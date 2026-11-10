import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createTracker} from '../lib/tracker.js'
import {buildProbePayload,parseProbeAnswer} from '../lib/model-probe.js'
import {createProbeContext} from '../lib/probe-context.js'
import {progressDisplay} from '../lib/progress-display.js'
const results=[]
function check(name,fn){try{fn();results.push({name,ok:true});console.log('PASS',name)}catch(error){results.push({name,ok:false,error:error.message});console.log('FAIL',name,error.message)}}
check('All concurrent operations reach the observer',()=>{const payload=buildProbePayload({projectBar:{},commands:[{active:true,name:'bash',label:'Run full tests',elapsedMs:5000},{active:true,name:'read',label:'Read README',elapsedMs:50}],command:{active:true,name:'read',label:'Read README',elapsedMs:50}},{});assert.match(payload,/Run full tests/);assert.match(payload,/Read README/)})
check('Dependency identifiers survive the compact observation',()=>{const payload=buildProbePayload({projectBar:{mode:'team',done:0,total:2},plan:{items:[{id:'task-A',content:'Compile',status:'in_progress'},{id:'task-B',content:'Check',status:'pending',blockedBy:['task-A']}]}},{});assert.ok(payload.includes('"id":"task-A"'),'dependency names alone do not identify the referenced task')})
check('Unknown duration is distinct from waiting for a person',()=>{assert.deepEqual(parseProbeAnswer('{"p":12,"eta":null,"s":"discover","c":0}'),{percent:.12,remainingMs:null,phase:'discover',confidence:0});const d=progressDisplay({running:true,turn:1,projectBar:{},model:{turn:1,percent:.12,remainingMs:null,at:Date.now(),phase:'discover',confidence:0}});assert.equal(d.state,'estimating');assert.equal(d.known,false)})
check('Reading during verification does not force a false return to exploration',()=>{const d=progressDisplay({running:true,turn:1,projectBar:{},commands:[{active:true,phase:'discover'}],model:{turn:1,percent:.9,remainingMs:30000,at:Date.now(),phase:'verify'}});assert.equal(d.phase,'verify')})
check('Current request is explicitly separated from earlier requests',()=>{const h=createProbeContext();const messages=h.build('s',{turn:2,startedAt:1,projectBar:{},probe:{goal:'Only correct the keyboard shortcut',requestContext:'Build the whole app\nOnly correct the keyboard shortcut',transcript:[]}});assert.match(JSON.stringify(messages),/CURRENT REQUEST/);h.dispose()})
const realNow=Date.now;let clock=1800000000000;Date.now=()=>clock
const handlers=new Map(),events=[];const session={id:'evidence',header:{cwd:'/work'},get seq(){return events.length},snapshotEvents:()=>events}
const learned=[]
const tracker=createTracker({get:key=>key==='sessions'?{list:()=>[session]}:undefined,on(name,fn){handlers.set(name,fn);return()=>{}}},{learning:{duration:()=>({ms:1000,samples:0}),observeDuration:(...value)=>learned.push(value)}})
function emit(type,data){const e={type,data,time:clock,seq:events.length};events.push(e);handlers.get('session/event')(session,e)}
try{
 emit('turn/start',{turn:1});emit('todo/write',{todos:[{content:'Implement',status:'completed'},{content:'Validate',status:'in_progress'}]})
 tracker.setModel(session.id,{turn:1,percent:.9,remainingMs:30000,at:clock,phase:'deliver',evidenceRevision:0})
 clock+=1000;emit('tool/call',{callId:'test',name:'bash',arguments:JSON.stringify({command:'node --test'})})
 check('A real verification command outranks an old delivery label',()=>assert.equal(progressDisplay(tracker.snapshot(session.id)).phase,'verify'))
 clock+=1000;emit('tool/result',{message:{toolCallId:'test',isError:true,content:[{type:'text',text:'Test failed'}]}})
 check('A failed check invalidates the old countdown without inventing a new percentage',()=>{const d=progressDisplay(tracker.snapshot(session.id));assert.equal(d.percent,.9);assert.equal(d.remainingMs,null);assert.equal(d.state,'recalculating')})
 tracker.setModel(session.id,{turn:1,percent:.7,remainingMs:60000,at:clock,phase:'verify',evidenceRevision:tracker.snapshot(session.id).evidenceRevision??0})
 clock+=1000;emit('todo/write',{todos:[{content:'Implement',status:'completed'},{content:'Validate',status:'in_progress'},{content:'Repair regression',status:'pending'}]})
 check('Expanding the plan invalidates an estimate made for the old scope',()=>{const d=progressDisplay(tracker.snapshot(session.id));assert.equal(d.percent,.7);assert.equal(d.remainingMs,null)})
 emit('turn/end',{reason:{kind:'completed'}});emit('turn/start',{turn:2})
 tracker.setModel(session.id,{turn:2,percent:.9,remainingMs:30000,at:clock,phase:'deliver',evidenceRevision:0})
 emit('tool/call',{callId:'exit',name:'bash',arguments:'{"command":"node --test"}'})
 clock+=1000;emit('tool/result',{message:{toolCallId:'exit',isError:false,content:[{type:'text',text:'test failed\n[exit code: 1]'}]}})
 check('A normal shell result with exit 1 is not learned or displayed as success',()=>{const v=tracker.snapshot(session.id);assert.equal(v.lastTool.status,'failed');assert.equal(progressDisplay(v).known,false)})
 emit('tool/call',{callId:'background',name:'bash',arguments:'{"command":"node --test"}'})
 clock+=1000;emit('tool/result',{message:{toolCallId:'background',content:[{type:'text',text:'[still running after 1000ms; moved to background job job-1]'}]}})
 check('A promoted shell command is pending in the background, not completed',()=>{assert.equal(tracker.snapshot(session.id).lastTool.status,'background');assert.equal(learned.length,0,'failed exits and background acknowledgements do not teach successful command durations')})
}finally{tracker.dispose();Date.now=realNow}
fs.mkdirSync('artifacts/v04',{recursive:true});fs.writeFileSync('artifacts/v04/accuracy-audit.json',JSON.stringify(results,null,2));if(results.some(row=>!row.ok))process.exitCode=1
