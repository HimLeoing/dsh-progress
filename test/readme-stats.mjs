import assert from 'node:assert/strict'
import {cumulativeDownloads} from '../scripts/download-series.mjs'

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
console.log('README download statistics passed: cumulative counts, corrections, lifetime retention, UTC gaps and invalid data')
