/** Exercise the actual panel's input handlers and left/right expansion anchors. */
import assert from'node:assert/strict'
let definition,cursor=0,states=[],refs=[];const storage=new Map(),slots=[],cleanup=[]
globalThis.window={innerWidth:800,innerHeight:600,__ModuleLoader__:{load:d=>definition=d},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},addEventListener(){},removeEventListener(){}}
globalThis.document={hidden:false,querySelector(){return null},head:{appendChild(){}},createElement(){return{dataset:{},remove(){}}},addEventListener(){},removeEventListener(){}}
globalThis.fetch=async()=>({ok:true,json:async()=>({})})
const h=(type,props,...children)=>({type,props:props??{},children}),react={createElement:h,Fragment:Symbol(),useEffect(){},useCallback:fn=>fn,useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(initial){const i=cursor++;return refs[i]??={current:initial}}}
await import('../client.js');const module=definition.factory(()=>react)
module.apply({get(){},effect(fn){cleanup.push(fn());return()=>{}},slots:{inject(_,fn){fn();return()=>{}},register(options,component){slots.push({options,component});return()=>{}}}})
const wrapper=slots.find(s=>s.options.id==='dsh-task-progress-progress').component({}),store={getSnapshot:()=>({status:'ready',data:{progress:{sessionId:'drag',turn:1,running:false,turnStatus:'completed',projectBar:{},plan:{items:[],total:0},settings:{aiEnabled:false},commands:[],children:[]}}}),refresh(){}}
const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...n.children.flatMap(all)]
let tree,overlay,header,rect
const render=()=>{cursor=0;tree=wrapper.type({...wrapper.props,store});overlay=all(tree).find(n=>n.props.className==='dtp-overlay');header=all(tree).find(n=>n.props.className==='dtp-head');const small=all(tree).find(n=>n.props.className==='dtp-card').props['data-collapsed']==='1',width=small?112:Number.parseFloat(overlay.props.style['--dtp-expanded-width']);rect={left:typeof overlay.props.style.left==='number'?overlay.props.style.left:window.innerWidth-overlay.props.style.right-width,top:overlay.props.style.top,width,height:small?32:130};overlay.props.ref.current={getBoundingClientRect:()=>rect};return tree}
const button=name=>all(tree).find(n=>n.props['aria-label']===name)
const target={closest:()=>null},capture={setPointerCapture(){},releasePointerCapture(){}},event=(x,y,type='pointermove')=>({type,button:0,pointerId:1,clientX:x,clientY:y,target,currentTarget:capture,preventDefault(){}})
const start=()=>header.props.onPointerDown(event(rect.left+12,rect.top+12,'pointerdown'))
const dragTo=(x,y)=>{const initial={...rect};start();header.props.onPointerMove(event(x+12,y+12));render();return initial}
const finish=type=>{header.props[type](event(rect.left+12,rect.top+12,type==='onLostPointerCapture'?'lostpointercapture':'pointerup'));render()}
const home=()=>{header.props.onKeyDown({key:'Home',target:capture,currentTarget:capture,preventDefault(){}});render()}
try{
 render();dragTo(-500,-500);assert.equal(rect.left,8);assert.equal(rect.top,8);finish('onPointerUp');assert.equal(JSON.parse(storage.get('dsh-task-progress.panel.position.v2')).edge,8)
 dragTo(108,128);finish('onLostPointerCapture');assert.equal(rect.left,108,'capture loss commits the last input instead of restoring the origin');assert.equal(rect.top,128);finish('onPointerUp');assert.equal(rect.left,108,'a later pointer-up is harmless')
 dragTo(230,300);finish('onPointerCancel');assert.equal(rect.left,230,'pointer cancellation also keeps the drop');assert.equal(header.props.onDoubleClick,undefined,'rapid drag gestures cannot trigger double-click reset')
 const original={...rect};dragTo(8,8);header.props.onKeyDown({key:'Escape',target:capture,currentTarget:capture,preventDefault(){}});render();assert.equal(rect.left,original.left,'explicit Escape remains a deliberate rollback')
 const ignored={...event(20,20),target:{closest:()=>({})}};header.props.onPointerDown(ignored);header.props.onPointerMove(event(200,200));render();assert.equal(rect.left,original.left,'buttons never initiate dragging')
 home();button('收起').props.onClick();render();dragTo(648,188);finish('onPointerUp');const rightPill={...rect};assert.equal(overlay.props.style.right,40)
 button('展开').props.onClick();render();assert.equal(rect.width,352);assert.equal(overlay.props.style.right,40,'right-half panel expands left from its outer edge');assert.equal(rect.top,rightPill.top)
 button('收起').props.onClick();render();assert.equal(rect.left,rightPill.left,'collapse returns to the original right-hand pill')
 dragTo(40,100);finish('onPointerUp');button('展开').props.onClick();render();assert.equal(rect.left,40,'left-half panel expands right');button('收起').props.onClick();render();assert.equal(rect.left,40)
 window.innerWidth=500;states[states.findIndex(s=>s?.width===800&&s?.height===600)]={width:500,height:600};render();dragTo(180,100);finish('onPointerUp');button('展开').props.onClick();render();assert.equal(rect.left,140,'expanded projection fits the viewport');button('收起').props.onClick();render();assert.equal(rect.left,180,'fitting the expanded panel must not overwrite its compact anchor')
 home();assert.equal(storage.has('dsh-task-progress.panel.position.v2'),false);assert.equal(storage.has('dsh-task-progress.panel.position.v1'),false);assert.equal(overlay.props.style.right,10)
 console.log('panel drag checks passed: release/capture-loss/cancel persistence, no double-click reset, Escape, right/left expansion, round trips, non-destructive bounds, Home')
}finally{for(const fn of cleanup.reverse())if(typeof fn==='function')fn()}
