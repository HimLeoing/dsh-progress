import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createLearningStore,declaredDuration,durationKey,toolFamily} from '../lib/learning-store.js'
import {progressDisplay} from '../lib/progress-display.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-learning-')),file=path.join(home,'learning.json')
try{
 let store=createLearningStore(file)
 assert.notEqual(durationKey('/a','bash','{"command":"npm test"}'),durationKey('/a','bash','{"command":"npm install"}'))
 assert.notEqual(durationKey('/a','bash','{"command":"npm test"}'),durationKey('/b','bash','{"command":"npm test"}'))
 assert.equal(toolFamily('bash',{command:'pnpm run build'}),'shell:build')
 assert.equal(declaredDuration('bash',{command:'sleep 2.5'}),2500)
 assert.equal(declaredDuration('bash',{command:'sleep 2 && npm test'}),null,'a delay followed by other work is not a total duration')
 assert.equal(declaredDuration('bash',{command:`node -e "setTimeout(() => console.log('ok'), 24000)"`}),24000)
 assert.equal(declaredDuration('bash',{command:`node -e "setTimeout(() => fetch('example.com'), 24000)"`}),null,'arbitrary callback work must not be treated as a known duration')
 assert.notEqual(toolFamily('bash',{command:`node -e "console.log(1)"`}),toolFamily('bash',{command:`node -e "setTimeout(() => console.log('ok'), 24000)"`}))
 const k=durationKey('/a','bash',{command:'npm test'})
 for(const ms of [1000,1100,1200,90000])store.observeDuration(k,ms)
 assert.ok(store.duration(k).ms<2000,'one outlier must not turn a one-second command into a 30-second prediction')
 for(let i=0;i<20;i++)store.forecast('s',1,{route:'p:m',mode:'todos',at:i*1000,remainingMs:30000})
 store.finish({sid:'s',turn:1,status:'completed',at:60000})
 assert.equal(store.calibration('p:m','todos').samples,1,'one completed turn contributes one vote, not twenty')
 assert.equal(store.calibration('p:m','todos').factor,1,'small samples cannot alter real predictions')
 store.forecast('aborted',1,{route:'p:m',mode:'todos',at:0,remainingMs:10000})
 store.finish({sid:'aborted',turn:1,status:'interrupted',at:90000})
 assert.equal(store.calibration('p:m','todos').samples,1)
 for(let turn=2;turn<=10;turn++){
   store.forecast('s',turn,{route:'p:m',mode:'todos',at:0,remainingMs:30000})
   store.finish({sid:'s',turn,status:'completed',at:60000})
 }
 const c=store.calibration('p:m','todos')
 assert.equal(c.samples,10);assert.equal(c.applied,true);assert.equal(c.factor,1.5,'history correction is conservative and capped')
 assert.equal(store.calibration('other:model','todos').samples,0,'models do not share calibration votes')
 store.forecast('changed',1,{route:'changed-route',mode:'turn',at:0,remainingMs:30000,evidenceRevision:0})
 store.finish({sid:'changed',turn:1,status:'completed',at:60000,evidenceRevision:1})
 assert.equal(store.calibration('changed-route','turn').samples,0,'forecasts made before a scope change do not train calibration')
 for(let turn=1;turn<=10;turn++){
   store.forecast('alternating',turn,{route:'unstable',at:0,remainingMs:30000})
   store.finish({sid:'alternating',turn,status:'completed',at:turn%2?15000:60000})
 }
 assert.equal(store.calibration('unstable').applied,false,'inconsistent bias cannot enable a harmful correction')
 const view={running:true,turn:1,turnStatus:'running',projectBar:{mode:'todos'},model:{turn:1,at:1000,remainingMs:30000,percent:.5,route:'p:m',phase:'verify'}}
 const display=progressDisplay(view,{now:2000,learning:store})
 assert.equal(display.remainingMs,44000);assert.equal(display.source,'calibrated');assert.equal(display.phase,'verify')
 store.dispose();store=createLearningStore(file)
 assert.equal(store.duration(k).samples,4,'duration history survives restart')
 assert.equal(store.calibration('p:m','todos').samples,10,'calibration survives restart')
 store.dispose()
 fs.writeFileSync(file,JSON.stringify({version:1,durations:{bad:'oops'},calibrations:{bad:42}}))
 store=createLearningStore(file);assert.equal(store.duration('bad').samples,0);store.dispose()
 console.log('learning checks passed: command families, outliers, distinct turns, causal gating, restart, malformed cache')
}finally{fs.rmSync(home,{recursive:true,force:true})}
