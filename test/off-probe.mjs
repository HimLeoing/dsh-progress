import assert from 'node:assert/strict'
import {createModelProbe}from'../lib/model-probe.js'
const requests=[]
const ctx={get(key){if(key==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:'m'})};if(key==='llm')return{resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'},{id:'low'}]}}),async *stream(request){requests.push(request);yield{type:'text-delta',text:'{"p":40,"eta":null,"s":"implement","c":0}'};yield{type:'usage',usage:{inputTokens:100,outputTokens:20,reasoningTokens:0}};yield{type:'finish',reason:{kind:'stop'}}}}}}
const p=createModelProbe(ctx,{reasoningEffort:'off'});const answer=await p.ask('fixture')
assert.equal(requests[0].reasoningEffort,'off','Off must actually disable reasoning instead of choosing Low')
assert.equal(answer.reasoningEffort,'off');assert.equal(answer.usage.reasoningTokens,0)
console.log('off-probe checks passed: explicit Off is dispatched and reported')
const percentage=createModelProbe(ctx,{reasoningEffort:'off',percentOnly:true})
const percentageAnswer=await percentage.ask('plan')
assert.equal(percentageAnswer.remainingMs,null)
assert.doesNotMatch(requests.at(-1).system,/integer seconds/,'production prompt asks for no ETA')
let unsupportedCalls=0
const unsupported={get(key){if(key==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:'m'})};if(key==='llm')return{resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low'}]}}),async *stream(){unsupportedCalls++}}}}
const closed=createModelProbe(unsupported,{reasoningEffort:'off'});assert.equal(await closed.ask('test'),null);assert.equal(unsupportedCalls,1,'missing Off support uses the lowest advertised thinking tier')
// Multiple snapshots describe one physical call, not additive usage deltas.
const snapshots={get(k){if(k==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:'m'})};if(k==='llm')return{resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'}]}}),async *stream(){yield{type:'usage',usage:{inputTokens:40,cacheReadTokens:20,outputTokens:0}};yield{type:'text-delta',text:'{"p":50,"c":2,"s":"implement"}'};yield{type:'usage',usage:{inputTokens:100,cacheReadTokens:60,outputTokens:10}};yield{type:'finish',reason:{kind:'stop'}}}}}}
const snapshotProbe=createModelProbe(snapshots,{reasoningEffort:'off',percentOnly:true});const snapshotAnswer=await snapshotProbe.ask('fixture');assert.deepEqual(snapshotAnswer.usage,{inputTokens:100,outputTokens:10,cacheReadTokens:60});assert.equal(snapshotProbe.lastAttempt.calls,1)
const {parseProbeAnswer}=await import('../lib/model-probe.js');assert.equal(parseProbeAnswer('{"p":100,"c":2,"s":"deliver"}',{percentOnly:true}).percent,.99,'a probe cannot declare actual task completion')
