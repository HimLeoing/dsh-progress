import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {localProgress} from '../lib/local-progress.js'
import {planKey} from '../lib/weighted-progress.js'
const listeners=new Map(),records=new Map(),start=Date.now()
const parent={id:'lead',seq:0,header:{createdAt:start},snapshotEvents:()=>[]}
const child={id:'worker',seq:0,header:{createdAt:start+1,origin:'subagent',parentSession:'lead'},snapshotEvents:()=>[]}
let sessions=[parent,child],members=[{id:'worker',name:'core',status:'running'}]
const tasks=[{id:'a',subject:'Core',status:'in_progress',ownerName:'core'}]
const ctx={on(name,fn){listeners.set(name,fn);return()=>{}},get(key){return key==='sessions'?{list:()=>sessions}:key==='agents'?{get:()=>({})}:key==='agentTeams'?{listTasks:()=>tasks,listMembers:()=>members}:undefined}}
const tracker=createTracker(ctx,{captureTranscript:false,localProgress:true,persistence:{load:id=>records.get(id)??null,save:(id,r)=>records.set(id,r)}})
const emit=(s,type,data={})=>listeners.get('session/event')(s,{seq:++s.seq,time:Date.now(),type,data})
try{
 emit(parent,'turn/start',{turn:1});emit(child,'turn/start',{turn:1})
 const sibling={id:'sibling',seq:0,header:{createdAt:start+1000,origin:'subagent',parentSession:'lead'},snapshotEvents:()=>[]};sessions.push(sibling);members.push({id:'sibling',name:'sprites',status:'running'});emit(sibling,'turn/start',{turn:1});assert.equal(tracker.snapshot('worker').children.length,0,'shared team membership does not turn a sibling into this worker’s child');sessions=sessions.filter(s=>s.id!=='sibling');members=members.filter(m=>m.id!=='sibling')
 emit(child,'todo/write',{todos:[{content:'Implement',status:'in_progress'},{content:'Test',status:'pending'}]})
 const before=tracker.snapshot('lead'),items=before.plan.items
 tracker.setModel('lead',{turn:1,at:Date.now(),percent:.3,confidence:2,evidenceRevision:before.evidenceRevision,weights:[1],fractions:[.3],planKey:planKey(items)})
 emit(child,'todo/write',{todos:[{content:'Implement',status:'completed'},{content:'Test',status:'in_progress'}]})
 const after=tracker.snapshot('lead'),display=localProgress(after,{aiEnabled:true,aiScope:'all'})
 assert.equal(after.evidenceRevision,before.evidenceRevision,'routine child checklist progress must not invalidate the parent estimate')
 assert.equal(display.percent,.3,'a child update must not reset parent progress to zero')
 emit(child,'turn/end',{reason:{kind:'completed'}})
 assert.equal(tracker.snapshot('lead').children[0].status,'completed','durable completion beats a stale running member')
 sessions=[parent];members=[]
 let view=tracker.snapshot('lead')
 assert.equal(view.children.length,1,'completed worker remains after the host unloads its session')
 assert.equal(view.children[0].label,'core','worker name survives roster removal')
 assert.equal(view.children[0].status,'completed')
 emit(child,'turn/start',{turn:2});emit(child,'todo/write',{todos:[{content:'Follow-up',status:'in_progress'}]})
 view=tracker.snapshot('lead');assert.equal(view.children.length,1);assert.equal(view.children[0].status,'running','same worker resumes without duplicate cards')
 emit(child,'turn/end',{reason:{kind:'completed'}});tasks[0].status='completed';emit(parent,'turn/end',{reason:{kind:'completed'}})
 assert.equal(records.get('lead').children.length,1,'turn roster survives a host restart');assert.equal(records.get('lead').plan[0].status,'completed','the final shared task state is persisted even without an intermediate poll')
 const legacy=new Map([['lead',{...records.get('lead'),children:[...records.get('lead').children,{id:'peer',label:'peer',status:'completed'}]}],['worker',{...records.get('worker'),children:[{id:'peer',label:'peer',status:'completed'}]}]])
 const restored=createTracker({get:key=>key==='sessions'?{list:()=>[{id:'lead',seq:0,header:{},snapshotEvents:()=>[]}]}:undefined,on:()=>()=>{}},{persistence:{load:id=>legacy.get(id)??null,save(){}}});try{restored.snapshot('lead');assert.equal(restored.snapshot('worker').children.length,0,'legacy saved snapshots also exclude peers identified by the parent roster')}finally{restored.dispose()}
 emit(parent,'turn/start',{turn:2});assert.equal(tracker.snapshot('lead').children.length,0,'previous-turn workers do not leak into new work')
 const stale=localProgress({...after,evidenceRevision:after.evidenceRevision+1},{aiEnabled:true,aiScope:'all'})
 assert.equal(stale.percentKnown,true,'rework uses a local approximate fallback');assert.equal(stale.estimated,true)
 console.log('team lifecycle passed: parent isolation, durable completion, retained roster, resumed workers, turn reset, stale display')
}finally{tracker.dispose()}
