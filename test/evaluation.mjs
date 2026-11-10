import assert from 'node:assert/strict'
import { evaluateProbes } from '../lib/evaluation.js'
const records = [
  { kind: 'probe', sid: 's', turn: 1, at: 1000, modelEtaMs: 2000, heuristicEtaMs: null, inputTokens: 10, cacheReadTokens: 90, outTokens: 9 },
  { kind: 'probe', sid: 's', turn: 1, at: 2000, modelEtaMs: null, heuristicEtaMs: 1200 },
  { kind: 'end', sid: 's', turn: 1, at: 3000, status: 'completed' },
  { kind: 'end', sid: 's', turn: 1, at: 5000 }, // legacy observer notices idle late
  { kind: 'probe', sid: 's', turn: 2, at: 6000, modelEtaMs: 10000 },
  { kind: 'end', sid: 's', turn: 2, at: 7000, status: 'interrupted' },
]
const report = evaluateProbes(records)
assert.equal(report.samples, 2, 'aborts never train or score completion ETA')
assert.equal(report.model.maeMs, 0, 'an exact durable end wins over an idle poll')
assert.equal(report.model.samples, 1, 'missing estimate is not coerced into zero')
assert.equal(report.model.coverage,.5,'accuracy reports disclose how often a numeric prediction was available')
assert.equal(report.heuristic.maeMs, 200)
assert.equal(report.usage.inputTokens, 10, 'cache and input are disjoint DSH counters')
assert.equal(report.usage.cacheReadTokens, 90)
const legacy = evaluateProbes([{kind:'probe', inTokens:12, outTokens:9, cacheReadTokens:100}])
assert.equal(legacy.usage.inputTokens, 12)
assert.equal(legacy.usage.outputTokens, 9)
console.log('evaluation checks passed')
