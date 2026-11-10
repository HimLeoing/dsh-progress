import assert from'node:assert/strict'
import fs from'node:fs';import os from'node:os';import path from'node:path'
import {createAiProgress}from'../lib/ai-progress.js'
let at=1800000000000,calls=0;const views={root:{sessionId:'root',turn:1,running:true,evidenceRevision:0,plan:{items:[],total:0},children:[{id:'child',label:'Forest',status:'running',percentKnown:false}],probe:{goal:'Whole scene'}},child:{sessionId:'child',turn:1,running:true,evidenceRevision:0,plan:{items:[],total:0},children:[],probe:{goal:'Forest only'}}}
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-family-')),models=[],logs=[],saved=[]
const probe={available:true,lastAttempt:null,async ask(payload){calls++;this.lastAttempt={calls:1,startedAt:at,usage:{inputTokens:100,cacheReadTokens:50,outputTokens:10}};return{percent:payload.includes('Forest only')?.4:.7,confidence:2,phase:'implement'}}}
const ai=createAiProgress({probe,snapshot:id=>views[id]??{},setModel:(id,m)=>{models.push({id,...m});views[id].model=m},recordObservation:(id,r)=>saved.push({id,...r}),log:r=>logs.push(r),quote:async()=>({priced:true,cny:.001,usd:.001/7}),now:()=>at,file:path.join(directory,'settings')})
try{
 ai.configure({aiEnabled:true});ai.observe('root');
 assert.equal(ai.completedStep('child',views.child,{seq:1,step:1,at}),true,'a visible parent allows its independent child probe')
 ai.completedStep('root',views.root,{seq:1,step:1,at,owner:'child'});await ai.tick();await ai.tick()
 assert.equal(calls,2);assert.equal(models.find(m=>m.id==='child').percent,.4);assert.equal(models.find(m=>m.id==='root').percent,.7)
 let root=ai.status('root');assert.equal(root.turnUsage.requests,2);assert.equal(root.turnUsage.costCny,.002);assert.equal(root.workerUsage.child.requests,1);assert.equal(root.workerUsage.child.cacheReadTokens,50)
 assert.equal(logs.find(r=>r.sid==='child'&&r.kind==='probe').rootSid,'root');assert.equal(saved.filter(r=>r.id==='root').at(-1).stats.requests,2)
 views.child={...views.child,turn:2};at+=100;ai.observe('root');ai.completedStep('child',views.child,{seq:2,step:1,at});await ai.tick()
 root=ai.status('root');assert.equal(root.turnUsage.requests,3,'a child resume must not lose or duplicate its earlier probe fee');assert.equal(root.workerUsage.child.requests,2)
 const old=calls;at+=100000;ai.observe('root');await ai.tick();assert.equal(calls,old,'time alone never probes')
 ai.configure({aiEnabled:false});assert.equal(ai.completedStep('child',views.child,{seq:3,step:2,at}),false)
 console.log('family probes passed: separate percentages, visible-family cadence, cached-input usage, exact-once family fees, resume, zero-cost off')
}finally{ai.dispose();fs.rmSync(directory,{recursive:true,force:true})}
// Independent child estimates and its own weighted checklist cannot be overwritten by the parent's weights.
const {workerProgress}=await import('../lib/worker-progress.js'),{planKey}=await import('../lib/weighted-progress.js')
const ownItems=[{content:'Geometry',status:'completed'},{content:'Review',status:'in_progress'}],parentItems=[{content:'Forest',status:'in_progress',owner:'Forest'}]
const parent={plan:{items:parentItems,total:1},model:{percent:.8,turn:1,weights:[1],fractions:[.8],planKey:planKey(parentItems)}}
const child={id:'c',label:'Forest',status:'running'},view={turn:1,running:true,evidenceRevision:0,projectBar:{mode:'turn'},ownPlan:{items:[],total:0},model:{turn:1,at:Date.now(),percent:.4,confidence:2,evidenceRevision:0,planKey:'[]'}}
assert.equal(workerProgress(child,view,parent,{aiEnabled:true,aiScope:'all'}).display.percent,.4)
const weighted=workerProgress(child,{...view,ownPlan:{items:ownItems,total:2,done:1},model:{...view.model,weights:[1,3],fractions:[1,.5],planKey:planKey(ownItems)}},parent,{aiEnabled:true,aiScope:'all'})
assert.equal(weighted.display.percent,.625,'the child uses its own difficulty weights')
// A terminal task drains an already sent request for usage, without accepting a late estimate.
const drainDir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-drain-'));let release,rootRunning=true,applied=0
const drainingProbe={available:true,lastAttempt:null,async ask(_,signal){await new Promise(resolve=>{release=resolve;signal.addEventListener('abort',()=>assert.fail('task end must collect already-sent usage'),{once:true})});this.lastAttempt={calls:1,usage:{inputTokens:10,cacheReadTokens:5,outputTokens:2}};return{percent:.9,confidence:2}}}
const draining=createAiProgress({probe:drainingProbe,snapshot:()=>({turn:1,running:rootRunning,plan:{items:[],total:0}}),setModel(){applied++},quote:async()=>({priced:true,cny:.001,usd:.0001}),file:path.join(drainDir,'p')})
try{draining.configure({aiEnabled:true});draining.observe('r');draining.completedStep('r',{turn:1,running:true,plan:{items:[],total:0}},{seq:1,step:1,at:Date.now()});const sent=draining.tick();await Promise.resolve();rootRunning=false;draining.cancel('r',{drain:true});release();assert.equal((await sent).reason,'cancelled');assert.equal(applied,0);assert.equal(draining.status('r').turnUsage.costCny,.001);assert.equal(draining.status('r').turnUsage.unpricedRequests,0)}finally{draining.dispose();fs.rmSync(drainDir,{recursive:true,force:true})}
