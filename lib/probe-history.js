/** Bounded metadata-only recovery; family fees count each physical request once. */
import fs from 'node:fs'
import readline from 'node:readline'
export function createProbeHistory(file,{quote}={}) {
 let records=new Map(),data=''
 const empty=()=>({requests:0,succeeded:0,failed:0,inputTokens:0,cacheReadTokens:0,outputTokens:0,costCny:0,costUsd:0,pricedRequests:0,unpricedRequests:0})
 const touch=(map,key,value)=>{map.delete(key);map.set(key,value);if(map.size>64)map.delete(map.keys().next().value);return value}
 const entry=(map,sid,turn)=>{const key=`${sid}:${turn}`;return touch(map,key,map.get(key)??{history:[],stats:{...empty(),workerUsage:{}}})}
 const valid=row=>row?.sid&&Number.isFinite(row.turn)&&['probe','failure','cancelled'].includes(row.kind)
 const recoverableUsage=row=>row.usage&&typeof row.usage==='object'&&!Array.isArray(row.usage)&&['inputTokens','outputTokens'].every(key=>Number.isFinite(row.usage[key])&&row.usage[key]>=0)&&['cacheReadTokens','cacheWriteTokens','reasoningTokens'].every(key=>row.usage[key]===undefined||Number.isFinite(row.usage[key])&&row.usage[key]>=0)
 const usage=(stats,row)=>{stats.requests+=row.calls??1;stats[row.kind==='probe'?'succeeded':'failed']++;for(const field of ['inputTokens','cacheReadTokens','outputTokens'])stats[field]+=row.usage?.[field]??0}
 function fold(map,row,cost){
  const own=entry(map,row.sid,row.turn);usage(own.stats,row)
  own.history.push({at:row.at,percent:row.kind==='probe'?row.modelPercent:null,kind:row.kind,step:row.step??null,owner:row.owner??null,ownerLabel:row.ownerLabel??null,trigger:row.trigger??'observation',latencyMs:row.latencyMs??null})
  if(own.history.length>32)own.history.shift()
  const targets=[own.stats]
  if(row.rootSid&&row.rootSid!==row.sid&&Number.isFinite(row.rootTurn)){const root=entry(map,row.rootSid,row.rootTurn),worker=root.stats.workerUsage[row.sid]??=empty();usage(root.stats,row);usage(worker,row);targets.push(root.stats,worker)}
  for(const stats of targets)if(cost?.priced&&Number.isFinite(cost.cny)&&Number.isFinite(cost.usd)){stats.costCny+=cost.cny;stats.costUsd+=cost.usd;stats.pricedRequests+=row.calls??1}else stats.unpricedRequests+=row.calls??1
 }
 // A small synchronous tail supplies immediate chart data; the background
 // stream recovers complete costs from both bounded log generations.
 try{const fd=fs.openSync(file,'r');try{const size=fs.fstatSync(fd).size,length=Math.min(size,262144),buffer=Buffer.alloc(length);fs.readSync(fd,buffer,0,length,size-length);data=buffer.toString();if(size>length)data=data.slice(data.indexOf('\n')+1)}finally{fs.closeSync(fd)}}catch{}
 for(const line of data.split('\n'))try{const row=JSON.parse(line);if(valid(row))fold(records,row,row.cost)}catch{}
 const read=(id,turn)=>{const key=`${id}:${turn}`,value=records.get(key);return value?touch(records,key,value):null}
 read.costsReady=false
 read.ready=(async()=>{
  const full=new Map();let readAny=false
  for(const source of [file+'.1',file]){
   let stream,lines
   try{
    const size=(await fs.promises.stat(source)).size,start=Math.max(0,size-6*1024*1024)
    stream=fs.createReadStream(source,{start,highWaterMark:65536});lines=readline.createInterface({input:stream,crlfDelay:Infinity});let skip=start>0
    for await(const line of lines){if(skip){skip=false;continue}let row;try{row=JSON.parse(line)}catch{continue}if(!valid(row))continue;let cost=row.cost
     // Successful quotes are frozen, including a genuine zero. Old requests
     // marked unknown may become priceable after a catalog/config update; only
     // retry complete usage, so missing tokens can never become a zero bill.
     if((!cost||cost.priced===false)&&quote&&recoverableUsage(row))try{cost=await quote(row,{at:row.startedAt??row.at-(row.latencyMs??0),sid:row.sid})}catch{}
     fold(full,row,cost);readAny=true
    }
   }catch{}finally{lines?.close();stream?.destroy()}
  }
  if(readAny)records=full
  read.costsReady=true
 })()
 return read
}
