/** Event-gated Off observations. No polling-driven calls or hourly quota. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {planKey,normalizeWeights,hasTaskPlan} from './weighted-progress.js'
import {localProgress,modelContinuity} from './local-progress.js'
import {createCadencePolicy} from './probe-policy.js'
import {buildProgressObservation} from './progress-observation.js'
const cadenceOf=value=>value==='step'?'step':value==='every-2'?'every-2':'balanced'
const emptyDecisions=()=>({boundaries:0,skipped:0,coalesced:0,dispatched:0,critical:0})
const emptyUsage=()=>({requests:0,succeeded:0,failed:0,inputTokens:0,cacheReadTokens:0,outputTokens:0,costCny:0,costUsd:0,pricedRequests:0,unpricedRequests:0})
export function createAiProgress({probe,snapshot,setModel,recordObservation=()=>{},history=()=>null,quote=async()=>null,log=()=>{},now=()=>Date.now(),file=path.join(process.env.DSH_HOME??path.join(os.homedir(),'.dsh'),'dsh-task-progress','preferences.json'),defaults={aiEnabled:false,aiScope:'all',cadence:'balanced'}}) {
 let settings={aiEnabled:defaults.aiEnabled,aiScope:defaults.aiScope,cadence:cadenceOf(defaults.cadence),developerMode:defaults.developerMode===true},visible=null,seenAt=0,pending=null,controller=null,disposed=false,configurationRevision=0
 const states=new Map(),queue=[],usage=emptyUsage(),policy=createCadencePolicy({now});let criticalBurst=0
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if([1,2,3].includes(saved.version))settings={aiEnabled:saved.aiEnabled===true,aiScope:saved.aiScope==='no-plan'?'no-plan':'all',cadence:cadenceOf(saved.cadence),developerMode:saved.developerMode===true}}catch{}
 const costFields=['costCny','costUsd','pricedRequests','unpricedRequests']
 const moneySnapshot=(value,requests=value?.requests??0)=>{
  const amount=key=>Number.isFinite(value?.[key])&&value[key]>=0?value[key]:0
  const priced=Math.min(requests,amount('pricedRequests'))
  return{costCny:amount('costCny'),costUsd:amount('costUsd'),pricedRequests:priced,unpricedRequests:Math.max(requests-priced,amount('unpricedRequests'))}
 }
 const replaceableCosts=(recovered,initial,requests)=>recovered?.requests===requests&&costFields.every(key=>Number.isFinite(recovered[key])&&recovered[key]>=0)&&recovered.pricedRequests+recovered.unpricedRequests===requests&&recovered.pricedRequests>=initial.pricedRequests&&recovered.costCny+1e-12>=initial.costCny&&recovered.costUsd+1e-12>=initial.costUsd
 const replaceInitialCosts=(target,initial,recovered)=>{for(const key of costFields)target[key]+=recovered[key]-initial[key]}
 const state=(id,view)=>{
  let s=states.get(id)
  if(!s||s.turn!==view.turn){
   const saved=history(id,view.turn),restored=view.probeStats??saved?.stats,initialRequests=restored?.requests??0,initialCosts=moneySnapshot(restored,initialRequests)
   const workerUsage=Object.fromEntries(Object.entries(restored?.workerUsage??{}).map(([key,value])=>[key,{...emptyUsage(),...value,...moneySnapshot(value)}]))
   s={turn:view.turn,seen:new Set(),advice:null,error:null,weights:null,planKey:null,manual:false,history:(view.observations?.length?view.observations:saved?.history??[]).slice(-32),stats:{...emptyUsage(),...restored,...initialCosts},workerUsage,initialWorkerUsage:structuredClone(workerUsage),initialCosts,costRecovery:initialRequests>0&&(initialCosts.unpricedRequests>0||!Number.isFinite(restored?.costCny)||!Number.isFinite(restored?.costUsd)),initialRequests,decisions:{...emptyDecisions(),...restored?.decisions},lastReason:'await-step',retryAt:0}
   states.set(id,s);if(states.size>64)states.delete(states.keys().next().value)
  }
  if(s.costRecovery&&history.costsReady){
   const recovered=history(id,view.turn)?.stats
   // A bounded/rotated log must cover the complete initial prefix. Replace
   // only that monetary share; live requests already in stats are additive.
   if(replaceableCosts(recovered,s.initialCosts,s.initialRequests)){
    replaceInitialCosts(s.stats,s.initialCosts,recovered)
    for(const [workerId,amounts]of Object.entries(recovered.workerUsage??{})){
     const initial=s.initialWorkerUsage[workerId],target=s.workerUsage[workerId]??=emptyUsage()
     if(initial){if(replaceableCosts(amounts,initial,initial.requests))replaceInitialCosts(target,initial,amounts)}
     else if(replaceableCosts(amounts,moneySnapshot(null,amounts.requests),amounts.requests))for(const key of Object.keys(emptyUsage()))target[key]+=amounts[key]??0
    }
   }
   s.costRecovery=false;recordObservation(id,{turn:view.turn,stats:{...s.stats,workerUsage:s.workerUsage}})
  }
  return s
 }
 const family=(id)=>{if(!visible||now()-seenAt>5000)return null;if(id===visible)return{id,view:snapshot(id)};const root=snapshot(visible);return root.running&&root.children?.some(child=>child.id===id)?{id:visible,view:root}:null}
 const eligible=(id,view,s)=>view.running&&!!family(id)&&(s.manual||settings.aiEnabled&&(!hasTaskPlan(view)||settings.aiScope==='all'))
 const payload=(view,weights,previous)=>buildProgressObservation(view,{weights,previous})

 const savedStats=s=>({...s.stats,workerUsage:s.workerUsage,decisions:s.decisions})
 const enqueue=(id,view,step,{result=false}={})=>{
  if(disposed)return false
  const s=state(id,view)
  if(step.owner&&!step.ownerLabel)step={...step,ownerLabel:view.children?.find(child=>child.id===step.owner)?.label??'#'+String(step.owner).slice(-6)}
  const key=String(step.owner??id)+':'+String(step.seq)
  if(s.seen.has(key))return false
  s.seen.add(key);if(s.seen.size>256)s.seen.delete(s.seen.values().next().value)
  // Remember even disabled/ineligible boundaries: enabling AI later must not
  // replay one through request() as though it were new work.
  if(!eligible(id,view,s))return false
  policy.update(id,view,step,{result})
  if(!result&&step.kind!=='finish-evidence')s.decisions.boundaries++
  const existing=settings.cadence==='step'?null:queue.find(job=>job.id===id&&job.view.turn===view.turn)
  const decision=policy.decide(id,view,{mode:settings.cadence,manual:s.manual||existing?.manual})
  s.latestBoundary={step:{...step},version:decision.ticket.version}
  let action='merge'
  if(existing){Object.assign(existing,{view:structuredClone(view),step:{...step},ticket:decision.ticket,manual:existing.manual||s.manual});s.decisions.coalesced++;action='replace'}
  else if(decision.due){
   if(queue.length>=128){const dropped=queue.shift();const old=states.get(dropped.id);if(old)old.merged=(old.merged??0)+1}
   const root=family(id)
   queue.push({id,rootId:root.id,rootTurn:root.view.turn,configurationRevision,view:structuredClone(view),step:{...step},manual:s.manual,queuedAt:now(),ticket:decision.ticket});action='queue'
  }else{s.decisions.skipped++;s.lastReason=decision.reason}
  log({kind:'probe-decision',sid:id,turn:view.turn,at:now(),step:step.step,owner:step.owner??null,mode:settings.cadence,action,reason:decision.reason,critical:decision.critical,revision:view.evidenceRevision??0})
  if(existing||decision.due){if(s.manual)s.manual=false;s.lastReason=pending?'queued':'step-completed';return true}
  return false
 }

 // Reconsider only a real boundary that arrived during a failed request.
 // A clock tick with no intervening boundary cannot create a retry request.
 const recoverMergedBoundary=(job,view,s)=>{
  const latest=s.latestBoundary
  if(settings.cadence==='step'||!latest||latest.version<=job.ticket.version||queue.some(j=>j.id===job.id&&j.view.turn===view.turn)||!eligible(job.id,view,s))return
  policy.update(job.id,view,latest.step,{refresh:true})
  const decision=policy.decide(job.id,view,{mode:settings.cadence})
  if(decision.due)queue.push({...job,view:structuredClone(view),step:{...latest.step},ticket:decision.ticket,manual:false,queuedAt:now()})
 }

 const api={
  get busy(){return pending!==null},
  get settings(){return{...settings,reasoningEffort:'off'}},
  configure(next){
   const previous=settings;settings={aiEnabled:next.aiEnabled??settings.aiEnabled,aiScope:next.aiScope??settings.aiScope,cadence:cadenceOf(next.cadence??settings.cadence),developerMode:next.developerMode??settings.developerMode}
   try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({version:3,...settings}),{mode:0o600});fs.renameSync(file+'.tmp',file)}catch(error){settings=previous;throw error}
   if(previous.aiEnabled!==settings.aiEnabled||previous.aiScope!==settings.aiScope){
    // A sent request is allowed to finish for complete token/cost accounting.
    // Its generation can no longer update progress, advice or policy state.
    configurationRevision++;queue.length=0
    for(const [id,s]of states){s.manual=false;s.advice=null;s.error=null;s.errors=0;s.retryAt=0;s.latestBoundary=null;policy.drop(id)
     const boundary=snapshot(id)?.boundary
     if(boundary?.kind==='step/end')s.seen.add(String(boundary.owner??id)+':'+String(boundary.seq))
    }
   }else if(previous.cadence!==settings.cadence){
    if(settings.cadence==='step'){
     // A merged historical snapshot is not a new step. Fine mode starts at
     // the next boundary, without expanding/backfilling the previous batch.
     for(let i=queue.length-1;i>=0;i--)if(!queue[i].manual)queue.splice(i,1)
    }else{
     const latest=new Map()
     for(const job of queue){const key=job.id+':'+job.view.turn,old=latest.get(key)
      if(old){const s=states.get(job.id);if(s)s.decisions.coalesced++;job.queuedAt=Math.min(job.queuedAt,old.queuedAt);job.manual=job.manual||old.manual}
      latest.set(key,job)
     }
     queue.splice(0,queue.length,...latest.values())
    }
   }
   return this.settings
  },
  observe(id){if(pending&&pending.id!==id&&pending.rootId!==id)controller?.abort();if(visible&&visible!==id){for(let i=queue.length-1;i>=0;i--)if(queue[i].id===visible)queue.splice(i,1)}visible=id||null;seenAt=now()},
  completedStep(id,view,step){return enqueue(id,view,step)},
  status(id,historicalView){
   if(historicalView?.historical){
    const saved=history(id,historicalView.turn),stats=historicalView.probeStats??saved?.stats??emptyUsage()
    return{enabled:settings.aiEnabled,state:'idle',draining:false,available:probe?.available??false,usage:{...usage},turnUsage:{...emptyUsage(),...stats},workerUsage:structuredClone(stats.workerUsage??{}),cadenceStats:{...emptyDecisions(),...stats.decisions},history:(historicalView.observations?.length?historicalView.observations:saved?.history??[]).slice(-32),queuedSteps:0,assessingStep:null,assessingOwner:null,lastReason:'historical',error:null}
   }
   const view=snapshot(id),s=state(id,view),jobs=queue.filter(job=>job.id===id&&job.view.turn===view.turn),active=pending?.id===id&&pending.view.turn===view.turn
   const currentActive=active&&pending.configurationRevision===configurationRevision
   return{enabled:settings.aiEnabled,state:currentActive?'updating':jobs.length||s.manual?'queued':s.error?'unavailable':'idle',draining:!!active&&!currentActive,available:probe?.available??false,nextAt:s.retryAt,usage:{...usage},turnUsage:{...s.stats,costPending:s.costRecovery},workerUsage:structuredClone(s.workerUsage),cadenceStats:{...s.decisions},history:s.history.slice(),queuedSteps:jobs.length,assessingStep:currentActive?pending.step.step:null,assessingOwner:currentActive?pending.step.ownerLabel??null:null,lastReason:s.lastReason,lastAt:s.history.at(-1)?.at??null,lastLatencyMs:s.history.at(-1)?.latencyMs??null,mergedSteps:s.merged??0,advice:s.advice,error:s.error}
  },
  async request(id,{manual=false}={}) {
   const view=snapshot(id),s=state(id,view)
   if(!view.running)return{ok:false,reason:'idle'}
   if(!probe?.available)return{ok:false,reason:'unavailable'}
   if(manual){s.manual=true;if(!family(id))visible=id;seenAt=now();s.lastReason='await-step';return{ok:true,queued:true,reason:'await-step'}}
   // Compatibility for event replayers: only an actual completed step can enqueue.
   const boundary=view.boundary
   if(boundary?.kind==='step/end'&&now()-boundary.at<3000)enqueue(id,view,{seq:boundary.seq,at:boundary.at,step:view.steps})
   return this.tick()
  },
  async tick(){
   if(disposed)return{ok:false,reason:'disposed'}
   if(pending)return{ok:false,reason:'busy'}
   if(!queue.length)return{ok:false,reason:'await-step'}
   // Skip another actor's backoff; one failing route must not block the family.
   let candidates=[]
   for(let i=queue.length-1;i>=0;i--){const j=queue[i],v=snapshot(j.id),st=state(j.id,v);if(j.view.turn!==v.turn||!(j.manual?v.running&&!!family(j.id):eligible(j.id,v,st))){queue.splice(i,1);continue}if(now()>=st.retryAt)candidates.push(j)}
   if(!candidates.length)return{ok:false,reason:queue.length?'retry-backoff':'await-step'}
   candidates.sort((a,b)=>(b.ticket?.priority??0)-(a.ticket?.priority??0)||a.queuedAt-b.queuedAt)
   if(criticalBurst>=2){const normal=candidates.filter(j=>(j.ticket?.priority??0)<2&&now()-j.queuedAt>=2000).sort((a,b)=>a.queuedAt-b.queuedAt)[0];if(normal)candidates=[normal,...candidates.filter(j=>j!==normal)]}
   const job=candidates[0],current=snapshot(job.id),s=state(job.id,current)
   if(!probe?.available){queue.splice(queue.indexOf(job),1);s.error='Off probe unavailable';return{ok:false,reason:'unavailable'}}
   const view=settings.cadence==='step'?{...job.view,children:current.children??job.view.children}:current
   if(settings.cadence!=='step'){
    policy.update(job.id,view,job.step,{refresh:true})
    const decision=policy.decide(job.id,view,{mode:settings.cadence,manual:job.manual})
    if(!decision.due){queue.splice(queue.indexOf(job),1);s.lastReason='already-covered';return{ok:false,reason:'already-covered'}}
    job.ticket=decision.ticket
   }
   queue.splice(queue.indexOf(job),1);s.manual=false;pending=job;controller=new AbortController();const signal=controller.signal
   policy.dispatched(job.id,job.ticket);criticalBurst=(job.ticket.priority??0)>=2?criticalBurst+1:0
   const items=view.plan?.items??[],identity=planKey(items)
   if(s.planKey!==identity){const saved=view.probe?.lockedWeights;s.weights=saved?.turn===view.turn&&saved.planKey===identity?normalizeWeights(saved.weights,items.length):null;s.planKey=identity}
   const rootView=job.rootId!==job.id?snapshot(job.rootId):null,rootState=rootView?.turn===job.rootTurn?state(job.rootId,rootView):null
   let answer=null,attempt=null,exception=null
   const continuity=modelContinuity(view)
   const requestText=payload(view,s.weights,s.advice)
   try{answer=await probe.ask(requestText,signal,{sessionId:job.id,turn:view.turn,rootSessionId:job.rootId,rootTurn:job.rootTurn,step:job.step.step})}catch(error){exception=error.message}
   finally{attempt=probe.lastAttempt;for(const target of [usage,s.stats]){target.requests+=attempt?.calls??1;for(const field of ['inputTokens','outputTokens','cacheReadTokens'])target[field]+=attempt?.usage?.[field]??0}}
   let cost=null;try{cost=await quote(attempt,{at:attempt?.startedAt??now(),sid:job.id})}catch{}
   for(const target of [usage,s.stats]){if(cost?.priced&&Number.isFinite(cost.cny)&&Number.isFinite(cost.usd)){target.costCny+=cost.cny;target.costUsd+=cost.usd;target.pricedRequests+=attempt?.calls??1}else target.unpricedRequests+=attempt?.calls??1}
   pending=null;controller=null;s.decisions.dispatched+=attempt?.calls??1;if((job.ticket.priority??0)>=2)s.decisions.critical+=attempt?.calls??1
   const latest=snapshot(job.id),rootLatest=job.rootId!==job.id?snapshot(job.rootId):null,cancelled=signal.aborted||disposed||latest.turn!==view.turn||!latest.running||rootLatest&&(rootLatest.turn!==job.rootTurn||!rootLatest.running),superseded=job.configurationRevision!==configurationRevision
   const weights=items.length&&items.length===view.plan.total?(s.weights??normalizeWeights(answer?.weights,items.length)):null
   const model=answer?{continuity,percent:answer.percent,phase:answer.phase,confidence:answer.confidence,weights,fractions:answer.fractions,planKey:identity,at:now(),turn:view.turn,remainingMs:null,evidenceRevision:view.evidenceRevision,forStep:job.step.step,observedAt:job.step.at,evidenceAt:Number.isFinite(view.updatedAt)?view.updatedAt:job.queuedAt??job.step.at??now(),route:`${answer.provider}:${answer.model}:percent-off-v06`}:null
   const display=model?localProgress({...view,model},{aiEnabled:true,aiScope:'all',now:now()}):null
   const fresh=!superseded&&latest.evidenceRevision===view.evidenceRevision&&planKey(latest.plan?.items??[])===identity
   const percent=fresh&&display?.percentKnown&&['model','weighted'].includes(display.source)?display.percent:null
   const kind=cancelled?'cancelled':answer?'probe':'failure',record={at:now(),percent:kind==='probe'?percent:null,kind,step:job.step.step,owner:job.step.owner??null,ownerLabel:job.step.ownerLabel??null,trigger:job.step.kind==='finish-evidence'?job.step.evidenceKind:job.step.owner?'worker-step':'step-end',latencyMs:attempt?.latencyMs??null}
   s.stats[kind==='probe'?'succeeded':'failed']++;usage[kind==='probe'?'succeeded':'failed']++
   s.history.push(record);if(s.history.length>32)s.history.shift()
   if(rootState){
    const delta={...emptyUsage(),requests:attempt?.calls??1,inputTokens:attempt?.usage?.inputTokens??0,cacheReadTokens:attempt?.usage?.cacheReadTokens??0,outputTokens:attempt?.usage?.outputTokens??0,[kind==='probe'?'succeeded':'failed']:1}
    if(cost?.priced){delta.costCny=cost.cny;delta.costUsd=cost.usd;delta.pricedRequests=delta.requests}else delta.unpricedRequests=delta.requests
    const worker=rootState.workerUsage[job.id]??=(emptyUsage())
    for(const key of Object.keys(emptyUsage())){rootState.stats[key]+=delta[key];worker[key]+=delta[key]}
    recordObservation(job.rootId,{turn:job.rootTurn,stats:savedStats(rootState)})
   }
   recordObservation(job.id,{turn:view.turn,record,stats:savedStats(s)})
   log({kind,sid:job.id,turn:view.turn,rootSid:job.rootId,rootTurn:job.rootTurn,at:record.at,step:job.step.step,owner:record.owner,ownerLabel:record.ownerLabel,modelPercent:record.percent,overallPercent:answer?.percent??null,inputChars:requestText.length,evidenceAt:model?.evidenceAt??null,acceptedEvidence:fresh&&!cancelled,cadence:settings.cadence,decisionReason:job.ticket.reason,modelConfidence:answer?.confidence??null,modelPhase:answer?.phase??null,planMode:view.projectBar?.mode??null,displaySource:display?.source??null,planCoverage:view.plan?.coverage??null,cost,modelEtaMs:null,trigger:record.trigger,...attempt,percentOnly:true,error:kind==='failure'?probe.lastError??exception:null})
   if(cancelled){policy.settled(job.id,job.ticket);return{ok:false,reason:'cancelled'}}
   if(superseded)return{ok:false,reason:'settings-changed'}
   if(!answer){policy.settled(job.id,job.ticket);s.error=probe.lastError??exception??'No answer';s.retryAt=now()+Math.min(30000,1000*2**Math.min(5,s.errors=(s.errors??0)+1));s.lastReason='failed';recoverMergedBoundary(job,latest,s);return{ok:false,reason:'unavailable'}}
   s.error=null;s.errors=0;s.retryAt=0;s.lastReason='await-step';s.advice={percent,phase:answer.phase,at:now(),turn:view.turn,step:job.step.step,reasoningEffort:answer.reasoningEffort}
   const accepted=fresh&&settings.aiEnabled&&(!hasTaskPlan(latest)||settings.aiScope==='all')
   if(accepted){if(weights)s.weights=weights;setModel(job.id,model)}
   policy.settled(job.id,job.ticket,{accepted:fresh,percent,phase:answer.phase,confidence:answer.confidence})
   if(accepted&&job.rootId!==job.id&&settings.cadence!=='step'){
    const parent=snapshot(job.rootId)
    enqueue(job.rootId,parent,{...job.step,owner:job.id,ownerLabel:parent.children?.find(c=>c.id===job.id)?.label,seq:'result:'+job.id+':'+job.step.seq,kind:'worker-result',workerCritical:job.ticket.critical.some(reason=>reason!=='initial')},{result:true})
   }

   return{ok:true,advice:s.advice}
  },
  cancel(id,{drain=false}={}){if(!drain&&(pending?.id===id||pending?.rootId===id))controller?.abort();for(let i=queue.length-1;i>=0;i--)if(queue[i].id===id||queue[i].rootId===id)queue.splice(i,1);const s=states.get(id);if(s){s.manual=false;recordObservation(id,{turn:s.turn,stats:savedStats(s)})}},
  dispose(){disposed=true;controller?.abort();queue.length=0;states.clear();policy.dispose()},
 }
 return api
}
