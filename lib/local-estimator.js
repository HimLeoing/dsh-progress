/** Event-based, bounded local estimates. No clock extrapolation and no model calls. */
import {normalizeWeights} from './weighted-progress.js'
const cap=(n,a=0,b=.99)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:0))
const phases=['discover','implement','verify','deliver']
const budgets={build:[.12,.62,.20,.06],research:[.64,.12,.16,.08],writing:[.18,.62,.12,.08],general:[.25,.5,.18,.07]}
const priors={build:[8,32,10,4],research:[28,6,8,4],writing:[8,18,6,4],general:[12,20,8,4]}
const hash=s=>{let n=2166136261;for(const c of String(s)){n^=c.charCodeAt(0);n=Math.imul(n,16777619)}return(n>>>0).toString(36)}
export function localTaskProfile(text=''){
 const t=String(text).split('EARLIER REQUEST')[0].slice(0,1200)
 const kind=/\b(?:implement|code|app|html|three\.?js|build|debug|refactor|website|circuit|pcb|hardware)\b|实现|编程|网页|开发|构建|修复|电路|硬件/iu.test(t)?'build':/\b(?:research|search|find|compare|investigate|download)\b|研究|查找|搜索|比较|调研|下载|搜集/iu.test(t)?'research':/\b(?:write|essay|article|report|document|readme)\b|撰写|写作|论文|文章|报告|文档/iu.test(t)?'writing':'general'
 const clauses=(t.match(/[;；\n]|\b(?:and|then|plus)\b|以及|并且/giu)??[]).length
 const complexity=cap(1+Math.min(2,clauses*.12+t.length/2400),1,3)
 return{kind,complexity,bucket:`${kind}:${complexity>=1.8?'large':complexity>=1.25?'medium':'small'}`}
}
function scope(text,learning,cwd,role='turn'){
 const profile=localTaskProfile(text),seed=priors[profile.kind].map(n=>n*profile.complexity),learned=learning?.localPrior?.(`${hash(cwd)}:${role}:${profile.bucket}`,seed)
 return{...profile,role,prior:learned?.units??seed,samples:learned?.samples??0,units:[0,0,0,0],successes:0,failures:0,material:0,verified:-1,strong:false,delivered:false,seen:{}}
}
export function createLocalEvidence(text='',options={}){return{version:1,root:scope(text,options.learning,options.cwd),items:{},keys:[],weights:[],signature:'',generation:0,trained:[],lastPercent:null}}
export function readLocalEvidence(value){
 const valid=s=>s&&budgets[s.kind]&&Array.isArray(s.units)&&s.units.length===4&&s.units.every(n=>Number.isFinite(n)&&n>=0&&n<=100000)&&Array.isArray(s.prior)&&s.prior.length===4&&s.prior.every(n=>Number.isFinite(n)&&n>0&&n<=1e6)
 if(value?.version!==1||!valid(value.root)||!value.items||typeof value.items!=='object'||Array.isArray(value.items))return null
 const clean=s=>({...s,units:s.units.slice(),prior:s.prior.slice(),seen:Object.fromEntries(Object.entries(s.seen??{}).slice(-128).filter(([,n])=>Number.isInteger(n)&&n>=0&&n<=4))})
 return{...value,root:clean(value.root),items:Object.fromEntries(Object.entries(value.items).slice(-128).filter(([,s])=>valid(s)).map(([k,s])=>[k,clean(s)])),keys:Array.isArray(value.keys)?value.keys.slice(0,128):[],weights:Array.isArray(value.weights)?value.weights.slice(0,128):[],trained:Array.isArray(value.trained)?value.trained.slice(-128):[],lastPercent:Number.isFinite(value.lastPercent)?cap(value.lastPercent):null}
}
export function setLocalGoal(evidence,text,options={}){if(evidence?.root?.successes===0)evidence.root=scope(text,options.learning,options.cwd)}
export function localItemKeys(items=[]){const counts=new Map();return items.map(item=>{const base=hash(JSON.stringify([item.id??null,String(item.content??'').slice(0,240),item.owner??null,item.blockedBy??[]])),n=counts.get(base)??0;counts.set(base,n+1);return`${base}:${n}`})}
/** Task status is deliberately excluded from identity; changes do not refit weights. */
export function syncLocalPlan(evidence,items=[],options={}){
 if(!evidence)return
 const visible=items.slice(0,128),keys=localItemKeys(visible),signature=JSON.stringify(keys),firstPlan=!evidence.keys.length&&visible.length>0&&Object.keys(evidence.items).length===0
 if(signature!==evidence.signature){
  evidence.generation++;evidence.signature=signature;evidence.keys=keys
  const explicit=normalizeWeights(options.weights,visible.length)??normalizeWeights(visible.map(i=>i.weight),visible.length)
  const effort=visible.map(item=>{const p=localTaskProfile(item.content);return p.complexity*(p.kind==='build'?1.5:p.kind==='research'?1.15:1)})
  evidence.weights=explicit??normalizeWeights(effort,effort.length)??[]
 }
 for(let i=0;i<keys.length;i++){
  const item=visible[i],key=keys[i];let s=evidence.items[key]
  if(!s)s=evidence.items[key]=scope(item.content,options.learning,options.cwd,'item')
  if(firstPlan&&item.status==='in_progress'&&!visible.some(item=>item.status==='completed')&&evidence.root.successes>0){const active=visible.filter(item=>item.status==='in_progress').length;s.units=evidence.root.units.map(n=>n/active);s.successes=evidence.root.successes/active;s.material=s.units[1]}
  if(s.status==='completed'&&item.status!=='completed'){s.units=[0,0,0,0];s.successes=0;s.material=0;s.verified=-1;s.strong=false;s.delivered=false;s.seen={};s.failures++;s.cycle=(s.cycle??0)+1}
  s.status=item.status
 }
 const active=new Set(keys);for(const key of Object.keys(evidence.items))if(!active.has(key))delete evidence.items[key]
}
export function bindLocalItems(evidence,items=[]){const keys=localItemKeys(items);return items.flatMap((item,i)=>item.status==='in_progress'&&evidence?.items[keys[i]]?[keys[i]]:[])}
/** Wider categories are estimates only; the strong host evidence classifier stays unchanged. */
export function localOperationPhase(name,raw,strongPhase,kind='general'){
 let args=raw;try{if(typeof args==='string')args=JSON.parse(args)}catch{args={}}
 if(kind==='build'&&['write','edit','apply_patch','write_file','edit_file'].includes(name)&&/\.(?:md|mdx|rst|txt)$/iu.test(String(args?.file_path??args?.path??'')))return'deliver'
 if(strongPhase)return strongPhase
 if(name==='present')return'deliver'
 const description=String(args?.description??''),command=String(args?.command??args?.cmd??'')
 if(/\b(?:verify|validate|validation|tests?|pytest|unittest|QA|acceptance)\b|校验|验证|回归|验收|测试/iu.test(description+' '+command.slice(0,800)))return'verify'
 if(/\b(?:curl|wget|fetch|download|search|list|ls|head|cat|grep|rg)\b|查找|搜索|读取/iu.test(description+' '+command.slice(0,100)))return'discover'
 return'implement'
}
function applyUnit(s,event,share=1){
 if(!s)return
 if(event.status==='failed'){s.failures++;s.verified=-1;s.strong=false;s.delivered=false;return}
 if(event.status!=='completed')return
 const name=String(event.name??''),label=String(event.label??'')
 if(/^(?:job_output|wait_agent|list_agents|send_message|team_task_(?:get|list|update|create)|spawn_teammate|todo_write|todo\/write|skill)$/u.test(name)||event.infinite)return
 const index=Math.max(0,phases.indexOf(event.phase)),key=hash(name+':'+(event.fingerprint??label)+(index===2?`:${s.material}:${s.failures}`:'')),count=s.seen[key]??0
 // Identical reads/commands have diminishing credit; repeated polls cannot fill a task.
 const limited=index===0||index===2||/^(?:read|read_file|read_image|grep|glob|web_fetch|web_search|assistant\/output)$/u.test(name)
 if(limited&&count>=4)return
 s.seen[key]=Math.min(4,count+1);const keys=Object.keys(s.seen);if(keys.length>128)delete s.seen[keys[0]]
 const credit=share*(event.credit??1)*(limited?1/(1+count):1)*(event.partial===true?cap(event.percent,0,.95)*.35:1)
 if(credit<=0)return
 s.units[index]=Math.min(100000,s.units[index]+credit);s.successes+=event.partial?0:share
 if(index===1){s.material+=credit;s.verified=-1;s.strong=false;s.delivered=false}
 if(index===2&&!event.partial){s.verified=s.material;s.strong=s.strong||/\b(?:final|acceptance|all tests|full suite|release check)\b|最终|验收|全部测试|全量回归/iu.test(label)}
 if(name==='present'&&!event.partial){s.delivered=true;s.units[3]=Math.max(s.units[3],1)}
}
export function recordLocalOperation(evidence,event){if(!evidence?.root)return;applyUnit(evidence.root,event);const owners=(event.owners??[]).filter(key=>evidence.items[key]);for(const key of owners)applyUnit(evidence.items[key],event,1/owners.length)}
export function estimateLocalScope(s){
 if(!s)return 0
 const b=budgets[s.kind]??budgets.general,u=s.units??[0,0,0,0],expected=s.prior??priors.general
 const f=u.map((n,i)=>1-Math.exp(-Math.log(10)*Math.max(0,n)/Math.max(1,expected[i]*(1+Math.min(3,s.failures??0)*.18))))
 const primary=s.kind==='research'?0:1
 // A successful check is evidence about work already produced, not proof of the whole request.
 if(s.verified===s.material&&u[2]>0&&u[primary]>=Math.min(2,expected[primary]*.2)){
  f[primary]=Math.max(f[primary],s.strong?.97:.82);f[2]=Math.max(f[2],s.strong?.95:.55)
  if(s.strong)f[0]=Math.max(f[0],.9)
 }
 if(s.delivered)return .985
 return cap(f.reduce((n,v,i)=>n+v*b[i],0))
}
/** Existing snapshots without new statistics get a conservative event-count seed, never a clock curve. */
function fallbackScope(view){
 const p=localTaskProfile(view.probe?.goal??view.task?.label??''),s=scope('',null,'');Object.assign(s,p);s.prior=priors[p.kind].map(n=>n*p.complexity)
 const count=Math.max(0,Math.min(100000,view.operations?.completed??0)),phase=view.observedPhase??view.lastTool?.phase??'discover',index=Math.max(0,phases.indexOf(phase));s.units[index]=count;s.successes=count;s.failures=view.operations?.failed??0;return s
}
export function localPlanFractions(view){
 const items=view.plan?.items??[],e=view.localEvidence,keys=localItemKeys(items)
 return items.map((item,i)=>{if(item.status==='completed')return 1;if(item.status!=='in_progress')return 0;const child=(view.children??[]).find(c=>item.owner&&(item.owner===c.id||item.owner===c.label));return child?cap(child.status==='completed'?1:child.display?.percent??child.localPercent??child.percent??0):estimateLocalScope(activeScope(e?.items?.[keys[i]],view.commands,keys[i]))})
}
function activeScope(s,commands=[],itemKey=null){
 if(!s)return s
 const copy={...s,units:s.units.slice(),seen:{...s.seen}}
 for(const row of commands)if(row.known&&!row.infinite&&['native','native-progress','frames','ffmpeg-frames','ffmpeg-time','tqdm'].includes(row.source)&&(!itemKey||row.localOwners?.includes(itemKey)))applyUnit(copy,{...row,status:'completed',partial:true},itemKey?1/Math.max(1,row.localOwners.length):1)
 return copy
}
export function weightedLocalFraction(weights,fractions){return fractions.reduce((n,p,i)=>n+(weights[i]??0)*cap(p,0,1),0)}
export function estimateLocalProgress(view){
 const e=view.localEvidence,s=e?.root??fallbackScope(view),items=view.plan?.items??[],total=view.plan?.total??0
 let own=estimateLocalScope(activeScope(s,view.commands)),weights=null,fractions=null,source='local-estimate'
 const full=total>0&&items.length===total
 const delegated=view.plan?.coverage==='delegated',distinct=!!view.children?.length&&view.ownPlan?.items?.length&&JSON.stringify(localItemKeys(view.ownPlan.items))!==JSON.stringify(localItemKeys(items))
 if(full){
  weights=e?.signature===JSON.stringify(localItemKeys(items))?normalizeWeights(e.weights,items.length):null
  weights??=normalizeWeights(items.map(i=>i.weight),items.length)??normalizeWeights(items.map(i=>{const p=localTaskProfile(i.content);return p.complexity*(p.kind==='build'?1.5:p.kind==='research'?1.15:1)}),items.length)
  fractions=localPlanFractions(view);const weighted=weightedLocalFraction(weights,fractions)
  if(!delegated&&!distinct){own=weighted;source='local-weighted'}else own=own*.3+weighted*.7
 }else if(total>0){own=cap((view.plan.done??0)/total);source='local-counts'}
 const children=view.children??[]
 if(children.length&&!(full&&(!distinct||delegated))){
  const childWeights=children.map(child=>localTaskProfile(child.label).complexity),sum=childWeights.reduce((a,b)=>a+b,0)
  const progress=children.reduce((n,c,i)=>n+childWeights[i]/sum*(c.status==='completed'?1:cap(c.display?.percentKnown?c.display.percent:c.localPercent??c.percent??0)),0)
  // Reserve the lead's integration/checks. Expanding a team cannot replace an established lead estimate with zero.
  const combined=.45*own+.55*progress
  own=Math.max(own*.8,combined,cap(e?.lastPercent??0)*.85)
 }
 const stage=s.delivered||s.units?.[3]>0&&s.verified===s.material?'deliver':s.verified===s.material&&s.units?.[2]>0?'verify':s.units?.[1]>0?'implement':'discover'
 return{percent:cap(own),weights,fractions,source,estimated:true,percentKnown:true,indeterminate:false,local:{method:'evidence-prior-v1',events:s.successes??0,failures:s.failures??0,samples:s.samples??0,kind:s.kind??'general',stage,scope:full?'complete-plan':total?'partial-plan':'turn'}}
}
export function trainLocalScope(evidence,learning,cwd,key,s,identity){
 if(!learning?.observeLocal||!s||s.successes<1)return
 const id=hash(identity);if(evidence.trained.includes(id))return
 learning.observeLocal(`${hash(cwd)}:${s.role}:${s.bucket}`,id,s.units);evidence.trained.push(id);if(evidence.trained.length>128)evidence.trained.shift()
}
