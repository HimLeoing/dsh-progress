import assert from'node:assert/strict'
import fs from'node:fs';import os from'node:os';import path from'node:path'
import {createAiProgress}from'../lib/ai-progress.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-heartbeats-'))
async function scenario({target='child',switchTo='root',ended=false}={}){
 let release,aborted=false,at=1800000000000,applied=0;const views={root:{turn:1,running:true,plan:{items:[],total:0},children:[{id:'child'}]},child:{turn:1,running:true,plan:{items:[],total:0}},other:{turn:1,running:true,plan:{items:[],total:0}}}
 const probe={available:true,lastAttempt:null,async ask(_,signal){await new Promise(resolve=>{release=resolve;signal.addEventListener('abort',()=>{aborted=true;resolve()},{once:true})});this.lastAttempt={calls:1,usage:aborted?null:{inputTokens:10,cacheReadTokens:5,outputTokens:2}};return aborted?null:{percent:.3,confidence:2}}}
 const ai=createAiProgress({probe,snapshot:id=>views[id],setModel(){applied++},quote:async attempt=>({priced:!!attempt.usage,cny:.001,usd:.0001}),file:path.join(dir,target+switchTo+ended),now:()=>at})
 try{ai.configure({aiEnabled:true});ai.observe('root');ai.completedStep(target,views[target],{seq:1,step:1,at});const pending=ai.tick();await Promise.resolve();if(ended){views[target].running=false;ai.cancel(target,{drain:true})}for(let i=0;i<3;i++){at+=1000;ai.observe(switchTo)}release();const result=await pending;return{result,aborted,applied,stats:ai.status('root').turnUsage}}finally{ai.dispose()}
}
try{
 const child=await scenario();assert.equal(child.aborted,false,'periodic foreground heartbeats must not abort a child belonging to the same root');assert.equal(child.result.ok,true);assert.equal(child.stats.requests,1);assert.equal(child.stats.unpricedRequests,0)
 const own=await scenario({target:'root'});assert.equal(own.result.ok,true)
 const switched=await scenario({switchTo:'other'});assert.equal(switched.aborted,true,'a real switch to another project still cancels the old request');assert.equal(switched.result.reason,'cancelled')
 const ended=await scenario({ended:true});assert.equal(ended.aborted,false,'heartbeats must also preserve final usage collection');assert.equal(ended.result.reason,'cancelled');assert.equal(ended.applied,0);assert.equal(ended.stats.unpricedRequests,0)
 console.log('foreground family passed: repeated root heartbeats, child independence, actual context switches and terminal usage drain')
}finally{fs.rmSync(dir,{recursive:true,force:true})}
