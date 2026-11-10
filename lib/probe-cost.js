/** Read-only adapter to the installed cost meter's exact pricing functions. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const fields=['prices','priceMatch','priceOverrides','currency','exchangeRate','fxRates','peakEnabled','peakEffectiveAt','peakWindows','peakHolidays']
export function createProbeCost({home=process.env.DSH_HOME??path.join(os.homedir(),'.dsh'),packageRoot,now=()=>Date.now()}={}) {
 let modules=null,config=null,normalizedHistory=null,checked=0,signature=''
 const load=()=>modules??=(async()=>{
  let root=packageRoot
  if(!root)for(const base of [import.meta.url,pathToFileURL(path.join(home,'profiles',process.env.DSH_PROFILE??'web','package.json')).href])try{root=path.dirname(createRequire(base).resolve('dsh-cost-meter/package.json'));break}catch{}
  if(!root)return null
  try{const [pricing,history,fx]=await Promise.all(['pricing.js','billing-history.js','exchange-rates.js'].map(file=>import(pathToFileURL(path.join(root,'lib',file)).href)));return{...pricing,...history,...fx}}catch{return null}
 })()
 return async(attempt,{at=attempt?.startedAt??now(),sid=''}={})=>{
  if(attempt?.calls===0)return{cny:0,usd:0,priced:true,basis:'no-request'}
  if(!attempt?.usage)return{priced:false,reason:'usage-unavailable'}
  const api=await load();if(!api)return{priced:false,reason:'cost-meter-unavailable'}
  try{
   if(!config||now()-checked>30000){
    const file=path.join(home,'storages','cost-meter','ledger.json'),stat=fs.statSync(file),key=`${stat.mtimeMs}:${stat.size}`
    if(stat.size>33554432)return{priced:false,reason:'pricing-unavailable'}
    if(key!==signature||!config){
     const raw=JSON.parse(fs.readFileSync(file,'utf8')),nextConfig=Object.fromEntries(fields.filter(key=>raw.config?.[key]!==undefined).map(key=>[key,raw.config[key]]))
     // Reuse validated immutable price versions, but always read the new
     // timeline/overrides/FX. Failed refreshes must not publish half a snapshot.
     const nextHistory=api.normalizePricingHistory(raw.pricingHistory,nextConfig,normalizedHistory??undefined,true)
     api.bindPricingHistory(nextConfig,nextHistory)
     config=nextConfig;normalizedHistory=nextHistory;signature=key
    }
    checked=now()
   }
   const pricing=api.pricingConfigAt(config,at,sid,`${attempt.provider}:${attempt.model}`)
   const resolved=api.providerPriceEntryFor(attempt.provider,attempt.model,pricing.prices,{mode:pricing.priceMatch==='exact'?'exact':'auto',overrides:pricing.priceOverrides})
   if(!resolved.priced)return{priced:false,reason:'model-unpriced'}
   const peak={enabled:pricing.peakEnabled===true&&['deepseek-peak','utc-peak'].includes(resolved.billingMode),effectiveAtMs:Date.parse(pricing.peakEffectiveAt??''),windows:pricing.peakWindows,holidays:pricing.peakHolidays}
   const buckets=Object.fromEntries([['input','inputTokens'],['output','outputTokens'],['cacheRead','cacheReadTokens'],['cacheWrite','cacheWriteTokens'],['reasoning','reasoningTokens']].map(([target,key])=>[target,attempt.usage[key]??0]))
   const rate=api.fxRatesOf(pricing).CNY,usd=api.usdFromCost(api.costOf(buckets,resolved.entry,at,peak),resolved.currency,rate)
   return{cny:usd*rate,usd,priced:true,basis:'dsh-cost-meter',at}
  }catch{return{priced:false,reason:'pricing-unavailable'}}
 }
}
