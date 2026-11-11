import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {localProgress,modelContinuity} from '../lib/local-progress.js'
import {planKey} from '../lib/weighted-progress.js'
const handlers=new Map(),root={id:'lead',seq:0,header:{cwd:'/work'},snapshotEvents:()=>[]},child={id:'child',seq:0,header:{cwd:'/work',parentSession:'lead',origin:'subagent',createdAt:Date.now()+10},snapshotEvents:()=>[]},sessions=[root]
const tracker=createTracker({get:key=>key==='sessions'?{list:()=>sessions}:undefined,on(name,fn){handlers.set(name,fn);return()=>handlers.delete(name)}},{localProgress:true})
const event=(session,type,data={})=>handlers.get('session/event')(session,{seq:++session.seq,type,data,time:Date.now()})
const settings={aiEnabled:true,aiScope:'all'}
const items=[{content:'Implement app',status:'in_progress'}]
const estimate=p=>{const v=tracker.snapshot('lead');tracker.setModel('lead',{turn:1,at:Date.now(),percent:p,confidence:1,evidenceRevision:v.evidenceRevision,planKey:planKey(v.plan.items),weights:[1],fractions:[p]})}
try{
 event(root,'turn/start',{turn:1});event(root,'todo/write',{todos:items});estimate(.18)
 assert.equal(localProgress(tracker.snapshot('lead'),settings).percent,.18)
 sessions.push(child);event(child,'turn/start',{turn:1});tracker.snapshot('lead')
 event(child,'todo/write',{todos:[{content:'Implement assigned module',status:'in_progress'}]})
 event(child,'todo/write',{todos:[{content:'Implement assigned module',status:'in_progress'},{content:'Verify module boundary',status:'pending'}]})
 let view=tracker.snapshot('lead'),display=localProgress(view,settings)
 assert.notEqual(view.evidenceRevision,view.model.evidenceRevision,'new child scope updates parent evidence revision')
 assert.equal(display.source,'model-retained');assert.equal(display.percent,.18,'same root scope retains last AI estimate instead of dropping to cold local curve')
 assert.equal(display.estimated,true);assert.equal(display.retained,true);assert.equal(display.state,'recalculating')
 assert.equal(view.lastKnownProgress.percent,.18,'retained result does not become a newly recorded observation')
 estimate(.12);display=localProgress(tracker.snapshot('lead'),settings)
 assert.equal(display.percent,.12,'a genuinely fresh lower model assessment is allowed')
 assert.notEqual(display.source,'model-retained')
 const base=tracker.snapshot('lead'),stale={...base,model:{...base.model,evidenceRevision:-1}}
 assert.equal(localProgress(stale,settings).source,'model-retained')
 const variants=[
  {...stale,operations:{...stale.operations,failed:(stale.operations.failed??0)+1}},
  {...stale,plan:{...stale.plan,items:[...stale.plan.items,{content:'New scope',status:'pending'}],total:2}},
  {...stale,children:stale.children.map(c=>({...c,turn:c.turn+1}))},
  {...stale,model:{...stale.model,confidence:0}},
  {...stale,probe:{...stale.probe,goal:'a replacement request'}},
 ]
 for(const value of variants)assert.notEqual(localProgress(value,settings).source,'model-retained','scope, failure, resumed worker, unsupported or replacement goal must invalidate retention')
 assert.notEqual(localProgress(stale,{aiEnabled:false}).source,'model-retained','switching AI off uses the agreed local transition')
 const completed={...base,plan:{...base.plan,items:[{content:'Implement app',status:'completed'}]},ownPlan:{items:[{content:'Implement app',status:'completed'}]}}
 const baseline=modelContinuity(completed)
 const reopened={...stale,model:{...stale.model,continuity:baseline},plan:{...stale.plan,items:[{content:'Implement app',status:'in_progress'}]}}
 assert.notEqual(localProgress(reopened,settings).source,'model-retained','a reopened completed item must be allowed to decrease')
 assert.equal(localProgress({...stale,turnStatus:'completed',running:false},settings).percent,1)
 console.log('model-continuity-alpha3 passed: real child scope event, no stale/local bounce, honest rework/scope/failure decreases, fresh lower estimates and mode changes')
}finally{tracker.dispose()}
