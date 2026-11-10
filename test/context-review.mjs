/** Independent v065 regression review; no provider calls, filesystem/settings mutations or UI. */
import assert from 'node:assert/strict'
import {buildProgressObservation} from '../lib/progress-observation.js'
import {localProgress} from '../lib/local-progress.js'
import {planKey} from '../lib/weighted-progress.js'

const now=Date.now(),settings={aiEnabled:true,aiScope:'all',now}
function fixture({workers=6,toolLength=64,goalLength=1500,tasks=32}={}){
 const tool='mcp__'+ 'tool_'.repeat(Math.ceil(toolLength/5)).slice(0,Math.max(0,toolLength-5))
 return {turn:1,running:true,turnStatus:'running',steps:99,evidenceRevision:8,updatedAt:now,observedPhase:'verify',projectBar:{mode:'team',done:1,total:tasks},
  plan:{total:tasks,done:1,coverage:'delegated',items:Array.from({length:tasks},(_,i)=>({id:'task-'+i,content:'Implement scene section '+i+' '+ 'detail '.repeat(32),owner:'Worker '+i%workers,status:i?'in_progress':'completed'}))},
  ownPlan:{total:32,done:0,items:Array.from({length:32},(_,i)=>({id:'lead-'+i,content:'Integrate and validate section '+i+' '+ 'detail '.repeat(32),status:'pending'}))},
  operations:{completed:100,failed:3},commands:Array.from({length:6},()=>({name:tool,label:'src/'+ 'section_'.repeat(12)})),
  preparing:{name:'write_file',label:'src/main.js'},
  children:Array.from({length:workers},(_,i)=>({id:'worker-'+i,label:'Worker '+i+' '+ 'descriptive name '.repeat(5),status:i===workers-1?'completed':'running',percentKnown:true,percent:i===workers-1?1:.5,done:1,total:3,lastTool:{name:tool,label:'src/'+ 'section_'.repeat(12),status:'completed'}})),
  probe:{goal:'Build a procedural scene. '.repeat(80).slice(0,goalLength),evidence:{checks:Array.from({length:4},()=>({name:tool,label:'Validate result '+ 'details '.repeat(20),status:'failed'})),changedFiles:Array(12).fill('src/'+ 'section_'.repeat(12)),milestones:Array(4).fill({name:'write_file',label:'src/main.js'}),assistantClaim:'integration remains'},recentOperations:Array(6).fill({name:tool,label:'src/'+ 'section_'.repeat(12),status:'completed'})}}
}
const line=(text,prefix)=>{const value=text.split('\n').find(row=>row.startsWith(prefix));assert.ok(value,`missing core section ${prefix}`);return value.slice(prefix.length)}
const cases=[]
function check(name,run){try{run();cases.push({name,ok:true})}catch(error){cases.push({name,ok:false,error:error.message})}}

