import assert from 'node:assert/strict'
import {workerProgress}from'../lib/worker-progress.js'
import {planKey}from'../lib/weighted-progress.js'
const items=[{content:'A',owner:'Alice',status:'completed'},{content:'B',owner:'Bob',status:'in_progress'},{content:'C',owner:'Bob',status:'pending'}]
const parent={turn:1,evidenceRevision:0,plan:{items},model:{turn:1,percent:.9,at:Date.now(),evidenceRevision:0,weights:[.2,.3,.5],fractions:[1,.5,0],planKey:planKey(items)}}
const view={turn:2,evidenceRevision:0,running:true,turnStatus:'running',projectBar:{mode:'team'},plan:{items,total:3,done:1},ownPlan:{items:[]}}
const alice=workerProgress({id:'a',label:'Alice',status:'completed'},view,parent,{aiEnabled:true,aiScope:'all'})
const bob=workerProgress({id:'b',label:'Bob',status:'running'},view,parent,{aiEnabled:true,aiScope:'all'})
assert.equal(alice.display.percent,1);assert.equal(bob.total,2);assert.equal(bob.done,0);assert.ok(Math.abs(bob.display.percent-.1875)<1e-10,'Bob receives only his own weighted contributions, not the shared-board total')
const waitingAlice=workerProgress({id:'a',label:'Alice',status:'running'},view,parent,{aiEnabled:true,aiScope:'all'});assert.equal(waitingAlice.display.percentKnown,false,'a child finishing its assigned work must not copy the parent overall percentage')
const local=workerProgress({id:'b',label:'Bob',status:'running'},view,parent,{aiEnabled:false});assert.equal(local.display.percent,0)
const unknown=workerProgress({id:'c',label:'Carol',status:'running'},view,parent,{aiEnabled:true,aiScope:'all'});assert.equal(unknown.display.percentKnown,false,'no assigned work means unknown, not an invented 0-100 fraction')
console.log('worker-v05 checks passed: independent circles, assigned tasks, shared weight reuse, local mode, unknown')
const {createTracker}=await import('../lib/tracker.js')
const listeners=new Map(),start=Date.now(),p={id:'p',seq:0,header:{cwd:'/test'},snapshotEvents:()=>[]},c={id:'c',seq:0,header:{cwd:'/test',origin:'subagent',parentSession:'p',createdAt:start+1},snapshotEvents:()=>[]}
const tracker=createTracker({get:key=>key==='sessions'?{list:()=>[p,c]}:undefined,on:(name,fn)=>{listeners.set(name,fn);return()=>{}}},{captureTranscript:false,localProgress:true})
const emit=(session,type,data)=>listeners.get('session/event')(session,{type,data,time:Date.now(),seq:++session.seq})
try{emit(p,'turn/start',{turn:1});emit(c,'turn/start',{turn:1});emit(c,'step/start',{});emit(c,'step/end',{});assert.equal(tracker.snapshot('p').boundary.kind,'child/step/end','a parent waiting on teammates still observes their execution boundaries');emit(c,'tool/call',{callId:'bad',name:'bash',arguments:'{"command":"node --test"}'});emit(c,'tool/result',{message:{toolCallId:'bad',isError:false,content:[{type:'text',text:'failed\n[exit code: 1]'}]}});assert.ok(tracker.snapshot('p').evidenceRevision>0,'a teammate failure invalidates the parent estimate')}finally{tracker.dispose()}

const restored=workerProgress({id:'b',label:'Bob',status:'completed',done:4,total:4},{...view,persisted:true,ownPlan:{items:[]}},parent,{aiEnabled:false});assert.equal(restored.total,4,'legacy restart preserves the child counts kept by the parent roster');assert.equal(restored.done,4)
const preparing=workerProgress({id:'c',label:'Carol',status:'running'},{...view,preparing:{name:'run_code',label:'',elapsedMs:37000}},parent,{aiEnabled:true,aiScope:'all'});assert.equal(preparing.current.preparing,true,'worker cards preserve argument-generation versus actual execution')
