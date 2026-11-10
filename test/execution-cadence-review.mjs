// Independent adversarial review. Mock provider only; no network/DSH actions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createAiProgress} from '../lib/ai-progress.js'
import {createCadencePolicy} from '../lib/probe-policy.js'

const findings=[]
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-cadence-review-'))
try{
 // A new critical event must survive a failed request even when all later
 // boundaries were legitimately merged into the same in-flight coverage.
 {
  let now=1800000000000,calls=0,release,holding=false
  let view={sessionId:'root',turn:1,running:true,evidenceRevision:0,steps:0,plan:{items:[],total:0,done:0},operations:{completed:0,failed:0},children:[],probe:{recentOperations:[]}}
  const models=[]
  const probe={available:true,lastAttempt:null,async ask(){calls++;if(holding)await new Promise(resolve=>{release=resolve});this.lastAttempt={calls:1,usage:{inputTokens:10,outputTokens:2}};return calls===2?null:{percent:.3,phase:'implement',confidence:2}}}
  const ai=createAiProgress({probe,snapshot:()=>view,setModel:(_,m)=>models.push(m),now:()=>now,file:path.join(directory,'critical-retry')})
  const boundary=()=>{now+=100;view={...view,steps:view.steps+1};ai.observe('root');ai.completedStep('root',view,{seq:view.steps,step:view.steps,at:now})}
  try{
   ai.configure({aiEnabled:true,cadence:'balanced'});boundary();await ai.tick()
   view={...view,evidenceRevision:1,operations:{completed:0,failed:1}}
   boundary();holding=true;const attempt=ai.tick();await Promise.resolve()
   boundary();assert.equal(ai.status('root').queuedSteps,0,'ordinary in-flight event is covered by critical flight')
   release();await attempt;holding=false
   const afterFailure=ai.status('root');now+=60000;ai.observe('root')
   const afterBackoff=await ai.tick()
   assert.equal(afterFailure.queuedSteps,1,'a genuinely observed merged boundary retains the unresolved critical obligation')
   assert.equal(afterBackoff.ok,true);assert.equal(calls,3);assert.equal(models.length,2)
   const lost=calls===2&&afterFailure.queuedSteps===0&&afterBackoff.reason==='await-step'
   findings.push({case:'critical-flight-failure',bug:lost,calls,queuedAfterFailure:afterFailure.queuedSteps,retryAt:afterFailure.nextAt,resultAfterBackoff:afterBackoff.reason,acceptedModels:models.length})
  }finally{ai.dispose()}
 }

 // Observe the exact same debt in the pure policy: it correctly remains due.
 // This isolates the lost obligation to ai-progress queue integration.
 {
  let now=1800000000000;const p=createCadencePolicy({now:()=>now})
  const base={turn:1,evidenceRevision:0,operations:{failed:0},plan:{items:[],total:0,done:0},children:[],probe:{recentOperations:[]}}
  p.update('root',base,{seq:1,at:now});let d=p.decide('root',base);p.dispatched('root',d.ticket);p.settled('root',d.ticket,{accepted:true,percent:.3,phase:'implement',confidence:2})
  const failed={...base,evidenceRevision:1,operations:{failed:1}}
  p.update('root',failed,{seq:2,at:++now});d=p.decide('root',failed);p.dispatched('root',d.ticket)
  p.update('root',failed,{seq:3,at:++now});assert.equal(p.decide('root',failed).due,false)
  p.settled('root',d.ticket,{accepted:false});const still=p.decide('root',failed)
  assert.ok(still.critical.includes('rework'));findings.push({case:'pure-policy-debt-control',bug:false,stillDue:still.due,reason:still.reason});p.dispose()
 }

 // Millisecond timestamps are not operation identity. Two distinct completed
 // operations delivered at different boundaries may legally share one stamp.
 {
  let now=1800000000000;const p=createCadencePolicy({now:()=>now})
  let view={turn:1,evidenceRevision:0,operations:{failed:0},plan:{items:[],total:0,done:0},children:[],probe:{recentOperations:[]}}
  p.update('root',view,{seq:1,at:now});let d=p.decide('root',view);p.dispatched('root',d.ticket);p.settled('root',d.ticket,{accepted:true,percent:.3,phase:'implement',confidence:2})
  const finishedAt=++now
  view={...view,probe:{recentOperations:[{name:'write',label:'scene.js',phase:'implement',status:'completed',finishedAt}]}}
  p.update('root',view,{seq:2,at:now});d=p.decide('root',view)
  view={...view,probe:{recentOperations:[...view.probe.recentOperations,{name:'read_image',label:'scene.png',phase:'discover',status:'completed',finishedAt}]}}
  p.update('root',view,{seq:3,at:++now});const visual=p.decide('root',view)
  findings.push({case:'same-ms-new-operation',bug:!visual.critical.includes('visual-check'),reason:visual.reason,critical:visual.critical,expectedCritical:'visual-check'})
  p.dispose()
 }

 // A failed request alone is not an execution boundary. Time/heartbeats must
 // not manufacture additional paid requests when no newer node was observed.
 {
  let now=1800000000000,calls=0
  let view={sessionId:'root',turn:1,running:true,evidenceRevision:0,steps:0,plan:{items:[],total:0,done:0},operations:{completed:0,failed:0},children:[],probe:{recentOperations:[]}}
  const probe={available:true,lastAttempt:null,async ask(){calls++;this.lastAttempt={calls:1,usage:{inputTokens:10,outputTokens:2}};return calls===2?null:{percent:.3,phase:'implement',confidence:2}}}
  const ai=createAiProgress({probe,snapshot:()=>view,setModel(){},now:()=>now,file:path.join(directory,'no-boundary-retry')})
  const boundary=()=>{now+=100;view={...view,steps:view.steps+1};ai.observe('root');ai.completedStep('root',view,{seq:view.steps,step:view.steps,at:now})}
  try{
   ai.configure({aiEnabled:true,cadence:'balanced'});boundary();await ai.tick()
   view={...view,evidenceRevision:1,operations:{completed:0,failed:1}};boundary()
   assert.equal((await ai.tick()).reason,'unavailable');assert.equal(calls,2)
   assert.equal(ai.status('root').queuedSteps,0)
   for(let i=0;i<4;i++){now+=60000;ai.observe('root');assert.equal((await ai.tick()).reason,'await-step')}
   assert.equal(calls,2,'elapsed time cannot create a retry without a newly observed node')
   findings.push({case:'failure-without-new-boundary',bug:false,calls,queuedSteps:ai.status('root').queuedSteps})
  }finally{ai.dispose()}
 }

 // A visual checkpoint arriving during another request remains sticky even
 // after later ordinary nodes replace the queued latest snapshot. The old
 // successful reply covers only its earlier ticket, not the new visual work.
 {
  let now=1800000000000,calls=0,holding=false,release
  let view={sessionId:'root',turn:1,running:true,evidenceRevision:0,steps:0,plan:{items:[],total:0,done:0},operations:{completed:0,failed:0},children:[],probe:{recentOperations:[]}}
  const models=[],logs=[]
  const probe={available:true,lastAttempt:null,async ask(){calls++;if(holding)await new Promise(resolve=>{release=resolve});this.lastAttempt={calls:1,usage:{inputTokens:10,outputTokens:2}};return{percent:.3,phase:'implement',confidence:2}}}
  const ai=createAiProgress({probe,snapshot:()=>view,setModel:(_,m)=>models.push(m),log:row=>logs.push(row),now:()=>now,file:path.join(directory,'visual-debt')})
  const boundary=op=>{now+=100;view={...view,steps:view.steps+1,updatedAt:now,...(op?{lastTool:op,probe:{recentOperations:[...view.probe.recentOperations,op].slice(-6)}}:{})};ai.observe('root');return ai.completedStep('root',view,{seq:view.steps,step:view.steps,at:now})}
  try{
   ai.configure({aiEnabled:true,cadence:'balanced'});boundary();await ai.tick()
   const sameTime=now+100
   boundary({id:'1:write',name:'write',label:'scene.js',phase:'implement',status:'completed',finishedAt:sameTime})
   boundary();holding=true;const old=ai.tick();await Promise.resolve();assert.equal(calls,2)
   boundary({id:'1:image',name:'read_image',label:'scene.png',phase:'discover',status:'completed',finishedAt:sameTime})
   boundary({id:'1:read',name:'read',label:'scene.js',phase:'discover',status:'completed',finishedAt:now+100})
   assert.equal(ai.status('root').queuedSteps,1)
   release();await old;holding=false
   assert.equal(ai.status('root').queuedSteps,1,'the old reply cannot consume the later visual ticket')
   await ai.tick();assert.equal(calls,3);assert.equal(models.length,3)
   const actual=logs.filter(row=>row.kind==='probe').at(-1)
   assert.equal(actual.decisionReason,'visual-check');assert.equal(ai.status('root').queuedSteps,0)
   findings.push({case:'visual-during-flight',bug:false,calls,lastReason:actual.decisionReason})
  }finally{ai.dispose()}
 }

 // A child critical checkpoint affects the parent even when neither the
 // child's numeric percentage nor the parent's revision/roster changes.
 {
  let now=1800000000000,seq=0
  const base=id=>({sessionId:id,turn:1,running:true,evidenceRevision:0,steps:0,plan:{items:[],total:0,done:0},operations:{completed:0,failed:0},children:[],probe:{recentOperations:[]}})
  const views={root:base('root'),child:base('child')};views.root.children=[{id:'child',label:'worker',status:'running',percentKnown:true,percent:.4}]
  const calls=[],logs=[]
  const probe={available:true,lastAttempt:null,async ask(_,__,{sessionId}){calls.push(sessionId);this.lastAttempt={calls:1,usage:{inputTokens:10,outputTokens:2}};return{percent:.4,phase:'implement',confidence:2}}}
  const ai=createAiProgress({probe,snapshot:id=>views[id],setModel:(id,m)=>{views[id].model=m},log:row=>logs.push(row),now:()=>now,file:path.join(directory,'worker-critical-stable-percent')})
  const boundary=(id,op)=>{now+=100;const old=views[id];views[id]={...old,steps:old.steps+1,updatedAt:now,...(op?{lastTool:op,probe:{recentOperations:[...old.probe.recentOperations,op].slice(-6)}}:{})};ai.observe('root');return ai.completedStep(id,views[id],{seq:++seq,step:views[id].steps,at:now})}
  try{
   ai.configure({aiEnabled:true,cadence:'balanced'});boundary('root');await ai.tick();boundary('child');await ai.tick()
   assert.equal(ai.status('root').queuedSteps,0,'an unchanged ordinary first child result may merge')
   const stamp=now+100
   boundary('child',{id:'c:write',name:'write',label:'scene.js',phase:'implement',status:'completed',finishedAt:stamp})
   boundary('child',{id:'c:image',name:'read_image',label:'scene.png',phase:'discover',status:'completed',finishedAt:stamp})
   await ai.tick();assert.equal(ai.status('root').queuedSteps,1,'accepted child visual evidence must queue a root assessment')
   await ai.tick();assert.deepEqual(calls,['root','child','child','root'])
   const rootProbe=logs.filter(row=>row.kind==='probe'&&row.sid==='root').at(-1)
   assert.equal(rootProbe.decisionReason,'worker-critical')
   assert.equal(views.root.evidenceRevision,0);assert.equal(views.root.children[0].percent,.4)
   findings.push({case:'worker-critical-stable-percent',bug:false,calls,rootReason:rootProbe.decisionReason})
  }finally{ai.dispose()}
 }
 console.log(JSON.stringify(findings,null,2))
 const found=findings.filter(row=>row.bug)
 // Keep the independent review as ordinary regression coverage after fixes.
 assert.equal(found.length,0,`${found.length} independently reproduced cadence defect(s)`)
}finally{fs.rmSync(directory,{recursive:true,force:true})}
