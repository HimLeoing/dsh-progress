import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createProbeCost,BUILTIN_PRICING} from '../lib/probe-cost.js'
import {createPricingHistory,advancePricingHistory,encodePricingHistory} from '../lib/probe-meter-billing-history.js'
import {createAiProgress} from '../lib/ai-progress.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-standalone-cost-'))
const peak=Date.parse('2026-11-11T02:00:00Z'),off=Date.parse('2026-11-11T04:00:00Z'),weekend=Date.parse('2026-11-14T02:00:00Z'),holiday=Date.parse('2026-10-01T02:00:00Z')
let now=peak
const attempt=(usage={inputTokens:100,cacheReadTokens:900,outputTokens:10},model='deepseek-v4.1-flash',provider='deepseek')=>({calls:1,provider,model,usage,startedAt:peak})
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-11,`${message}: ${actual} vs ${expected}`)
try{
 const quote=createProbeCost({home,now:()=>now})
 assert.equal(fs.existsSync(path.join(home,'storages/cost-meter/ledger.json')),false)
 const p=await quote(attempt(),{at:peak});assert.equal(p.priced,true);assert.equal(p.basis,'builtin-pricing');close(p.cny,(100*2+900*.04+10*8)/1e6,'exclusive uncached and cached buckets')
 for(const at of [off,weekend,holiday])close((await quote(attempt(),{at})).cny,p.cny/2,'off-peak/weekend/Chinese holiday')
 for(const id of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp','deepseek-v4.1-flash'])close((await quote(attempt(undefined,id),{at:peak})).cny,p.cny,'official Flash billing aliases')
 for(const provider of ['llm-deepseek','deepseek-official','deepseek-account'])close((await quote(attempt(undefined,undefined,provider),{at:peak})).cny,p.cny,'host provider aliases')
 close((await quote(attempt({inputTokens:0,cacheReadTokens:1e6,outputTokens:0}),{at:peak})).cny,.04,'cached input is billed at the cache hit price')
 close((await quote(attempt({inputTokens:0,outputTokens:1e6,reasoningTokens:1e6}),{at:peak})).cny,8,'reasoning is not double billed when included in output')
 close((await quote(attempt({inputTokens:1e6,outputTokens:0},'deepseek-v4-pro'),{at:peak})).cny,9,'Pro has its independent official price')
 assert.equal((await quote(attempt(undefined,'not-a-real-model'),{at:peak})).priced,false,'unknown model does not get a default zero or Flash price')
 assert.equal((await quote(attempt(undefined,undefined,'unknown-marked-up-proxy'),{at:peak})).priced,false,'unknown gateway cannot inherit direct API rates')
 for(const usage of [null,{}, {inputTokens:-1}, {inputTokens:NaN}])assert.equal((await quote(attempt(usage),{at:peak})).priced,false,'invalid or absent usage stays unknown')
 assert.equal((await quote({calls:0})).cny,0)
 assert.equal(BUILTIN_PRICING.checkedAt,'2026-11-11')

 // A pricing file works on a clean machine and is not executable plugin code.
 const own=path.join(home,'dsh-progress');fs.mkdirSync(own,{recursive:true})
 const config={currency:'CNY',priceMatch:'exact',prices:{currency:'USD',default:{unpriced:true},providers:{custom:{models:{m:{input:2,cachedInput:.2,cacheWrite:.5,output:8,billingMode:'flat',longContext:{aboveInputTokens:250000,cacheMiss:4,cacheHit:.4,cacheWrite:1,output:12}}}}}},fxRates:{CNY:8,EUR:.9},peakEnabled:false}
 fs.writeFileSync(path.join(own,'pricing.json'),JSON.stringify(config));now+=30001
 const custom=attempt({inputTokens:100000,cacheReadTokens:180000,cacheWriteTokens:1000,outputTokens:100},'m','custom')
 const long=await quote(custom,{at:peak});assert.equal(long.basis,'local-pricing');close(long.usd,(100000*4+180000*.4+1000+100*12)/1e6,'long-context threshold includes all input buckets');close(long.cny,long.usd*8,'configured FX')

 // Immutable price versions choose the call time, not the current catalog.
 const before={...config,prices:{currency:'CNY',providers:{custom:{models:{m:{input:1,output:4,billingMode:'deepseek-peak'}}}}}},after={...before,prices:{currency:'CNY',providers:{custom:{models:{m:{input:2,output:8,billingMode:'deepseek-peak'}}}}}}
 const history=createPricingHistory(before);advancePricingHistory(history,after,peak)
 fs.writeFileSync(path.join(own,'pricing.json'),JSON.stringify({config:after,pricingHistory:encodePricingHistory(history)}));now+=30001
 const historical=attempt({inputTokens:1e6,outputTokens:0},'m','custom')
 close((await quote(historical,{at:peak-1})).cny,1,'call immediately before price change');close((await quote(historical,{at:peak})).cny,2,'half-open historical price boundary')

 // Optional meter config works without any installed meter package; own file wins.
 const ledgerDir=path.join(home,'storages/cost-meter');fs.mkdirSync(ledgerDir,{recursive:true});fs.writeFileSync(path.join(ledgerDir,'ledger.json'),JSON.stringify({config:before}))
 now+=30001;close((await quote(historical,{at:peak})).cny,2,'own pricing wins over optional ledger')
 fs.rmSync(path.join(own,'pricing.json'));now+=30001
 const inherited=await quote(historical,{at:peak});assert.equal(inherited.basis,'cost-meter-config');close(inherited.cny,1,'optional legacy config remains usable')
 fs.rmSync(path.join(ledgerDir,'ledger.json'));now+=30001
 assert.equal((await quote(attempt(),{at:peak})).basis,'builtin-pricing','removed optional config returns to standalone defaults')

 // Real quote function composes with existing exact-once main + child accounting.
 const views={root:{sessionId:'root',turn:1,running:true,evidenceRevision:0,plan:{items:[],total:0},children:[{id:'child',label:'Worker',status:'running'}],probe:{goal:'Whole task'}},child:{sessionId:'child',turn:1,running:true,evidenceRevision:0,plan:{items:[],total:0},children:[],probe:{goal:'Worker task'}}}
 const probe={available:true,lastAttempt:null,async ask(){this.lastAttempt=attempt();return{percent:.4,confidence:2,phase:'implement'}}}
 const ai=createAiProgress({probe,snapshot:id=>views[id]??{},setModel(){},quote,now:()=>peak,file:path.join(home,'settings.json')})
 try{
  ai.configure({aiEnabled:true,cadence:'step'});ai.observe('root')
  ai.completedStep('child',views.child,{seq:1,step:1,at:peak});ai.completedStep('root',views.root,{seq:1,step:1,at:peak,owner:'child'});await ai.tick();await ai.tick()
  const root=ai.status('root');assert.equal(root.turnUsage.requests,2);assert.equal(root.turnUsage.unpricedRequests,0);close(root.turnUsage.costCny,p.cny*2,'root includes one own and one child quote exactly once');close(root.workerUsage.child.costCny,p.cny,'independent worker subtotal')
 }finally{ai.dispose()}
 console.log('built-in probe cost passed: clean install, exclusive cache buckets, provider/model aliases, direct CNY, peak boundaries/weekends/holidays, Pro, unknown rates, FX, long context, immutable history, read-only overrides, standalone fallback, exact-once main + child totals')
}finally{fs.rmSync(home,{recursive:true,force:true})}
