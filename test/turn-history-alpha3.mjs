import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createProgressStore} from '../lib/progress-store.js'
import {createTracker} from '../lib/tracker.js'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dtp-history-')),file=path.join(dir,'progress.json')
try {
 fs.writeFileSync(file,JSON.stringify({version:1,sessions:{legacy:{turn:3,status:'completed',percent:1,updatedAt:3}}}))
 let store=createProgressStore(file)
 assert.equal(store.get('legacy',3).status,'completed')
 for(let turn=4;turn<=40;turn++)store.set('legacy',{turn,status:'completed',percent:1,updatedAt:turn})
 store.set('legacy',{turn:9,status:'completed',percent:1,updatedAt:9})
 assert.equal(store.get('legacy').turn,40,'late older updates must not replace latest turn')
 assert.equal(store.listTurns('legacy').length,32)
 store.flush();store=createProgressStore(file)
 assert.equal(store.get('legacy',9).turn,9);assert.equal(store.get('legacy').turn,40)
 assert.equal(fs.statSync(file).mode&0o777,0o600,'atomic record file remains private')
 const handlers=new Map(),events=[],session={id:'turns',seq:0,header:{cwd:'/work'},snapshotEvents:()=>events}
 const listed=[session]
 const ctx={get:key=>key==='sessions'?{list:()=>listed}:undefined,on(name,fn){handlers.set(name,fn);return()=>handlers.delete(name)}}
 const persistence={load:id=>store.get(id),loadTurn:(id,turn)=>store.get(id,turn),listTurns:id=>store.listTurns(id),save:(id,r)=>store.set(id,r)}
 let tracker=createTracker(ctx,{persistence,localProgress:true})
 const send=(type,data={})=>{const event={seq:++session.seq,type,time:Date.now(),data};events.push(event);handlers.get('session/event')(session,event)}
 send('turn/start',{turn:1});send('step/start',{turn:1,step:1})
 send('todo/write',{todos:[{content:'First turn only',status:'completed'}]})
 tracker.snapshot('turns');send('turn/end',{turn:1,reason:{kind:'completed'}})
 send('turn/start',{turn:2});send('step/start',{turn:2,step:1});send('todo/write',{todos:[{content:'Second only',status:'in_progress'}]})
 const old=tracker.snapshot('turns',{turn:1})
 assert.equal(old.historical,true);assert.equal(old.turnStatus,'completed');assert.equal(old.projectBar.percent,1)
 assert.equal(old.ownPlan.items[0].content,'First turn only')
 assert.equal(tracker.snapshot('turns').turn,2);assert.equal(tracker.snapshot('turns').running,true)
 assert.equal(tracker.snapshot('turns',{turn:8}).unavailable,true)
 assert.deepEqual(tracker.turns('turns'),[1,2])
 // Only completed evidence + genuine text frames qualifies, never reasoning/tool prep.
 const frame=(value)=>handlers.get('agent/assistant-stream')({agent:{id:'turns'},frame:value})
 frame({type:'start',attemptId:'a',revision:1,turn:2});frame({type:'chunk',attemptId:'a',revision:2,chunk:{type:'text-delta',text:'Working'}})
 assert.equal(tracker.snapshot('turns').finalResponseCandidate,false,'incomplete work must not be called final')
 send('todo/write',{todos:[{content:'Second only',status:'completed'}]})
 assert.equal(tracker.snapshot('turns').finalResponseCandidate,true)
 frame({type:'chunk',attemptId:'a',revision:3,chunk:{type:'tool-call-delta',id:'new',name:'write',argumentsDelta:'{}'}})
 assert.equal(tracker.snapshot('turns').finalResponseCandidate,false,'new tool immediately reverses candidate')
 frame({type:'start',attemptId:'b',revision:4,turn:2});frame({type:'chunk',attemptId:'b',revision:5,chunk:{type:'reasoning-delta',text:'private'}})
 assert.equal(tracker.snapshot('turns').finalResponseCandidate,false)
 assert.doesNotMatch(JSON.stringify(tracker.snapshot('turns')),/private/)
 send('tool/call',{callId:'rework',name:'write',arguments:'{"file_path":"/work/fix.js","content":"fixed"}'})
 send('tool/result',{message:{toolCallId:'rework',content:[{type:'text',text:'written'}]}})
 frame({type:'start',attemptId:'c',revision:6,turn:2});frame({type:'chunk',attemptId:'c',revision:7,chunk:{type:'text-delta',text:'More commentary'}})
 assert.equal(tracker.snapshot('turns').finalResponseCandidate,false,'stale completed checklist cannot hide new material/rework')
 const child={id:'worker',seq:0,header:{cwd:'/work',parentSession:'turns',origin:'subagent',createdAt:Date.now()+1},snapshotEvents:()=>[]};listed.push(child)
 const childEvent=(type,data)=>handlers.get('session/event')(child,{seq:++child.seq,type,data,time:Date.now()+2})
 childEvent('turn/start',{turn:1});childEvent('turn/end',{turn:1,reason:{kind:'completed'}})
 childEvent('turn/start',{turn:2});childEvent('turn/end',{turn:2,reason:{kind:'completed'}})
 assert.equal(tracker.snapshot('turns').children[0].turn,2,'worker current turn is part of parent roster snapshot')
 send('turn/end',{turn:2,reason:{kind:'completed'}});send('turn/start',{turn:3})
 childEvent('turn/start',{turn:3})
 assert.equal(tracker.snapshot('turns',{turn:2}).children[0].turn,2,'historical parent never follows worker into a later turn')
 tracker.dispose();store.flush()
 // Historical reads after restart use persisted turn data while current replay stays current.
 tracker=createTracker(ctx,{persistence,localProgress:true})
 assert.equal(tracker.snapshot('turns',{turn:1}).ownPlan.items[0].content,'First turn only')
 assert.equal(tracker.snapshot('turns').turn,3)
 tracker.dispose()
 // Existing native histories without any stored turns recover old turns once, without probes.
 const replay=createTracker(ctx,{localProgress:true})
 assert.equal(replay.snapshot('turns',{turn:1}).turnStatus,'completed')
 assert.equal(replay.snapshot('turns').turn,3)
 replay.dispose()
 console.log('turn-history-alpha3 passed: migration, bounded history, late saves, replay, restart, isolated turn selection and reversible answer candidate')
} finally {fs.rmSync(dir,{recursive:true,force:true})}
