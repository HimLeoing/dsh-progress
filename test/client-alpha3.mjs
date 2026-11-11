import assert from 'node:assert/strict'
let definition,cursor=0,states=[],refs=[],effects=[];const registrations=[],disposers=[],requests=[]
let rows=[],active=[],mutation
const listeners=new Map()
globalThis.window={__ModuleLoader__:{load(d){definition=d}},innerWidth:1100,innerHeight:800,localStorage:{getItem(){return null},setItem(){}},addEventListener(){},removeEventListener(){}}
globalThis.MutationObserver=class{constructor(fn){mutation=fn}observe(){}disconnect(){}}
globalThis.document={body:{},activeElement:null,hidden:false,querySelector(){return null},querySelectorAll(selector){return selector.startsWith('nav ')?active:rows},head:{appendChild(){}},createElement(){return{dataset:{},remove(){}}},addEventListener(name,fn){listeners.set(name,fn)},removeEventListener(name){listeners.delete(name)}}
globalThis.fetch=async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({progress:{sessionId:'S',turn:Number(new URL(url,'http://local').searchParams.get('turn'))||3,turnStatus:'completed',display:{percent:1,percentKnown:true}}})}}
const h=(type,props,...children)=>({type,props:props??{},children}),react={createElement:h,Fragment:Symbol(),useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(initial){const i=cursor++;return refs[i]??={current:initial}},useEffect(fn){effects.push(fn)},useCallback:fn=>fn}
await import('../client.js');definition.factory(()=>react).apply({effect(fn){disposers.push(fn());return()=>{}},get(){},slots:{inject(key,fn){fn();return()=>{}},register(options,component){registrations.push({options,component});return()=>{}}}})
const panel=registrations.find(r=>r.options.id==='dsh-task-progress-progress').component({}),store=panel.props.store
const settle=()=>new Promise(resolve=>setTimeout(resolve,0)),waitRead=()=>new Promise(resolve=>setTimeout(resolve,100))
const raw=node=>!node||typeof node!=='object'?[]:[node,...(node.children??[]).flatMap(raw)]
const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join(' ')
const row=(turn,top)=>({getAttribute:()=>String(turn),getBoundingClientRect:()=>({top,width:600,height:200}),closest:()=>null})
try{
 await settle();store.setSession('S');store.setObserving(true);await settle()
 rows=[row(1,0),row(2,300),row(3,600)]
 const sessionProbe=registrations.find(r=>r.options.id==='dsh-task-progress-session').component({sessionId:'S'});sessionProbe.type(sessionProbe.props);const cleanup=effects.at(-1)()
 await waitRead();assert.match(requests.at(-1).url,/turn=1/);assert.match(requests.at(-1).url,/foreground=1/,'reading history must not turn off live foreground observation')
 active=[{getAttribute:()=> '跳转到第 2 轮',getBoundingClientRect:()=>({width:20,height:10})}];mutation();await waitRead();assert.match(requests.at(-1).url,/turn=2/,'native minimap current marker changes selected turn')
 const n=requests.length;mutation();await waitRead();assert.equal(requests.length,n,'unchanged reading turn must not fetch again')
 active=[];rows[0].closest=selector=>selector==='[data-chat-following-tail]'?{}:null;listeners.get('scroll')();await waitRead();assert.doesNotMatch(requests.at(-1).url,/&turn=/,'following the tail resumes latest-turn mode')
 cleanup();store.stop();rows=[]
 const progress={sessionId:'S',turn:3,running:false,turnStatus:'completed',settings:{aiEnabled:false,developerMode:true},display:{percent:1,percentKnown:true},projectBar:{elapsedMs:100},plan:{items:[],done:0,total:0},children:[],observer:{}}
 const fixture={getSnapshot:()=>({status:'ready',data:{progress,plugin:{version:'0.1.1-alpha3'},update:{available:true,version:'0.1.1-rc1'}}}),refresh:async()=>{}}
 states=[];refs=[];const render=()=>{cursor=0;return panel.type({...panel.props,store:fixture})}
 let tree=render();raw(tree).find(n=>n.props['aria-label']==='任务详情'||n.props['aria-label']==='Task details').props.onClick();tree=render()
 assert.match(text(tree),/v0.1.1-alpha3/)
 assert.ok(raw(tree).some(n=>n.type?.name==='ProbeDebug'))
 const footer=raw(tree).find(n=>n.props?.className==='dtp-footer'),developer=raw(footer).find(n=>n.props?.role==='switch')
 assert.ok(developer,'developer mode is a footer switch beside the version')
 assert.equal(developer.props.className,'dtp-ai-toggle','developer mode shares AI toggle styling')
 assert.equal(developer.props['aria-checked'],true)
 assert.equal(raw(tree).some(n=>n.type==='input'&&n.props.type==='checkbox'),false,'no standalone developer checkbox row')
 await developer.props.onClick();assert.equal(requests.at(-1).url,'/dsh-task-progress/preferences');assert.equal(JSON.parse(requests.at(-1).options.body).developerMode,false)
 const debug=raw(tree).find(n=>n.type?.name==='ProbeDebug'),panelStates=states,panelRefs=refs;states=[];refs=[];cursor=0
 let debugTree=debug.type(debug.props);assert.equal(raw(debugTree).find(n=>n.props?.className==='dtp-debug-records').props.role,'region')
 const originalFetch=globalThis.fetch
 const record={id:'test',sessionId:'session-12345678-abcd-5678',rootSessionId:'root',actorLabel:'session-12345678-abcd-5678',step:4,input:{content:'full input'},output:{content:'full output'}}
 globalThis.fetch=async()=>({ok:true,json:async()=>({records:[record]})})
 await raw(debugTree).find(n=>n.type==='button').props.onClick();cursor=0;debugTree=debug.type(debug.props);globalThis.fetch=originalFetch
 const entry=raw(debugTree).find(n=>n.type?.name==='ProbeDebugRecord');states=[];refs=[];cursor=0;let recordTree=entry.type(entry.props)
 assert.doesNotMatch(text(recordTree),/session-12345678-abcd-5678/,'summary never exposes a long session id')
 assert.ok(text(recordTree).includes('#'+record.sessionId.slice(-6)))
 assert.equal(raw(recordTree).some(n=>n.type==='pre'),false,'closed log rows do not render full payload')
 recordTree.props.onToggle({currentTarget:{open:true}});cursor=0;recordTree=entry.type(entry.props);assert.match(text(recordTree),/full input/);assert.match(text(recordTree),/full output/)
 states=panelStates;refs=panelRefs
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../client.js',import.meta.url),'utf8')
 assert.match(source,/\.dtp-debug\{height:196px;box-sizing:border-box;display:flex/,'log box has a fixed compact total height')
 assert.match(source,/\.dtp-debug-records\{flex:1;min-height:0;overflow-y:scroll;/,'log contents scroll without expanding the panel')

 let update=raw(tree).find(n=>/^(更新插件|Update plugin)$/.test(n.props['aria-label']??''));assert.ok(update)
 const before=requests.length;await update.props.onClick();tree=render();assert.equal(requests.length,before,'first update click only arms confirmation')
 update=raw(tree).find(n=>/^(确认更新插件|Confirm plugin update)$/.test(n.props['aria-label']??''));assert.ok(update);await update.props.onClick();assert.equal(requests.at(-1).url,'/dsh-task-progress/update/apply');assert.equal(requests.at(-1).options.method,'POST')
 progress.unavailable=true;progress.historical=true;tree=render();assert.match(text(tree),/未记录此轮进度|No progress recorded/);assert.match(text(tree),/未记录|Not recorded/)
 console.log('client alpha3 passed: passive reading/minimap selection, live foreground preserved, deduped updates, latest tail, version/developer UI, two-click install, unavailable history')
}finally{store.stop();for(const dispose of disposers.reverse())dispose?.()}
