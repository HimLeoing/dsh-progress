/** Exercise the real browser-store closure without rendering a mock UI. */
import assert from 'node:assert/strict'
let definition
const disposers=[],registrations=[],reactEffects=[]
globalThis.window={__ModuleLoader__:{load(value){definition=value}},addEventListener(){},removeEventListener(){},localStorage:{getItem(){return null}}}
globalThis.document={hidden:false,querySelector(){return null},head:{appendChild(){}},createElement(){return{dataset:{},remove(){}}},addEventListener(){},removeEventListener(){}}
const requests=[]
globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))
const react={createElement:(type,props)=>({type,props}),useState(){},useEffect(fn){reactEffects.push(fn())},useRef(){},useCallback:fn=>fn}
await import('../client.js')
const module=definition.factory(name=>{assert.equal(name,'react');return react})
module.apply({get(){},effect(fn){const dispose=fn();disposers.push(dispose);return()=>{}},slots:{inject(slot,fn){fn();return()=>{}},register(options,component){registrations.push({options,component});return()=>{}}}})
const panel=registrations.find(row=>row.options.id==='dsh-progress-progress')
const store=panel.component({}).props.store
const settle=()=>new Promise(resolve=>setTimeout(resolve,0))
const reply=(request,id,percent)=>request.resolve({ok:true,json:async()=>({progress:{sessionId:id,display:{percent},running:true}})})
try{
 const probe=registrations.find(row=>row.options.id==='dsh-progress-session').component({sessionId:'A'});probe.type(probe.props)
 const cleanupA=reactEffects.at(-1)
 reply(requests[0],'old',1);await settle()
 assert.ok(store.getSnapshot().data === null || store.getSnapshot().data.progress.sessionId === 'A','the previous context never appears while loading')
 assert.match(requests[1].url,/session=A/)
 store.setSession('B');reply(requests[1],'A',1);await settle()
 assert.match(requests[2].url,/session=B/)
 assert.notEqual(store.getSnapshot().data?.progress.sessionId,'A','late A responses cannot overwrite B')
 reply(requests[2],'B',.25);await settle()
 assert.equal(store.getSnapshot().data.progress.sessionId,'B')
 cleanupA()
 assert.equal(store.getSnapshot().data.progress.sessionId,'B','a late old view cleanup cannot clear the currently selected session')
 const received=store.getSnapshot().receivedAt
 const pending=store.refresh();requests[3].reject(new Error('offline'));await pending
 assert.equal(store.getSnapshot().status,'stale')
 assert.equal(store.getSnapshot().data.progress.display.percent,.25)
 assert.equal(store.getSnapshot().receivedAt,received,'a failed poll never resets the clock origin')
 const mount=id=>{const p=registrations.find(row=>row.options.id==='dsh-progress-session').component({sessionId:id});p.type(p.props);return reactEffects.at(-1)}
 const parentCleanup=mount('parent');reply(requests.at(-1),'parent',1);await settle()
 const childCleanup=mount('child');reply(requests.at(-1),'child',1);await settle();assert.equal(store.getSnapshot().data.progress.sessionId,'child')
 childCleanup();assert.match(requests.at(-1).url,/session=parent/,'closing a child transcript restores its still-mounted parent context');reply(requests.at(-1),'parent',1);await settle();assert.equal(store.getSnapshot().data.progress.display.percent,1)
 const duplicateCleanup=mount('parent');duplicateCleanup();assert.equal(store.getSnapshot().data.progress.sessionId,'parent','unmounting a duplicate session probe must not clear the remaining one')
 const blankCleanup=mount(null);reply(requests.at(-1),null,0);await settle();assert.equal(store.getSnapshot().data.progress.sessionId,null,'an explicit new chat still has an empty progress state');blankCleanup();reply(requests.at(-1),'parent',1);await settle();assert.equal(store.getSnapshot().data.progress.sessionId,'parent')
 parentCleanup();reply(requests.at(-1),null,0);await settle()
 store.stop();const count=requests.length;await store.refresh();assert.equal(requests.length,count)
 console.log('client-store checks passed: late responses, rapid navigation, offline snapshot, disposal')
}finally{for(const dispose of disposers.reverse())if(typeof dispose==='function')dispose()}
