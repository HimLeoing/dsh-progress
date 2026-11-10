import assert from 'node:assert/strict'
import {createTracker}from'../lib/tracker.js'
const handlers=new Map(),session={id:'ptc',seq:0,header:{cwd:'/work'},snapshotEvents:()=>[]},saved=new Map()
const tracker=createTracker({on(name,fn){handlers.set(name,fn);return()=>{}},get:key=>key==='sessions'?{list:()=>[session]}:undefined},{captureTranscript:false,localProgress:true,persistence:{load:id=>saved.get(id),save:(id,v)=>saved.set(id,v)}})
const emit=(type,data)=>handlers.get('session/event')(session,{seq:++session.seq,time:Date.now(),type,data})
try{
 emit('turn/start',{turn:1});emit('tool/call',{callId:'outer',name:'run_code',arguments:'{"description":"Inspect render"}'})
 emit('tool/ptc-dispatch-start',{rootCallId:'outer',parentCallId:'outer',subCallId:'r',name:'read',arguments:{file_path:'/work/src/a.js'}})
 emit('tool/ptc-dispatch-start',{rootCallId:'outer',parentCallId:'outer',subCallId:'w',name:'write',arguments:{file_path:'/work/src/b.js',content:'PRIVATE BODY'}})
 let p=tracker.snapshot(session.id,{includeTranscript:true})
 assert.deepEqual(p.commands.map(c=>c.name),['read','write'],'nested reads/writes are real active operations, not just the outer run_code')
 assert.equal(p.commands[1].indeterminate,true);assert.equal(p.commands[1].known,false)
 assert.equal(p.probe.transcript.length,0,'local mode does not retain a second transcript')
 emit('tool/ptc-dispatch',{rootCallId:'outer',parentCallId:'outer',subCallId:'w',name:'write',arguments:{},content:[{type:'text',text:'done'}],isError:false})
 emit('tool/ptc-dispatch',{rootCallId:'outer',parentCallId:'outer',subCallId:'r',name:'read',arguments:{},content:[{type:'text',text:'ok'}],isError:false})
 emit('tool/result',{message:{toolCallId:'outer',content:[{type:'text',text:'ok'}]}})
 p=tracker.snapshot(session.id);assert.equal(p.lastTool.name,'read','the outer wrapper does not hide the last substantive operation');assert.equal(p.lastTool.label,'src/a.js');assert.equal(p.operations.completed,2)
 emit('turn/end',{reason:{kind:'completed'}});assert.equal(saved.get(session.id).lastTool.name,'read')
 console.log('ptc-progress checks passed: nested calls, independent bars, last operation, bounded local capture, persistence')
}finally{tracker.dispose()}
