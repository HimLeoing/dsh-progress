import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createAiProgress} from '../lib/ai-progress.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-transitions-'));let serial=0
function setup({cadence='step',enabled=true,children=0,planned=false}={}){
 let time=1800000000000,seq=0,held=null,nextAnswer={percent:.4,confidence:2,phase:'implement'}
 const calls=[],models=[],records=[],views={root:{turn:1,running:true,turnStatus:'running',evidenceRevision:0,steps:0,plan:{items:[],done:0,total:0},operations:{completed:0,failed:0},children:[],probe:{goal:'Main implementation',recentOperations:[]}}}
 if(planned)views.root.plan={items:[{content:'Main work',status:'in_progress'}],done:0,total:1}
 for(let i=0;i<children;i++){const id='c'+i;views[id]={...structuredClone(views.root),plan:{items:[],done:0,total:0},children:[],probe:{goal:'Child '+id,recentOperations:[]}};views.root.children.push({id,label:id,status:'running'})}
 const probe={available:true,lastAttempt:null,async ask(payload,signal,{sessionId}){const call={id:sessionId,payload,signal};calls.push(call);if(held){const gate=held;held=null;await new Promise(resolve=>{gate.release=resolve;signal.addEventListener('abort',()=>{gate.aborted=true;resolve()},{once:true})})}this.lastAttempt={calls:1,usage:{inputTokens:100,cacheReadTokens:60,outputTokens:10},startedAt:time};return nextAnswer}}
 const ai=createAiProgress({probe,snapshot:id=>views[id]??{},setModel:(id,model)=>{models.push({id,...model});views[id].model=model},recordObservation:(id,r)=>records.push({id,...r}),quote:async()=>({priced:true,cny:.002,usd:.0002}),now:()=>time,file:path.join(dir,String(serial++))})
 ai.configure({aiEnabled:enabled,cadence});ai.observe('root')
 const step=(id='root',change={})=>{time+=1000;views[id]={...views[id],...change,steps:views[id].steps+1,updatedAt:time};const boundary={kind:'step/end',seq:++seq,step:views[id].steps,at:time};views[id].boundary=boundary;ai.observe('root');return ai.completedStep(id,structuredClone(views[id]),boundary)}
 return{ai,views,calls,models,records,step,hold(){return held={}},answer(a){nextAnswer=a},clock(ms){time+=ms;ai.observe('root')}}
}
const results=[]
async function check(name,fn){let f;try{await fn(options=>f=setup(options));results.push({name,ok:true})}catch(error){results.push({name,ok:false,error:error.message})}finally{f?.ai.dispose()}}
try{
 await check('step to balanced collapses actor backlog without recounting boundaries',async make=>{
  const f=make();for(let i=0;i<6;i++)f.step();const before=f.ai.status('root').cadenceStats.boundaries
  f.ai.configure({cadence:'balanced'});assert.equal(f.ai.status('root').queuedSteps,1);assert.equal(f.ai.status('root').cadenceStats.boundaries,before)
  await f.ai.tick();assert.equal(f.calls.length,1);assert.match(f.calls[0].payload,/"steps":6/);assert.equal(f.ai.status('root').queuedSteps,0)
 })
 await check('balanced to step starts at the next new real boundary',async make=>{
  const f=make({cadence:'balanced'});f.step();f.ai.configure({cadence:'step'});assert.equal(f.ai.status('root').queuedSteps,0)
  await f.ai.request('root');assert.equal(f.calls.length,0,'request compatibility cannot replay the pre-switch boundary')
  f.step();await f.ai.tick();assert.equal(f.calls.length,1);assert.equal(f.models[0].forStep,2)
 })
 await check('AI off drains a sent request for billing without applying it after re-enable',async make=>{
  const f=make();f.step();const hold=f.hold(),flight=f.ai.tick();await Promise.resolve();f.ai.configure({aiEnabled:false})
  const aborted=f.calls[0].signal.aborted;f.ai.configure({aiEnabled:true});f.step();hold.release();await flight
  assert.equal(aborted,false,'already sent request should finish so final usage can be priced');assert.equal(f.models.length,0,'pre-disable response cannot leak across re-enable')
  assert.equal(f.ai.status('root').turnUsage.pricedRequests,1);assert.equal(f.ai.status('root').turnUsage.costCny,.002)
  await f.ai.tick();assert.equal(f.models.length,1);assert.equal(f.models[0].forStep,2);assert.equal(f.ai.status('root').turnUsage.costCny,.004)
 })
 await check('AI off clears unsent actor queues and does not backfill old boundaries',async make=>{
  const f=make({children:2});f.step();f.step('c0');f.step('c1');f.ai.configure({aiEnabled:false})
  for(const id of ['root','c0','c1'])assert.equal(f.ai.status(id).queuedSteps,0)
  f.step();f.ai.configure({aiEnabled:true});await f.ai.request('root');assert.equal(f.calls.length,0,'disabled boundary must not be replayed when enabling')
  f.step();await f.ai.tick();assert.equal(f.calls.length,1)
 })
 await check('scope changes isolate pending responses while eligible children remain usable',async make=>{
  const f=make({planned:true,children:1});f.step();const hold=f.hold(),flight=f.ai.tick();await Promise.resolve()
  f.ai.configure({aiScope:'no-plan'});assert.equal(f.step(),false);f.step('c0');f.ai.configure({aiScope:'all'});f.step();hold.release();await flight
  assert.equal(f.models.length,0,'old all-scope answer cannot leak through no-plan then all')
  assert.equal(f.calls[0].signal.aborted,false);await f.ai.tick();assert.equal(f.models.length,1);assert.equal(f.models[0].forStep,3)
 })
 await check('manual off remains a diagnostic one-shot across cadence changes',async make=>{
  const f=make({enabled:false});await f.ai.request('root',{manual:true});f.step();f.ai.configure({cadence:'balanced'});await f.ai.tick()
  assert.equal(f.calls.length,1);assert.equal(f.models.length,0,'manual off cannot replace local progress');assert.equal(f.ai.status('root').advice.percent,.4)
  f.step();await f.ai.tick();assert.equal(f.calls.length,1)
 })
 await check('same-settings writes do not invalidate pending work or duplicate boundaries',async make=>{
  const f=make();f.step();const hold=f.hold(),flight=f.ai.tick();await Promise.resolve();f.ai.configure({aiEnabled:true,cadence:'step',aiScope:'all'});hold.release();await flight
  assert.equal(f.models.length,1);await f.ai.request('root');assert.equal(f.calls.length,1)
 })
 await check('switching to fine mode preserves an explicitly queued diagnostic one-shot',async make=>{
  const f=make({enabled:false,cadence:'balanced'});await f.ai.request('root',{manual:true});f.step();f.ai.configure({cadence:'step'});await f.ai.tick()
  assert.equal(f.calls.length,1);assert.equal(f.models.length,0);assert.equal(f.ai.status('root').advice.percent,.4);f.step();await f.ai.tick();assert.equal(f.calls.length,1)
 })
 await check('no-plan scope still serves an unplanned child while excluding its planned parent',async make=>{
  const f=make({planned:true,children:1});f.ai.configure({aiScope:'no-plan'});assert.equal(f.step(),false);assert.equal(f.step('c0'),true);await f.ai.tick()
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].id,'c0');assert.equal(f.models[0].id,'c0');assert.equal(f.ai.status('root').turnUsage.requests,1);assert.equal(f.ai.status('root').queuedSteps,0)
 })
 await check('new enablement is not blocked by a stale failure backoff',async make=>{
  const f=make();f.answer(null);f.step();await f.ai.tick();f.ai.configure({aiEnabled:false});f.ai.configure({aiEnabled:true});f.answer({percent:.5,confidence:2,phase:'verify'});f.step();await f.ai.tick()
  assert.equal(f.calls.length,2);assert.equal(f.models.length,1)
 })
 await check('drained child usage is counted exactly once at its root after disabling',async make=>{
  const f=make({children:1});f.step('c0');const hold=f.hold(),flight=f.ai.tick();await Promise.resolve();f.ai.configure({aiEnabled:false});hold.release();await flight
  assert.equal(f.models.length,0);for(const id of ['root','c0']){const u=f.ai.status(id).turnUsage;assert.equal(u.requests,1);assert.equal(u.pricedRequests,1);assert.equal(u.costCny,.002)}
  assert.equal(f.ai.status('root').workerUsage.c0.costCny,.002);assert.equal(f.ai.status('root').queuedSteps,0)
 })
 await check('repeated family and cadence toggles neither leak old estimates nor lose billed usage',async make=>{
  const f=make({children:2}),actors=['root','c0','c1']
  for(let i=0;i<12;i++){
   const id=actors[i%actors.length],before=f.models.length
   f.ai.configure({aiEnabled:true,aiScope:'all',cadence:'step'});f.step(id);const hold=f.hold(),flight=f.ai.tick();await Promise.resolve()
   f.ai.configure({cadence:'balanced'});f.ai.configure({aiEnabled:false});f.ai.configure({aiScope:'no-plan'});f.ai.configure({aiEnabled:true});f.ai.configure({cadence:'step'});f.ai.configure({aiScope:'all'});f.step(id)
   hold.release();await flight;assert.equal(f.models.length,before);await f.ai.tick();assert.equal(f.models.length,before+1)
   for(const actor of actors)assert.equal(f.ai.status(actor).queuedSteps,0)
  }
  assert.equal(f.calls.length,24);assert.equal(f.models.length,12);const total=f.ai.status('root').turnUsage;assert.equal(total.requests,24);assert.equal(total.pricedRequests,24);assert.ok(Math.abs(total.costCny-.048)<1e-12)
 })
 for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.error?'\n  '+r.error:''}`)
 console.log(`Mode transitions: ${results.filter(r=>r.ok).length}/${results.length} passed`);if(results.some(r=>!r.ok))process.exitCode=1
}finally{fs.rmSync(dir,{recursive:true,force:true})}
