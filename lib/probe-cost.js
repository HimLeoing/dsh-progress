/** Standalone probe-only pricing; optional price files are read, never executed. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {DEFAULT_PRICE_TABLE_CNY,DEFAULT_PROVIDER_PRICE_TABLE,DEFAULT_PEAK_EFFECTIVE_AT,DEFAULT_PEAK_WINDOWS,DEFAULT_PEAK_HOLIDAYS,providerPriceEntryFor,costOf,usdFromCost} from './probe-meter-pricing.js'
import {normalizePricingHistory,bindPricingHistory,pricingConfigAt} from './probe-meter-billing-history.js'
import {fxRatesOf} from './probe-meter-exchange-rates.js'

/** Source and effective date refer to DeepSeek's direct API, not reseller prices. */
export const BUILTIN_PRICING = Object.freeze({
 checkedAt:'2026-11-11',flashEffectiveAt:'2026-09-10T04:00:00Z',
 sourceUrl:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
 sourceUrlUsd:'https://api-docs.deepseek.com/quick_start/pricing/',
 otherCatalogVersion:'dsh-cost-meter@1.9.58',fxReferenceCny:7.2,
})
const fields=['prices','priceMatch','priceOverrides','currency','exchangeRate','fxRates','peakEnabled','peakEffectiveAt','peakWindows','peakHolidays','peakSchedule']
const usageFields=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens']
const defaults=()=>({
 prices:{...structuredClone(DEFAULT_PRICE_TABLE_CNY),currency:'CNY',default:{unpriced:true},providers:structuredClone(DEFAULT_PROVIDER_PRICE_TABLE)},
 priceMatch:'auto',currency:'CNY',fxRates:{CNY:BUILTIN_PRICING.fxReferenceCny,EUR:.92},
 peakEnabled:true,peakEffectiveAt:DEFAULT_PEAK_EFFECTIVE_AT,peakWindows:DEFAULT_PEAK_WINDOWS,peakHolidays:DEFAULT_PEAK_HOLIDAYS,
})

export function createProbeCost({home=process.env.DSH_HOME??path.join(os.homedir(),'.dsh'),now=()=>Date.now()}={}) {
 let current={config:defaults(),basis:'builtin-pricing'},nextCheck=-Infinity,signature=''
 const refresh=()=>{
  if(now()<nextCheck)return true
  // Own price settings win. A missing/unreadable optional meter does not disable costs.
  for(const [file,basis,limit] of [[path.join(home,'dsh-task-progress','pricing.json'),'local-pricing',2097152],[path.join(home,'storages','cost-meter','ledger.json'),'cost-meter-config',33554432]]) {
   try {
    const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)return false
    const key=`${file}:${stat.mtimeMs}:${stat.size}`;if(key===signature){nextCheck=now()+30000;return true}
    const raw=JSON.parse(fs.readFileSync(file,'utf8')),value=raw.config??raw
    if(!value?.prices||typeof value.prices!=='object'||Array.isArray(value.prices))return false
    const config=Object.fromEntries(fields.filter(field=>value[field]!==undefined).map(field=>[field,value[field]]))
    const history=normalizePricingHistory(raw.pricingHistory,config,current.basis===basis?current.history:undefined,true)
    bindPricingHistory(config,history);current={config,basis,history};signature=key;nextCheck=now()+30000;return true
   }catch(error){if(error.code!=='ENOENT')return false}
  }
  if(signature){current={config:defaults(),basis:'builtin-pricing'};signature=''}
  nextCheck=now()+30000;return true
 }
 return async(attempt,{at=attempt?.startedAt??now(),sid=''}={})=>{
  if(attempt?.calls===0)return{cny:0,usd:0,priced:true,basis:'no-request'}
  const usage=attempt?.usage
  if(!usage||typeof usage!=='object'||!usageFields.some(key=>Number.isFinite(usage[key])&&usage[key]>=0)||usageFields.some(key=>usage[key]!==undefined&&(!Number.isFinite(usage[key])||usage[key]<0)))return{priced:false,reason:'usage-unavailable'}
  if(!Number.isFinite(at))return{priced:false,reason:'billing-time-unavailable'}
  try{
   if(!refresh())return{priced:false,reason:'pricing-unavailable'}
   const pricing=pricingConfigAt(current.config,at,sid,`${attempt.provider}:${attempt.model}`)
   const provider=String(attempt.provider??'').trim().toLowerCase().replace(/^llm-/,'')
   // An arbitrary gateway can charge its own markup; a model name alone cannot
   // establish that gateway's bill. Known host aliases retain direct-API pricing.
   if(current.basis==='builtin-pricing'&&!['deepseek','deepseek-official','deepseek-account'].includes(provider)&&!Object.hasOwn(pricing.prices.providers??{},provider))return{priced:false,reason:'provider-unpriced'}
   const resolved=providerPriceEntryFor(attempt.provider,attempt.model,pricing.prices,{mode:pricing.priceMatch==='exact'?'exact':'auto',overrides:pricing.priceOverrides})
   if(!resolved.priced)return{priced:false,reason:'model-unpriced'}
   const peak={enabled:pricing.peakEnabled===true&&['deepseek-peak','utc-peak'].includes(resolved.billingMode),effectiveAtMs:Date.parse(pricing.peakEffectiveAt??''),windows:pricing.peakWindows,holidays:pricing.peakHolidays}
   // DSH reports exclusive uncached input/cache-read/cache-write buckets. Do not
   // subtract cache a second time or add reasoning to output unless separately priced.
   const buckets=Object.fromEntries([['input','inputTokens'],['output','outputTokens'],['cacheRead','cacheReadTokens'],['cacheWrite','cacheWriteTokens'],['reasoning','reasoningTokens']].map(([target,key])=>[target,usage[key]??0]))
   const rate=fxRatesOf(pricing).CNY,usd=usdFromCost(costOf(buckets,resolved.entry,at,peak),resolved.currency,rate)
   if(!Number.isFinite(usd)||usd<0)return{priced:false,reason:'pricing-unavailable'}
   const directDeepSeek=['deepseek','deepseek-official','deepseek-account'].includes(provider)
   return{cny:usd*rate,usd,priced:true,basis:current.basis,priceCurrency:resolved.currency,at,...(current.basis==='builtin-pricing'?{catalogVersion:BUILTIN_PRICING.otherCatalogVersion,checkedAt:directDeepSeek?BUILTIN_PRICING.checkedAt:resolved.entry?.checkedAt??null,sourceUrl:resolved.entry?.sourceUrl??(directDeepSeek?BUILTIN_PRICING.sourceUrl:null),...(resolved.currency==='USD'?{fxReferenceCny:rate}:{})}:{})}
  }catch{return{priced:false,reason:'pricing-unavailable'}}
 }
}
