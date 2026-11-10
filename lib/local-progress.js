/** Progress is backed by observable work; project-level ETA is intentionally absent. */
import {weightedPlan,planKey,hasTaskPlan}from'./weighted-progress.js'
import {checkpointProgress}from'./local-continuity.js'
import {taskPhase}from'./task-phase.js'
export function localProgress(view,{aiEnabled=false,aiScope='no-plan',now=Date.now()}={}) {
 const bar=view.projectBar??{},plan=view.plan??{},model=view.model,hasPlan=hasTaskPlan(view),total=plan.total??bar.total??0,done=plan.done??bar.done??0
 const evidenceAt=model?.evidenceAt??model?.at,ageMs=model?Math.max(0,now-evidenceAt):null
 const {phase,detailPhase}=taskPhase(view,{now,useModel:aiEnabled&&(!hasPlan||aiScope==='all')})
 const separateLead=!!view.children?.length&&!!view.ownPlan?.items?.length&&planKey(view.ownPlan.items)!==planKey(plan.items??[])
 const incompleteScope=plan.coverage==='delegated'||separateLead
 const historicalAi=view.lastAiReference?.turn===view.turn?view.lastAiReference:view.lastKnownProgress?{...view.lastKnownProgress,turn:view.turn}:null
 const base={historicalAi:!aiEnabled?historicalAi:null,phase,detailPhase,retainedPercent:aiEnabled&&(!hasPlan||aiScope==='all')?view.lastKnownProgress?.percent??null:null,planComplete:hasPlan&&done>=total,known:false,remainingMs:null,estimated:false,rangeMs:null,calibrationSamples:0,updatedAt:view.activityAt??0,indeterminate:true,percentKnown:false,source:hasPlan?'plan':'activity'}
 if(view.turnStatus==='completed')return{...base,phase:'completed',state:'completed',source:'completed',percent:1,percentKnown:true,indeterminate:false}
 if(view.localBridge&&(!aiEnabled||!model)){const checkpoint=checkpointProgress(view);if(checkpoint?.valid)return{...base,percent:checkpoint.percent,percentKnown:true,indeterminate:false,estimated:true,source:'local-bridge',state:view.running?'running':view.turnStatus??'interrupted'};return{...base,percent:hasPlan?done/total:0,state:'recalculating',source:'activity',bridgePaused:true}}
 if(!view.running)return{...base,state:view.turnStatus??'idle',percent:incompleteScope?view.lastKnownProgress?.percent??0:hasPlan?done/total:bar.percent??0,percentKnown:hasPlan&&!incompleteScope,indeterminate:false}

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

 return{...base,state:'running',percent:0}
}
