import assert from'node:assert/strict'
import fs from'node:fs';import os from'node:os';import path from'node:path'
import {createAiProgress}from'../lib/ai-progress.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-cadence-'));let fixture=0
function setup({mode='balanced',childCount=0,answer,confidence=1}={}){
 let at=1800000000000,seq=0,hold=null;const calls=[],models=[],records=[],views={root:{sessionId:'root',turn:1,running:true,evidenceRevision:0,steps:0,plan:{items:[],done:0,total:0},operations:{completed:0,failed:0},children:[],probe:{goal:'Main task',recentOperations:[]}}}
 for(let i=0;i<childCount;i++){const id='c'+i;views[id]={...structuredClone(views.root),sessionId:id,probe:{goal:id,recentOperations:[]}};views.root.children.push({id,label:id,status:'running',percent:0,percentKnown:false})}
 const probe={available:true,lastAttempt:null,async ask(payload,signal,{sessionId}){calls.push({id:sessionId,payload});if(hold)await new Promise(resolve=>{hold.release=resolve;signal.addEventListener('abort',resolve,{once:true})});this.lastAttempt={calls:1,usage:{inputTokens:100,cacheReadTokens:50,outputTokens:10}};return answer?answer(sessionId,calls):{percent:.3,confidence,phase:'implement'}}}
 const ai=createAiProgress({probe,snapshot:id=>views[id]??{},setModel(id,m){models.push({id,...m});views[id].model=m;const child=views.root.children.find(c=>c.id===id);if(child){child.percent=m.percent;child.percentKnown=m.confidence!==0}},recordObservation:(id,r)=>records.push({id,...r}),quote:async()=>({priced:true,cny:.001,usd:.0001}),now:()=>at,file:path.join(dir,String(fixture++))})
 ai.configure({aiEnabled:true,cadence:mode});ai.observe('root')
 const step=(id='root',change={},owner,advance=1000)=>{at+=advance;views[id]={...views[id],...change};if(!owner)views[id].steps++;ai.observe('root');return ai.completedStep(id,structuredClone(views[id]),{seq:++seq,step:views[id].steps,owner,at})}
 return{ai,views,calls,models,records,step,clock(ms){at+=ms;ai.observe('root')},hold(){hold={};return hold},release(){hold?.release();hold=null}}
}
try{
 for(const mode of ['balanced','every-2','step']){const f=setup({mode});try{for(let i=0;i<12;i++){f.step();await f.ai.tick()}assert.equal(f.calls.length,mode==='step'?12:6);const n=f.calls.length;f.clock(300000);await f.ai.tick();assert.equal(f.calls.length,n,'no timer-only request');f.ai.configure({aiEnabled:false});await f.ai.request('root',{manual:true});f.step();await f.ai.tick();assert.equal(f.calls.length,n+1,'manual one-shot bypasses cadence on next boundary');f.step();await f.ai.tick();assert.equal(f.calls.length,n+1)}finally{f.ai.dispose()}}
 {
  const f=setup();try{f.step();f.hold();const old=f.ai.tick();await Promise.resolve();f.step('root',{evidenceRevision:1,operations:{completed:1,failed:1}});f.release();await old;assert.equal(f.models.length,0,'old scope response is billed but not applied');await f.ai.tick();assert.equal(f.models.length,1);assert.equal(f.models[0].evidenceRevision,1)}finally{f.ai.dispose()}
 }
 {
  const f=setup();try{f.step();f.hold();const old=f.ai.tick();await Promise.resolve();for(let i=0;i<100;i++)f.step();assert.equal(f.ai.status('root').queuedSteps,1,'one latest queued snapshot per actor');assert.ok(f.ai.status('root').cadenceStats.coalesced>90);f.release();await old;await f.ai.tick();assert.equal(f.calls.length,2);assert.match(f.calls[1].payload,/101/,'coalesced request includes latest work') }finally{f.ai.dispose()}
 }
 {
  const f=setup({childCount:1});try{f.step();await f.ai.tick();for(let i=0;i<12;i++){f.step('c0');f.step('root',{},'c0');for(let k=0;k<3;k++)await f.ai.tick()}assert.ok(f.calls.filter(c=>c.id==='c0').length>=5,'child has independent observations');assert.ok(f.calls.filter(c=>c.id==='root').length<=4,'ordinary child steps are merged at parent');const old=f.calls.filter(c=>c.id==='root').length;f.views.root.evidenceRevision++;f.step('c0',{evidenceRevision:1,operations:{completed:0,failed:1}});f.step('root',{},'c0');for(let k=0;k<3;k++)await f.ai.tick();assert.ok(f.calls.filter(c=>c.id==='root').length>old,'child failure is not swallowed by percentage thresholds');f.views.root.children[0].status='completed';f.views.c0.running=false;f.ai.completedStep('root',f.views.root,{seq:'terminal:c0',step:0,owner:'c0',kind:'worker-terminal',at:1800000100000});await f.ai.tick();assert.equal(f.views.root.running,true);assert.notEqual(f.views.root.model.percent,1,'child completion is not root completion');const usage=f.ai.status('root').turnUsage;assert.equal(usage.requests,f.calls.length);assert.ok(Math.abs(usage.costCny-f.calls.length*.001)<1e-12)}finally{f.ai.dispose()}
 }
 {
  let failed=false;const f=setup({childCount:1,answer:id=>{if(id==='root'&&!failed){failed=true;return null}return{percent:.3,confidence:1,phase:'implement'}}});try{f.step();await f.ai.tick();f.step();f.step('c0',{},undefined,0);await f.ai.tick();assert.equal(f.calls[1].id,'c0','a failed parent backoff must not block the child')}finally{f.ai.dispose()}
 }
 {
  const f=setup({childCount:6});try{f.step();for(let i=0;i<6;i++){f.step('c'+i);f.step('root',{},'c'+i)}for(let k=0;k<20;k++)await f.ai.tick();for(const id of ['root','c0','c1','c2','c3','c4','c5'])assert.ok(f.calls.some(c=>c.id===id),'every actor receives a slot');assert.ok(f.ai.status('root').queuedSteps<=1)}finally{f.ai.dispose()}
 }
 console.log('cadence integration passed: reduced calls, no timer, manual, stale scopes, bounded coalescing, independent children, critical bypass, fee sum, backoff isolation, six-actor fairness')
}finally{fs.rmSync(dir,{recursive:true,force:true})}
