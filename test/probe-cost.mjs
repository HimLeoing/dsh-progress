import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createProbeCost} from '../lib/probe-cost.js'
import {createAiProgress} from '../lib/ai-progress.js'
import {createProbeHistory} from '../lib/probe-history.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-cost-'))
fs.mkdirSync(path.join(home,'storages/cost-meter'),{recursive:true})
fs.writeFileSync(path.join(home,'storages/cost-meter/ledger.json'),JSON.stringify({config:{priceMatch:'exact',prices:{currency:'CNY',default:{unpriced:true},providers:{test:{models:{m:{cacheMiss:4,cacheHit:.4,cacheWrite:.8,output:16,reasoning:10,billingMode:'deepseek-peak'}}}}},fxRates:{CNY:7},peakEnabled:true},pricingHistory:{}}))
try{
 const quote=createProbeCost({home}),attempt={calls:1,provider:'test',model:'m',usage:{inputTokens:100,cacheReadTokens:40,cacheWriteTokens:20,outputTokens:10,reasoningTokens:2}}
 const amount=await quote(attempt,{at:1800000000000});assert.equal(amount.priced,true);assert.equal(amount.cny,.000612);assert.equal(amount.usd,amount.cny/7,'reuse the optional pricing configuration FX and currency conversion');assert.equal((await quote({...attempt,usage:null})).priced,false);assert.equal((await quote({...attempt,provider:'unknown'})).priced,false);assert.equal((await quote({calls:0})).cny,0)
 const log=path.join(home,'p.jsonl');fs.writeFileSync(log,[{kind:'probe',sid:'s',turn:1,at:1800000000000,...attempt},{kind:'failure',sid:'s',turn:1,at:1800000000001,...attempt,cost:{priced:true,cny:.01,usd:.01/7}}].map(JSON.stringify).join('\n'))
 const history=createProbeHistory(log,{quote});await history.ready;assert.equal(history('s',1).stats.costCny,.010612,'recover legacy probe-only usage and preserve already frozen costs')
 let view={turn:1,running:true,turnStatus:'running',plan:{items:[],total:0},probeStats:{requests:2,inputTokens:200}},calls=0
 const probe={available:true,lastAttempt:attempt,async ask(){calls++;return calls===1?{percent:.5,confidence:2,phase:'verify'}:null}}
 const ai=createAiProgress({probe,snapshot:()=>view,setModel(){},history,quote,file:path.join(home,'settings.json'),now:()=>1800000001000})
 try{
  assert.equal(ai.status('s').turnUsage.costCny,.010612);assert.equal(ai.status('s').turnUsage.costCny,.010612,'history recovery is applied once')
  ai.configure({aiEnabled:true,cadence:'step'});ai.observe('s');for(let i=1;i<=2;i++){ai.completedStep('s',view,{seq:i,step:i,at:1800000001000});await ai.tick()}
  const stats=ai.status('s').turnUsage;assert.equal(stats.requests,4);assert.ok(Math.abs(stats.costCny-(.010612+2*.000612))<1e-12,'a malformed response still costs tokens when usage is reported');assert.equal(stats.pricedRequests,4)
 }finally{ai.dispose()}
 console.log('probe cost passed: built-in pricing functions with optional meter config, exclusive cache buckets, FX, unknown pricing/usage, no-call zero, historical recovery, frozen cost, failed-response billing, no double counting')
}finally{fs.rmSync(home,{recursive:true,force:true})}
