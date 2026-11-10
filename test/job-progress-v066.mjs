import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
let clock=1800000000000;const realNow=Date.now;Date.now=()=>clock
const handlers=new Map(),listeners=new Set(),jobsMap=new Map();let next=0,reads=0
const jobs={events:{subscribe(filter,fn){assert.equal(filter.owners,'scope');listeners.add(fn);return()=>listeners.delete(fn)}},get(id,owner){const j=jobsMap.get(id);assert.equal(j.owner,owner);return structuredClone(j)},read(){throw Error('Must never consume model cursor')},readAt(id,from,owner){reads++;const j=jobsMap.get(id);assert.equal(j.owner,owner);return{chunks:j.chunks.filter(c=>c.at+c.text.length>from).map(c=>({...c})),next:j.output.total,lossy:from<j.output.earliest}}}
const sessions=[{id:'root',seq:0,header:{cwd:'/fixture'},snapshotEvents:()=>[]}]
const ctx={on:(key,fn)=>{handlers.set(key,fn);return()=>handlers.delete(key)},get:key=>key==='sessions'?{list:()=>sessions}:key==='jobs'?jobs:undefined}
const tracker=createTracker(ctx,{localProgress:true,captureTranscript:false})
const emit=(type,data)=>handlers.get('session/event')(sessions[0],{type,data,time:clock,seq:++next})
const event=e=>{for(const fn of listeners)fn(e)}
function start(id,callId,command){
 emit('tool/call',{name:'bash',callId,arguments:JSON.stringify({command,description:'Fixture command'})})
 const job={id,kind:'bash',owner:'root',label:command,status:'running',startedAt:clock,output:{total:0,earliest:0},chunks:[]};jobsMap.set(id,job);event({type:'registered',job});emit('job/registered',{jobId:id,kind:'bash',owner:'root',startedAt:clock,toolCall:{callId,rootCallId:callId}});return job
}
const append=(job,text)=>{job.chunks.push({at:job.output.total,text});job.output.total+=text.length;event({type:'output',id:job.id,owner:job.owner,total:job.output.total})}
try{
 emit('turn/start',{turn:1});emit('step/start',{turn:1,step:1})
 let job=start('bash-render','render','node render.mjs');clock+=1000;append(job,'Frame 40/100 fps=20\n');await Promise.resolve()
 let row=tracker.snapshot('root').commands.find(c=>c.id==='render');assert.equal(row.percent,.4);assert.equal(row.remainingMs,3000);assert.equal(row.source,'frames')
 const stamp=row.evidenceAt;clock+=1000;event({type:'output',id:job.id,owner:'root',total:job.output.total});await Promise.resolve();row=tracker.snapshot('root').commands.find(c=>c.id==='render');assert.equal(row.evidenceAt,stamp,'a status read cannot renew stale evidence');assert.equal(row.percent,.4);assert.equal(row.remainingMs,2000)
 emit('tool/result',{message:{toolCallId:'render',content:[{type:'text',text:'started background job bash-render'}]}})
 row=tracker.snapshot('root').commands.find(c=>c.jobId===job.id);assert.ok(row.background);assert.equal(row.percent,.4);assert.equal(tracker.snapshot('root').commands.length,1,'native background replaces the foreground, never duplicates it')
 clock+=2000;append(job,'Frame 80/100 fps=20\n');await Promise.resolve();row=tracker.snapshot('root').commands[0];assert.equal(row.percent,.8);assert.equal(row.remainingMs,1000)
 job.status='completed';job.detail='exit code: 0';job.finishedAt=clock;event({type:'settled',job,cause:'producer',awaited:false});await Promise.resolve();assert.equal(tracker.snapshot('root').commands.length,0)
 const server=start('bash-server','serve','python3 -m http.server 8000');row=tracker.snapshot('root').commands[0];assert.equal(row.infinite,true);emit('tool/result',{message:{toolCallId:'serve',content:[{type:'text',text:'started background job bash-server'}]}});assert.equal(tracker.snapshot('root').commands[0].infinite,true)
 server.status='killed';event({type:'settled',job:server,cause:'kill',awaited:false});await Promise.resolve();assert.equal(tracker.snapshot('root').commands.length,0)
 const native=start('bash-native','native','node batch.mjs');append(native,'3/10\n');await Promise.resolve();assert.equal(tracker.snapshot('root').commands[0].known,false,'generic log fraction is not a declared work meter');native.progress='3/10';event({type:'progress',job:native});await Promise.resolve();assert.equal(tracker.snapshot('root').commands[0].percent,.3)
 assert.ok(reads>0);assert.equal(listeners.size,1);tracker.dispose();assert.equal(listeners.size,0)
 console.log('native job progress passed: non-consuming offsets, live counters/ETA, repeated evidence age, foreground/background dedupe, service lifetime, native channel and disposal')
}finally{tracker.dispose();Date.now=realNow}
