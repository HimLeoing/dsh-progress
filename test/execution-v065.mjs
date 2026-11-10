import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {jobOutcome,resultStatus,operationPhase} from '../lib/progress-evidence.js'

const footerCases=[
 ['running','background'],['stopping','background'],['completed','completed'],['failed','failed'],['killed','failed'],
 ['running, exit code: null','background'],['stopping, user requested','background'],
 ['completed, exit code: 0','completed'],['completed, exit code: 3','failed'],['completed, exit code: -1','failed'],
 ['failed, producer error','failed'],['killed, user requested','failed'],
]
for(const [detail,expected] of footerCases){
 const text=`(no new output)\n[status: ${detail}]\n`
 assert.equal(resultStatus('job_output',{},text),expected,detail)
 assert.equal(resultStatus('bash',{},text),'completed','job protocol is not inferred from arbitrary shell output')
}
assert.equal(jobOutcome('not protocol [status: failed]'),null)
assert.equal(jobOutcome('[status: failed]\nmore output'),null)
assert.equal(resultStatus('job_output',{message:{isError:true}},'[status: completed]'),'failed')
assert.equal(operationPhase('bash',{command:"sed -n '1,5p' file.js"}),'discover','retain read-only sed phase')

function harness({seedCurrent=false}={}){
 const handlers=new Map(),ends=[],sessions=[],logs=new Map()
 let clock=Date.now()-10000
 const add=(id,parentSession)=>{
  const events=[];logs.set(id,events)
  const session={id,header:{cwd:'/work',createdAt:++clock,...(parentSession?{origin:'subagent',parentSession}:{})},get seq(){return events.length},snapshotEvents:()=>seedCurrent?events:[]}
  sessions.push(session);return session
 }
 const session=add('root')
 const tracker=createTracker({on:(name,fn)=>{handlers.set(name,fn);return()=>{}},get:key=>key==='sessions'?{list:()=>sessions}:undefined},{captureTranscript:false,localProgress:true,onTurnEnd:row=>ends.push(row)})
 const commit=(type,data={},target=session)=>{const events=logs.get(target.id),event={type,data,seq:events.length+1,time:++clock};events.push(event);return event}
 const redeliver=(event,target=session)=>handlers.get('session/event')(target,event)
 const emit=(type,data={},target=session)=>{const event=commit(type,data,target);redeliver(event,target);return event}
 const poll=(id,jobId,detail='completed, exit code: 1',extra={})=>{
  emit('tool/call',{callId:id,name:'job_output',arguments:JSON.stringify({job_id:jobId,wait:false})})
  const event=emit('tool/result',{message:{toolCallId:id,content:[{type:'text',text:`(no new output)\n[status: ${detail}]`}],...extra}})
  return {event,view:tracker.snapshot(session.id)}
 }
 return {session,tracker,ends,emit,commit,redeliver,poll,add}
}

{
 const h=harness()
 try{
  h.emit('turn/start',{turn:1})
  const first=h.poll('read1','bash-job').view
  assert.deepEqual(first.operations,{completed:1,failed:1,active:0})
  assert.equal(first.evidenceRevision,1);assert.equal(first.boundary.important,true)
  assert.equal(first.lastTool.jobId,'bash-job');assert.equal(first.lastTool.label,'bash-job')
  const next=h.poll('read2','bash-job').view
  assert.deepEqual(next.operations,{completed:2,failed:1,active:0},'successful output reads and failed work are distinct counters')
  assert.equal(next.lastTool.status,'failed','reading the same failure must not display success')
  assert.equal(next.evidenceRevision,1);assert.equal(next.boundary.important,false)
  assert.equal(next.probe.evidence.checks.length,1)
  const different=h.poll('read3','other-job').view
  assert.equal(different.operations.failed,2);assert.equal(different.evidenceRevision,2)
  const duplicate=h.poll('read4','other-job')
  h.redeliver(duplicate.event)
  assert.equal(h.tracker.snapshot('root').operations.completed,4,'same tool result is not counted again')
  for(const [i,detail] of ['running','stopping, user requested','completed, exit code: 0'].entries()){
   const row=h.poll(`lifecycle${i}`,'success-job',detail).view
   assert.equal(row.operations.failed,2);assert.equal(row.evidenceRevision,2)
  }
  h.poll('tool-error','bad-read','completed',{isError:true})
  const errored=h.tracker.snapshot('root')
  assert.equal(errored.operations.completed,7,'failed output read itself is not a completed read')
  assert.equal(errored.operations.failed,3)
  h.emit('turn/end',{turn:1,reason:{kind:'completed'}})
  h.emit('turn/start',{turn:2})
  assert.equal(h.poll('new-turn','bash-job').view.operations.failed,1,'new turn owns independent bounded evidence')
  for(let i=0;i<150;i++)h.poll(`bounded${i}`,`job-${i}`)
  const last=h.tracker.snapshot('root'),repeated=h.poll('latest-again','job-149').view
  assert.equal(repeated.operations.failed,last.operations.failed,'latest terminal failures remain deduplicated after bounded cache overflow')
  assert.equal(repeated.evidenceRevision,last.evidenceRevision)
 }finally{h.tracker.dispose()}
}

