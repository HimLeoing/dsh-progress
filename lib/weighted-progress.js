/** Stable plan identity and bounded contributions; the clock never advances an item. */
export const planKey = items => JSON.stringify(items.map(item=>[item.id??null,item.content]))
/** Worker counts are not a checklist, including records written by older builds. */
export const hasTaskPlan = view => (view.plan?.total ?? view.projectBar?.total ?? 0)>0 && !(view.projectBar?.mode==='agents'&&!view.plan?.items?.length)
/** A board wholly assigned to children cannot prove the lead's project is done. */
export const planCoverage=(items=[],children=[])=>items.length&&children.length&&items.every(item=>item.owner&&children.some(child=>item.owner===child.label||item.owner===child.id))?'delegated':'checklist'
export function normalizeWeights(weights,length) {
 if(!Array.isArray(weights)||weights.length!==length||!length||weights.some(value=>!Number.isFinite(value)||value<=0))return null
 const sum=weights.reduce((a,b)=>a+b,0)
 return Number.isFinite(sum)&&sum>0?weights.map(value=>value/sum):null
}
export function weightedPlan(items,model) {
 const weights=model?.planKey===planKey(items)?normalizeWeights(model.weights,items.length):null
 const fractions=items.map((item,index)=>item.status==='completed'?1:item.status==='in_progress'&&weights&&Number.isFinite(model?.fractions?.[index])?Math.max(0,Math.min(.95,model.fractions[index])):0)
 return {weights,fractions,percent:items.reduce((sum,_,index)=>sum+fractions[index]*(weights?.[index]??1/Math.max(1,items.length)),0)}
}
