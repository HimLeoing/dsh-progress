/** Render the actual panel's element tree to check visibility, without a mock page. */
import assert from 'node:assert/strict'
let definition,cursor=0,states=[],refs=[]
const registrations=[],disposers=[]
globalThis.window={__ModuleLoader__:{load(value){definition=value}},localStorage:{getItem(){return '0'},setItem(){}},addEventListener(){},removeEventListener(){}}
globalThis.document={hidden:false,querySelector(){return null},head:{appendChild(){}},createElement(){return{dataset:{},remove(){}}},addEventListener(){},removeEventListener(){}}
globalThis.fetch=async()=>({ok:true,json:async()=>({})})
const h=(type,props,...children)=>({type,props:props??{},children})
const react={createElement:h,Fragment:Symbol('Fragment'),useEffect(){},useCallback:fn=>fn,
 useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}]},
 useRef(initial){const i=cursor++;return refs[i]??=( {current:initial})}}
await import('../client.js')
const module=definition.factory(()=>react)
const ctx={get(key){if(key==='locale')return{getLocale:()=>({id:'zh-CN'})}},effect(fn){disposers.push(fn());return()=>{}},slots:{inject(slot,fn){fn();return()=>{}},register(options,component){registrations.push({options,component});return()=>{}}}}
module.apply(ctx)
const wrapper=registrations.find(row=>row.options.id==='dsh-task-progress-progress').component({})
const now=Date.now()
let progress={sessionId:'panel',turn:1,running:true,turnStatus:'running',startedAt:now-120000,projectBar:{mode:'todos',elapsedMs:120000,done:1,total:3},display:{percent:.45,remainingMs:90000,known:true,source:'model',state:'running',phase:'implement',ageMs:2000,updatedAt:now-2000,calibrationSamples:1},plan:{done:1,total:3,items:[{content:'Build the scene',status:'completed'},{content:'Validate the result',status:'in_progress'},{content:'Deliver',status:'pending'}]},commands:[],children:[],lastTool:{name:'read',label:'README.md',ms:21,status:'completed'}}
let worker=null,selectedWorker=null
let storeStatus='ready'
const store={getSnapshot:()=>({status:storeStatus,receivedAt:now,data:{progress,worker}}),setWorker(id){selectedWorker=id},refresh(){}}
const render=()=>{const i=states.findIndex(value=>value?.data?.progress);if(i>=0)states[i]=store.getSnapshot();cursor=0;return wrapper.type({...wrapper.props,store})}
const nodes=node=>node===null||node===undefined||typeof node==='boolean'?[]:Array.isArray(node)?node.flatMap(nodes):typeof node!=='object'?[node]:typeof node.type==='function'?nodes(node.type(node.props)):[node,...node.children.flatMap(nodes)]
const text=node=>nodes(node).filter(value=>typeof value==='string'||typeof value==='number').join(' ')
const button=(tree,label)=>nodes(tree).find(node=>node?.type==='button'&&(node.props['aria-label']===label||text(node)===label))
try{
 let tree=render()
 assert.doesNotMatch(text(tree),/AI估计 · 仅供参考|任务进度（估计）|本轮请求/,'remove the redundant main-panel copy')
 const head=nodes(tree).find(n=>n?.props?.className==='dtp-head');const aiSwitch=nodes(head).find(n=>n?.props?.role==='switch');assert.ok(aiSwitch,'AI switch belongs in the header');assert.equal(text(aiSwitch),'AI辅助');assert.equal(aiSwitch.props['aria-checked'],false)
 const meta=nodes(tree).find(n=>n?.props?.className==='dtp-totalmeta');assert.match(text(meta),/README.md/,'recent operation belongs immediately below the total bar');assert.equal(nodes(tree).some(n=>n?.props?.className==='dtp-recent'),false)
 assert.match(text(tree),/README.md/,'the previous operation is visible before expanding details')
 assert.doesNotMatch(text(tree),/模型预测|前更新|历史校准样本/,'diagnostics must not clutter the default card')
 const details=button(tree,'任务详情');assert.ok(details,'task details have a dedicated button');details.props.onClick();tree=render()
 assert.match(text(tree),/Validate the result/)
 const cadence=nodes(tree).find(n=>n?.type==='select'&&n.props['aria-label']==='评估节奏');assert.equal(cadence.props.value,'balanced');assert.match(text(cadence),/智能均衡.*隔步省费.*逐步精细/,'mode choices stay inside one-click details')
 assert.equal(button(tree,'预测诊断'),undefined,'no redundant diagnostic disclosure button')
 assert.equal(nodes(tree).filter(n=>n?.props?.className==='dtp-metric').length,4);assert.match(text(tree),/本轮费用 ≈/);assert.doesNotMatch(text(tree),/AI开启|实际完成|\bOff\b|剩余约|历史校准样本/,'the removed diagnostic strip stays hidden')
 progress={...progress,display:{...progress.display,phase:'verify',state:'retrying',percentKnown:true},preparing:{name:'write',label:'scene.js',elapsedMs:2000}}
 tree=render();assert.match(text(tree),/检查与验证/,'forecast retry does not replace the actual work phase')
 assert.match(text(tree),/准备写入文件/,'a generated call is shown as preparation rather than execution')
 assert.doesNotMatch(text(tree),/历史校准样本/)
 assert.ok(nodes(tree).some(n=>n?.props?.role==='progressbar'&&n.props['aria-valuenow']===undefined),'preparation uses a genuine indeterminate activity bar')
 progress={...progress,display:{percent:0,percentKnown:false,indeterminate:true,phase:'implement',source:'activity',state:'running'},children:[{id:'a',label:'Builder',status:'running',display:{percent:.25,percentKnown:true,source:'plan'},current:{name:'write',label:'src/main.js'},elapsedMs:2000},{id:'b',label:'Tester',status:'running',display:{percentKnown:false},elapsedMs:1000},{id:'c',label:'Reviewer',status:'completed',display:{percent:1,percentKnown:true}}]}
 tree=render();assert.match(text(tree),/Builder/);assert.match(text(tree),/25%/);assert.match(text(tree),/100%/);assert.doesNotMatch(text(tree),/剩余约/)
 const workers=nodes(tree).filter(n=>n?.props?.className==='dtp-worker');assert.equal(workers.length,3,'three workers share a responsive card grid')
 button(tree,'任务详情').props.onClick();tree=render();assert.doesNotMatch(text(tree),/Build the scene/,'team checklist stays hidden until task details opens');assert.equal(nodes(tree).filter(n=>n?.props?.className==='dtp-worker').length,3,'compact worker cards stay visible');button(tree,'任务详情').props.onClick();tree=render();assert.match(text(tree),/Build the scene/,'task details reveals the full team checklist')
 assert.equal(nodes(tree).find(n=>n?.props?.role==='switch').props['aria-checked'],false,'AI is visibly off by default')
 progress={...progress,plan:{items:[],done:0,total:0},settings:{aiEnabled:true,aiScope:'all'},display:{...progress.display,detailPhase:'previewing'}}
 tree=render();assert.match(text(tree),/检查效果/);assert.doesNotMatch(text(tree),/本轮没有任务清单/);assert.equal(text(nodes(tree).find(n=>n?.props?.role==='switch')),'AI辅助');assert.equal(nodes(tree).find(n=>n?.props?.role==='switch').props['aria-checked'],true)
 progress={...progress,running:false,turnStatus:'completed',observer:{history:[{at:now-120000,step:4,percent:.9,kind:'probe',ownerLabel:'Builder'}],turnUsage:{requests:1}}};tree=render();assert.doesNotMatch(text(tree),/秒前|分.*前/,'relative observation ages are hidden after completion');assert.match(text(tree),/Builder · 第4步/,'worker observations retain their source')
 progress={...progress,observer:{...progress.observer,history:[{at:now,step:5,percent:1,kind:'probe'}]}};tree=render();assert.match(text(tree),/清单已完/);assert.doesNotMatch(text(tree),/≈100%/,'a finished checklist observation is not shown as predicted task completion')
 storeStatus='stale';tree=render();assert.equal((text(tree).match(/连接中断，保留上次进度/g)??[]).length,1,'disconnection message appears exactly once');storeStatus='ready';progress={...progress,observer:{...progress.observer,turnUsage:{requests:2,pricedRequests:2,unpricedRequests:0,costCny:.025}}};tree=render();assert.match(text(tree),/¥0.025/,'fee tile shows probe-only turn cost')
 progress={...progress,running:true,turnStatus:'running',projectBar:{mode:'agents',elapsedMs:2000},display:{percent:.62,percentKnown:true,estimated:true},commands:[{id:'x',name:'bash',label:'Main validation',elapsedMs:50}],children:[]};
 for(let count=1;count<=6;count++){progress.children=Array.from({length:count},(_,i)=>({id:'w'+i,label:'Worker '+i,status:'running',elapsedMs:1000,elapsedBasis:'cumulative',display:{percent:.1*(i+1),percentKnown:true}}));tree=render();const grid=nodes(tree).find(n=>n?.props?.className==='dtp-workers');assert.equal(nodes(tree).filter(n=>n?.props?.className==='dtp-worker').length,count);assert.equal(grid.props.style.gridTemplateColumns,'repeat('+(count===1?1:count===2||count===4?2:3)+',minmax(0,1fr))');const all=nodes(tree);assert.ok(all.findIndex(n=>n?.props?.className==='dtp-block')<all.findIndex(n=>n?.props?.className==='dtp-children'),'main operation precedes worker cards')}
 button(tree,'Worker 0 · 查看子任务进度').props.onClick();assert.equal(selectedWorker,'w0');worker={sessionId:'w0',turn:1,running:true,turnStatus:'running',label:'Worker 0',projectBar:{elapsedMs:1000},plan:{items:[],total:0},children:[],display:{percent:.2,percentKnown:true,estimated:true}};tree=render();assert.match(text(tree),/20%/);assert.equal(nodes(tree).filter(n=>n?.props?.className==='dtp-worker').length,0,'worker detail does not recurse into deeper agents');button(tree,'‹ 主任务').props.onClick();tree=render();assert.match(text(tree),/62%/);assert.equal(progress.sessionId,'panel','drill-down preserves the native main context');assert.equal(selectedWorker,null)
 progress={...progress,display:{percent:0,percentKnown:false,retainedPercent:.62,estimated:true,state:'recalculating'}};tree=render();assert.match(text(tree),/≈62%/,'a brief reassessment retains the last valid main percentage');assert.ok(nodes(tree).some(n=>n?.props?.title==='保留上次有效估计，正在更新'))
 progress={...progress,children:[{id:'r',label:'Rechecking',status:'running',display:{percent:.45,percentKnown:false,retainedPercent:.22,estimated:true},current:{name:'run_code',preparing:true}}]};tree=render();const ring=nodes(tree).find(n=>n?.props?.className==='dtp-worker-ring');assert.equal(ring.props['aria-valuenow'],22,'card ring retains the same valid number as the child detail header');assert.match(text(tree),/准备执行工具/);assert.match(ring.props['aria-valuetext'],/更新/)
 progress={...progress,observer:{history:Array.from({length:32},(_,i)=>({at:now-100000+i*1000,step:i+1,percent:(i+1)/40,kind:'probe'}))},settings:{aiEnabled:false,cadence:'balanced'},display:{percent:.8,percentKnown:true,estimated:true,source:'local-bridge',historicalAi:{percent:.7,turn:1}},commands:[{id:'service',name:'bash',label:'Local preview',elapsedMs:5000,source:'service-ready',infinite:true,state:'service',known:false}]};tree=render()
 assert.match(text(tree),/上次 AI 估计 ≈70%/);assert.match(text(tree),/当前按清单衔接/);assert.match(text(tree),/常驻服务 ∞/)
 const scroller=nodes(tree).find(n=>n?.props?.className==='dtp-trend-scroll');assert.ok(scroller);assert.equal(scroller.props.tabIndex,0);const chart=nodes(scroller).find(n=>n?.type==='svg');assert.ok(Number.parseInt(chart.props.style.width)>280,'long history has a genuine horizontal canvas');assert.equal(nodes(chart).filter(n=>n?.type==='title').length,32,'every numeric observation has a point tooltip');assert.ok(nodes(chart).some(n=>n?.props?.['aria-label']==='第32步 · ≈80%'),'hover and keyboard labels preserve step and percentage')
 console.log('client-panel checks passed: concise default, one-click checklist and diagnostics, worker drill-down and 1–6 layouts')
}finally{for(const dispose of disposers.reverse())if(typeof dispose==='function')dispose()}
