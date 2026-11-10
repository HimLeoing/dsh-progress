import assert from 'node:assert/strict'
import {localProgress}from'../lib/local-progress.js'
import {planKey}from'../lib/weighted-progress.js'
const items=[{content:'A',status:'in_progress'},{content:'B',status:'pending'},{content:'C',status:'pending'},{content:'D',status:'pending'},{content:'E',status:'pending'}]
let view={turn:1,running:true,turnStatus:'running',projectBar:{elapsedMs:10000},plan:{items,done:0,total:5},operations:{completed:1},evidenceRevision:0}
let d=localProgress(view)
assert.equal(d.percent,0);assert.equal(d.source,'plan');assert.equal(d.remainingMs,null)
view={...view,model:{turn:1,percent:.99,confidence:2,at:Date.now(),evidenceRevision:0,weights:[10,20,30,20,20],fractions:[1,1,1,1,1],planKey:planKey(items)}}
d=localProgress(view,{aiEnabled:true,aiScope:'all'})
assert.equal(d.source,'weighted');assert.ok(d.percent<.1,'unfinished first item cannot exceed its own 10% contribution; pending tasks contribute zero')
items[0].status='completed';items[1].status='in_progress';view.plan.done=1
d=localProgress(view,{aiEnabled:true,aiScope:'all'});assert.ok(d.percent>=.1&&d.percent<.3)
view.evidenceRevision++
d=localProgress(view,{aiEnabled:true,aiScope:'all'});assert.equal(d.percent,.1,'failure discards stale partial estimates, preserves completed contribution');assert.equal(d.state,'recalculating')
for(const item of items)item.status='completed';view.plan.done=5
d=localProgress(view,{aiEnabled:true,aiScope:'all'});assert.equal(d.state,'recalculating');assert.equal(d.percentKnown,false,'5/5 with a stale estimate stays unknown until new evidence arrives, rather than declaring task completion')
view={...view,plan:{items:[],total:0,done:0},evidenceRevision:0}
for(const eta of [12000,180000,1000,600000]){view.model.remainingMs=eta;d=localProgress(view,{aiEnabled:true});assert.equal(d.remainingMs,null,'old countdown resets never leak into the display')}
d=localProgress(view);assert.equal(d.percentKnown,false);assert.equal(d.source,'activity','switching off ignores any old AI estimate')
view.turnStatus='completed';view.running=false;d=localProgress(view);assert.equal(d.percent,1);assert.equal(d.percentKnown,true)
console.log('local-v05 checks passed: weighted caps, pending items, rework, 5/5, no ETA, local/off')
const {resultStatus}=await import('../lib/progress-evidence.js')
const wrapper={command:'node --test test/ 2>&1 | tail -60; echo "EXIT=${PIPESTATUS[0]}"'}
assert.equal(resultStatus('bash',{message:{isError:false}},'MODULE_NOT_FOUND\nℹ fail 1\nEXIT=1\n',wrapper),'failed','actual pipeline failure is carried by its explicit status marker')
assert.equal(resultStatus('bash',{message:{isError:false}},'ℹ fail 0\nEXIT=0\n',wrapper),'completed')
assert.equal(resultStatus('bash',{message:{isError:false}},'example EXIT=1\n',{command:'cat example.txt'}),'completed','plain text resembling an error is not a failed execution')
