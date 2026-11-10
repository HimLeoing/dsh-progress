/** A frozen AI checkpoint plus future completed items; never time-based extrapolation. */
import {planKey,normalizeWeights} from './weighted-progress.js'
import {localPlanFractions} from './local-estimator.js'
const identity=items=>JSON.stringify(items.map(item=>[item.id??null,String(item.content??'').slice(0,240),item.owner??null,item.blockedBy??[]]))
export function wholeChecklist(view){
 const plan=view.plan??{},items=plan.items??[],own=view.ownPlan?.items??[]
 return items.length>0&&items.length===plan.total&&plan.coverage!=='delegated'&&!(view.projectBar?.mode==='team'&&view.children?.length)&&(!own.length||planKey(own)===planKey(items))
}
export function freezeLocalCheckpoint(view,display){
 if(view.localBridge&&checkpointProgress(view)?.valid)return structuredClone(view.localBridge)
 if(!view.running||!display?.percentKnown||!Number.isFinite(display.percent))return null
 const items=view.plan?.items??[],weights=normalizeWeights(display.weights,items.length)??items.map(()=>1/Math.max(1,items.length))
 const remaining=items.map((item,index)=>item.status==='completed'?0:weights[index]),sum=remaining.reduce((a,b)=>a+b,0)
 if(!wholeChecklist(view)||sum<=0)return null
 return{turn:view.turn,revision:view.evidenceRevision??0,identity:identity(items),workers:JSON.stringify((view.children??[]).map(c=>[c.id,c.workClock?.lastStart??null])),percent:Math.min(.99,Math.max(0,display.percent)),remaining,localFractions:localPlanFractions(view),completed:items.map(item=>item.status==='completed'),at:view.updatedAt??Date.now()}
}
export function checkpointProgress(view){
 const checkpoint=view.localBridge,items=view.plan?.items??[]
 if(!checkpoint)return null
 if(!Number.isFinite(checkpoint.percent)||checkpoint.percent<0||checkpoint.percent>.99||!Array.isArray(checkpoint.remaining)||checkpoint.remaining.length!==items.length||checkpoint.remaining.some(n=>!Number.isFinite(n)||n<0)||!Number.isFinite(checkpoint.remaining.reduce((a,b)=>a+b,0))||checkpoint.remaining.reduce((a,b)=>a+b,0)<=0||!Array.isArray(checkpoint.completed)||checkpoint.completed.length!==items.length||checkpoint.completed.some(n=>typeof n!=='boolean'))return{valid:false}
 const invalid=checkpoint.turn!==view.turn||checkpoint.revision!==(view.evidenceRevision??0)||!wholeChecklist(view)||checkpoint.identity!==identity(items)||checkpoint.workers!==JSON.stringify((view.children??[]).map(c=>[c.id,c.workClock?.lastStart??null]))||items.some((item,index)=>checkpoint.completed[index]&&item.status!=='completed')
 if(invalid)return{valid:false}
 const fractions=localPlanFractions(view),baseline=checkpoint.localFractions??items.map(()=>0)
 const sum=checkpoint.remaining.reduce((a,b)=>a+b,0),done=items.reduce((n,item,index)=>{const start=Number.isFinite(baseline[index])?Math.max(0,Math.min(.99,baseline[index])):0,increment=item.status==='completed'?1:Math.max(0,Math.min(1,(fractions[index]-start)/(1-start)));return n+(checkpoint.remaining[index]??0)*increment},0)
 return{valid:true,percent:Math.min(.99,checkpoint.percent+(1-checkpoint.percent)*Math.min(1,done/sum))}
}
