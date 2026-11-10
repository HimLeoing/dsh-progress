import assert from 'node:assert/strict'
import {localProgress}from'../lib/local-progress.js'
const now=Date.now()
const view={turn:1,running:true,turnStatus:'running',evidenceRevision:0,observedPhase:'discover',plan:{items:[],done:0,total:0},projectBar:{},lastTool:{name:'read_image',label:'tmp/hands2.png',phase:'discover',finishedAt:now-60000,status:'completed'}}
assert.equal(localProgress(view).detailPhase,'previewing','inspecting the result must not masquerade as initial analysis, even during a long model step')
const plan={items:[{content:'实现主体',status:'completed'},{content:'运行测试',status:'completed'},{content:'最终检查与交付',status:'in_progress'}],done:2,total:3}
assert.equal(localProgress({...view,lastTool:{name:'read',phase:'discover'},plan}).detailPhase,'finishing','the last checklist item outranks a stale discovery phase')
assert.equal(localProgress({...view,plan,commands:[{name:'read',label:'src/main.js',phase:'discover'}]}).detailPhase,'finishing')
assert.equal(localProgress({...view,commands:[{name:'edit',label:'src/main.js',phase:'implement'}],lastTool:{status:'failed'}}).detailPhase,'fixing')
assert.equal(localProgress({...view,commands:[{name:'bash',label:'npm test',phase:'verify'}]}).detailPhase,'testing','actual tests override an old visual-inspection context')
assert.equal(localProgress({...view,preparing:{name:'write',label:'README.md'}}).detailPhase,'documenting')
assert.equal(localProgress({...view,commands:[{name:'bash',label:'npm install',phase:'implement'}]}).detailPhase,'installing')
assert.equal(localProgress({...view,commands:[{name:'bash',label:'npm run build',phase:'implement'}]}).detailPhase,'building')
assert.equal(localProgress({...view,commands:[{name:'present'}]}).detailPhase,'delivering')
const unknown={...view,lastTool:null,observedPhase:null,model:null};assert.equal(localProgress(unknown).detailPhase,'processing','no evidence does not imply near completion')
const ai={...unknown,model:{turn:1,at:now,evidenceRevision:0,phase:'deliver',percent:.92,confidence:2}}
assert.equal(localProgress(ai,{aiEnabled:true}).detailPhase,'finishing')
assert.notEqual(localProgress(ai,{aiEnabled:false}).detailPhase,'finishing','switching AI off ignores its old phase')
console.log('phase-v051 checks passed: final checklist, visual review, actual tools, repair, docs, no clock/extra model calls')
assert.equal(localProgress({...view,lastTool:{name:'read',phase:'discover',finishedAt:now-30000},preparing:{name:'run_code',label:'',elapsedMs:37000}}).detailPhase,'processing','unknown tool preparation must not inherit a stale reading stage')
assert.equal(localProgress({...unknown,observedPhase:'discover',lastTool:{name:'bash',label:'Read prior screenshot tooling',phase:'discover',status:'completed',finishedAt:now}}).detailPhase,'reading','reading screenshot source is not inspecting a rendered image')
assert.equal(localProgress({...unknown,observedPhase:'discover',commands:[{name:'bash',label:'Read prior screenshot tooling',phase:'discover'}]}).detailPhase,'reading')
