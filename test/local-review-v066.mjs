/** Local-mode review against real modules. No model calls, settings or native sessions. */
import assert from 'node:assert/strict'
import {localProgress} from '../lib/local-progress.js'
import {workerProgress} from '../lib/worker-progress.js'
import {createTracker} from '../lib/tracker.js'
import {operationPhase} from '../lib/progress-evidence.js'
import {taskGraphRemaining} from '../lib/task-graph.js'
const now=Date.now(),settings={aiEnabled:false,now},checks=[]
function check(name,fn){try{fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:error.message})}}
const empty={turn:1,running:true,turnStatus:'running',evidenceRevision:0,plan:{items:[],done:0,total:0},operations:{completed:0,failed:0}}
check('an interrupted lead cannot turn a completed delegated board into known whole-request 100%',()=>{
 const items=[{content:'Assets',owner:'a',status:'completed'},{content:'Textures',owner:'b',status:'completed'}]
 const view={...empty,running:false,turnStatus:'interrupted',plan:{items,done:2,total:2,coverage:'delegated'},children:[{id:'a',status:'completed'},{id:'b',status:'completed'}]}
 assert.equal(localProgress(view,settings).percentKnown,false,'known delegated counts do not establish the interrupted lead whole-request scope')
})
check('disabled AI cannot erase actual assigned-task counts because its old model exists',()=>{
 const items=[{id:'a',content:'Implement scene',owner:'Forest',status:'completed'},{id:'b',content:'Validate scene',owner:'Forest',status:'pending'}],parent={...empty,plan:{items,done:1,total:2}}
 const child={id:'forest',label:'Forest',status:'running'},view={...empty,ownPlan:{items:[],done:0,total:0},model:{turn:1,percent:.7,confidence:2,at:now,evidenceRevision:0}}
 const row=workerProgress(child,view,parent,settings)
 assert.equal(row.done,1,'keep factual assigned completion counts even when whole child scope is unknown');assert.equal(row.total,2)
})
check('33-item own checklist keeps full counts across real tracker persistence and restart',()=>{
 const handlers=new Map(),records=new Map(),session={id:'worker',seq:0,header:{createdAt:now},snapshotEvents:()=>[]}
 const persistence={load:id=>records.get(id),save:(id,value)=>records.set(id,structuredClone(value))}
 const live=createTracker({on:(name,fn)=>{handlers.set(name,fn);return()=>{}},get:key=>key==='sessions'?{list:()=>[session]}:undefined},{localProgress:true,captureTranscript:false,persistence})
 const emit=(type,data)=>handlers.get('session/event')(session,{seq:++session.seq,time:now,type,data})
 try{emit('turn/start',{turn:1});emit('todo/write',{todos:Array.from({length:33},(_,i)=>({content:'Checklist '+i,status:i===32?'completed':'pending'}))});const before=live.snapshot('worker');assert.equal(before.ownPlan.total,33);assert.equal(before.ownPlan.done,1);emit('turn/end',{reason:{kind:'cancelled'}});assert.equal(records.get('worker').ownPlan.length,32,'persisted task bodies are intentionally bounded')}finally{live.dispose()}
 const cold=createTracker({on:()=>()=>{},get:key=>key==='sessions'?{list:()=>[]}:undefined},{localProgress:true,captureTranscript:false,persistence})
 try{const restored=cold.snapshot('worker');assert.equal(restored.ownPlan.total,33,'bounded bodies cannot replace the true denominator');assert.equal(restored.ownPlan.done,1,'completion outside the 32 visible bodies is still factual')}finally{cold.dispose()}
})
check('supported PowerShell execution contributes the same strong phase evidence as bash',()=>{
 assert.equal(operationPhase('pwsh',{command:'npm run test'}),'verify');assert.equal(operationPhase('pwsh',{command:'npm run build'}),'implement')
})
check('time and execution volume never invent total progress for an unplanned task',()=>{
 const view={...empty,steps:500,operations:{completed:2000,failed:0},observedPhase:'verify',commands:[{name:'bash',label:'npm test',phase:'verify'}]}
 for(const clock of [now,now+3600000]){const d=localProgress(view,{...settings,now:clock});assert.equal(d.percentKnown,false);assert.equal(d.percent,0);assert.equal(d.detailPhase,'testing')}
})
check('unknown dependency edges and cycles are unknown, never optimistic completion paths',()=>{
 assert.equal(taskGraphRemaining([{id:'a',status:'pending',blockedBy:['missing']}],()=>100),null)
 assert.equal(taskGraphRemaining([{id:'a',status:'pending',blockedBy:['b']},{id:'b',status:'pending',blockedBy:['a']}],()=>100),null)
})
check('actual checklist reopens reduce factual completion instead of monotonically fabricating progress',()=>{
 const items=[{content:'A',status:'completed'},{content:'B',status:'pending'}],before=localProgress({...empty,plan:{items,done:1,total:2}},settings),after=localProgress({...empty,evidenceRevision:1,plan:{items:items.map(i=>({...i,status:'pending'})),done:0,total:2}},settings)
 assert.equal(before.percent,.5);assert.equal(after.percent,0);assert.equal(after.percentKnown,true)
})
check('authoritative turn completion remains complete without a checklist',()=>{
 const d=localProgress({...empty,running:false,turnStatus:'completed'},settings);assert.equal(d.percent,1);assert.equal(d.percentKnown,true)
})
for(const row of checks)console.log(`${row.ok?'PASS':'FAIL'} ${row.name}${row.error?'\n  '+row.error:''}`)
console.log(`Local review: ${checks.filter(row=>row.ok).length}/${checks.length} passed`)
if(checks.some(row=>!row.ok))process.exitCode=1
