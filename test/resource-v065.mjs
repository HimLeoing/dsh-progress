import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {createProbeCost} from '../lib/probe-cost.js'
import {createProbeHistory} from '../lib/probe-history.js'
import {createProgressStore} from '../lib/progress-store.js'

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-resource-'))
const root=path.join(directory,'meter'),ledgerFile=path.join(directory,'storages/cost-meter/ledger.json')
const attempt={calls:1,provider:'test',model:'m',usage:{inputTokens:100,cacheReadTokens:50,cacheWriteTokens:20,outputTokens:10,reasoningTokens:2}}
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value))}
let now=100000
try{
 write(path.join(root,'package.json'),{type:'module'})
 fs.mkdirSync(path.join(root,'lib'),{recursive:true})
 fs.writeFileSync(path.join(root,'lib/pricing.js'),`export const providerPriceEntryFor=(p,m,prices,options)=>({priced:true,entry:prices.models[options.overrides?.[p+':'+m]??m],currency:'USD',billingMode:'flat'});export const costOf=(t,e)=>(t.input*e.input+t.cacheRead*e.cache+t.cacheWrite*e.write+t.output*e.output+t.reasoning*e.reasoning)/1e6;export const usdFromCost=v=>v`)
 fs.writeFileSync(path.join(root,'lib/exchange-rates.js'),`export const fxRatesOf=c=>c.fxRates`)
 fs.writeFileSync(path.join(root,'lib/billing-history.js'),`const bindings=new WeakMap();export const state={previous:[],bound:[]};export function normalizePricingHistory(raw,c,previous){state.previous.push(previous);if(raw.failNormalize)throw Error('normalize');return{...raw,prior:previous?.id??null}};export function bindPricingHistory(c,h){if(h.failBind)throw Error('bind');bindings.set(c,h);state.bound.push(c)};export function pricingConfigAt(c,at){const h=bindings.get(c);return h.old&&at<2000?{...c,...h.old}:c}`)
 const rates=multiplier=>({input:2*multiplier,cache:.2*multiplier,write:.3*multiplier,output:8*multiplier,reasoning:3*multiplier})
 const first={config:{prices:{models:{m:rates(1),override:rates(3)}},priceOverrides:{'test:m':'override'},fxRates:{CNY:7}},pricingHistory:{id:'first',old:{prices:{models:{m:rates(.5),override:rates(1.5)}},fxRates:{CNY:6}}}}
 write(ledgerFile,first)
 const api=await import(pathToFileURL(path.join(root,'lib/billing-history.js')).href),quote=createProbeCost({home:directory,packageRoot:root,now:()=>now})
 const current=await quote(attempt,{at:3000});assert.equal(current.priced,true);assert.equal(current.usd,(100*6+50*.6+20*.9+10*24+2*9)/1e6);assert.equal(current.cny,current.usd*7)
 const historical=await quote(attempt,{at:1000});assert.equal(historical.priced,true);assert.equal(historical.usd,current.usd/2);assert.equal(historical.cny,historical.usd*6,'historical FX is preserved')
 const second=structuredClone(first);second.pricingHistory.id='second';second.config.prices.models.override=rates(4);second.config.fxRates.CNY=8
 now+=31000;write(ledgerFile,second);const refreshed=await quote(attempt,{at:3000});assert.equal(refreshed.cny,refreshed.usd*8);assert.equal(api.state.previous.at(-1).id,'first','normalize receives the previous validated history')
 // A decode or bind error must publish neither candidate config nor history,
 // and the same timestamp must permit a fixed file to be retried immediately.
 for(const failure of ['failNormalize','failBind']){
  now+=31000;const bad=structuredClone(second);bad.config.prices.models.override=rates(99);bad.pricingHistory={id:'bad-'+failure,[failure]:true};write(ledgerFile,bad)
  assert.equal((await quote(attempt,{at:3000})).priced,false)
  const prior=api.state.previous.at(-1);assert.equal(prior.id,'second')
  const restored=structuredClone(second);restored.pricingHistory.id='repaired-'+failure;write(ledgerFile,restored)
  const fixed=await quote(attempt,{at:3000});assert.equal(fixed.cny,refreshed.cny,'failed refresh cannot poison the retained config')
  assert.equal(api.state.previous.at(-1),prior,'failed refresh cannot replace the retained normalized history')
  // Return to the shared successful identity for the next failure case.
  now+=31000;write(ledgerFile,second);await quote(attempt,{at:3000})
 }
 now+=31000;fs.writeFileSync(ledgerFile,'{broken');assert.equal((await quote(attempt)).priced,false);write(ledgerFile,second);assert.equal((await quote(attempt,{at:3000})).cny,refreshed.cny,'bad JSON is retried without a 30-second stale-cache window')

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
