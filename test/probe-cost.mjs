import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createProbeCost} from '../lib/probe-cost.js'
import {createAiProgress} from '../lib/ai-progress.js'
import {createProbeHistory} from '../lib/probe-history.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-cost-')),root=path.join(home,'meter')
fs.mkdirSync(path.join(root,'lib'),{recursive:true});fs.mkdirSync(path.join(home,'storages/cost-meter'),{recursive:true})
fs.writeFileSync(path.join(root,'package.json'),' {"type":"module"}')
fs.writeFileSync(path.join(root,'lib/pricing.js'),`export function providerPriceEntryFor(provider,model,prices){return{priced:provider==='test',entry:prices.default,currency:'CNY',billingMode:'deepseek-peak'}};export function costOf(t,e,at,peak){return(t.input*e.cacheMiss+t.cacheRead*e.cacheHit+t.cacheWrite*e.cacheWrite+t.output*e.output+t.reasoning*e.reasoning)/1e6*(peak.enabled?2:1)};export function usdFromCost(v,c,r){return c==='CNY'?v/r:v}`)
fs.writeFileSync(path.join(root,'lib/billing-history.js'),`export const normalizePricingHistory=h=>h;export const bindPricingHistory=c=>c;export const pricingConfigAt=c=>c`)
fs.writeFileSync(path.join(root,'lib/exchange-rates.js'),`export const fxRatesOf=c=>({CNY:c.fxRates.CNY})`)
fs.writeFileSync(path.join(home,'storages/cost-meter/ledger.json'),JSON.stringify({config:{prices:{default:{cacheMiss:2,cacheHit:.2,cacheWrite:.4,output:8,reasoning:5}},fxRates:{CNY:7},peakEnabled:true},pricingHistory:{}}))
try{
 const quote=createProbeCost({home,packageRoot:root}),attempt={calls:1,provider:'test',model:'m',usage:{inputTokens:100,cacheReadTokens:40,cacheWriteTokens:20,outputTokens:10,reasoningTokens:2}}
 const amount=await quote(attempt,{at:1800000000000});assert.equal(amount.priced,true);assert.equal(amount.cny,.000612);assert.equal(amount.usd,amount.cny/7,'use the meter FX and currency conversion');assert.equal((await quote({...attempt,usage:null})).priced,false);assert.equal((await quote({...attempt,provider:'unknown'})).priced,false);assert.equal((await quote({calls:0})).cny,0)
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
 console.log('probe cost passed: meter functions, exclusive cache buckets, FX, unknown pricing/usage, no-call zero, historical recovery, frozen cost, failed-response billing, no double counting')
}finally{fs.rmSync(home,{recursive:true,force:true})}
