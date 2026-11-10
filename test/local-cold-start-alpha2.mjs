/** Cold-start estimates require neither saved work nor a learning/model service. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createLocalEvidence,estimateLocalProgress,estimateLocalScope,recordLocalOperation,syncLocalPlan,localItemKeys} from '../lib/local-estimator.js'
import {createLearningStore} from '../lib/learning-store.js'

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`)
const view=e=>({turn:1,running:true,turnStatus:'running',localEvidence:e,plan:{items:[],total:0,done:0},children:[],steps:0,operations:{completed:0,failed:0}})
const rows=[]
function check(name,fn){try{fn();rows.push({name,ok:true});console.log(`PASS ${name}`)}catch(error){rows.push({name,ok:false});console.error(`FAIL ${name}: ${error.message}`)}}
const workflows=[
  {text:'Research available evidence',kind:'research',name:'read',phase:'discover',count:60,min:.75},
  {text:'Build a web app',kind:'build',name:'write',phase:'implement',count:64,min:.75},
  {text:'Write a report',kind:'writing',name:'write',phase:'implement',count:36,min:.75},
  {text:'Organize the requested material',kind:'general',name:'bash',phase:'implement',count:50,min:.65},
]
for(const workflow of workflows)check(`${workflow.kind} continues beyond a fixed single-stage budget without history`,()=>{
  const evidence=createLocalEvidence(workflow.text),snapshot=view(evidence),series=[]
  assert.equal(evidence.root.samples,0)
  assert.equal(evidence.root.kind,workflow.kind)
  for(let i=0;i<workflow.count;i++){
    recordLocalOperation(evidence,{name:workflow.name,phase:workflow.phase,label:`distinct-work-${i}`,status:'completed'})
    const display=estimateLocalProgress(snapshot)
    assert.equal(display.percentKnown,true);assert.equal(display.indeterminate,false);assert.equal(display.estimated,true)
    assert.ok(Number.isFinite(display.percent)&&display.percent>0&&display.percent<1)
    if(series.length)assert.ok(display.percent>series.at(-1),'a new distinct successful operation must add evidence')
    series.push(display.percent)
  }
  assert.ok(series.at(-1)>workflow.min,`not trapped at the ${workflow.phase} budget: ${series.at(-1)}`)
  const frozen=series.at(-1)
  near(estimateLocalProgress({...snapshot,updatedAt:Date.now()+86_400_000,projectBar:{elapsedMs:86_400_000}}).percent,frozen)
  recordLocalOperation(evidence,{name:'bash',phase:'verify',label:'Final acceptance',status:'completed'})
  const verified=estimateLocalProgress(snapshot).percent
  assert.ok(verified>=frozen,'a new successful phase cannot reduce prior progress')
  recordLocalOperation(evidence,{name:'bash',phase:'verify',label:'Failed verification',status:'failed'})
  assert.ok(estimateLocalProgress(snapshot).percent<verified,'real failure can correct the estimate downward')
})

check('a running task starts with a conservative number, not an unknown activity bar',()=>{
  const snapshot=view(createLocalEvidence())
  const started=estimateLocalProgress(snapshot),one=estimateLocalProgress({...snapshot,steps:1}),many=estimateLocalProgress({...snapshot,steps:80})
  near(started.percent,.01)
  assert.ok(one.percent>=started.percent&&one.percent<=.08)
  assert.ok(many.percent>one.percent&&many.percent<=.08)
  near(estimateLocalProgress({...snapshot,steps:80,projectBar:{elapsedMs:9e9}}).percent,many.percent)
  assert.equal(many.percentKnown,true);assert.equal(many.indeterminate,false)
})

check('assistant-only evidence progresses without inventing completion or a required tool pipeline',()=>{
  const evidence=createLocalEvidence('Write a report'),snapshot=view(evidence),start=estimateLocalProgress(snapshot).percent
  for(let i=0;i<8;i++)recordLocalOperation(evidence,{name:'assistant/output',phase:'implement',label:'response',fingerprint:`section-${i}`,credit:.2,status:'completed'})
  const after=estimateLocalProgress({...snapshot,steps:8})
  assert.ok(after.percent>start&&after.percent<.3)
  assert.equal(after.percentKnown,true)
})

check('missing, invalid or failed learning cannot disable cold priors',()=>{
  const plain=createLocalEvidence('Research evidence'),seed=plain.root.prior
  for(const learning of [null,{}, {localPrior:()=>null},{localPrior:()=>({samples:100,units:[NaN,0,Infinity,-1]})},{localPrior(){throw Error('unavailable')}}]){
    const evidence=createLocalEvidence('Research evidence',{learning})
    assert.deepEqual(evidence.root.prior,seed)
    recordLocalOperation(evidence,{name:'web_search',phase:'discover',label:'query',status:'completed'})
    const result=estimateLocalProgress(view(evidence));assert.ok(Number.isFinite(result.percent)&&result.percent>0)
  }
})

check('large historical signals remain a small correction to the cold-start prior',()=>{
  const plain=createLocalEvidence('Build an app'),seed=plain.root.prior
  for(const scale of [.001,1000]){
    const evidence=createLocalEvidence('Build an app',{learning:{localPrior:()=>({samples:100000,units:seed.map(n=>n*scale)})}})
    evidence.root.prior.forEach((n,i)=>assert.ok(n>=seed[i]*.925&&n<=seed[i]*1.075,'history correction is bounded to 7.5%'))
  }
})

check('a new empty learning home yields exactly the no-learning prior',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-cold-alpha2-')),file=path.join(dir,'learning.json'),learning=createLearningStore(file)
  try{
    assert.equal(fs.existsSync(file),false)
    const fresh=createLocalEvidence('Research examples',{learning,cwd:'/new-workspace'}),plain=createLocalEvidence('Research examples')
    assert.deepEqual(fresh.root.prior,plain.root.prior);assert.equal(fresh.root.samples,0)
    for(let i=0;i<5;i++)recordLocalOperation(fresh,{name:'web_search',phase:'discover',label:`query-${i}`,status:'completed'})
    const display=estimateLocalProgress(view(fresh));assert.ok(display.percent>0&&display.percent<1);assert.equal(display.percentKnown,true)
  }finally{learning.dispose();fs.rmSync(dir,{recursive:true,force:true})}
})

check('per-item weighting remains exactly twenty plus forty times sixty percent',()=>{
  const items=[{content:'First',weight:20,status:'completed'},{content:'Second',weight:40,status:'in_progress'},{content:'Third',weight:40,status:'pending'}]
  const evidence=createLocalEvidence();syncLocalPlan(evidence,items)
  const second=evidence.items[localItemKeys(items)[1]]
  second.units=second.prior.map(n=>-Math.log(.4)*n/Math.log(10))
  near(estimateLocalScope(second),.6)
  const snapshot={...view(evidence),steps:80,plan:{items,total:3,done:1}}
  near(estimateLocalProgress(snapshot).percent,.44)
  items[1].status='completed';items[2].status='in_progress';syncLocalPlan(evidence,items)
  near(estimateLocalProgress(snapshot).percent,.6)
})

check('polling, waiting and permanent services do not inflate cold estimates',()=>{
  const evidence=createLocalEvidence('Build a web app'),snapshot=view(evidence)
  recordLocalOperation(evidence,{name:'write',phase:'implement',label:'main.js',status:'completed'})
  const before=estimateLocalProgress(snapshot).percent
  for(let i=0;i<300;i++)for(const name of ['job_output','wait_agent','list_agents'])recordLocalOperation(evidence,{name,phase:'implement',label:String(i),status:'completed'})
  recordLocalOperation(evidence,{name:'bash',phase:'implement',label:'server',infinite:true,status:'completed'})
  near(estimateLocalProgress(snapshot).percent,before)
  assert.ok(Object.keys(evidence.root.seen).length<=128)
})

check('long cold runs keep bounded statistics without retaining operation text',()=>{
  const evidence=createLocalEvidence('Research examples')
  for(let i=0;i<10000;i++)recordLocalOperation(evidence,{name:'read',phase:'discover',label:`file-${i}.md`,status:'completed'})
  assert.equal(Object.keys(evidence.root.seen).length,128)
  assert.ok(JSON.stringify(evidence).length<24000)
  assert.doesNotMatch(JSON.stringify(evidence),/file-9999/)
  const display=estimateLocalProgress(view(evidence));assert.ok(display.percent>0&&display.percent<1)
  assert.equal(display.local.method,'evidence-prior-v2')
})

console.log(`Cold start alpha2: ${rows.filter(row=>row.ok).length}/${rows.length} passed`)
if(rows.some(row=>!row.ok))process.exitCode=1
