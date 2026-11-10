import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {createProbeCost} from '../lib/probe-cost.js'
import {createProbeHistory} from '../lib/probe-history.js'
import {createProgressStore} from '../lib/progress-store.js'
import {createPricingHistory,advancePricingHistory,encodePricingHistory} from '../lib/probe-meter-billing-history.js'

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-resource-'))
const ledgerFile=path.join(directory,'storages/cost-meter/ledger.json')
const attempt={calls:1,provider:'test',model:'m',usage:{inputTokens:100,cacheReadTokens:50,cacheWriteTokens:20,outputTokens:10,reasoningTokens:2}}
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value))}
let now=100000
try{
 // Exercise the built-in pricing engine and actual immutable history, rather
 // than executing a generated external plugin as a pricing test double.
 const rates=multiplier=>({cacheMiss:2*multiplier,cacheHit:.2*multiplier,cacheWrite:.3*multiplier,output:8*multiplier,reasoning:3*multiplier,billingMode:'flat'})
 const makeConfig=(multiplier,fx)=>({priceMatch:'exact',prices:{currency:'USD',default:{unpriced:true},providers:{test:{models:{m:rates(1),override:rates(multiplier)}}}},priceOverrides:{'test:m':'override'},fxRates:{CNY:fx,EUR:.92},peakEnabled:false})
 const old=makeConfig(1.5,6),firstConfig=makeConfig(3,7),timeline=createPricingHistory(old)
 advancePricingHistory(timeline,firstConfig,2000)
 const first={config:firstConfig,pricingHistory:encodePricingHistory(timeline)};write(ledgerFile,first)
 const quote=createProbeCost({home:directory,now:()=>now})
 const current=await quote(attempt,{at:3000});assert.equal(current.priced,true);assert.equal(current.usd,(100*6+50*.6+20*.9+10*24+2*9)/1e6);assert.equal(current.cny,current.usd*7)
 const historical=await quote(attempt,{at:1000});assert.equal(historical.priced,true);assert.equal(historical.usd,current.usd/2);assert.equal(historical.cny,historical.usd*6,'historical FX is preserved')
 const secondConfig=makeConfig(4,8);advancePricingHistory(timeline,secondConfig,2500)
 const second={config:secondConfig,pricingHistory:encodePricingHistory(timeline)}
 now+=31000;write(ledgerFile,second);const refreshed=await quote(attempt,{at:3000});assert.equal(refreshed.cny,refreshed.usd*8);assert.ok(refreshed.usd>current.usd,'new immutable version updates the quote')
 // A failed refresh is not a permission to guess a different price. Preserve
 // the last validated snapshot internally, report unknown, retry a fixed file.
 for(const invalid of ['{broken',JSON.stringify({config:{prices:null}})]){
  now+=31000;fs.writeFileSync(ledgerFile,invalid);assert.equal((await quote(attempt,{at:3000})).priced,false)
  write(ledgerFile,second);assert.equal((await quote(attempt,{at:3000})).cny,refreshed.cny,'a fixed price file is retried immediately without a stale-cache window')
 }

 // Repeated activity must keep the family's accumulator resident while cold
 // child sessions are evicted, even after more than 64 distinct sessions.
 const log=path.join(directory,'probe-history.jsonl'),rows=[{kind:'probe',sid:'root',turn:1,calls:1,cost:{priced:true,cny:.1,usd:.01}}]
 for(let i=0;i<90;i++)rows.push({kind:'probe',sid:'child-'+i,turn:1,rootSid:'root',rootTurn:1,calls:1,cost:{priced:true,cny:.01,usd:.001}})
 fs.writeFileSync(log,rows.map(JSON.stringify).join('\n'))
 const history=createProbeHistory(log);assert.equal(history('root',1).stats.requests,91);await history.ready
 const family=history('root',1);assert.equal(family.stats.requests,91);assert.ok(Math.abs(family.stats.costCny-1)<1e-12);assert.equal(Object.keys(family.stats.workerUsage).length,90);assert.equal(history('child-0',1),null,'cold entries stay bounded');assert.equal(history('missing',1),null,'evicted or absent data remains unknown')

 const file=path.join(directory,'progress.json'),sessions=Object.fromEntries(Array.from({length:205},(_,i)=>['s'+i,{updatedAt:i,percent:i/1000}]))
 sessions.invalid=null;write(file,{version:1,sessions});const original=fs.readFileSync(file),store=createProgressStore(file)
 assert.equal(store.get('s4'),null);assert.equal(store.get('s5').percent,.005);assert.equal(store.get('s204').percent,.204);assert.equal(store.get('invalid'),null);store.flush();assert.deepEqual(fs.readFileSync(file),original,'startup trimming does not rewrite the source')
 store.set('new',{updatedAt:999,percent:1});store.flush();assert.equal(Object.keys(JSON.parse(fs.readFileSync(file,'utf8')).sessions).length,200);assert.equal(store.get('s5'),null)
 for(const [name,contents]of [['oversized',' '.repeat(8*1024*1024+1)],['corrupt','{not json']]){
  const target=path.join(directory,name+'.json');fs.writeFileSync(target,contents);const protectedStore=createProgressStore(target)
  assert.equal(protectedStore.get('old'),null);protectedStore.set('live',{updatedAt:1,percent:.4});protectedStore.flush();assert.equal(fs.readFileSync(target,'utf8'),contents,'unreadable source is preserved for recovery');assert.equal(protectedStore.get('live').percent,.4,'live memory remains usable');assert.equal(protectedStore.get('unknown'),null)
 }
 const absent=path.join(directory,'new-store.json'),newStore=createProgressStore(absent);newStore.set('s',{updatedAt:1,percent:1});newStore.flush();assert.equal(JSON.parse(fs.readFileSync(absent,'utf8')).sessions.s.percent,1)

 // Use the installed official pure functions when available. No native
 // service, network, balance refresh or real user ledger is accessed.
 let installed
 try{installed=path.dirname(createRequire(pathToFileURL(path.join(process.env.DSH_HOME??path.join(os.homedir(),'.dsh'),'profiles',process.env.DSH_PROFILE??'web','package.json'))).resolve('dsh-cost-meter/package.json'))}catch{}
 if(installed){
  const [pricing,billing,fx]=await Promise.all(['pricing.js','billing-history.js','exchange-rates.js'].map(name=>import(pathToFileURL(path.join(installed,'lib',name)).href)))
  const base={prices:{currency:'USD',default:{cacheMiss:2,cacheHit:.2,cacheWrite:.3,output:8},models:{'deepseek-flash':{cacheMiss:2,cacheHit:.2,cacheWrite:.3,output:8},alternate:{cacheMiss:5,cacheHit:.5,cacheWrite:.7,output:10}},providers:{}},priceMatch:'exact',priceOverrides:{'deepseek-account:alias':'deepseek:alternate'},currency:'CNY',exchangeRate:7,fxRates:{CNY:7},peakEnabled:false}
  const newer=structuredClone(base);newer.exchangeRate=8;newer.fxRates.CNY=8;newer.prices.models.alternate.cacheMiss=6
  const timeline=billing.createPricingHistory(base,true);billing.advancePricingHistory(timeline,newer,2000)
  write(ledgerFile,{config:newer,pricingHistory:timeline});const official=createProbeCost({home:directory,packageRoot:installed,now:()=>now}),a={...attempt,provider:'deepseek-account',model:'alias'}
  const cold=(raw,at)=>{
   const config=structuredClone(raw.config);billing.bindPricingHistory(config,billing.normalizePricingHistory(structuredClone(raw.pricingHistory),config,undefined,true))
   const c=billing.pricingConfigAt(config,at,'s',a.provider+':'+a.model),r=pricing.providerPriceEntryFor(a.provider,a.model,c.prices,{mode:'exact',overrides:c.priceOverrides}),tokens={input:a.usage.inputTokens,cacheRead:a.usage.cacheReadTokens,cacheWrite:a.usage.cacheWriteTokens,output:a.usage.outputTokens,reasoning:a.usage.reasoningTokens},rate=fx.fxRatesOf(c).CNY,usd=pricing.usdFromCost(pricing.costOf(tokens,r.entry,at,{enabled:false}),r.currency,rate)
   assert.equal(r.priced,true);return{usd,cny:usd*rate}
  }
  const raw={config:newer,pricingHistory:timeline}
  for(const at of [1000,3000]){const got=await official(a,{at,sid:'s'}),expected=cold(raw,at);assert.equal(got.priced,true);assert.equal(got.cny,expected.cny);assert.equal(got.usd,expected.usd)}
  assert.equal((await official(a,{at:1000,sid:'s'})).cny/(await official(a,{at:1000,sid:'s'})).usd,7)
  assert.equal((await official(a,{at:3000,sid:'s'})).cny/(await official(a,{at:3000,sid:'s'})).usd,8)
  // A usage-only write still decodes the new history using prior immutable
  // versions. A genuine timeline/FX change must also remain visible.
  now+=31000;write(ledgerFile,{...raw,days:{'1970-01-01':{calls:1}}});assert.equal((await official(a,{at:1000,sid:'s'})).cny,cold(raw,1000).cny)
  const last=structuredClone(newer);last.exchangeRate=9;last.fxRates.CNY=9;last.prices.models.alternate.cacheMiss=7;billing.advancePricingHistory(timeline,last,4000);const changed={config:last,pricingHistory:timeline};now+=31000;write(ledgerFile,changed)
  for(const at of [1000,3000,5000]){const got=await official(a,{at,sid:'s'}),expected=cold(changed,at);assert.equal(got.cny,expected.cny);assert.equal(got.usd,expected.usd)}
  console.log('official cost-meter parity passed: override, historical/new FX, exclusive cache buckets, usage-only reload and later timeline update')
 }else console.log('official cost-meter parity not run: package is not installed in this DSH profile')
 console.log('resource v065 passed: reusable pricing snapshots, atomic failure recovery, LRU family recovery and bounded safe progress startup')
}finally{fs.rmSync(directory,{recursive:true,force:true})}
