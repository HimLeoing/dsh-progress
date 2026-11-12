import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {localWorkFacts} from '../lib/local-work-evidence.js'
import {belongsToTurn} from '../lib/child-metadata.js'
import {localItemKeys,localPlanFractions} from '../lib/local-estimator.js'
let clock=1800000000000
const realNow=Date.now;Date.now=()=>clock
const handlers=new Map(),listed=[]
const session=(id,parentSession)=>{const s={id,seq:0,header:{createdAt:clock,cwd:'/fixture',...(parentSession?{parentSession,origin:'subagent'}:{})},snapshotEvents:()=>[]};listed.push(s);return s}
const parent=session('lead')
const tracker=createTracker({on(name,fn){handlers.set(name,fn);return()=>{}},get:name=>name==='sessions'?{list:()=>listed}:undefined},{localProgress:true,captureTranscript:false})
const emit=(s,type,data)=>handlers.get('session/event')(s,{type,data,seq:++s.seq,time:++clock})
try{
 emit(parent,'turn/start',{turn:1})
 const args={path:'app.js',content:'const actualMaterial = true;\n'.repeat(120)},credit=localWorkFacts('write',args).credit
 for(let i=0;i<2;i++){
  emit(parent,'tool/ptc-dispatch-start',{name:'write',subCallId:'nested-'+i,rootCallId:'root',arguments:args})
  emit(parent,'tool/ptc-dispatch',{subCallId:'nested-'+i,content:[]})
 }
 assert.equal(tracker.snapshot('lead').localEvidence.root.units[1],credit,'PTC material is measured before transcript compaction and duplicate content is counted once')
 assert.doesNotMatch(JSON.stringify(tracker.snapshot('lead').localEvidence),/actualMaterial/)
 const items=[{content:'Delegate implementation',status:'in_progress'},{content:'Independent integration',status:'pending'}]
 emit(parent,'todo/write',{todos:items})
 const worker=session('actual-worker','lead');emit(worker,'turn/start',{turn:1});emit(worker,'turn/end',{reason:{kind:'completed'}})
 let view=tracker.snapshot('lead');assert.deepEqual(view.children[0].localOwners,[localItemKeys(items)[0]])
 const advanced=localPlanFractions(view)[0];assert.ok(advanced>0,'delegated work advances the active unowned checklist item')
 items[0].status='completed';items[1].status='in_progress';emit(parent,'todo/write',{todos:items})
 view=tracker.snapshot('lead');assert.equal(localPlanFractions(view)[1],0,'the completed child cannot advance a different subsequent item')
 emit(parent,'turn/end',{reason:{kind:'completed'}})
 assert.deepEqual(tracker.snapshot('lead').children.map(c=>c.id),['actual-worker'])
 clock+=30000;const maintenance=session('post-turn-maintenance','lead');emit(maintenance,'turn/start',{turn:1});emit(maintenance,'turn/end',{reason:{kind:'completed'}})
 assert.deepEqual(tracker.snapshot('lead').children.map(c=>c.id),['actual-worker'],'new background sessions after parent completion do not enter the ended turn')
 assert.equal(tracker.snapshot('lead').turnStatus,'completed')
 assert.equal(belongsToTurn({workClock:{complete:true,lastStart:clock,settledMs:0}},clock-1),false,'legacy rows with only post-turn work are excluded too')
 assert.equal(belongsToTurn({workClock:{complete:true,lastStart:clock,settledMs:100}},clock-1),true,'real earlier work remains in the roster')
 console.log('Team window rc1 passed: delegation affects the bound item once, real teammates retained, post-turn maintenance and legacy rows excluded, compact PTC material deduplicated')
}finally{tracker.dispose();Date.now=realNow}
