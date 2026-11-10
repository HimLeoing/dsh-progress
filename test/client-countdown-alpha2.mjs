/** Real client store normalization and real panel rendering; no model or native sessions. */
import assert from 'node:assert/strict'
let definition,cursor=0,states=[],refs=[],mono=0;const registrations=[],disposers=[],savedPerformance=globalThis.performance
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>mono}})
globalThis.window={__ModuleLoader__:{load(d){definition=d}},innerWidth:1200,innerHeight:800,localStorage:{getItem(){return '0'},setItem(){}},addEventListener(){},removeEventListener(){}}
globalThis.document={hidden:false,querySelector(){return null},head:{appendChild(){}},createElement(){return{dataset:{},remove(){}}},addEventListener(){},removeEventListener(){}}
const h=(type,props,...children)=>({type,props:props??{},children}),react={createElement:h,Fragment:Symbol(),useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(initial){const i=cursor++;return refs[i]??={current:initial}},useEffect(){},useCallback:fn=>fn}
const legacy={sessionId:'fixture',turn:1,running:true,turnStatus:'running',operations:{completed:3,failed:0},steps:3,plan:{items:[],done:0,total:0},projectBar:{elapsedMs:17000},commands:[{active:true,id:'op',name:'web_fetch',label:'source page',percent:.99,indeterminate:true}],display:{percent:0,percentKnown:false,indeterminate:true,source:'activity'},settings:{aiEnabled:false},children:[]}
globalThis.fetch=async()=>({ok:true,json:async()=>({plugin:{version:'0.1.0-rc1'},progress:legacy})})
await import('../client.js');const client=definition.factory(()=>react),ctx={get:key=>key==='locale'?{getLocale:()=>({id:'zh-CN'})}:undefined,effect(fn){disposers.push(fn());return()=>{}},slots:{inject(_name,fn){fn();return()=>{}},register(options,component){registrations.push({options,component});return()=>{}}}};client.apply(ctx)
const panel=registrations.find(r=>r.options.id==='dsh-task-progress-progress').component({}),realStore=panel.props.store
const raw=node=>Array.isArray(node)?node.flatMap(raw):!node||typeof node!=='object'?[]:[node,...(node.children??[]).flatMap(raw)],text=node=>node==null?'':Array.isArray(node)?node.map(text).join(' '):typeof node!=='object'?String(node):(node.children??[]).map(text).join(' ')
const render=snapshot=>{states=[];refs=[];cursor=0;return panel.type({...panel.props,store:{getSnapshot:()=>snapshot,subscribe:()=>()=>{},refresh(){}}})}
try{
 await new Promise(resolve=>setTimeout(resolve,0));const snap=realStore.getSnapshot(),p=snap.data.progress
 assert.equal(p.display.percentKnown,true);assert.equal(p.display.indeterminate,false);assert.ok(p.display.percent>0&&p.display.percent<.5,'main legacy fallback uses whole-task evidence, never command 99%');assert.equal(snap.data.compatibility.mismatch,true);assert.ok(p.display.remainingMs>0)
 let tree=render(snap),bar=raw(tree).find(n=>n.type?.name==='Bar'&&n.props.label==='任务进度');assert.equal(bar.props.shimmer,false);assert.match(text(tree),/≈\d+%/);assert.doesNotMatch(text(tree),/进行中 任务进度/)
 const fixture={...p,settings:{aiEnabled:true},commands:[],display:{...p.display,source:'model',percent:.5,remainingMs:40000,eta:{id:1,precision:'second'}}},base={status:'ready',receivedAt:Date.now(),receivedMono:0,data:{progress:fixture}}
 tree=render(base);assert.match(text(tree),/剩余≈40秒/);mono=1000;tree=render(base);assert.match(text(tree),/剩余≈39秒/)
 mono=999999;tree=render(base);assert.match(text(tree),/剩余≈1秒/);assert.doesNotMatch(text(tree),/剩余≈0秒/)
 mono=0;fixture.settings.aiEnabled=false;tree=render(base);assert.match(text(tree),/剩余≈<1分/);fixture.display.remainingMs=61000;tree=render(base);assert.match(text(tree),/剩余≈2分/)
 const time=raw(tree).find(n=>n.props.className==='dtp-task-times');assert.equal(time.children[0].props.className,'dtp-totalelapsed');assert.equal(time.children[1].props.className,'dtp-totalremaining')
 fixture.running=false;fixture.turnStatus='completed';tree=render(base);assert.equal(raw(tree).some(n=>n.props.className==='dtp-totalremaining'),false)
 fixture.running=true;fixture.turnStatus='running';fixture.settings.aiEnabled=true;fixture.display.remainingMs=40000;mono=999999;tree=render({...base,status:'stale'});assert.match(text(tree),/剩余≈40秒/,'disconnection freezes the last sampled countdown')
 console.log('client countdown alpha2 passed: real legacy-store fallback, determinate main, independent command, seconds/minutes, monotonic tick, floor, elapsed-left layout, completion and disconnect')
}finally{for(const fn of disposers.reverse())fn?.();Object.defineProperty(globalThis,'performance',{configurable:true,value:savedPerformance})}
