import assert from 'node:assert/strict'
import {createTracker}from'../lib/tracker.js'
import {createCadencePolicy}from'../lib/probe-policy.js'
let at=1800000000000,seq=0;const callbacks=[],handlers=new Map(),session={id:'lead',seq:0,header:{createdAt:at},snapshotEvents:()=>[]}
const tracker=createTracker({on:(key,fn)=>{handlers.set(key,fn);return()=>{}},get:key=>key==='sessions'?{list:()=>[session]}:undefined},{localProgress:true,captureTranscript:false,onEvidence:(id,view,event)=>callbacks.push({id,view,event})})
const emit=(type,data)=>{const e={type,data,seq:++seq,time:at+=100};session.seq=seq;handlers.get('session/event')(session,e);return e}
const run=(name,command,status='completed')=>{const id='call-'+seq;emit('tool/call',{name,callId:id,arguments:JSON.stringify(name==='write'?{path:'scene.js'}:{command})});return emit('tool/result',{message:{toolCallId:id,content:[{type:'text',text:status==='failed'?'error\n[exit code: 1]':'ok'}]}})}
try{
 emit('turn/start',{turn:1});emit('step/start',{turn:1,step:1});run('read','example');assert.equal(callbacks.length,0)
 run('bash','npm test');assert.equal(callbacks.length,1,'successful validation schedules a review before step/end');assert.equal(callbacks[0].event.evidenceKind,'verification-ready');assert.equal(callbacks[0].event.kind,'finish-evidence')
 run('bash','npm test');assert.equal(callbacks.length,1,'the same verification cycle cannot repeatedly ask')
 run('write');run('bash','npm test');assert.equal(callbacks.length,2,'new material rearms verification')
 run('bash','npm test','failed');run('bash','npm test');assert.equal(callbacks.length,3,'successful repair recheck is fresh evidence')
 emit('tool/call',{name:'present',callId:'deliver',arguments:'{}'});assert.equal(callbacks.length,4);assert.equal(callbacks.at(-1).event.evidenceKind,'delivery-ready')
 const before=callbacks.length;const duplicate={type:'tool/call',seq,time:at,data:{name:'present',callId:'deliver',arguments:'{}'}};handlers.get('session/event')(session,duplicate);assert.equal(callbacks.length,before)
 emit('step/end',{turn:1,step:1});emit('turn/end',{turn:1,reason:{kind:'completed'}});assert.equal(tracker.snapshot('lead').turnStatus,'completed')
 for(const mode of ['balanced','step']){
  const policy=createCadencePolicy({now:()=>at}),view={turn:1,running:true,evidenceRevision:0,plan:{items:[],done:0,total:0},operations:{completed:1,failed:0},children:[],probe:{recentOperations:[]}},event={seq:'evidence:1',step:1,at,kind:'finish-evidence',evidenceKind:'delivery-ready',evidenceKey:'one'}
  policy.update('lead',view,event);const d=policy.decide('lead',view,{mode});assert.equal(d.due,true);policy.dispatched('lead',d.ticket);policy.settled('lead',d.ticket,{accepted:true,percent:.88,phase:'deliver',confidence:1});policy.update('lead',view,{seq:2,step:1,at,kind:'step/end'});assert.equal(policy.decide('lead',view,{mode}).due,false,'subsequent step/end is covered by the early review');policy.dispose()
 }
 console.log('finish review passed: evidence before final step, bounded cycles, repair rearming, real delivery, duplicate protection, terminal completion and no double step probe')
}finally{tracker.dispose()}
