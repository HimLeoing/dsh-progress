import assert from 'node:assert/strict'
let definition,cursor=0,states=[],refs=[],effects=[];const registrations=[],disposers=[]
globalThis.window={__ModuleLoader__:{load(d){definition=d}},innerWidth:1100,innerHeight:800,localStorage:{getItem(){return null},setItem(){}},addEventListener(){},removeEventListener(){}}
globalThis.document={activeElement:null,hidden:false,querySelector(){return null},head:{appendChild(){}},createElement(){return{dataset:{},remove(){}}},addEventListener(){},removeEventListener(){}}
globalThis.fetch=async()=>({ok:true,json:async()=>({})})
const h=(type,props,...children)=>({type,props:props??{},children}),react={createElement:h,Fragment:Symbol(),useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(initial){const i=cursor++;return refs[i]??={current:initial}},useEffect(fn){effects.push(fn)},useCallback:fn=>fn}
await import('../client.js');const client=definition.factory(()=>react);client.apply({effect(fn){disposers.push(fn());return()=>{}},get(){},slots:{inject(key,fn){fn();return()=>{}},register(options,component){registrations.push({options,component});return()=>{}}}})
const panel=registrations.find(r=>r.options.id==='dsh-progress-progress').component({}),progress={sessionId:'fixture',turn:1,running:true,turnStatus:'running',settings:{aiEnabled:true},display:{percent:.55,percentKnown:true},projectBar:{elapsedMs:100},plan:{items:[],total:0,done:0},children:[],observer:{history:[{owner:'worker-long',ownerLabel:'old label',step:67,percent:.55,at:1}]}}
const store={getSnapshot:()=>({status:'ready',data:{progress}}),refresh(){}}
cursor=0;let panelTree=panel.type({...panel.props,store});const raw=node=>!node||typeof node!=='object'?[]:[node,...(node.children??[]).flatMap(raw)];const details=raw(panelTree).find(n=>n.props?.['aria-label']==='Task details'||n.props?.['aria-label']==='任务详情');details.props.onClick();cursor=0;panelTree=panel.type({...panel.props,store});const trend=raw(panelTree).find(n=>n.type?.name==='ProgressTrend');assert.ok(trend)
const name='Teammate building the procedural scene · architecture and final validation';const props={...trend.props,workers:[{id:'worker-long',label:name}]};states=[];refs=[];const render=()=>{cursor=0;return trend.type(props)},text=n=>!n?'':typeof n==='string'?n:(n.children??[]).map(text).join(' ')
try{
 window.HTMLElement={prototype:{showPopover(){}}}
 let tree=render(),point=raw(tree).find(n=>n.type==='circle'&&n.props.tabIndex===0)
 const target={getBoundingClientRect:()=>({left:1040,top:570,bottom:590})}
 point.props.onMouseEnter({currentTarget:target});tree=render()
 assert.equal(raw(tree).some(n=>n.props.role==='tooltip'),false,'pointer hover uses only the native title tooltip')
 assert.match(text(raw(tree).find(n=>n.type==='title')),/67.*55%/)
 point.props.onFocus({currentTarget:target});tree=render()
 const tooltip=raw(tree).find(n=>n.props.role==='tooltip')
 assert.ok(tooltip,'keyboard focus must render a numeric tooltip')
 assert.equal(raw(tree).some(n=>n.type==='title'),false,'native title is suppressed while the keyboard tooltip is visible')
 assert.equal(tooltip.props.popover,'manual','tooltip must enter the top layer instead of the backdrop-filter card containing block')
 assert.match(text(tooltip),/67.*55%/)
 assert.match(text(tooltip),/architecture and final validation/)
 let opened=0,closed=0
 const node={style:{},showPopover(){opened++},hidePopover(){closed++},getBoundingClientRect:()=>({width:240,height:68})};tooltip.props.ref.current=node
 const cleanup=effects.at(-2)();assert.equal(opened,1,'the real tooltip effect opens the native top layer');assert.ok(parseFloat(node.style.left)+240<=window.innerWidth-8);assert.ok(parseFloat(node.style.top)+68<=window.innerHeight-8);cleanup();assert.equal(closed,1,'unmount closes the top-layer element')
 assert.ok(tooltip.props.style.left<=window.innerWidth-8,'tooltip is initially constrained to the viewport')
 point=raw(tree).find(n=>n.type==='circle'&&n.props.tabIndex===0)
 point.props.onKeyDown({key:'Escape'});assert.equal(raw(render()).some(n=>n.props.role==='tooltip'),false)
 window.HTMLElement={prototype:{}}
 point.props.onFocus({currentTarget:target});tree=render()
 const fallback=raw(tree).find(n=>n.props.role==='tooltip')
 assert.equal(fallback.props.popover,undefined,'unsupported browsers retain an inline visible fallback')
 assert.equal(fallback.props.style.position,'relative','fallback cannot inherit the old off-screen fixed coordinates')
 assert.match(text(fallback),/55%/)
 console.log('trend top-layer passed: backdrop-filter/overflow escape, pointer and focus, keyboard dismissal, visible fallback')
}finally{for(const dispose of disposers.reverse())dispose?.()}
