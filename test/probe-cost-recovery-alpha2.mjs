import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createProbeHistory} from '../lib/probe-history.js'
import {createProbeCost} from '../lib/probe-cost.js'
import {createAiProgress} from '../lib/ai-progress.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-cost-recovery-')),file=path.join(home,'probes.jsonl')
const at=Date.parse('2026-11-11T02:00:00Z'),usage={inputTokens:100,cacheReadTokens:900,outputTokens:10}
const base={sid:'root',turn:1,kind:'probe',calls:1,provider:'deepseek',model:'deepseek-flash',startedAt:at,at:at+1000,usage}
const unknown={priced:false,reason:'cost-meter-unavailable'}
const child={sid:'child',rootSid:'root',rootTurn:1}
const rows=[
 {...base,step:1,cost:{priced:true,cny:.1,usd:.01}},
 {...base,...child,step:2,cost:unknown},
 {...base,kind:'failure',step:3,usage:{inputTokens:200,cacheReadTokens:1800,outputTokens:20},cost:unknown},
 {...base,...child,turn:2,step:4},
 {...base,step:5,usage:null,cost:unknown},
 {...base,...child,turn:2,step:6,model:'unpriced-custom-model',cost:{priced:false,reason:'model-unpriced'}},
 {...base,step:7,usage:{inputTokens:100},cost:unknown},
 {...base,step:8,cost:{priced:true,cny:0,usd:0}},
 {...base,...child,turn:2,step:9,kind:'cancelled',cost:unknown},
]
const close=(got,expected,label)=>assert.ok(Math.abs(got-expected)<1e-12,`${label}: ${got} vs ${expected}`)
try{
 fs.writeFileSync(file+'.1',rows.slice(0,3).map(JSON.stringify).join('\n')+'\n')
 fs.writeFileSync(file,rows.slice(3).map(JSON.stringify).join('\n')+'\n')
 const before=[fs.readFileSync(file),fs.readFileSync(file+'.1')]
 const builtin=createProbeCost({home}),single=await builtin(base),seen=[]
 const quote=async(row,options)=>{seen.push({step:row.step,at:options.at,sid:options.sid});return builtin(row,options)}
 const history=createProbeHistory(file,{quote});await history.ready
 const root=history('root',1),worker=root.stats.workerUsage.child
 assert.equal(root.stats.requests,9,'each physical main/child request is included once after complete replay')
 assert.equal(root.stats.pricedRequests,6,'legacy unknown quotes with complete usage can now become priced')
 assert.equal(root.stats.unpricedRequests,3,'absent/partial usage and an unknown price remain unknown')
 close(root.stats.costCny,.1+single.cny*5,'frozen main amount plus recovered main and child fees')
 close(root.stats.costUsd,.01+single.usd*5,'frozen USD amount is not repriced')
 assert.equal(worker.requests,4);assert.equal(worker.pricedRequests,3);assert.equal(worker.unpricedRequests,1)
 close(worker.costCny,single.cny*3,'child subtotal is counted once across resumed child turns')
 close(history('child',1).stats.costCny,single.cny,'first child turn fee')
 close(history('child',2).stats.costCny,single.cny*2,'resumed child and cancelled-but-billed fee')
 assert.equal(root.history.length,5,'child observations never become main percentages')
 assert.deepEqual(seen.map(row=>row.step),[2,3,4,6,9],'frozen amounts (including a true zero) and incomplete usage are never re-quoted')
 assert.ok(seen.every(row=>row.at===at),'historical billing timestamps are passed unchanged')
 const snapshot=structuredClone(root.stats);history('root',1);history('child',2);await history.ready
 assert.deepEqual(history('root',1).stats,snapshot,'reading or awaiting an already-recovered history cannot add fees again')
 assert.deepEqual(fs.readFileSync(file),before[0]);assert.deepEqual(fs.readFileSync(file+'.1'),before[1],'recovery is read-only and does not rewrite pricing evidence')

 // A still-missing price or quote failure must not turn an unknown into zero.
 const failedFile=path.join(home,'failed.jsonl')
 fs.writeFileSync(failedFile,JSON.stringify({...base,cost:unknown})+'\n')
 for(const failingQuote of [async()=>{throw Error('unavailable')},async()=>({priced:false,reason:'model-unpriced'})]){
  const failed=createProbeHistory(failedFile,{quote:failingQuote});await failed.ready
  assert.equal(failed('root',1).stats.pricedRequests,0);assert.equal(failed('root',1).stats.unpricedRequests,1)
 }
 const withoutQuote=createProbeHistory(failedFile);await withoutQuote.ready;assert.equal(withoutQuote('root',1).stats.unpricedRequests,1)
 // Persisted stats already contain costCny:0 for old unknown requests.
 // Recovery can finish before or after a new request; only the initial share
 // may be replaced, and current-process fees must survive either ordering.
 async function resumedFamily(recoverDuringActive){
  const frozen={requests:9,costCny:.1,costUsd:.01,pricedRequests:2,unpricedRequests:7,workerUsage:{child:{requests:4,costCny:0,costUsd:0,pricedRequests:0,unpricedRequests:4}}}
  const views={root:{sessionId:'root',turn:1,running:true,evidenceRevision:0,plan:{items:[],total:0},children:[{id:'child',label:'Worker',status:'running'}],probeStats:frozen},child:{sessionId:'child',turn:2,running:true,evidenceRevision:0,plan:{items:[],total:0},children:[],probeStats:{requests:3,costCny:0,costUsd:0,pricedRequests:0,unpricedRequests:3}}}
  const recovery=(id,turn)=>history(id,turn);recovery.costsReady=false
  let release,entered;const started=new Promise(resolve=>entered=resolve),writes=[]
  const probe={available:true,lastAttempt:null,async ask(){entered();await new Promise(resolve=>release=resolve);this.lastAttempt={...base};return{percent:.4,confidence:2,phase:'implement'}}}
  const ai=createAiProgress({probe,snapshot:id=>views[id],setModel(){},history:recovery,quote:builtin,recordObservation:(id,row)=>writes.push({id,...structuredClone(row)}),now:()=>at,file:path.join(home,'settings-'+recoverDuringActive+'.json')})
  try{
   ai.configure({aiEnabled:true,cadence:'step'});ai.observe('root')
   close(ai.status('root').turnUsage.costCny,.1,'known initial subtotal remains visible while history is loading')
   assert.equal(ai.status('root').turnUsage.costPending,true,'old explicit unpriced costs schedule recovery')
   close(ai.status('child').turnUsage.costCny,0,'old child starts with a known zero subtotal and unknown requests')
   ai.completedStep('child',views.child,{seq:100,step:10,at});const live=ai.tick();await started
   if(recoverDuringActive){recovery.costsReady=true;close(ai.status('root').turnUsage.costCny,.1+single.cny*5,'initial recovery can finish while a child request is active');close(ai.status('child').turnUsage.costCny,single.cny*2,'active child recovery uses its own initial turn')}
   release();await live
   if(!recoverDuringActive){
    close(ai.status('root').turnUsage.costCny,.1+single.cny,'live money is added to the existing known subtotal before recovery')
    const saved=writes.filter(row=>row.id==='root').at(-1).stats;close(saved.costCny,.1+single.cny,'a pending recovery must not omit known monetary fields from persistence')
    recovery.costsReady=true
   }
   const final=ai.status('root'),own=ai.status('child')
   assert.equal(final.turnUsage.requests,10);assert.equal(final.turnUsage.pricedRequests,7);assert.equal(final.turnUsage.unpricedRequests,3)
   close(final.turnUsage.costCny,.1+single.cny*6,'historical share is replaced once and the live fee is retained')
   close(final.workerUsage.child.costCny,single.cny*4,'worker old + resumed live fees are not duplicated')
   assert.equal(final.workerUsage.child.requests,5);assert.equal(final.workerUsage.child.pricedRequests,4);assert.equal(final.workerUsage.child.unpricedRequests,1)
   assert.equal(own.turnUsage.requests,4);close(own.turnUsage.costCny,single.cny*3,'current worker turn retains its own recovery and live subtotal')
   assert.equal(final.turnUsage.costPending,false)
   for(let i=0;i<4;i++){close(ai.status('root').turnUsage.costCny,final.turnUsage.costCny,'repeated status cannot reapply history');close(ai.status('child').turnUsage.costCny,own.turnUsage.costCny,'child status cannot reapply history')}
  }finally{ai.dispose()}
 }
 await resumedFamily(true);await resumedFamily(false)

 // A bounded log can no longer cover all initial requests. Keep its old known
 // subtotal and unknown remainder rather than replacing it with a partial log.
 for(const initial of [{requests:20,costCny:1.234,costUsd:.2,pricedRequests:5,unpricedRequests:15},{requests:20},{requests:9,costCny:1.234,costUsd:.2,pricedRequests:5,unpricedRequests:4}]){
  const read=(id,turn)=>history(id,turn);read.costsReady=true
  const view={sessionId:'root',turn:1,running:true,plan:{items:[],total:0},children:[],probeStats:initial},saved=[]
  const ai=createAiProgress({probe:{available:false},snapshot:()=>view,setModel(){},history:read,recordObservation:(_,row)=>saved.push(row),file:path.join(home,'partial-'+String(initial.costCny)+'.json')})
  try{const current=ai.status('root').turnUsage;assert.equal(current.requests,initial.requests);close(current.costCny,initial.costCny??0,'partial logs cannot erase an existing known subtotal');assert.equal(current.unpricedRequests,initial.unpricedRequests??initial.requests);assert.equal(current.pricedRequests,initial.pricedRequests??0);assert.equal(current.costPending,false);assert.equal(ai.status('root').turnUsage.costCny,current.costCny)}finally{ai.dispose()}
 }
 const zeroView={sessionId:'root',turn:1,running:true,plan:{items:[],total:0},children:[],probeStats:{requests:9,costCny:0,costUsd:0,pricedRequests:0,unpricedRequests:9}}
 const completedRead=(id,turn)=>history(id,turn);completedRead.costsReady=true
 const zeroAi=createAiProgress({probe:{available:false},snapshot:()=>zeroView,setModel(){},history:completedRead,file:path.join(home,'old-zero.json')})
 try{close(zeroAi.status('root').turnUsage.costCny,.1+single.cny*5,'an old persisted explicit zero can recover all newly priced history');assert.equal(zeroAi.status('root').turnUsage.unpricedRequests,3);close(zeroAi.status('root').workerUsage.child.costCny,single.cny*3,'complete history restores a previously absent worker breakdown')}finally{zeroAi.dispose()}
 // Invalid AI confidence can now fall back to a known local percentage.
 // That fallback must never be logged as a successful AI percentage.
 const fallbackView={sessionId:'fallback',turn:1,running:true,evidenceRevision:0,operations:{completed:5},plan:{items:[],total:0},children:[]},logged=[]
 const fallbackProbe={available:true,lastAttempt:null,async ask(){this.lastAttempt={...base};return{percent:.7,confidence:0,phase:'implement'}}}
 const fallbackAi=createAiProgress({probe:fallbackProbe,snapshot:()=>fallbackView,setModel(){},quote:builtin,log:row=>logged.push(row),now:()=>at,file:path.join(home,'fallback-ai.json')})
 try{fallbackAi.configure({aiEnabled:true,cadence:'step'});fallbackAi.observe('fallback');fallbackAi.completedStep('fallback',fallbackView,{seq:1,step:1,at});await fallbackAi.tick();assert.equal(logged.find(row=>row.kind==='probe').modelPercent,null,'a local fallback is not an AI observation');assert.equal(fallbackAi.status('fallback').advice.percent,null)}finally{fallbackAi.dispose()}
 console.log('probe cost recovery alpha2 passed: legacy unpriced re-quote, frozen successful/zero quotes, complete usage only, immutable billing timestamp, exact-once main + resumed worker totals, failure/cancelled billing, read-only recovery, unknown-price preservation, persisted-zero recovery, active/live family reconciliation, partial-history safeguards, AI/local source guard')
}finally{fs.rmSync(home,{recursive:true,force:true})}
