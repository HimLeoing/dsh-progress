import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {buildProbePayload} from '../lib/model-probe.js'
const handlers=new Map(),events=[],session={id:'stream',seq:0,header:{cwd:'/work'},snapshotEvents:()=>events}
const ctx={get:key=>key==='sessions'?{list:()=>[session]}:undefined,on(name,fn){handlers.set(name,fn);return()=>handlers.delete(name)}}
const tracker=createTracker(ctx)
function event(type,data){const e={seq:++session.seq,type,data,time:Date.now()};events.push(e);handlers.get('session/event')(session,e)}
const frame=value=>handlers.get('agent/assistant-stream')?.({agent:{id:session.id,session},frame:value})
try{
 event('turn/start',{turn:1});frame({type:'start',attemptId:'attempt-1',revision:1,turn:1,step:1})
 frame({type:'chunk',attemptId:'attempt-1',revision:2,index:0,time:Date.now(),chunk:{type:'reasoning-delta',index:0,text:'PRIVATE REASONING'}})
 assert.equal(tracker.snapshot(session.id).preparing??null,null,'reasoning never creates a fake operation bar')
 frame({type:'chunk',attemptId:'attempt-1',revision:3,index:1,time:Date.now(),chunk:{type:'tool-call-delta',index:1,id:'write-1',name:'write',argumentsDelta:'{"file_path":"/work/scene.js","content":"'+ 'x'.repeat(10000)}})
 let view=tracker.snapshot(session.id)
 assert.ok(view.preparing,'a streamed write call must be visible as preparation before execution');assert.equal(view.preparing.name,'write');assert.equal(view.preparing.label,'scene.js');assert.equal(view.phase,'implement')
 assert.equal(view.commands.length,0,'preparing a call is not executing it')
 assert.match(buildProbePayload(view,{}),/NOT executed/)
 assert.doesNotMatch(JSON.stringify(view),/PRIVATE REASONING|x{1000}/,'stream body never reaches HTTP or the probe')
 frame({type:'end',attemptId:'old',revision:9,index:2,outcome:{kind:'abandoned'}})
 assert.ok(tracker.snapshot(session.id).preparing,'an old attempt cannot end a new one')
 frame({type:'end',attemptId:'attempt-1',revision:4,index:2,outcome:{kind:'committed',eventType:'assistant/message',seq:2}})
 assert.equal(tracker.snapshot(session.id).preparing,null)
 frame({type:'start',attemptId:'late-path',revision:1,turn:1,step:2})
 frame({type:'chunk',attemptId:'late-path',revision:2,time:Date.now(),chunk:{type:'tool-call-delta',id:'late-write',name:'write',argumentsDelta:'{"content":"'+'z'.repeat(10000)}})
 frame({type:'chunk',attemptId:'late-path',revision:3,time:Date.now(),chunk:{type:'tool-call-delta',id:'late-write',argumentsDelta:'","file_path":"/work/late.js"}'}})
 assert.equal(tracker.snapshot(session.id).preparing.label,'late.js','a file path sent after a long body is still recognized')
 assert.doesNotMatch(JSON.stringify(tracker.snapshot(session.id)),/z{1000}/)
 frame({type:'end',attemptId:'late-path',revision:4,outcome:{kind:'committed'}})
 event('turn/end',{reason:{kind:'aborted'}})
 frame({type:'start',attemptId:'late',revision:10,turn:1,step:1})
 assert.equal(tracker.snapshot(session.id).preparing,null,'a late stream cannot revive a stopped turn')
 console.log('stream-evidence checks passed: bounded preparation metadata, no reasoning/body leakage, stale frames and cancellation')
}finally{tracker.dispose();assert.equal(handlers.size,0,'stream subscriptions are disposed')}
