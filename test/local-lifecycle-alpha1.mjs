/** Local estimates through real tracker events, family views and persisted records. */
import assert from 'node:assert/strict'
import {createTracker} from '../lib/tracker.js'
import {localProgress} from '../lib/local-progress.js'
import {workerProgress} from '../lib/worker-progress.js'
import {localItemKeys} from '../lib/local-estimator.js'

const originalNow=Date.now,off={aiEnabled:false,aiScope:'all'}
let clock=1_800_000_000_000
Date.now=()=>clock
const closeTo=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-10,`${label}: ${actual} != ${expected}`)
const checks=[]

function fixture({team=true,sharedMembership=true}={}) {
  const handlers=new Map(),records=new Map(),learned=[]
  const make=(id,parentSession)=>({id,seq:0,header:{createdAt:clock,cwd:'/fixture/local-progress',origin:parentSession?'subagent':'user',parentSession},events:[],snapshotEvents(){return this.events}})
  const parent=make('lead'),child=make('forest','lead'),peer=make('sky','lead')
  let sessions=team?[parent,child,peer]:[parent],agentRunning=true
  const tasks=[
    {id:'forest-task',subject:'Implement forest',ownerName:'forest',status:'in_progress'},
    {id:'sky-task',subject:'Implement sky',ownerName:'sky',status:'in_progress'},
  ]
  const context={
    on(name,fn){handlers.set(name,fn);return()=>{if(handlers.get(name)===fn)handlers.delete(name)}},
    get(name){
      if(name==='sessions')return{list:()=>sessions}
      if(name==='agents')return{get:id=>({id,status:agentRunning?'running':'idle'})}
      if(name==='agentTeams'&&team)return{
        tryMembership:agent=>sharedMembership||agent.id==='lead'?{}:undefined,
        listTasks:()=>tasks,
        listMembers:()=>[{id:'forest',name:'forest'},{id:'sky',name:'sky'}],
      }
    },
  }
  const options={
    localProgress:true,captureTranscript:false,
    persistence:{load:id=>records.get(id),save:(id,value)=>records.set(id,structuredClone(value))},
    learning:{observeDuration(){},duration:()=>({samples:0,ms:1000}),localPrior:(_key,seed)=>({units:seed,samples:0}),observeLocal:(...args)=>learned.push(args)},
  }
  let tracker=createTracker(context,options),call=0
  const emit=(session,type,data={})=>{
    const event={seq:++session.seq,time:++clock,type,data}
    session.events.push(event)
    handlers.get('session/event')(session,event)
  }
  const operation=(session,name,args)=>{
    const callId=`call-${++call}`
    emit(session,'tool/call',{callId,name,arguments:args})
    emit(session,'tool/result',{message:{toolCallId:callId,content:[]}})
  }
  const start=()=>{
    emit(parent,'turn/start',{turn:1})
    if(team)for(const session of [child,peer]){
      emit(session,'subagent/descriptor',{label:session.id})
      emit(session,'turn/start',{turn:1})
    }
  }
  const renderedParent=()=>{
    const view=tracker.snapshot(parent.id)
    const children=view.children.map(row=>workerProgress(row,tracker.snapshot(row.id),view,off))
    return{view:{...view,children},display:localProgress({...view,children},off)}
  }
  return{
    parent,child,peer,tasks,records,learned,emit,operation,start,renderedParent,
    get tracker(){return tracker},
    cold(){tracker.dispose();sessions=[];agentRunning=false;tracker=createTracker(context,options)},
    dispose(){tracker.dispose()},
  }
}

function check(name,fn) {
  try{fn();checks.push(name);console.log(`PASS ${name}`)}catch(error){error.message=`${name}: ${error.message}`;throw error}
}

