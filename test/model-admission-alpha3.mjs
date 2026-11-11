import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createAiProgress} from '../lib/ai-progress.js'
import {modelContinuity} from '../lib/local-progress.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-admission-'))
let view={sessionId:'root',turn:1,running:true,evidenceRevision:0,steps:1,plan:{items:[],total:0},operations:{completed:0,failed:0},children:[],probe:{goal:'PRIVATE REQUEST MUST NOT BE STORED AS CONTINUITY',recentOperations:[]}}
let release,hold=true,seq=0
const accepted=[]
const probe={available:true,lastAttempt:null,async ask(){if(hold)await new Promise(resolve=>{release=resolve});this.lastAttempt={calls:1,usage:{inputTokens:20,outputTokens:4,cacheReadTokens:8}};return{percent:.18,confidence:1,phase:'implement'}}}
const ai=createAiProgress({probe,snapshot:()=>view,setModel:(id,model)=>accepted.push(model),file:path.join(dir,'prefs.json')})
const step=()=>{view={...view,steps:++seq};ai.completedStep('root',structuredClone(view),{seq,step:seq,at:Date.now()})}
try{
 ai.configure({aiEnabled:true,cadence:'step'});ai.observe('root');step()
 const pending=ai.tick();await Promise.resolve()
 view={...view,evidenceRevision:1,operations:{completed:0,failed:1}}
 release();await pending
 assert.equal(accepted.length,0,'in-flight scope/failure changes still reject stale results')
 assert.equal(ai.status('root').turnUsage.requests,1,'sent stale requests remain billed')
 hold=false;step();const baseline=modelContinuity(view);await ai.tick()
 assert.deepEqual(accepted[0].continuity,baseline,'accepted model carries the exact request-admission baseline')
 assert.doesNotMatch(JSON.stringify(accepted[0].continuity),/PRIVATE REQUEST/,'baseline contains only a goal hash and bounded evidence metadata')
 hold=true;step();const cancelled=ai.tick();await Promise.resolve();ai.configure({aiEnabled:false});release();await cancelled
 assert.equal(accepted.length,1,'switching AI off during a sent request cannot accept its result')
 assert.equal(ai.status('root').turnUsage.requests,3)
 console.log('model-admission-alpha3 passed: request baseline, compact privacy, stale result rejection, cancellation and sent-request billing')
}finally{ai.dispose();fs.rmSync(dir,{recursive:true,force:true})}
