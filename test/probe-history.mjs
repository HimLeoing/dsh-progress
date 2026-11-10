import assert from'node:assert/strict'
import fs from'node:fs'
import os from'node:os'
import path from'node:path'
import {createProbeHistory}from'../lib/probe-history.js'
import {createTracker}from'../lib/tracker.js'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-history-')),file=path.join(directory,'probes.jsonl')
try{
 const lines=Array.from({length:40},(_,i)=>JSON.stringify({kind:'probe',sid:'s',turn:2,at:1000+i,step:i+1,modelPercent:i/100,calls:1,usage:{inputTokens:10,outputTokens:2,cacheReadTokens:4}}))
 fs.writeFileSync(file,'broken line\n'+lines.join('\n'))
 const recovered=createProbeHistory(file)('s',2);assert.equal(recovered.history.length,32);assert.equal(recovered.stats.requests,40);assert.equal(recovered.stats.inputTokens,400);assert.equal(recovered.history.at(-1).step,40)
 assert.equal(createProbeHistory(path.join(directory,'missing'))('s',2),null)
 const listeners=new Map(),events=[],records=new Map(),session={id:'s',seq:0,header:{cwd:'/test'},snapshotEvents:()=>events}
 let completed=[]
 const ctx={get:key=>key==='sessions'?{list:()=>[session]}:undefined,on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name)}}
 let tracker=createTracker(ctx,{captureTranscript:false,localProgress:true,onStepEnd:(id,view,step)=>completed.push({id,step:step.step}),persistence:{load:id=>records.get(id),save:(id,r)=>records.set(id,r)}})
 const emit=(type,data={})=>{const e={seq:++session.seq,type,data,time:Date.now()};events.push(e);listeners.get('session/event')(session,e);return e}
 emit('turn/start',{turn:1});emit('step/start',{});emit('tool/call',{callId:'x',name:'read',arguments:'{"path":"spec.md"}'});emit('tool/result',{message:{toolCallId:'x',content:[]}});assert.equal(completed.length,0,'ordinary tool results do not create extra automatic calls')
 const last=emit('step/end',{});assert.equal(completed.length,1);listeners.get('session/event')(session,last);assert.equal(completed.length,1,'the actual step-end hook is duplicate-safe')
 tracker.recordObservation('s',{turn:1,record:{at:Date.now(),percent:.4,step:1,kind:'probe'},stats:{requests:1,inputTokens:100}});emit('turn/end',{reason:{kind:'completed'}});tracker.dispose()
 tracker=createTracker(ctx,{captureTranscript:false,localProgress:true,persistence:{load:id=>records.get(id),save:(id,r)=>records.set(id,r)}})
 assert.equal(tracker.snapshot('s').observations.length,1);assert.equal(tracker.snapshot('s').probeStats.requests,1,'step history and token stats survive restart');tracker.dispose()
 fs.writeFileSync(file,[{kind:'probe',sid:'root',turn:1,modelPercent:.5,calls:1,usage:{inputTokens:10,cacheReadTokens:5},cost:{priced:true,cny:.1,usd:.01}},{kind:'probe',sid:'child',turn:1,rootSid:'root',rootTurn:1,modelPercent:.2,calls:1,usage:{inputTokens:20,cacheReadTokens:7},cost:{priced:true,cny:.2,usd:.02}},{kind:'probe',sid:'child',turn:2,rootSid:'root',rootTurn:1,modelPercent:.4,calls:1,usage:{inputTokens:30,cacheReadTokens:9},cost:{priced:true,cny:.3,usd:.03}}].map(JSON.stringify).join('\n'))
 const family=createProbeHistory(file);await family.ready;const stats=family('root',1).stats;assert.equal(stats.requests,3);assert.equal(stats.cacheReadTokens,21);assert.ok(Math.abs(stats.costCny-.6)<1e-12);assert.equal(stats.workerUsage.child.requests,2);assert.equal(family('root',1).history.length,1,'child percentages never contaminate the overall chart');assert.equal(family('child',2).history[0].percent,.4)
 // Fees outside the immediate 256KiB tail recover without retaining all rows.
 const old={kind:'probe',sid:'old',turn:1,modelPercent:.2,calls:1,usage:{inputTokens:100,cacheReadTokens:80,outputTokens:1},cost:{priced:true,cny:.123,usd:.01}}
 fs.writeFileSync(file,JSON.stringify(old)+'\n'+('x'.repeat(512)+'\n').repeat(600));const streamed=createProbeHistory(file);assert.equal(streamed('old',1),null);await streamed.ready;assert.equal(streamed('old',1).stats.costCny,.123)
 console.log('probe history checks passed: bounded recovery, step-only hook, no duplicates, persisted chart and stats')
}finally{fs.rmSync(directory,{recursive:true,force:true})}