check('ordinary bounded envelope keeps core evidence and all six workers',()=>{
 const v=fixture(),text=buildProgressObservation(v,{weights:Array(32).fill(1/32)})
 assert.ok(text.length<=10000);assert.match(text,/^Lead-only responsibilities/m)
 const critical=JSON.parse(line(text,'Current evidence: ')),workers=JSON.parse(line(text,'Workers: '))
 assert.equal(critical.failed,3);assert.equal(critical.plan_status.length,32);assert.equal(critical.lead_status.length,32);assert.equal(workers.length,6);assert.equal(workers.at(-1).status,'completed')
})
check('long extension tool identifiers cannot evict the complete worker state envelope',()=>{
 // Tracker stores extension names without a local length guard. Keep the UI/request
 // bounded even when an extension supplies an unusually descriptive identifier.
 const v=fixture({toolLength:512}),text=buildProgressObservation(v,{weights:Array(32).fill(1/32)})
 assert.ok(text.length<=10000)
 assert.equal(JSON.parse(line(text,'Workers: ')).length,6)
 assert.match(text,/^Lead-only responsibilities/m)
 assert.equal(JSON.parse(line(text,'Current evidence: ')).failed,3)
})
check('shared-board weights cannot erase a distinct incomplete lead-only scope',()=>{
 const items=[{id:'shared-1',content:'Build scene assets',owner:'worker-a',status:'completed'},{id:'shared-2',content:'Polish scene assets',owner:'',status:'in_progress'}]
 const view={turn:1,running:true,turnStatus:'running',evidenceRevision:1,projectBar:{mode:'team',done:1,total:2},plan:{items,done:1,total:2,coverage:'checklist'},ownPlan:{items:[{content:'Integrate renderer and validate every deliverable',status:'pending'}],done:0,total:1},children:[{id:'worker-a',label:'Assets',status:'running'}],model:{turn:1,at:now,evidenceAt:now,evidenceRevision:1,percent:.2,confidence:2,weights:[1,1],fractions:[1,.8],planKey:planKey(items)}}
 assert.match(buildProgressObservation(view),/Integrate renderer/)
 const display=localProgress(view,settings)
 assert.equal(display.percent,.2,'whole-request p must still account for separate lead duties; board-only fractions report .9')
 assert.equal(display.source,'model')
})
check('clipped names keep independent worker identities and owner alignment',()=>{
 const prefix='CURRENT: Team member implementing the procedural scene subsystem '
 const a=prefix+'forest',b=prefix+'architecture',v=fixture({workers:2,tasks:2})
 v.children=[{id:'worker-forest',label:a,status:'running',done:0,total:1},{id:'worker-architecture',label:b,status:'completed',done:1,total:1}]
 v.plan.items=v.plan.items.map((item,i)=>({...item,owner:i?b:a}))
 const rows=JSON.parse(line(buildProgressObservation(v),'Workers: '))
 assert.equal(new Set(rows.map(row=>row.id??row.name)).size,2,'different teammates must remain distinguishable after label clipping')
})
check('summary-only task arrays do not retain an old complete-array weight lock',()=>{
 const v=fixture();v.plan.total=33
 // This can occur in ai-progress: adding the 33rd task leaves the first 32-item
 // planKey unchanged, so s.weights may retain the prior complete-plan lock.
 const text=buildProgressObservation(v,{weights:Array(32).fill(1/32)})
 assert.equal(JSON.parse(line(text,'Current evidence: ')).plan_summary_only,true)
 assert.doesNotMatch(text,/Locked weights:/,'summary-only p assessment must not consume stale partial-plan locks')
 assert.match(text,/do not return w\/f/)
})
check('truncated lists preserve exact completed-count evidence without false alignment',()=>{
 const v=fixture();v.ownPlan={items:[],total:0,done:0};v.plan.total=33;v.plan.coverage='checklist';v.model={turn:1,at:now,evidenceAt:now,evidenceRevision:8,percent:.9,confidence:2,weights:Array(32).fill(1),fractions:Array(32).fill(.9),planKey:planKey(v.plan.items)}
 const d=localProgress(v,settings);assert.equal(d.percent,1/33);assert.equal(d.percentKnown,true);assert.equal(d.weights,null)
})
check('fresh response does not freshen an old evidence snapshot',()=>{
 const v=fixture({tasks:2});v.plan.coverage='delegated';v.model={turn:1,at:now,evidenceAt:now-700000,evidenceRevision:8,percent:.9,confidence:2,planKey:planKey(v.plan.items)}
 const d=localProgress(v,settings);assert.equal(d.percentKnown,true);assert.ok(d.source.startsWith('local-'));assert.equal(d.ageMs,700000)
})
for(const item of cases)console.log(`${item.ok?'PASS':'FAIL'} ${item.name}${item.error?'\n  '+item.error:''}`)
console.log(`Context review: ${cases.filter(item=>item.ok).length}/${cases.length} passed`)
if(cases.some(item=>!item.ok))process.exitCode=1