try {
  for(const sharedMembership of [true,false])check(`child attribution with ${sharedMembership?'shared member board':'parent-only board'}`,()=>{
    const f=fixture({sharedMembership})
    try{
      f.start()
      for(let i=0;i<6;i++)f.operation(f.child,'write',{path:'forest.js'})
      const parent=f.tracker.snapshot('lead'),child=f.tracker.snapshot('forest'),keys=localItemKeys(parent.plan.items)
      assert.equal(child.localEvidence.items[keys[0]]?.units[1],6,'all six child writes belong to its assigned task')
      assert.equal(child.localEvidence.items[keys[1]],undefined,'a sibling task cannot acquire ghost work')
      const row=workerProgress(parent.children.find(row=>row.id==='forest'),child,parent,off)
      assert.ok(row.display.percent>0&&row.display.percent<1,'assigned tasks must not erase independent child evidence')
      assert.equal(row.display.percentKnown,true)
      assert.equal(row.display.indeterminate,false)
      const {view,display}=f.renderedParent()
      closeTo(parent.children.find(row=>row.id==='forest').localPercent,row.display.percent,'raw and rendered child estimates use the same scope')
      assert.ok(display.percent>0,'the root receives the child contribution')
      const before=display.percent
      f.emit(f.parent,'turn/end',{reason:{kind:'cancelled'}})
      closeTo(localProgress(f.tracker.snapshot('lead'),off).percent,before,'interruption freezes the complete family view')
      assert.equal(view.children.find(row=>row.id==='sky').display.percent,0,'an idle sibling keeps its own zero')
      f.cold()
      closeTo(localProgress(f.tracker.snapshot('lead'),off).percent,before,'frozen family progress survives cold recovery')
    }finally{f.dispose()}
  })

  check('running family cold recovery retains nonzero root and child progress',()=>{
    const f=fixture()
    try{
      f.start()
      for(let i=0;i<6;i++)f.operation(f.child,'write',{path:'forest.js'})
      const before=f.renderedParent(),childBefore=before.view.children.find(row=>row.id==='forest').display.percent
      assert.ok(before.display.percent>0&&childBefore>0)
      f.cold()
      const parent=f.tracker.snapshot('lead'),child=f.tracker.snapshot('forest')
      assert.equal(parent.turnStatus,'interrupted')
      closeTo(localProgress(parent,off).percent,before.display.percent,'a running record must not recover as zero')
      const row=workerProgress(parent.children.find(row=>row.id==='forest'),child,parent,off)
      closeTo(row.display.percent,childBefore,'the child retains its assigned scope after restart')
    }finally{f.dispose()}
  })

  check('AI eighty percent cancellation stays frozen without replacing it with local zero',()=>{
    const f=fixture({team:false}),on={aiEnabled:true,aiScope:'all'}
    try{
      f.start()
      const view=f.tracker.snapshot('lead')
      assert.equal(f.tracker.setModel('lead',{turn:1,at:clock,evidenceAt:clock,evidenceRevision:view.evidenceRevision,percent:.8,confidence:2}),true)
      closeTo(localProgress(f.tracker.snapshot('lead'),on).percent,.8,'live AI estimate')
      f.emit(f.parent,'turn/end',{reason:{kind:'cancelled'}})
      closeTo(localProgress(f.tracker.snapshot('lead'),on).percent,.8,'cancelled AI estimate')
      assert.ok(localProgress(f.tracker.snapshot('lead'),off).percent<1,'local cancellation cannot invent success')
      f.cold()
      closeTo(localProgress(f.tracker.snapshot('lead'),on).percent,.8,'AI provenance survives cold recovery')
    }finally{f.dispose()}
  })

  check('same-file mutations and current-material verification continue beyond four calls',()=>{
    const f=fixture({team:false})
    try{
      f.start()
      f.emit(f.parent,'user/message',{content:[{type:'text',text:'Implement a web app'}]})
      let priorVerified=-1
      for(let i=0;i<8;i++){
        f.operation(f.parent,'write',{path:'main.js'})
        let root=f.tracker.snapshot('lead').localEvidence.root
        assert.equal(root.units[1],i+1,'real mutations cannot stop contributing after four identical path fingerprints')
        assert.equal(root.verified,-1,'a new mutation invalidates the preceding verification')
        f.operation(f.parent,'bash',{command:'npm test',description:'Final acceptance full suite'})
        root=f.tracker.snapshot('lead').localEvidence.root
        assert.equal(root.units[2],i+1,'verification credit is scoped to the current material version')
        assert.equal(root.verified,root.material,'the latest successful test validates the current material')
        assert.ok(root.verified>priorVerified)
        priorVerified=root.verified
      }
      const display=localProgress(f.tracker.snapshot('lead'),off)
      assert.ok(display.percent>0&&display.percent<1,'repeated successful work remains an estimate until actual success')
    }finally{f.dispose()}
  })

  check('historical snapshots do not train while real completed work does',()=>{
    const f=fixture({team:false})
    try{
      const history=[
        ['turn/start',{turn:1}],
        ['todo/write',{todos:[{content:'Write main',status:'in_progress'}]}],
        ['tool/call',{callId:'old-write',name:'write',arguments:{path:'old.js'}}],
        ['tool/result',{message:{toolCallId:'old-write',content:[]}}],
        ['todo/write',{todos:[{content:'Write main',status:'completed'}]}],
        ['turn/end',{reason:{kind:'completed'}}],
      ]
      for(const [type,data]of history)f.parent.events.push({seq:++f.parent.seq,time:++clock,type,data})
      assert.equal(f.tracker.snapshot('lead').turnStatus,'completed')
      f.tracker.snapshot('lead')
      assert.equal(f.learned.length,0,'neither replay nor repeated historical UI reads train the estimator')
      f.emit(f.parent,'turn/start',{turn:2})
      f.emit(f.parent,'todo/write',{todos:[{content:'Write new file',status:'in_progress'}]})
      f.operation(f.parent,'write',{path:'new.js'})
      f.emit(f.parent,'todo/write',{todos:[{content:'Write new file',status:'completed'}]})
      f.emit(f.parent,'turn/end',{reason:{kind:'completed'}})
      assert.equal(f.learned.length,2,'one real item and one real turn each contribute one sample')
      f.tracker.snapshot('lead')
      f.tracker.snapshot('lead')
      assert.equal(f.learned.length,2,'snapshot reads cannot duplicate completed-work samples')
    }finally{f.dispose()}
  })

  console.log(`Local lifecycle alpha1: ${checks.length}/${checks.length} passed`)
}finally{Date.now=originalNow}
