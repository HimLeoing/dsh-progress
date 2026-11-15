import assert from 'node:assert/strict'
import {cumulativeDownloads,statisticsChanged} from '../scripts/download-series.mjs'

const days=[{date:'2026-11-13',count:288},{date:'2026-11-14',count:12},{date:'2026-11-15',count:0}]
assert.deepEqual(cumulativeDownloads(days).map(x=>x.count),[288,300,300])
assert.deepEqual(cumulativeDownloads([{...days[0],count:290},...days.slice(1)]).map(x=>x.count),[290,302,302])
const long=Array.from({length:400},(_,i)=>({date:new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10),count:1}))
assert.equal(cumulativeDownloads(long).slice(-366).at(-1).count,400)
assert.throws(()=>cumulativeDownloads([days[0],days[2]]),/Incomplete/)
assert.throws(()=>cumulativeDownloads([days[1],days[0]]),/unordered/)
assert.throws(()=>cumulativeDownloads([{date:'2026-02-30',count:1}]),/Invalid/)
assert.throws(()=>cumulativeDownloads([{date:'2026-11-13',count:-1}]),/Invalid/)
assert.deepEqual(cumulativeDownloads([]),[])
assert.deepEqual(cumulativeDownloads([{date:'2026-11-12',count:0},{date:'2026-11-13',count:288},{date:'2026-11-14',count:248}]).map(x=>x.count),[0,288,536])
const snapshot={stars:[{date:'2026-11-15',count:1}],downloads:days,npmAvailable:true,npmDataThrough:'2026-11-15'}
assert.equal(statisticsChanged(snapshot,{...snapshot,updatedAt:'later',chartsUpdatedAt:'later'}),false)
assert.equal(statisticsChanged(snapshot,{...snapshot,downloads:[...days,{date:'2026-11-16',count:1}]}),true)
assert.equal(statisticsChanged(snapshot,{...snapshot,stars:[{date:'2026-11-15',count:2}]}),true)
assert.equal(statisticsChanged(snapshot,{...snapshot,npmAvailable:false}),true)
console.log('README download statistics passed: cumulative counts, corrections, lifetime retention, UTC gaps, 536 total and unchanged polls')
