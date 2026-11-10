import assert from'node:assert/strict'
import {createCadencePolicy}from'../lib/probe-policy.js'
let at=1800000000000,n=0,view={turn:1,running:true,evidenceRevision:0,operations:{completed:0,failed:0},plan:{items:[],total:0,done:0},children:[],probe:{recentOperations:[]}}
const p=createCadencePolicy({now:()=>at})
const event=(change={},owner)=>{at+=1000;n++;view={...view,...change};p.update('s',view,{seq:n,step:n,at,owner});return p.decide('s',view)}
const accept=(d,percent=.3,confidence=2)=>{assert.equal(d.due,true);p.dispatched('s',d.ticket);p.settled('s',d.ticket,{accepted:true,percent,phase:'implement',confidence})}
try{
 accept(event());assert.equal(event().due,false);accept(event());assert.equal(event().due,false);accept(event());assert.equal(event().due,false);assert.equal(event().due,false);assert.equal(event().due,false);accept(event());
 let d=event({evidenceRevision:1,operations:{completed:1,failed:1}});assert.equal(d.reason,'rework');p.dispatched('s',d.ticket);assert.equal(event().critical.includes('rework'),false,'in-flight coverage avoids a duplicate failure request');p.settled('s',d.ticket,{accepted:false});assert.equal(p.decide('s',view).reason,'rework','a failed/obsolete answer never clears critical evidence');accept(p.decide('s',view),.2)
 d=event({plan:{items:[{id:'a',content:'Build',status:'in_progress'}],total:1,done:0}});assert.equal(d.reason,'plan-change');accept(d)
 d=event({plan:{items:[{id:'a',content:'Build',status:'completed'}],total:1,done:1}});assert.equal(d.reason,'plan-finished');accept(d)
 view={...view,plan:{items:[],total:0,done:0}};accept(event({observedPhase:'implement'}))
 const op=(name,label,phase)=>({name,label,phase,status:'completed',finishedAt:at+1000})
 d=event({probe:{recentOperations:[op('write','src/main.js','implement')]}});if(d.due)accept(d)
 d=event({probe:{recentOperations:[op('read_image','front.png','discover')]}});assert.ok(d.critical.includes('visual-check'));accept(d)
 d=event({probe:{recentOperations:[op('read_image','side.png','discover')]}});assert.ok(d.critical.includes('visual-check'));accept(d)
 d=event({probe:{recentOperations:[op('read_image','top.png','discover')]}});assert.equal(d.due,false,'later images of the same batch can merge')
 at+=60000;d=event();assert.equal(d.due,true);accept(d);at+=60000;d=event();assert.equal(d.reason,'event-age','a long intervening step is assessed at its next boundary');accept(d)
 d=event({children:[{id:'c',status:'running',percent:0,percentKnown:false}]},'c');assert.equal(d.reason,'workers-change');accept(d)
 for(let i=0;i<3;i++)assert.equal(event({},'c').due,false,'ordinary child steps do not force duplicate parent calls')
 d=event({children:[{id:'c',status:'completed',percent:1,percentKnown:true}]},'c');assert.equal(d.reason,'workers-change');accept(d)
 console.log('cadence policy passed: initial, 2/4 bounds, sticky critical debt, in-flight coverage, plan weights, verification bursts, child merges, long-step boundary')
}finally{p.dispose()}
