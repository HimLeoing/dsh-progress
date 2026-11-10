import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {taskGraphRemaining} from '../lib/task-graph.js'
let clock=1800000000000
const realNow=Date.now;Date.now=()=>clock
const sessions=[],listeners=new Map(),records=new Map()
let tasks=[{id:'old',subject:'Old completed task',status:'completed',blockedBy:[]}]
const ctx={get(key){
 if(key==='sessions')return{list:()=>sessions}
 if(key==='agentTeams')return{listTasks:()=>tasks,listMembers:()=>[{id:'team',name:'Lead'},{id:'worker',name:'Worker'}]}
 if(key==='agents')return{get:id=>id==='team'?{}:undefined}
},on(name,fn){listeners.set(name,fn);return()=>{}}}
const tracker=createTracker(ctx,{persistence:{load:id=>records.get(id),save:(id,value)=>records.set(id,value)}})
function session(id,extra={}){const s={id,seq:0,header:{cwd:'/work',createdAt:clock,...extra},snapshotEvents:()=>[]};sessions.push(s);return s}
function emit(s,type,data={}){listeners.get('session/event')(s,{seq:++s.seq,type,data,time:clock})}
const parent=session('parent'),one=session('one',{origin:'subagent',parentSession:'parent'}),two=session('two',{origin:'subagent',parentSession:'parent'}),fork=session('fork',{isSeeded:true,parentSession:'parent'})
emit(parent,'turn/start',{turn:1});emit(one,'turn/start',{turn:1});emit(two,'turn/start',{turn:1});emit(fork,'turn/start',{turn:1})
emit(one,'user/message',{source:{kind:'user'},content:[{type:'text',text:'Build the first part'}]})
tracker.setModel('one',{turn:1,at:clock,percent:.4,remainingMs:20000})
tracker.setModel('two',{turn:1,at:clock,percent:.7,remainingMs:10000})
let view=tracker.snapshot('parent')
assert.equal(view.children.length,2,'ordinary forks are not child agents')
assert.equal(view.children[0].label,'Build the first part')
assert.equal(view.children[0].percent,.4)
assert.equal(view.projectBar.mode,'agents')
emit(one,'turn/end',{reason:{kind:'completed'}})
view=tracker.snapshot('parent');assert.equal(view.children[0].status,'completed');assert.equal(view.projectBar.done,1)
const lead=session('team');emit(lead,'turn/start',{turn:1})
view=tracker.snapshot('team');assert.equal(view.projectBar.mode,'turn','old team completions do not leak into a new turn')
tasks=[...tasks,{id:'new',subject:'New task',status:'in_progress',blockedBy:[]}]
view=tracker.snapshot('team');assert.equal(view.projectBar.mode,'team');assert.equal(view.projectBar.total,1)
assert.equal(view.plan.items[0].content,'New task')
emit(parent,'todo/write',{todos:[{content:'One',status:'completed'},{content:'Two',status:'in_progress'}]})
emit(parent,'tool/call',{callId:'1',name:'bash',arguments:'{"command":"npm test"}'})
emit(parent,'tool/call',{callId:'2',name:'read',arguments:'{"file_path":"README.md"}'})
view=tracker.snapshot('parent');assert.equal(view.commands.length,2,'all concurrent operations are presented')
assert.equal(view.commands[0].known,false,'one command does not establish a reliable duration')
assert.equal(view.plan.done,1)
emit(parent,'turn/end',{reason:{kind:'completed'}})
assert.equal(records.get('parent').plan.length,2,'saved records retain a compact checklist')
assert.equal(records.get('parent').mode,'todos')
assert.equal(taskGraphRemaining([{id:'a',status:'pending',blockedBy:[]},{id:'b',status:'pending',blockedBy:[]}],()=>10000,2),10000,'parallel work is not summed')
assert.equal(taskGraphRemaining([{id:'a',status:'pending',blockedBy:[]},{id:'b',status:'pending',blockedBy:['a']}],()=>10000,2),20000,'dependent work follows the critical path')
assert.equal(taskGraphRemaining([{id:'a',status:'pending',blockedBy:['b']},{id:'b',status:'pending',blockedBy:['a']}],()=>10000,2),null,'dependency cycles cannot produce a confident ETA')
assert.equal(taskGraphRemaining([{id:'a',status:'pending',blockedBy:['missing']}],()=>10000,2),null,'an unknown dependency is not assumed complete')
tracker.dispose();Date.now=realNow
console.log('tracker v03 checks passed: child agents, forks, team turns, concurrent tools, persisted plan, dependencies')
