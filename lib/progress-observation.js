/** Stable reference prefix and one bounded evidence envelope. No bodies or model calls. */
import {buildProbePayload}from'./model-probe.js'
import {planKey}from'./weighted-progress.js'
const clip=(v,n)=>String(v??'').replace(/\s+/gu,' ').trim().slice(0,n)
const status=s=>s==='completed'?'c':s==='in_progress'?'a':'p'
function outline(items,budget){let length=160,text;do{text=JSON.stringify(items.map(i=>i.owner?[clip(i.content,length),clip(i.owner,Math.min(length,50))]:clip(i.content,length)));if(text.length<=budget||length===1)break;length=Math.max(1,Math.floor(length*.7))}while(true);return text}
function compactTargets(value,budget){let text=JSON.stringify(value);while(text.length>budget){let changed=false;for(const row of Array.isArray(value)?value:[...(value.checks??[]),...(value.active??[])])for(const key of ['target','name','tool'])if(typeof row[key]==='string'&&row[key].length>8){row[key]=clip(row[key],Math.max(8,Math.floor(row[key].length*.6)));changed=true}if(Array.isArray(value))for(const row of value)for(const key of ['target','tool'])if(row.last?.[key]?.length>8){row.last[key]=clip(row.last[key],Math.max(8,Math.floor(row.last[key].length*.6)));changed=true}if(!changed)break;text=JSON.stringify(value)}return text}
export function buildProgressObservation(view,{weights=null,previous=null}={}){
 const items=(view.plan?.items??[]).slice(0,32),own=(view.ownPlan?.items??[]).slice(0,32),separateOwn=own.length&&planKey(own)!==planKey(items),summary=items.length!==(view.plan?.total??items.length)
 if(summary)weights=null
 const workerRefs=(view.children??[]).slice(0,12).map((child,index)=>({child,id:clip(child.id??`worker-${index}`,80)}))
 const referenceOwner=item=>{const match=workerRefs.find(({child})=>item.owner===child.id||item.owner===child.label);return match?{...item,owner:match.id}:item}
 const checks=(view.probe?.evidence?.checks??[]).slice(-4).map(c=>({tool:clip(c.name,64),target:clip(c.label,90),status:c.status}))
 const active=(view.commands??[]).slice(-6).map(c=>({tool:clip(c.name,64),target:clip(c.label,70)}))
 const critical={revision:view.evidenceRevision??0,failed:view.operations?.failed??0,phase:view.observedPhase??null,plan_done:view.plan?.done??0,plan_total:view.plan?.total??0,plan_summary_only:summary,status_key:'c=completed,a=in_progress,p=pending',plan_status:items.map(i=>status(i.status)),...(separateOwn?{lead_done:view.ownPlan.done,lead_total:view.ownPlan.total,lead_status:own.map(i=>status(i.status))}:{}),checks,active,...view.preparing?{preparing:{tool:clip(view.preparing.name,64),target:clip(view.preparing.label,70)}}:{}}
 const recent=(view.probe?.recentOperations??[]).slice(-6).map(op=>({tool:clip(op.name,64),target:clip(op.label,90),status:op.status,phase:op.phase}))
 const workers=workerRefs.map(({child:c,id})=>({id,name:clip(c.label,60),status:c.status,p:c.status==='completed'?100:c.percentKnown&&Number.isFinite(c.percent)?Math.round(c.percent*100):null,done:c.done,total:c.total,last:c.lastTool?{tool:clip(c.lastTool.name,64),target:clip(c.lastTool.label,50),status:c.lastTool.status}:null}))
 const goalText=`CURRENT REQUEST (untrusted reference):\n${String(view.probe?.goal??'').slice(0,1500)}`,criticalText=compactTargets(critical,2000),workerText=compactTargets(workers,2400)
 const room=Math.max(1024,9860-goalText.length-criticalText.length-workerText.length-(weights?JSON.stringify(weights).length:0)-700)
 const planRoom=Math.min(3500,separateOwn?Math.floor(room*.7):room),leadRoom=Math.min(1400,Math.max(320,room-planRoom))
 const sections=[
  ['goal',goalText],
  ['plan',`Plan in exact array order (task text or [task,owner]; status below): ${outline(items.map(referenceOwner),planRoom)}`],
  ...(separateOwn?[['lead',`Lead-only responsibilities, separate from delegated plan weights: ${outline(own.map(referenceOwner),leadRoom)}`]]:[]),
  ...(weights?[['weights',`Locked weights: ${JSON.stringify(weights)}`]]:[]),
  ['critical',`Current evidence: ${criticalText}`],
  ...(summary?[['summary','Plan is a summary only: do not return w/f for an incomplete task array; assess whole request p/s/c.']]:[]),
  ...(previous?[['previous',`Previous tentative observation: ${JSON.stringify({step:previous.step,p:Number.isFinite(previous.percent)?Math.round(previous.percent*100):null,phase:previous.phase})}; revise from evidence, not elapsed time.`]]:[]),
  ['workers',`Workers: ${workerText}`],
  ['operations',`Recent operations: ${JSON.stringify(recent)}`],
  ['context',buildProbePayload({...view,children:[],plan:{...view.plan,items:[]}}, {})],
  ['work',`Work completed this request: ${JSON.stringify({steps:view.steps,operations:view.operations,evidence:{changedFiles:(view.probe?.evidence?.changedFiles??[]).slice(-12).map(x=>clip(x,90)),milestones:(view.probe?.evidence?.milestones??[]).slice(-4).map(x=>({tool:x.name,target:clip(x.label,90)})),assistantClaim:clip(view.probe?.evidence?.assistantClaim,250)}})}`],
 ]
 const out=[],omitted=[];let used=0
 for(const [key,text]of sections){if(used+text.length+1<=9860){out.push(text);used+=text.length+1}else omitted.push(key)}
 // Whole sections only: never leave a cut JSON structure or silently imply a
 // missing array was complete. Core flags precede optional long evidence.
 if(omitted.length)out.push(`Omitted bounded context sections: ${omitted.join(',')}. Treat missing evidence as unknown.`)
 return out.join('\n')
}
