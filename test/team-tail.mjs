import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {localProgress} from '../lib/local-progress.js'
import {createAiProgress} from '../lib/ai-progress.js'
import {planKey,planCoverage} from '../lib/weighted-progress.js'
const now=Date.now(),items=[{id:'task-1',content:'Atmosphere plates',owner:'atmos',status:'completed'},{id:'task-2',content:'Sprite sheets',owner:'sprites',status:'completed'}]
let view={turn:1,running:true,turnStatus:'running',evidenceRevision:0,steps:64,plan:{items,total:2,done:2},ownPlan:{items:[],total:0,done:0},commands:[{active:true,name:'bash',label:'Rebuild and verify ring and gate',phase:'verify'}],children:[{id:'a',label:'atmos',status:'completed'},{id:'b',label:'sprites',status:'completed'}],model:{turn:1,at:now,percent:.75,confidence:2,evidenceRevision:0,weights:[.5,.5],fractions:[1,1],planKey:planKey(items)}}
let display=localProgress(view,{aiEnabled:true,aiScope:'all',now})
assert.equal(display.percentKnown,true,'completed worker tasks must not hide the running lead estimate')
assert.equal(display.percent,.75);assert.equal(display.source,'model');assert.equal(display.planComplete,true)
view.model={...view.model,percent:.88};display=localProgress(view,{aiEnabled:true,aiScope:'all',now});assert.equal(display.percent,.88,'lead estimates continue to update after both workers complete')
assert.equal(localProgress(view,{aiEnabled:false,now}).percentKnown,true,'local mode provides a distinct approximate request estimate')
assert.equal(localProgress({...view,evidenceRevision:1},{aiEnabled:true,aiScope:'all',now}).percentKnown,true,'stale AI is replaced by a local estimate during rework')
assert.equal(localProgress({...view,model:{...view.model,confidence:0}},{aiEnabled:true,aiScope:'all',now}).percentKnown,true)
assert.equal(planCoverage(items,view.children),'delegated');assert.equal(planCoverage([...items,{owner:'lead'}],view.children),'checklist')
const partial={...view,plan:{items:[items[0],{...items[1],status:'in_progress'}],done:1,total:2,coverage:'delegated'},model:{...view.model,percent:.65,fractions:[1,.1]}};assert.equal(localProgress(partial,{aiEnabled:true,aiScope:'all',now}).percent,.65,'a delegated-only board uses overall scope before and after workers finish');assert.equal(localProgress(partial,{aiEnabled:false,now}).percentKnown,true,'local evidence estimates the remaining lead scope for a partial board')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-tail-'));let calls=0,observations=[]
const probe={available:true,lastAttempt:{calls:1},async ask(){calls++;return{percent:calls===1?.75:.88,confidence:2,phase:'verify',weights:[1,1],fractions:[1,1]}}}
const ai=createAiProgress({probe,snapshot:()=>view,setModel:(_,model)=>{view={...view,model}},recordObservation:(_,x)=>observations.push(x.record),file:path.join(dir,'p.json'),now:()=>now})
try{
 ai.configure({aiEnabled:true,cadence:'step'});ai.observe('lead')
 for(let step=64;step<=65;step++){ai.completedStep('lead',view,{seq:step,step,at:now});await ai.tick()}
 assert.equal(calls,2,'reuse the existing per-step calls, without extra tail probes');assert.deepEqual(observations.map(r=>r.percent),[.75,.88],'chart and headline use the same overall estimate after checklist completion')
 assert.equal(localProgress(view,{aiEnabled:true,aiScope:'all',now}).percent,.88)
 const thinking=localProgress({...view,commands:[],lastTool:{name:'edit',label:'main.js',finishedAt:now-60000},model:{...view.model,phase:'implement'}},{aiEnabled:true,aiScope:'all',now})
 assert.equal(thinking.detailPhase,'writing','a complete teammate board does not force the lead into final checks')
 assert.equal(localProgress({...view,running:false,turnStatus:'completed'},{aiEnabled:true,aiScope:'all',now}).percent,1)
 console.log('team tail passed: completed workers, active lead estimate, chart consistency, no extra calls, stale/low-confidence/off, actual completion')
}finally{ai.dispose();fs.rmSync(dir,{recursive:true,force:true})}
