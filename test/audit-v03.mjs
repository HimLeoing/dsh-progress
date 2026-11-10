import assert from 'node:assert/strict'
import { createModelProbe } from '../lib/model-probe.js'
import { createTracker } from '../lib/tracker.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const results=[]
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name)}catch(error){results.push({name,ok:false,error:error.message});console.log('FAIL',name,':',error.message)}}
await check('A stream error must never become an accepted forecast',async()=>{
 const llm = {
   async *stream() {
     yield {type:'text-delta',text:'{"p":80,"eta":10}'}
     yield {type:'finish',reason:{kind:'error',failure:{code:'NETWORK',message:'transport failed'}}}
   },
 }
 const p = createModelProbe({get(key) {
   if(key==='agentDefaultModel') return {currentSelection:()=>({provider:'p',model:'m'})}
   if(key==='llm') return llm
 }})
 assert.equal(await p.ask('x'),null)
})
await check('Replaying saved turns must not learn the same durations twice',()=>{
 const at=1800000000000,events=[{seq:0,type:'turn/start',time:at,data:{turn:1}},{seq:1,type:'turn/end',time:at+10000,data:{reason:{kind:'completed'}}}]
 const records=new Map([['s',{turn:1,status:'completed',percent:1,turnEtaMs:171000,turnEtaSamples:1,itemEtaMs:90000,itemEtaSamples:0}]])
 const s={id:'s',seq:2,header:{cwd:'/test'},snapshotEvents:()=>events}
 const t=createTracker({on:()=>()=>{},get:k=>k==='sessions'?{list:()=>[s]}:undefined},{persistence:{load:id=>records.get(id),save:(id,r)=>records.set(id,r)}})
 t.snapshot('s');t.dispose();assert.equal(records.get('s').turnEtaSamples,1)
})
await check('Progress HTTP must not wait for the npm version registry',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-v03-audit-'));const oldHome=process.env.DSH_HOME;process.env.DSH_HOME=home
 const oldFetch=globalThis.fetch;let release
 globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({latest:'1',next:'1'})})})
 const routes=[],clean=[];const {apply}=await import('../index.js')
 const ctx={get:()=>undefined,on:()=>()=>{},effect(fn){const d=fn();clean.push(d);return()=>{}},webServer:{register(r){routes.push(r);return()=>{}}}}
 try{
  apply(ctx);let done=false;const route=routes.find(r=>r.path==='/dsh-task-progress/state')
  const pending=route.handler({method:'GET',url:'/dsh-task-progress/state?session=',headers:{host:'127.0.0.1:3080'},socket:{remoteAddress:'127.0.0.1'}},{writeHead(){},end(){done=true}})
  await new Promise(resolve=>setTimeout(resolve,40));const immediate=done
  release?.();await pending
  assert.equal(immediate,true)
 }finally{release?.();for(const d of clean.reverse())if(typeof d==='function')await d();globalThis.fetch=oldFetch;if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;fs.rmSync(home,{recursive:true,force:true})}
})
fs.mkdirSync('artifacts/v03',{recursive:true});fs.writeFileSync('artifacts/v03/audit.json',JSON.stringify(results,null,2)+'\n');if(results.some(r=>!r.ok))process.exitCode=1
