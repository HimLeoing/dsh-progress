/** Observe the native job ring at independent offsets. Never consume jobs.read(). */
import {commandMetadata,readCommandSignal,commandProgress} from './command-progress.js'
const MAX_JOBS=128,TAIL=8192
export function createJobProgress(ctx,{now=()=>Date.now()}={}){
 const jobs=ctx.get('jobs'),records=new Map(),pending=new Set();let scheduled=false,disposed=false,off=null
 function record(job){
  if(!job?.owner||job.kind!=='bash')return null
  let entry=records.get(job.id)
  if(!entry){entry={id:job.id,owner:job.owner,startedAt:job.startedAt,meta:commandMetadata('bash',{command:job.label}),label:'',next:Math.max(0,(job.output?.total??0)-TAIL),tail:'',signal:null};records.set(job.id,entry)}
  entry.status=job.status;entry.detail=job.detail;entry.finishedAt=job.finishedAt
  records.delete(job.id);records.set(job.id,entry)
  if(records.size>MAX_JOBS)records.delete(records.keys().next().value)
  return entry
 }
 function collect(id,owner){
  if(disposed||!jobs?.get||!jobs?.readAt)return
  try{
   const job=jobs.get(id,owner),entry=record(job);if(!entry)return
   const from=Math.max(entry.next,job.output?.earliest??0,(job.output?.total??0)-TAIL),read=jobs.readAt(id,from,entry.owner)
   let gap=read.lossy||from>entry.next,tail=gap?'':entry.tail
   for(const chunk of read.chunks??[]){if(chunk.gapBefore){gap=true;tail=''}tail=(tail+String(chunk.text??'').slice(-TAIL)).slice(-TAIL)}
   entry.tail=tail;entry.next=read.next
   entry.signal=readCommandSignal(entry.meta,tail,{at:now(),previous:entry.signal,gap,nativeProgress:job.progress})
  }catch{/* Foreign, removed or unsupported registry: unknown; never fall back to consuming read. */}
 }
 try{off=jobs?.events?.subscribe({owners:'scope'},event=>{
  const job=event.job,id=job?.id??event.id,owner=job?.owner??event.owner
  if(!owner||!id)return
  if(event.type==='removed'){records.delete(id);pending.delete(id);return}
  if(job)record(job)
  else if(!records.has(id))try{record(jobs.get(id,owner))}catch{}
  pending.add(id)
  if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;for(const key of pending){const entry=records.get(key);if(entry)collect(key,entry.owner)}pending.clear()})}
 })}catch{}
 return{
  bind(data,{meta,label,turn,owner}={}){
   if(!data?.jobId||data.owner!==owner||data.kind!=='bash')return
   try{const job=jobs?.get(data.jobId,owner);if(!['running','stopping'].includes(job?.status))return;const entry=record(job);if(!entry)return;entry.callId=String(data.toolCall?.callId??'');entry.turn=turn;entry.label=String(label??'').slice(0,80);if(meta){entry.meta=meta;entry.signal=null}collect(entry.id,owner)}catch{}
  },
  progress(owner,callId,{meta,elapsedMs,now:at=now(),history}={}){
   const entry=[...records.values()].reverse().find(row=>row.owner===owner&&(row.callId===callId||'ptc:'+row.callId===callId))
   if(!entry)return commandProgress({meta,elapsedMs,now:at,history})
   return commandProgress({meta:entry.meta,signal:entry.signal,elapsedMs,now:at,status:entry.status==='completed'&&/exit code:\s*-?[1-9]\d*/u.test(entry.detail??'')?'failed':entry.status,history})
  },
  background(owner,{turn,startedAt,activeIds=new Set(),now:at=now()}={}){
   return [...records.values()].filter(row=>row.owner===owner&&row.startedAt>=startedAt&&(!row.turn||row.turn===turn)&&['running','stopping'].includes(row.status)&&!activeIds.has(row.callId)&&!activeIds.has('ptc:'+row.callId)).slice(-6).map(row=>({active:true,id:'job:'+row.id,name:'bash',label:row.label||'后台命令',background:true,jobId:row.id,...commandProgress({meta:row.meta,signal:row.signal,elapsedMs:Math.max(0,at-row.startedAt),now:at,status:row.status})}))
  },
  dispose(){disposed=true;if(typeof off==='function')off();pending.clear();records.clear()},
 }
}
