import assert from'node:assert/strict'
import {localProgress}from'../lib/local-progress.js'
import {planKey}from'../lib/weighted-progress.js'
import {createTracker}from'../lib/tracker.js'
const now=Date.now(),settings={aiEnabled:true,aiScope:'all',now},items=[{content:'A',status:'completed'},{content:'B',status:'in_progress'}]
const model={turn:1,at:now,evidenceRevision:0,percent:.55,confidence:2,weights:[1,9],fractions:[1,.5],planKey:planKey(items)}
const view={turn:1,running:true,turnStatus:'running',evidenceRevision:0,plan:{items,total:2,done:1},lastKnownProgress:{percent:.55,at:now-1000},model}
const unsupported=localProgress({...view,model:{...model,confidence:0,percent:.91,fractions:[1,.9]}},settings)
assert.equal(unsupported.percentKnown,false,'confidence zero cannot validate weighted partial fractions')
assert.equal(unsupported.state,'recalculating');assert.equal(unsupported.percent,.1,'actual completed weighted contribution remains')
assert.deepEqual(unsupported.fractions,[1,0],'unsupported activity fractions are discarded')
assert.equal(unsupported.retainedPercent,.55,'retain the prior valid estimate for presentation')
const handlers=new Map(),records=new Map(),session={id:'lead',seq:0,header:{createdAt:now},snapshotEvents:()=>[]}
const tracker=createTracker({on:(n,f)=>{handlers.set(n,f);return()=>{}},get:k=>k==='sessions'?{list:()=>[session]}:undefined},{localProgress:true,captureTranscript:false,persistence:{load:id=>records.get(id),save:(id,r)=>records.set(id,r)}})
const emit=(type,data)=>handlers.get('session/event')(session,{seq:++session.seq,type,data,time:now})
try{emit('turn/start',{turn:1});emit('todo/write',{todos:items});tracker.setModel('lead',model);assert.equal(tracker.snapshot('lead').lastKnownProgress.percent,.55);tracker.setModel('lead',{...model,confidence:0,percent:.91,fractions:[1,.9]});assert.equal(tracker.snapshot('lead').lastKnownProgress.percent,.55,'an unsupported response cannot replace durable valid progress');assert.equal(records.get('lead').lastKnownProgress.percent,.55)}finally{tracker.dispose()}
const partialItems=Array.from({length:32},(_,i)=>({content:'Task '+i,status:i===0?'completed':'pending'}))
const summaryView={...view,plan:{items:partialItems,total:33,done:1},model:{...model,weights:Array(32).fill(1),fractions:Array(32).fill(0),planKey:planKey(partialItems)}}
for(const confidence of [0,2]){const d=localProgress({...summaryView,model:{...summaryView.model,confidence}},settings);assert.equal(d.percent,1/33);assert.equal(d.percentKnown,true,'truncated summaries fall back to actual item counts');assert.equal(d.source,'plan');assert.equal(d.weights,null);assert.equal(d.estimated,false);assert.equal(d.state,'running')}
const old=now-700000
for(const scope of ['plain','weighted','delegated']){
 const scoped=scope==='plain'?{...view,plan:{items:[],total:0,done:0}}:scope==='delegated'?{...view,plan:{...view.plan,coverage:'delegated'}}:view
 const stale=localProgress({...scoped,model:{...model,evidenceAt:old,at:now}},settings)
 assert.equal(stale.percentKnown,false,scope+' evidence age, not response age, controls staleness');assert.equal(stale.ageMs,700000);assert.equal(stale.updatedAt,old)
 const fresh=localProgress({...scoped,model:{...model,evidenceAt:now,at:old,observedAt:old}},settings)
 assert.equal(fresh.percentKnown,true,'a freshly captured snapshot may follow an older execution boundary');assert.equal(fresh.ageMs,0);assert.equal(fresh.updatedAt,now)
 const legacy=localProgress({...scoped,model:{...model,at:old}},settings)
 assert.equal(legacy.percentKnown,false,'legacy models without evidenceAt use at');assert.equal(legacy.ageMs,700000)
}
const completed=localProgress({...view,running:false,turnStatus:'completed',model:{...model,confidence:0,evidenceAt:old}},settings)
assert.equal(completed.percent,1);assert.equal(completed.percentKnown,true,'actual completion does not depend on model confidence or freshness')
console.log('evidence v065 passed: confidence-zero isolation, valid-cache preservation, truncated count fallback, evidence-time freshness and legacy models')
