/** Overall ETA from elapsed work and the current progress estimate. No model calls. */
const finite=Number.isFinite
const bound=p=>Math.max(0,Math.min(.99,p))
/** A new progress/evidence version anchors once; polling never extends it. */
export function createTaskEta({clock=()=>performance.now(),limit=256}={}){
 const anchors=new Map();let sequence=0
 return{
  display(view,display,{aiEnabled=false,elapsedMs=view.etaElapsedMs??view.projectBar?.elapsedMs}={}){
   const key=String(view.sessionId??'')+':'+String(view.turn??0),p=bound(display.percent),now=clock()
   if(!view.running||!finite(display.percent)||display.percentKnown!==true||p<=0||!finite(elapsedMs)||elapsedMs<0){if(!view.running)anchors.delete(key);return{...display,remainingMs:null,eta:null}}
   const model=['model','weighted'].includes(display.source)?view.model:null
   const signature=JSON.stringify([display.source,p,view.evidenceRevision??0,model?.at??null,model?.forStep??null,model?.planKey??null])
   let anchor=anchors.get(key)
   if(!anchor||anchor.signature!==signature||elapsedMs+1000<anchor.elapsedAtEstimateMs){
    const remaining=(1/p-1)*elapsedMs
    if(!finite(remaining))return{...display,remainingMs:null,eta:null}
    anchor={id:++sequence,signature,percent:p,elapsedAtEstimateMs:elapsedMs,remainingMs:Math.max(1000,remaining),at:now};anchors.delete(key);anchors.set(key,anchor)
    if(anchors.size>limit)anchors.delete(anchors.keys().next().value)
   }
   const age=Math.max(0,now-anchor.at),remainingMs=Math.max(1000,anchor.remainingMs-age)
   return{...display,remainingMs,eta:{id:anchor.id,method:'elapsed-progress',percent:anchor.percent,elapsedAtEstimateMs:anchor.elapsedAtEstimateMs,initialRemainingMs:anchor.remainingMs,remainingMs,precision:aiEnabled?'second':'minute',overdue:age>=anchor.remainingMs}}
  },
  clear(){anchors.clear()},
 }
}
