/** Local policy: local event gating only. No timers, model calls or transcript retention. */
const materialTools=new Set(['write','edit','apply_patch','write_file','edit_file'])
const shellTools=new Set(['bash','exec_command','pwsh'])
const stable=v=>JSON.stringify(v)
const planIdentity=v=>stable((v.plan?.items??[]).map(i=>[i.id??null,i.content]))
const workers=v=>(v.children??[]).slice(0,12).map(c=>({id:c.id,status:c.status,start:c.workClock?.lastStart??0,p:c.percentKnown&&Number.isFinite(c.percent)?c.percent:null}))
const ownScope=v=>{const items=v.ownPlan?.items??[];return items.length&&planIdentity({plan:{items}})!==planIdentity(v)?stable(items.map(i=>[i.id??null,i.content,i.status])):null}
const roster=w=>stable(w.map(c=>[c.id,c.status,c.start]))
const phases={implement:1,verify:2,deliver:4}
export function createCadencePolicy({now=()=>Date.now()}={}) {
 const states=new Map()
 function state(id,view){let s=states.get(id);if(!s||s.turn!==view.turn){s={turn:view.turn,version:0,own:0,childUpdates:0,workerCritical:0,finish:0,finishSeen:new Set(),seenOps:new Set(),material:0,visual:0,visualMaterial:0,visualBudget:0,visualTargets:[],check:0,checkedMaterial:-1,checkResult:null,repair:0,repairOpen:false,phaseBits:0,accepted:null,flight:null,lastSentAt:0,lastSentOwn:0,stable:0,answer:false};states.set(id,s);if(states.size>64)states.delete(states.keys().next().value)}return s}
 function snapshot(s,view,step){return{version:s.version,turn:s.turn,own:s.own,childUpdates:s.childUpdates,workerCritical:s.workerCritical,finish:s.finish,ownPlan:ownScope(view),revision:view.evidenceRevision??0,failed:view.operations?.failed??0,plan:planIdentity(view),planTotal:view.plan?.total??0,planDone:view.plan?.done??0,workers:workers(view),material:s.material,visual:s.visual,check:s.check,repair:s.repair,phaseBits:s.phaseBits,at:step.at??now(),step:{...step}}}
 function update(id,view,step,{result=false,refresh=false}={}){
  const s=state(id,view);if(!refresh)s.version++
  if(!step.owner&&!result&&!refresh&&step.kind!=='finish-evidence')s.own++
  if(!refresh&&step.kind==='finish-evidence'&&!s.finishSeen.has(step.evidenceKey)){s.finish++;s.finishSeen.add(step.evidenceKey);if(s.finishSeen.size>128)s.finishSeen.delete(s.finishSeen.values().next().value)}
  if(result&&!refresh)s.childUpdates++
  if(step.workerCritical&&!refresh)s.workerCritical++
  const operations=(view.probe?.recentOperations?.length?view.probe.recentOperations:view.lastTool?[view.lastTool]:[]),occurrences=new Map()
  for(const op of operations){
   const signature=op.id??stable([op.finishedAt,op.name,op.label,op.phase,op.status]),ordinal=occurrences.get(signature)??0;occurrences.set(signature,ordinal+1)
   const key=op.id??signature+':'+ordinal
   if(s.seenOps.has(key))continue
   s.seenOps.add(key);if(s.seenOps.size>128)s.seenOps.delete(s.seenOps.values().next().value)
   const label=String(op.label??'')
   if(materialTools.has(op.name)||shellTools.has(op.name)&&op.phase==='implement'&&!/^(?:build|rebuild|install|compile|bundle|npm|pnpm|yarn)\b/iu.test(label)){s.material++;s.visualBudget=2;s.visualTargets=[]}
   if(/^(?:fix|repair|debug|rework|修复|排错)(?:\s|:|：)/iu.test(label)&&!s.repairOpen){s.repair++;s.repairOpen=true}
   if(op.name==='read_image'&&s.visualBudget>0&&!s.visualTargets.includes(label)){s.visual++;s.visualMaterial=s.material;s.visualBudget--;s.visualTargets.push(label);s.repairOpen=false}
   if(op.phase==='verify'&&(s.material>s.checkedMaterial||op.status!==s.checkResult)){s.check++;s.checkedMaterial=s.material;s.checkResult=op.status;if(op.status==='completed')s.repairOpen=false}
  }
  s.phaseBits|=phases[view.observedPhase]??0
  s.latest=snapshot(s,view,step)
  return s.latest
 }
 function decide(id,view,{mode='balanced',manual=false}={}){
  const s=state(id,view),f=s.latest??snapshot(s,view,{}),a=s.accepted,covered=s.flight??a,critical=[]
  // Sticky evidence is compared with the latest in-flight coverage, so a
  // failure followed by an ordinary read cannot erase the pending obligation.
  if(!s.answer&&!s.flight)critical.push('initial')
  if(covered){
   if(f.finish>(covered.finish??0))critical.push('finish-review')
   if(f.revision!==covered.revision||f.failed>covered.failed)critical.push('rework')
   if(f.plan!==covered.plan)critical.push('plan-change')
   if(f.ownPlan!==covered.ownPlan)critical.push('own-plan-change')
   if(f.workerCritical>(covered.workerCritical??0))critical.push('worker-critical')
   if(f.planTotal>0&&f.planDone>=f.planTotal&&covered.planDone<covered.planTotal)critical.push('plan-finished')
   if(roster(f.workers)!==roster(covered.workers))critical.push('workers-change')
   if(f.visual>covered.visual)critical.push('visual-check')
   if(f.check>covered.check)critical.push('verification')
   if(f.repair>covered.repair)critical.push('repair-intent')
   if((f.phaseBits&~covered.phaseBits)!==0)critical.push('phase-milestone')
  }
  const owner=!!f.step.owner,isResult=f.step.kind==='worker-result',late=(s.phaseBits&6)!==0
  const ownGap=f.own-s.lastSentOwn,dirty=!a||f.version>a.version
  const limit=mode==='every-2'||late||f.material>(covered?.material??0)?2:s.stable>=2?4:2
  let due=false,reason='merge',priority=0
  if(manual){due=true;reason='manual';priority=3}
  else if(mode==='step'){const sameFinish=covered?.step?.kind==='finish-evidence'&&f.step.kind!=='finish-evidence'&&f.step.step===covered.step.step&&(f.step.owner??id)===(covered.step.owner??id)&&!critical.length&&f.material===covered.material&&f.planDone===covered.planDone&&stable(f.workers)===stable(covered.workers);due=!isResult&&!sameFinish;reason=sameFinish?'finish-covered':'every-step'}
  else if(critical.length){due=true;reason=critical[0];priority=2}
  else if(ownGap>=limit){due=true;reason=limit===4?'stable-four':'ordinary-two'}
  else if(owner){
   const previous=new Map((covered?.workers??[]).map(c=>[c.id,c.p]))
   const changed=f.workers.some(c=>c.p!==null&&previous.get(c.id)!==null&&previous.has(c.id)&&Math.abs(c.p-previous.get(c.id))>=.10)
   const childGap=f.childUpdates-(covered?.childUpdates??0)
   if(changed){due=true;reason='worker-progress';priority=1}
   else if(childGap>=4){due=true;reason='worker-updates'}
   else if(dirty&&s.lastSentAt&&now()-s.lastSentAt>=45000){due=true;reason='event-age'}
   else reason='parent-merge'
  }else{
   if(dirty&&s.lastSentAt&&now()-s.lastSentAt>=45000){due=true;reason='event-age'}
  }
  return{due,reason,priority,critical,ticket:{...f,reason,priority,critical}}
 }
 function dispatched(id,ticket){const s=states.get(id);if(!s||s.turn!==ticket.turn)return;s.flight=ticket;s.lastSentAt=now();s.lastSentOwn=ticket.own}
 function settled(id,ticket,{accepted=false,percent=null,phase=null,confidence=null}={}){
  const s=states.get(id);if(!s||s.turn!==ticket.turn)return
  if(s.flight?.version===ticket.version)s.flight=null
  if(!accepted)return
  const old=s.accepted
  s.stable=confidence!==0&&Number.isFinite(percent)&&Number.isFinite(old?.percent)&&confidence===2&&Math.abs(percent-old.percent)<=.01&&phase===old.phase&&!ticket.critical.some(k=>k!=='initial')?Math.min(3,s.stable+1):0
  s.accepted={...ticket,percent,phase};s.answer=true
 }
 return{update,decide,dispatched,settled,drop(id){states.delete(id)},dispose(){states.clear()}}
}
