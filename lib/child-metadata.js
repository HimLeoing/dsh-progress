/** Numeric work clocks and stable names; never retain transcript bodies or resume agents. */
export function createWorkClock(from=0,until=0) {
 return {version:1,from,until,seq:-1,settledMs:0,openSince:null,lastStart:0,lastEnd:0,label:null,complete:false}
}
export function foldWorkEvent(clock,event) {
 if(!Number.isFinite(event.seq)||event.seq<=clock.seq)return
 clock.seq=event.seq
 if(event.type==='subagent/descriptor'&&typeof event.data?.label==='string')clock.label=event.data.label.trim().slice(0,240)||clock.label
 const at=event.time
 if(!Number.isFinite(at)||at<1e12)return
 if(event.type==='turn/start') {
  // Repeated starts never count the same segment twice. A missing end closes
  // at the last observed event, not at a later restart or the current clock.
  if(clock.openSince!==null)clock.settledMs+=overlap(clock,clock.openSince,clock.through??clock.openSince)
  clock.openSince=at;clock.lastStart=at;clock.lastEnd=0
 } else if(event.type==='turn/end') {
  if(clock.openSince!==null)clock.settledMs+=overlap(clock,clock.openSince,at)
  clock.openSince=null;clock.lastEnd=at
 }
 clock.through=at
}
const overlap=(c,start,end)=>Math.max(0,Math.min(end,c.until||Infinity)-Math.max(start,c.from))
export const workElapsed=(clock,{running=false,now=Date.now()}={})=>clock.settledMs+(clock.openSince===null?0:overlap(clock,clock.openSince,running?now:clock.through??clock.openSince))
/** Background maintenance created after a closed turn is outside its scope.
 * The clock fallback also repairs older saved rows without creation metadata. */
export function belongsToTurn(row,endedAt=0){
 if(!endedAt)return true
 if(Number.isFinite(row.createdAt)&&row.createdAt>endedAt)return false
 const c=row.workClock
 return !(c?.complete&&c.lastStart>endedAt&&c.settledMs===0)
}

export function createChildMetadata(ctx) {
 const cache=new Map(),pending=new Map();let disposed=false,chain=Promise.resolve()
 const key=(id,from,until)=>`${id}:${from}:${until}`
 function entry(id,from,until,saved) {
  const k=key(id,from,until);let value=cache.get(k)
  if(!value){value={clock:saved?.version===1&&saved.from===from&&saved.until===until?{...saved}:createWorkClock(from,until),source:null,offset:0};cache.set(k,value);if(cache.size>256)cache.delete(cache.keys().next().value)}
  return value
 }
 function live(session,from,until=0,saved) {
  const value=entry(String(session.id),from,until,saved),events=session.snapshotEvents(0)
  if(value.source?.deref()!==session){value.source=new WeakRef(session);value.offset=0}
  for(let i=value.offset;i<events.length;i++)if(events[i].seq>=(session.inheritedEventCount??0))foldWorkEvent(value.clock,events[i])
  value.offset=events.length;value.clock.complete=true
  return {...value.clock}
 }
 async function recover(id,from,until=0,saved) {
  const value=entry(id,from,until,saved),k=key(id,from,until)
  if(value.clock.complete&&value.clock.openSince===null)return{...value.clock}
  if(pending.has(k))return pending.get(k)
  const service=ctx.get('sessionPersistence');if(!service?.open)return null
  const task=chain.catch(()=>{}).then(async()=>{
   if(disposed)return null
   const signal=AbortSignal.timeout(15000);let handle
   try {
    handle=await service.open(id,'read',{signal})
    let offset=Math.max(handle.inheritedEventCount??0,value.clock.seq+1),read=0
    while(!disposed&&read<100000){signal.throwIfAborted();const {events}=await handle.read(offset,256,{signal});if(!events.length){value.clock.complete=true;break}for(const event of events)foldWorkEvent(value.clock,event);read+=events.length;const next=events.at(-1).seq+1;if(next<=offset)break;offset=next}
    return {...value.clock}
   }catch{return null}finally{await Promise.resolve(handle?.close()).catch(()=>{})}
  }).finally(()=>pending.delete(k))
  pending.set(k,task);chain=task;return task
 }
 return {live,recover,event(session,event,from,until=0,saved){live(session,from,until,saved);const value=entry(String(session.id),from,until,saved);if(event.seq>=(session.inheritedEventCount??0))foldWorkEvent(value.clock,event);return{...value.clock}},dispose(){disposed=true;cache.clear()}}
}
