import assert from 'node:assert/strict'
import {mkdtemp, rm, stat, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createProbeDebugLog} from '../lib/probe-debug-log.js'
import {createModelProbe} from '../lib/model-probe.js'
const dir=await mkdtemp(join(tmpdir(),'dtp-debug-')), file=join(dir,'private','probes.jsonl')
let enabled=false, efforts=[{id:'minimal'},{id:'low'},{id:'high'}], mode='ok'
const requests=[]
const debugLog=createProbeDebugLog(file,{enabled:()=>enabled})
const ctx={get(key){if(key==='agentDefaultModel')return{currentSelection:()=>({provider:'p',model:JSON.stringify(efforts)})};if(key==='llm')return{
 resolveModelInfo:async()=>({reasoning:{efforts}}), async *stream(request){requests.push(request)
 if(mode==='error')throw new Error('fixture adapter failure')
 if(mode==='slow'){await new Promise(r=>setTimeout(r,35));yield {type:'text-delta',text:'late'};return}
 yield {type:'reasoning-delta',text:'full intermediate output'}
 yield {type:'text-delta',text:' '.repeat(5000)}
 yield {type:'text-delta',text:'{"p":42,"s":"implement","c":2}'}
 yield {type:'usage',usage:{inputTokens:120,cacheReadTokens:80,outputTokens:24}}
 yield {type:'finish',reason:{kind:'stop'}}
 }}}}
try {
 const probe=createModelProbe(ctx,{reasoningEffort:'off',percentOnly:true,debugLog})
 await probe.ask('private fixture',undefined,{sessionId:'main',turn:1})
 assert.equal(requests.at(-1).reasoningEffort,'minimal','host effort order defines minimum; do not assume low')
 assert.equal((await debugLog.read()).records.length,0,'default mode never captures input/output')
 await assert.rejects(stat(file),{code:'ENOENT'})
 enabled=true
 // Short stream separately tests a valid parsed result; long output intentionally
 // exceeds the parser buffer but must remain complete in developer diagnostics.
 await probe.ask('private fixture',undefined,{sessionId:'child',turn:2,rootSessionId:'main',rootTurn:3,step:8})
 let log=await debugLog.read({rootSessionId:'main',rootTurn:3})
 assert.equal(log.records.length,1)
 let row=log.records[0]
 assert.equal(row.sessionId,'child');assert.equal(row.turn,2);assert.equal(row.step,8)
 assert.equal(row.input.messages[0].content[0].text,'private fixture')
 assert.equal(row.input.reasoningEffort,'minimal');assert.equal('signal' in row.input,false)
 assert.equal(row.output.chunks[1].text.length,5000,'diagnostics do not reuse the bounded JSON parser buffer')
 assert.equal(row.output.chunks[0].text,'full intermediate output')
 assert.deepEqual(row.usage,{inputTokens:120,outputTokens:24,cacheReadTokens:80})
 assert.equal(row.outputTruncated,false);assert.ok(row.finishedAt>=row.startedAt)
 assert.equal((await stat(file)).mode&0o777,0o600)
 assert.equal((await debugLog.read({sessionIds:['unrelated']})).records.length,0)
 mode='error';await probe.ask('failure',undefined,{sessionId:'main',turn:3})
 row=(await debugLog.read({sessionIds:['main']})).records.at(-1)
 assert.equal(row.status,'error');assert.match(row.error,/fixture adapter failure/)
 mode='slow';const timed=createModelProbe(ctx,{timeoutMs:5,reasoningEffort:'off',debugLog,percentOnly:true})
 await timed.ask('timeout',undefined,{sessionId:'main',turn:3})
 row=(await debugLog.read({sessionIds:['main']})).records.at(-1)
 assert.equal(row.status,'error');assert.equal(row.error,'aborted')
 await new Promise(r=>setTimeout(r,45));assert.equal((await debugLog.read()).records.length,3,'late provider cannot finish the same debug call twice')
 mode='ok';efforts=[{id:'high'},{id:'none'}]
 await probe.ask('none',undefined,{sessionId:'main',turn:3});assert.equal(requests.at(-1).reasoningEffort,'none')
 efforts=[];await probe.ask('plain',undefined,{sessionId:'main',turn:3});assert.equal('reasoningEffort' in requests.at(-1),false,'nonreasoning adapter gets no invented effort')
 await debugLog.clear();assert.equal((await debugLog.read()).records.length,0)
 // Fixed retention, explicit truncation, pending-call removal, and queue flush.
 const small=createProbeDebugLog(join(dir,'bounded.jsonl'),{enabled:()=>true,maxBytes:4096,payloadBytes:1024})
 for(let i=0;i<20;i++){const entry=small.begin({sessionId:'s',turn:i},{messages:['x'.repeat(5000)]});entry.chunk({type:'text-delta',text:'y'.repeat(5000)});entry.finish()}
 await small.flush();log=await small.read({limit:1000})
 assert.ok(log.records.length<20);assert.ok(log.records.length>0)
 assert.equal(log.records.at(-1).inputTruncated,true);assert.equal(log.records.at(-1).outputTruncated,true)
 for(const path of [join(dir,'bounded.jsonl'),join(dir,'bounded.jsonl.1')])assert.ok((await stat(path)).size<=4096)
 const entry=small.begin({sessionId:'s',turn:99},{messages:['will clear']});await small.clear();entry.chunk({text:'late'});entry.finish()
 assert.equal((await small.read()).records.length,0,'clear invalidates an in-flight capture')
 console.log('Alpha3 probe diagnostics passed: actual input/output, minimum effort, privacy, cancellation, retention')
}finally{await rm(dir,{recursive:true,force:true})}