for(const seedCurrent of [false,true]){
 const h=harness({seedCurrent})
 try{
  h.emit('turn/start',{turn:1})
  const end=h.emit('turn/end',{turn:1,reason:{kind:'completed'}})
  h.redeliver(end)
  assert.equal(h.ends.length,1,'current end is notified once even when ensure already seeded it')
  h.emit('turn/start',{turn:2});h.redeliver(end)
  assert.equal(h.ends.length,1,'old seq cannot notify or cancel the new turn')
  h.emit('turn/end',{turn:1,reason:{kind:'completed'}})
  assert.equal(h.tracker.snapshot('root').running,true,'explicit old turn with a newer delivery seq cannot end the current turn')
  assert.equal(h.ends.length,1)
  h.emit('turn/end',{turn:2,reason:{kind:'completed'}})
  assert.deepEqual(h.ends.map(row=>row.turn),[1,2]);assert.ok(h.ends.every(row=>row.elapsedMs>=0))
 }finally{h.tracker.dispose()}
}

{
 const h=harness({seedCurrent:true})
 try{
  h.commit('turn/start',{turn:1})
  const end=h.commit('turn/end',{turn:1,reason:{kind:'completed'}})
  h.redeliver(end);h.redeliver(end)
  assert.equal(h.ends.length,1,'cold first end notification survives replay containing that same end')
  assert.equal(h.ends[0].status,'completed')
 }finally{h.tracker.dispose()}
}

{
 const h=harness()
 try{
  h.emit('turn/start',{turn:1})
  h.emit('tool/call',{callId:'outer',name:'run_code',arguments:'{}'})
  h.emit('tool/ptc-dispatch-start',{rootCallId:'outer',subCallId:'poll',name:'job_output',arguments:{job_id:'ptc-job',wait:false}})
  assert.equal(h.tracker.snapshot('root').commands[0].label,'ptc-job')
  h.emit('tool/ptc-dispatch',{rootCallId:'outer',subCallId:'poll',name:'job_output',content:[{type:'text',text:'[status: failed, producer error]'}],isError:false})
  h.emit('tool/result',{message:{toolCallId:'outer',content:[{type:'text',text:'ok'}]}})
  const v=h.tracker.snapshot('root')
  assert.deepEqual(v.operations,{completed:1,failed:1,active:0});assert.equal(v.lastTool.jobId,'ptc-job')
  const worker=h.add('worker','root');h.emit('turn/start',{turn:1},worker)
  h.tracker.setModel('worker',{turn:1,at:Date.now(),evidenceAt:Date.now()-700000,evidenceRevision:0,percent:.5,confidence:2})
  assert.equal(h.tracker.snapshot('root').children[0].percentKnown,true,'stale AI response falls back to local progress');assert.equal(h.tracker.snapshot('root').children[0].percent,.01,'stale AI 50% cannot become fresh local evidence')
  h.tracker.setModel('worker',{turn:1,at:Date.now(),evidenceAt:Date.now(),evidenceRevision:0,percent:.5,confidence:2})
  assert.equal(h.tracker.snapshot('root').children[0].percentKnown,true)
  h.emit('turn/end',{turn:1,reason:{kind:'completed'}},worker)
  assert.equal(h.ends.at(-1).parentSession,'root','preserve owning parent in end notifications')
 }finally{h.tracker.dispose()}
}
console.log('execution-v065 passed: official job lifecycle, bounded failure identity, PTC metadata, end notification idempotence, evidence freshness')
