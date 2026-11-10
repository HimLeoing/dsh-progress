import assert from 'node:assert/strict'
import {createTaskEta} from '../lib/task-eta.js'
let clock=0;const eta=createTaskEta({clock:()=>clock}),v={sessionId:'root',turn:1,running:true,evidenceRevision:0,projectBar:{elapsedMs:60000}},d={percent:.25,percentKnown:true,source:'local-estimate'}
let a=eta.display(v,d,{aiEnabled:true});assert.equal(a.remainingMs,180000);assert.equal(a.eta.precision,'second');const id=a.eta.id
clock=1000;a=eta.display({...v,projectBar:{elapsedMs:61000}},d,{aiEnabled:true});assert.equal(a.remainingMs,179000);assert.equal(a.eta.id,id)
clock=11000;a=eta.display({...v,projectBar:{elapsedMs:71000}},d,{aiEnabled:true});assert.equal(a.remainingMs,169000);assert.equal(a.eta.id,id,'same percentage and evidence do not reset the countdown')
const mode=eta.display({...v,cadence:'step'},d,{aiEnabled:false});assert.equal(mode.eta.id,id);assert.equal(mode.eta.precision,'minute','precision changes do not restart an unchanged estimate')
clock=9999999;a=eta.display(v,d,{aiEnabled:true});assert.equal(a.remainingMs,1000);assert.equal(a.eta.overdue,true,'a running countdown cannot reach zero')
a=eta.display({...v,evidenceRevision:1,projectBar:{elapsedMs:90000}},{...d,percent:.1});assert.equal(a.remainingMs,810000);assert.notEqual(a.eta.id,id,'real rework may extend the estimate once')
for(const p of [0,NaN,undefined])assert.equal(eta.display(v,{...d,percent:p}).remainingMs,null)
assert.equal(eta.display({...v,projectBar:{elapsedMs:0}},d).remainingMs,1000)
assert.equal(eta.display({...v,running:false},d).remainingMs,null)
assert.ok(eta.display(v,{...d,percent:1}).remainingMs>=1000)
const worker={...v,sessionId:'worker',turn:2,etaElapsedMs:10000,projectBar:{elapsedMs:3600000}};a=eta.display(worker,{...d,percent:.5});assert.equal(a.remainingMs,10000,'worker ETA uses the current turn, not cumulative resumed work time')
assert.notEqual(eta.display({...worker,turn:3},d).eta.id,a.eta.id)
const ai={...d,source:'model',percent:.5},model={at:100,forStep:1};a=eta.display({...v,model},ai);const first=a.eta.id;clock+=1000;assert.equal(eta.display({...v,model},ai).eta.id,first);assert.notEqual(eta.display({...v,model:{at:200,forStep:2}},ai).eta.id,first,'a fresh AI observation can re-estimate even the same percentage')
eta.clear();console.log('task ETA alpha2 passed: exact formula, stable anchors, monotonic decay, running floor, rework, zero/invalid inputs, modes, workers and turn isolation')
