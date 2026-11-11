/** Observable work and optional AI estimates; total ETA is attached by task-eta. */
import {weightedPlan,planKey,hasTaskPlan}from'./weighted-progress.js'
import {checkpointProgress}from'./local-continuity.js'
import {taskPhase}from'./task-phase.js'
import {estimateLocalProgress}from'./local-estimator.js'
const fingerprint=value=>{let hash=2166136261;for(const c of String(value)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(36)}
/** A compact baseline for separating new evidence from actual scope/rework. */
export function modelContinuity(view){
 const items=view.plan?.items??[],own=view.ownPlan?.items??[],root=view.localEvidence?.root
 return {turn:view.turn,goal:fingerprint(view.probe?.goal??''),plan:planKey(items),own:planKey(own),
  statuses:items.map(item=>item.status),ownStatuses:own.map(item=>item.status),generation:view.localEvidence?.generation??0,
  failures:view.operations?.failed??0,material:root?.material??0,verified:root?.verified??-1,
  workers:Object.fromEntries((view.children??[]).map(child=>[child.id,{turn:child.turn??1,failed:child.operations?.failed??0}]))}
}
function canRetainModel(view,model){
 const before=model?.continuity
 if(!before||model.confidence===0||model.turn!==view.turn||before.turn!==view.turn||!Number.isFinite(model.percent))return false
 const after=modelContinuity(view)
 if(before.goal!==after.goal||before.plan!==after.plan||before.own!==after.own||before.generation!==after.generation||after.failures>before.failures)return false
 const regressed=(old,next)=>old.some((status,i)=>status==='completed'&&next[i]!=='completed'||status==='in_progress'&&next[i]==='pending')
 if(regressed(before.statuses,after.statuses)||regressed(before.ownStatuses,after.ownStatuses))return false
 if(before.verified>=0&&before.verified===before.material&&after.material>before.material)return false
 for(const[id,child]of Object.entries(after.workers)){const old=before.workers[id];if(child.failed>(old?.failed??0)||old&&child.turn>old.turn)return false}
 return true
}
function progressSource(view,{aiEnabled=false,aiScope='no-plan',now=Date.now()}={}) {
 const bar=view.projectBar??{},plan=view.plan??{},model=view.model,hasPlan=hasTaskPlan(view),total=plan.total??bar.total??0,done=plan.done??bar.done??0
 const evidenceAt=model?.evidenceAt??model?.at,ageMs=model?Math.max(0,now-evidenceAt):null
 const {phase,detailPhase}=taskPhase(view,{now,useModel:aiEnabled&&(!hasPlan||aiScope==='all')})
 const separateLead=!!view.children?.length&&!!view.ownPlan?.items?.length&&planKey(view.ownPlan.items)!==planKey(plan.items??[])
 const incompleteScope=plan.coverage==='delegated'||separateLead
 const historicalAi=view.lastAiReference?.turn===view.turn?view.lastAiReference:view.lastKnownProgress?{...view.lastKnownProgress,turn:view.turn}:null
 const base={historicalAi:!aiEnabled?historicalAi:null,phase,detailPhase,retainedPercent:aiEnabled&&(!hasPlan||aiScope==='all')?view.lastKnownProgress?.percent??null:null,planComplete:hasPlan&&done>=total,known:false,remainingMs:null,estimated:false,rangeMs:null,calibrationSamples:0,updatedAt:view.activityAt??0,indeterminate:true,percentKnown:false,source:hasPlan?'plan':'activity'}
 if(view.turnStatus==='completed')return{...base,phase:'completed',state:'completed',source:'completed',percent:1,percentKnown:true,indeterminate:false}
 const local=estimateLocalProgress(view),bridgePaused=!!view.localBridge&&checkpointProgress(view)?.valid!==true
 if(view.localBridge&&(!aiEnabled||!model)){const checkpoint=checkpointProgress(view);if(checkpoint?.valid)return{...base,...local,percent:checkpoint.percent,source:'local-bridge',state:view.running?'running':view.turnStatus??'interrupted'}}
 if(!view.running&&aiEnabled&&(!hasPlan||aiScope==='all')&&Number.isFinite(view.lastKnownProgress?.percent))return{...base,estimated:true,source:'model',state:view.turnStatus??'interrupted',percent:Math.max(0,Math.min(.99,view.lastKnownProgress.percent)),percentKnown:true,indeterminate:false}
 if(!view.running)return{...base,...local,bridgePaused,state:view.turnStatus??'idle',percent:view.localEvidence?.lastPercent??(view.localEvidence?local.percent:incompleteScope?view.lastKnownProgress?.percent??local.percent:hasPlan?Math.min(.99,done/total):bar.percent??local.percent)}

 if(!aiEnabled||hasPlan&&aiScope!=='all')return{...base,...local,bridgePaused,state:'running'}

 const canUseAi=aiEnabled&&(!hasPlan||aiScope==='all')&&model?.turn===view.turn&&Number.isFinite(model.percent)
 if(hasPlan){
  const items=plan.items??[],weighted=weightedPlan(items,canUseAi?model:null),complete=done>=total
  // A shared board may cover only delegated assets. Its 2/2 says nothing
  // about the lead's remaining implementation, integration or validation.
  if((complete||plan.coverage==='delegated'||separateLead)&&canUseAi&&model.overallScope!=='parent'&&(!model.planKey||model.planKey===planKey(items))){const stale=ageMs>600000||model.evidenceRevision!==view.evidenceRevision;return{...base,state:stale?'recalculating':'running',percent:Math.max(0,Math.min(.99,model.percent)),percentKnown:!stale&&model.confidence!==0,indeterminate:stale||model.confidence===0,estimated:true,source:'model',weights:weighted.weights,fractions:weighted.fractions,ageMs,updatedAt:evidenceAt}}
  if(plan.coverage==='delegated'||separateLead)return{...base,state:canUseAi?'recalculating':'running',percent:done/total,source:'activity'}
  const completeSummary=items.length===total,weights=canUseAi&&completeSummary&&weighted.weights,unsupported=!!weights&&model.confidence===0,stale=!!weights&&(ageMs>600000||model.evidenceRevision!==view.evidenceRevision)
  // Keep completed contributions; stale or unsupported fractions cannot become
  // a fresh number or overwrite the tracker's last valid progress. A clipped
  // checklist uses exact item counts instead of waiting for impossible weights.
  const grounded=stale||unsupported?weightedPlan(items,{...model,fractions:[]}):weighted,progress=grounded.percent
  const awaitingWeights=canUseAi&&completeSummary&&!weights
  return{...base,state:complete?'finishing':stale||unsupported||awaitingWeights?'recalculating':'running',percent:weights?progress:done/total,percentKnown:!complete&&!stale&&!unsupported&&!awaitingWeights,indeterminate:complete||stale||unsupported||awaitingWeights,estimated:!!weights,source:weights?'weighted':'plan',weights:weights||null,fractions:weights?grounded.fractions:null,ageMs:weights?ageMs:null,updatedAt:weights?evidenceAt:base.updatedAt}
 }
 if(canUseAi){const stale=ageMs>600000||model.evidenceRevision!==view.evidenceRevision;return{...base,percent:model.percent,estimated:true,source:'model',state:stale?'recalculating':'running',percentKnown:!stale&&model.confidence!==0,indeterminate:stale||model.confidence===0,ageMs,updatedAt:evidenceAt}}

 return{...base,...local,state:'running'}
}
/** A missing/stale AI result never removes the available local numeric estimate. */
export function localProgress(view,settings={}){
 const display=progressSource(view,settings)
 if(view.running&&view.finalResponseCandidate)return{...display,percent:.99,percentKnown:true,indeterminate:false,estimated:true,state:'answering',phase:'deliver',detailPhase:'answering',source:'final-response'}
 if(!view.running||display.percentKnown)return display
 if(settings.aiEnabled&&display.state==='recalculating'&&canRetainModel(view,view.model)){
  const prior=view.lastKnownProgress?.percent??view.model.percent
  return{...display,percent:Math.max(0,Math.min(.99,prior)),percentKnown:true,indeterminate:false,estimated:true,source:'model-retained',retained:true,updatedAt:view.model.evidenceAt??view.model.at}
 }
 const local=estimateLocalProgress(view)
 // Difficulty weights survive uncertainty about an active item's completion.
 if(Array.isArray(display.weights)&&Array.isArray(local.fractions)&&display.weights.length===local.fractions.length){local.weights=display.weights;local.percent=Math.min(.99,local.fractions.reduce((n,p,i)=>n+p*display.weights[i],0));local.source='local-weighted'}
 return{...display,...local,state:display.state}
}
