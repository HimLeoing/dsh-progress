import assert from 'node:assert/strict'
import {createProbeScheduler} from '../lib/probe-scheduler.js'
let clock=0,calls=0
const scheduler=createProbeScheduler({now:()=>clock,snapshot:()=>({running:true,turn:1,startedAt:0,projectBar:{},probe:{revision:'constant'}}),probe:{available:true,async ask(){calls++;return{percent:.2+calls%70/100,remainingMs:300000}}},setModel(){},log(){},options:{intervalMs:10000,minGapMs:5000,fastPerHour:6,maxPerHour:120}})
for(clock=0;clock<=2*3600000;clock+=1000)await scheduler.tick('long')
assert.ok(calls>120,'a two-hour task continues to receive probes after its initial budget')
assert.ok(calls<150,'long-running work is observed at a bounded slow cadence')
assert.notEqual(scheduler.statusOf('long').state,'budget')
scheduler.dispose()
let view={running:true,turn:1,startedAt:1,projectBar:{},probe:{revision:'one'}}
clock=0
const stalled=createProbeScheduler({now:()=>clock,snapshot:()=>view,probe:{available:true,async ask(){return{percent:.5,remainingMs:90000}}},setModel(){},log(){}})
for(clock=0;clock<120000;clock+=1000)await stalled.tick('x')
const before=stalled.stateOf('x').lastAt
view={...view,probe:{revision:'plan-changed'}}
clock=Math.max(clock,before+10000)
assert.equal((await stalled.tick('x')).probed,true,'a plan/tool change breaks a stale-answer backoff')
stalled.dispose()
console.log('long-run checks passed:',calls,'probes across two simulated hours')
// External wait is an unknown duration, not a zero-second countdown.
clock=0
let waitingModel
view={running:true,turn:2,startedAt:2,projectBar:{},probe:{revision:'waiting'}}
const externalWait=createProbeScheduler({now:()=>clock,snapshot:()=>view,probe:{available:true,async ask(){return{percent:.4,remainingMs:null,phase:'wait'}}},setModel(id,value){waitingModel=value},log(){}})
await externalWait.tick('wait');clock=10000
assert.equal((await externalWait.tick('wait')).probed,true)
assert.equal(waitingModel.remainingMs,null)
assert.equal(externalWait.stateOf('wait').interval,300000)
view={...view,probe:{revision:'action-arrived'}};clock=20000
assert.equal((await externalWait.tick('wait')).probed,true,'new evidence breaks the wait heartbeat')
externalWait.dispose()
