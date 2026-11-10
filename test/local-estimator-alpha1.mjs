import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createLocalEvidence,syncLocalPlan,recordLocalOperation,estimateLocalProgress,estimateLocalScope,localPlanFractions,weightedLocalFraction,localItemKeys,readLocalEvidence} from '../lib/local-estimator.js'
import {localProgress} from '../lib/local-progress.js'
import {freezeLocalCheckpoint} from '../lib/local-continuity.js'
import {createTracker} from '../lib/tracker.js'
import {createLearningStore} from '../lib/learning-store.js'
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`),off={aiEnabled:false}
const ev=createLocalEvidence('Implement a web app'),base={turn:1,running:true,turnStatus:'running',evidenceRevision:0,localEvidence:ev,plan:{items:[],total:0,done:0},operations:{completed:0},children:[]}
for(let i=0;i<6;i++)recordLocalOperation(ev,{name:'write',phase:'implement',label:'file'+i,status:'completed'})
let d=localProgress(base,off);assert.equal(d.percentKnown,true);assert.equal(d.indeterminate,false);assert.equal(d.estimated,true);assert.ok(d.percent>0&&d.percent<1);const before=d.percent
assert.equal(localProgress(base,{...off,now:Date.now()+86400000}).percent,before,'idle time alone cannot advance total progress')
for(let i=0;i<100;i++)recordLocalOperation(ev,{name:'job_output',phase:'implement',label:'poll'+i,status:'completed'})
near(localProgress(base,off).percent,before)
recordLocalOperation(ev,{name:'bash',phase:'implement',label:'permanent server',infinite:true,status:'completed'});near(localProgress(base,off).percent,before)
recordLocalOperation(ev,{name:'bash',phase:'verify',label:'Final acceptance full suite',status:'completed'});const verified=localProgress(base,off).percent;assert.ok(verified>before)
recordLocalOperation(ev,{name:'bash',phase:'verify',label:'failure',status:'failed'});assert.ok(localProgress(base,off).percent<verified,'real rework invalidates final verification')
assert.equal(localProgress({...base,running:false,turnStatus:'completed'},off).percent,1)
assert.ok(localProgress({...base,running:false,turnStatus:'interrupted'},off).percent<1)
// Exactly the user's formula, using independent local item evidence at 60%.
const items=[{content:'First task',weight:20,status:'completed'},{content:'Second task',weight:40,status:'in_progress'},{content:'Third task',weight:40,status:'pending'}],planned=createLocalEvidence('project');syncLocalPlan(planned,items)
const keys=localItemKeys(items),second=planned.items[keys[1]];second.units=second.prior.map(n=>-Math.log(.4)*n/Math.log(10))
near(estimateLocalScope(second),.6);near(weightedLocalFraction([.2,.4,.4],[1,.6,0]),.44)
const planView={...base,localEvidence:planned,plan:{items,total:3,done:1}};d=localProgress(planView,off);near(d.percent,.44);assert.equal(d.source,'local-weighted')
items[1].status='completed';items[2].status='in_progress';syncLocalPlan(planned,items);d=localProgress(planView,off);near(d.percent,.6);assert.equal(localPlanFractions(planView)[2],0,'next item starts at its own zero')
const bridge=freezeLocalCheckpoint(planView,{percentKnown:true,percent:.7,weights:[.2,.4,.4]});planView.localBridge=bridge;near(localProgress(planView,off).percent,.7)
const third=planned.items[keys[2]];third.units=third.prior.map(n=>-Math.log(.5)*n/Math.log(10));near(localProgress(planView,off).percent,.85,'bridge allocates only new local fraction after disabling AI')
near(localProgress(planView,off).percent,.85);assert.equal(localProgress({...base,children:[{id:'new',status:'running',percent:0}]},off).percentKnown,true)
assert.ok(localProgress({...base,children:[{id:'new',status:'running',percent:0}]},off).percent>0,'new worker zero cannot erase lead evidence')
assert.ok(estimateLocalProgress({...base,children:[{id:'new',status:'completed'}]}).percent>estimateLocalProgress({...base,children:[{id:'new',status:'running',percent:0}]}).percent)
const clone=JSON.parse(JSON.stringify(planned));near(estimateLocalProgress({...planView,localEvidence:readLocalEvidence(clone)}).percent,estimateLocalProgress(planView).percent)
assert.equal(readLocalEvidence({...clone,root:{...clone.root,units:[null]}}),null)
const dup=[{content:'Same',status:'in_progress'},{content:'Same',status:'in_progress'}];assert.notEqual(...localItemKeys(dup))
const partial=localProgress({...base,localEvidence:createLocalEvidence(),plan:{items:Array.from({length:32},()=>({content:'visible',status:'completed'})),total:33,done:32}},off);near(partial.percent,32/33)
// Real dispatch ownership: finish a tool after another checklist item becomes active.
let now=1800000000000;const realNow=Date.now;Date.now=()=>now
const handlers=new Map(),records=new Map(),session={id:'lead',seq:0,header:{createdAt:now,cwd:'/fixture'},events:[],snapshotEvents(){return this.events}},calls=[]
const learning={observeDuration(){},duration:()=>({samples:0,ms:1000}),localPrior:(_key,seed)=>({units:seed,samples:0}),observeLocal:(...args)=>calls.push(args)}
const tracker=createTracker({on:(key,fn)=>{handlers.set(key,fn);return()=>{}},get:key=>key==='sessions'?{list:()=>[session]}:undefined},{localProgress:true,captureTranscript:false,learning,persistence:{load:id=>records.get(id),save:(id,r)=>records.set(id,structuredClone(r))}})
const emit=(type,data)=>{const e={seq:++session.seq,time:++now,type,data};session.events.push(e);handlers.get('session/event')(session,e)}
try{
 emit('turn/start',{turn:1});emit('user/message',{content:[{type:'text',text:'Implement a web app'}]});const tasks=[{content:'First',weight:20,status:'in_progress'},{content:'Second',weight:80,status:'pending'}]
 emit('todo/write',{todos:tasks});emit('tool/call',{callId:'work',name:'write',arguments:{path:'first.js'}});emit('todo/write',{todos:[{...tasks[0],status:'completed'},{...tasks[1],status:'in_progress'}]});emit('tool/result',{message:{toolCallId:'work',content:[]}})
 let view=tracker.snapshot('lead'),k=localItemKeys(view.plan.items);assert.ok(view.localEvidence.items[k[0]].units[1]>0);assert.equal(view.localEvidence.items[k[1]].units[1],0)
 emit('tool/call',{callId:'work2',name:'write',arguments:{path:'second.js'}});emit('tool/result',{message:{toolCallId:'work2',content:[]}});view=tracker.snapshot('lead');assert.ok(localProgress(view,off).percent>.2);assert.ok(localProgress(view,off).percent<1)
 const weights=view.localEvidence.weights.slice();tracker.snapshot('lead');assert.deepEqual(tracker.snapshot('lead').localEvidence.weights,weights,'snapshot reads do not refit weights')
 emit('turn/end',{reason:{kind:'completed'}});assert.equal(localProgress(tracker.snapshot('lead'),off).percent,1);assert.ok(calls.length>=1)
}finally{tracker.dispose();Date.now=realNow}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-local-alpha1-')),file=path.join(dir,'learning.json');let store=createLearningStore(file)
try{for(let i=0;i<8;i++)store.observeLocal('work',String(i),[2,6,2,1]);const p=store.localPrior('work',[4,16,5,2]);assert.equal(p.samples,8);near(p.units[1],11);store.observeLocal('work','0',[100,100,100,100]);assert.equal(store.localPrior('work',[4,16,5,2]).samples,8);store.dispose();store=createLearningStore(file);assert.deepEqual(store.localPrior('work',[4,16,5,2]),p)}finally{store.dispose();fs.rmSync(dir,{recursive:true,force:true})}
console.log('local estimator alpha1 passed: no-AI determinate, weighted44%, independent items, dispatch ownership, duplicates/services, rework, bridge residual, workers, truncated plans, persistence, bounded learning')
