import {localProgress} from './local-progress.js'
import {planKey,normalizeWeights} from './weighted-progress.js'
/** A teammate's ring measures its own checklist or assigned tasks, never the entire shared board. */
export function workerProgress(child,view,parent,settings) {
 const own=view.ownPlan?.items??(view.projectBar?.mode==='todos'?view.plan?.items:[])??[]
 const shared=parent.plan?.items??[],indices=((parent.plan?.total??shared.length)===shared.length?shared:[]).flatMap((item,index)=>item.owner===child.label||item.owner===child.id?[index]:[])
 // An independently assessed child without its own checklist keeps that own
 // request percentage; a parent-board fraction must not replace it.
 const independent=settings.aiEnabled===true&&!own.length&&view.model?.turn===view.turn&&Number.isFinite(view.model.percent)
 const items=own.length?own:independent?[]:indices.map(index=>shared[index])
 // Older records may lack the child's checklist bodies. The parent roster
 // still has its exact counts; do not substitute the entire shared board.
 const savedOwn=view.persisted&&!own.length&&child.total>0
 const plan=savedOwn?{items:[],done:child.done,total:child.total}:{items,done:own.length?view.ownPlan?.done??items.filter(item=>item.status==='completed').length:items.filter(item=>item.status==='completed').length,total:own.length?view.ownPlan?.total??items.length:items.length}
 let model=view.model
 if(!independent&&!own.length&&indices.length&&parent.model?.weights&&parent.model.planKey===planKey(shared)) {
  const weights=normalizeWeights(indices.map(index=>parent.model.weights[index]),indices.length)
  if(weights)model={...parent.model,overallScope:'parent',turn:view.turn,planKey:planKey(items),weights,fractions:indices.map(index=>parent.model.fractions?.[index]??0),evidenceRevision:parent.model.evidenceRevision===parent.evidenceRevision?view.evidenceRevision:-1}
 }
 const display=localProgress({...view,running:child.status==='running',turnStatus:child.status,plan,model,projectBar:{...view.projectBar,...plan}},settings)
 return{...child,...plan,current:view.preparing?{...view.preparing,preparing:true}:view.commands?.at(-1)??view.lastTool,display}
}
