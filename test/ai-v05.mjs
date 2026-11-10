import assert from'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync}from'node:fs'
import {join}from'node:path'
import {tmpdir}from'node:os'
import {createAiProgress}from'../lib/ai-progress.js'
let at=1800000000000,calls=0,models=[],payloads=[],hold=null
let view={turn:1,startedAt:at,running:true,steps:0,evidenceRevision:0,plan:{items:[],done:0,total:0},operations:{completed:0,failed:0},probe:{goal:'Test',evidence:{changedFiles:['src/a.js'],checks:[]}}}
const directory=mkdtempSync(join(tmpdir(),'dtp-step-')),file=join(directory,'preferences.json')
const probe={available:true,lastAttempt:null,async ask(payload,signal){calls++;payloads.push(payload);this.lastAttempt={calls:1,usage:{inputTokens:100,outputTokens:20}};if(hold)await new Promise(resolve=>{hold.signal=signal;hold.resolve=resolve;signal.addEventListener('abort',resolve,{once:true})});return{percent:.35,phase:'verify',confidence:1,weights:[1,9],fractions:[.5,0],reasoningEffort:'off'}}}
const ai=createAiProgress({probe,snapshot:()=>view,setModel:(_,m)=>models.push(m),now:()=>at,file})
const step=()=>{at+=1000;view={...view,steps:view.steps+1,operations:{...view.operations,completed:view.operations.completed+1}};ai.observe('s');return ai.completedStep('s',structuredClone(view),{seq:view.steps,step:view.steps,at})}
try{
 step();await ai.tick();assert.equal(calls,0,'local default makes no model requests')
 ai.configure({aiEnabled:true,cadence:'step'});step();await ai.tick();assert.equal(calls,1)
 ai.completedStep('s',structuredClone(view),{seq:view.steps,step:view.steps,at});await ai.tick();assert.equal(calls,1,'duplicate step/end is never billed twice')
 at+=300000;ai.observe('s');await ai.tick();assert.equal(calls,1,'elapsed time does not cause observations')
 for(let i=0;i<35;i++){step();await ai.tick()}
 assert.equal(calls,36,'all 35 rapid completed steps are assessed; no hourly or burst quota')
 assert.equal('maxPerHour' in ai.settings,false);assert.equal('requestsThisHour' in ai.status('s'),false)
 assert.match(payloads[0],/src\/a.js/,'completed-work evidence reaches the model')
 assert.equal(models.at(-1).remainingMs,null);assert.equal('message' in models.at(-1),false)
 hold={};step();const first=ai.tick();await Promise.resolve();step();const concurrent=await ai.tick();assert.equal(concurrent.reason,'busy');const before=calls;hold.resolve();await first;hold=null;await ai.tick();assert.equal(calls,before+1,'a subsequent step is queued while the prior estimate is in flight')
 hold={};step();const draining=ai.tick();await Promise.resolve();const modelCount=models.length;ai.configure({aiEnabled:false});assert.equal(hold.signal.aborted,false,'sent requests drain for final usage');assert.equal(ai.status('s').draining,true);hold.resolve();assert.equal((await draining).reason,'settings-changed');assert.equal(models.length,modelCount,'disabled-generation response is only billed');hold=null;const count=calls;step();await ai.tick();assert.equal(calls,count)
 const manual=await ai.request('s',{manual:true});assert.equal(manual.queued,true);step();await ai.tick();assert.equal(calls,count+1,'one manual request runs on the next completed step while automatic AI is off');step();await ai.tick();assert.equal(calls,count+1,'manual means only one observation')
 ai.configure({aiEnabled:true,cadence:'step'});view={...view,plan:{items:[{content:'Small',status:'in_progress'},{content:'Large',status:'pending'}],done:0,total:2}};step();await ai.tick();assert.deepEqual(models.at(-1).weights,[.1,.9]);step();await ai.tick();assert.match(payloads.at(-1),/Locked weights/)
 ai.configure({aiScope:'no-plan'});const old=calls;step();await ai.tick();assert.equal(calls,old)
 assert.ok(ai.status('s').history.length<=32,'diagnostics history is bounded independently of call count')
 console.log('step observer checks passed: every completed step, duplicate suppression, zero-cost off, no hourly cap, sequential queue, evidence, sent-request drain, manual and stable weights')
}finally{ai.dispose();rmSync(directory,{recursive:true,force:true})}
// Old saved hourly limits are deliberately ignored during migration.
const directory2=mkdtempSync(join(tmpdir(),'dtp-migration-')),file2=join(directory2,'p.json')
writeFileSync(file2,JSON.stringify({version:1,aiEnabled:true,aiScope:'all',attempts:Array(20).fill(at),tokens:0,refilledAt:at}))
view={...view,plan:{items:[],total:0},turn:2};const migrated=createAiProgress({probe,snapshot:()=>view,setModel(){},file:file2,now:()=>at})
try{const old=calls;migrated.observe('s');migrated.completedStep('s',structuredClone(view),{seq:1,step:1,at});await migrated.tick();assert.equal(calls,old+1);console.log('saved quota migration checks passed')}finally{migrated.dispose();rmSync(directory2,{recursive:true,force:true})}
