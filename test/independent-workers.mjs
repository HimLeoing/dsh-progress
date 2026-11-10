import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {localProgress} from '../lib/local-progress.js'
const at=1800000000000,realNow=Date.now;let now=at;Date.now=()=>now
const handlers=new Map(),records=new Map(),make=(id,parent)=>({id,seq:0,header:{createdAt:at,parentSession:parent,origin:parent?'subagent':'user'},events:[],snapshotEvents(){return this.events}})
const parent=make('lead'),child=make('forest','lead');let sessions=[parent,child]
const ctx={on:(k,f)=>{handlers.set(k,f);return()=>{}},get:k=>k==='sessions'?{list:()=>sessions}:undefined}
const persistence={load:id=>records.get(id),save:(id,r)=>records.set(id,structuredClone(r))}
const tracker=createTracker(ctx,{localProgress:true,captureTranscript:false,persistence})
const emit=(s,type,data={},time=now)=>{const event={seq:s.seq++,time,type,data};s.events.push(event);handlers.get('session/event')(s,event)}
try{
 emit(parent,'turn/start',{turn:1});now+=10;emit(child,'subagent/descriptor',{label:'Autumn forest system and hero trees'});emit(child,'turn/start',{turn:1});now+=200;emit(child,'turn/end',{reason:{kind:'completed'}})
 now+=1000;emit(child,'turn/start',{turn:2});now+=100;emit(child,'turn/end',{reason:{kind:'completed'}})
 let view=tracker.snapshot('lead');assert.equal(view.children[0].elapsedMs,300,'sum both working intervals, excluding 1000ms idle')
 assert.equal(view.children[0].label,'Autumn forest system and hero trees');assert.equal(view.plan.total,0,'independent workers are not checklist items');assert.equal(view.projectBar.total,1)
 now+=500;assert.equal(tracker.snapshot('lead').children[0].elapsedMs,300,'completed work clock freezes')
 emit(child,'turn/start',{turn:3});emit(child,'user/message',{source:{kind:'agent-message'},content:[{type:'text',text:'CURRENT: generic status message'}]})
 view=tracker.snapshot('lead');assert.equal(view.children[0].label,'Autumn forest system and hero trees');assert.equal(view.children[0].percentKnown,false,'unknown worker progress is not numeric zero')
 const model={turn:1,at:now,percent:.62,confidence:1,evidenceRevision:view.evidenceRevision};tracker.setModel('lead',model)
 view=tracker.snapshot('lead');assert.equal(localProgress(view,{aiEnabled:true,aiScope:'no-plan',now}).percent,.62)
 now+=50;emit(child,'turn/end',{reason:{kind:'completed'}});emit(parent,'turn/end',{reason:{kind:'completed'}})
 sessions=[];tracker.dispose()
 const legacy=records.get('lead');for(const row of legacy.children){delete row.workClock;row.elapsedMs=50;row.label='generic prompt prefix';row.named=false}records.set('lead',legacy)
 const coldHandlers=new Map();let opened=0,closed=0
 const cold=createTracker({on:(k,f)=>{coldHandlers.set(k,f);return()=>{}},get:k=>k==='sessions'?{list:()=>[]}:k==='sessionPersistence'?{async open(id,access){assert.equal(access,'read');opened++;const s=id==='lead'?parent:child;return{header:s.header,inheritedEventCount:0,async read(offset=0,length=256){return{events:s.events.filter(e=>e.seq>=offset).slice(0,length)}},async close(){closed++}}}}:undefined},{persistence,localProgress:true})
 try{let v=cold.snapshot('lead');await cold.refreshChildMetadata('lead');v=cold.snapshot('lead');assert.equal(v.children[0].elapsedMs,350);assert.equal(v.children[0].label,'Autumn forest system and hero trees');assert.ok(opened>0,'old records require native read-only metadata recovery');assert.equal(opened,closed,'all read handles close');assert.equal(v.plan.total,0)}finally{cold.dispose()}
 console.log('independent workers passed: real labels, cumulative clocks, idle exclusion, parent scope, unknown progress, cold recovery')
}finally{Date.now=realNow;tracker.dispose()}
const {createWorkClock,foldWorkEvent,workElapsed,createChildMetadata}=await import('../lib/child-metadata.js')
const windowed=createWorkClock(at+100,at+500)
for(const event of [{seq:0,type:'turn/start',time:at},{seq:1,type:'turn/end',time:at+200},{seq:2,type:'turn/start',time:at+400},{seq:3,type:'turn/end',time:at+800}])foldWorkEvent(windowed,event)
assert.equal(workElapsed(windowed),200,'clip both sides of a parent request window')
const metadata=createChildMetadata({get(){}}),seeded={id:'fork',inheritedEventCount:2,snapshotEvents:()=>[{seq:0,type:'turn/start',time:at},{seq:1,type:'turn/end',time:at+10000},{seq:2,type:'subagent/descriptor',data:{label:'Own child'}},{seq:3,type:'turn/start',time:at+20000},{seq:4,type:'turn/end',time:at+20100}]}
assert.equal(workElapsed(metadata.live(seeded,at)),100,'never count the copied parent transcript as child work');metadata.dispose()
let closedOnError=0;const broken=createChildMetadata({get:()=>({async open(){return{async read(){throw Error('read failed')},async close(){closedOnError++}}}})})
assert.equal(await broken.recover('x',at),null);assert.equal(closedOnError,1,'cold read errors also release handles');broken.dispose()
