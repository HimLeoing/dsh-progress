/**
 * Scheduler simulation — run with `node test/probe-sim.mjs`.
 *
 * Drives the real scheduler with a fake clock, a fake probe and a fake 10-minute
 * turn, and checks the two things that matter: it probes every `intervalMs`
 * while the answer is moving, and it backs off (bounded) while the answer is
 * stuck. Also prints the MAE of the model answer against the heuristic one.
 */
import assert from 'node:assert/strict'
import { createProbeScheduler } from '../lib/probe-scheduler.js'

const TOTAL_MS = 600_000
const HEURISTIC_ETA = 240_000

/** Same loop, but actually awaiting each tick. */
async function simulateAsync(options) {
  let clock = 0
  const records = []
  let calls = 0
  const probe = {
    available: true,
    async ask() {
      calls += 1
      const { percent, eta } = options.answerFor(clock)
      return { percent, remainingMs: eta, usage: { inputTokens: 130, outputTokens: 12 }, latencyMs: 800 }
    },
  }
  const snapshot = () => {
    const running = clock < options.durationMs
    const elapsedMs = Math.min(clock, options.durationMs)
    const curve = 1 - Math.exp(-elapsedMs / HEURISTIC_ETA)
    return {
      running,
      turn: 1,
      projectBar: { mode: 'turn', percent: Math.min(0.98, curve), remainingMs: HEURISTIC_ETA * (1 - curve), elapsedMs },
      probe: { goal: options.label, payload: 'x'.repeat(120) },
    }
  }
  const scheduler = createProbeScheduler({
    probe,
    snapshot,
    setModel: () => {},
    log: (record) => records.push(record),
    now: () => clock,
    options: { intervalMs: 10_000, minGapMs: 5_000, maxBackoffMs: 60_000, maxPerTurn: 240 },
  })
  while (clock <= options.durationMs) {
    await scheduler.tick('s1')
    clock += 1000
  }
  return { records, calls, scheduler }
}

/* 1 — a healthy turn: percent advances every minute, so probing stays at 10 s. */
const healthy = await simulateAsync({
  label: 'healthy',
  durationMs: TOTAL_MS,
  answerFor: (t) => ({ percent: Math.min(1, t / TOTAL_MS), eta: Math.max(0, TOTAL_MS - t) }),
})
const healthyProbes = healthy.records.filter((r) => r.kind === 'probe')
assert.ok(healthyProbes.length >= 50, `~10 s cadence over 10 min: got ${healthyProbes.length}`)
assert.ok(healthyProbes.length <= 70, `and not more than that: got ${healthyProbes.length}`)
assert.equal(healthy.records.at(-1).kind, 'end', 'the turn end is logged for grading')

/* 2 — a stuck turn: the same 50% for four minutes, then it moves again. */
const stuck = await simulateAsync({
  label: 'stuck',
  durationMs: TOTAL_MS,
  answerFor: (t) => {
    if (t > 240_000 && t <= 480_000) return { percent: 0.5, eta: 300_000 } // long build, no visible progress
    return { percent: Math.min(1, t / TOTAL_MS), eta: Math.max(0, TOTAL_MS - t) }
  },
})
const stuckProbes = stuck.records.filter((r) => r.kind === 'probe')
assert.ok(stuckProbes.length < healthyProbes.length, `backoff must cost less: stuck ${stuckProbes.length} vs healthy ${healthyProbes.length}`)

const gaps = stuckProbes.slice(1).map((r, i) => r.at - stuckProbes[i].at)
const maxGap = Math.max(...gaps)
assert.ok(maxGap <= 62_000, `the stretched interval is bounded: widest gap ${Math.round(maxGap / 1000)}s`)
assert.ok(maxGap >= 15_000, `and it really stretched during the stall: widest gap ${Math.round(maxGap / 1000)}s`)

/* 3 — grading: model answer vs the heuristic curve, on the healthy run. */
const end = healthy.records.at(-1).at
const graded = healthyProbes
  .filter((r) => r.at < end)
  .map((r) => ({ actual: end - r.at, model: r.modelEtaMs, heuristic: r.heuristicEtaMs }))
const mae = (pick) => graded.reduce((sum, row) => sum + Math.abs(pick(row) - row.actual), 0) / graded.length
const modelMae = mae((row) => row.model)
const heuristicMae = mae((row) => row.heuristic)

console.log(`SIMULATION (fake model/clock): ${healthyProbes.length} probes / 10 min, model MAE ${Math.round(modelMae / 1000)}s, heuristic MAE ${Math.round(heuristicMae / 1000)}s`)
console.log(`stuck:   ${stuckProbes.length} probes / 10 min, widest gap ${Math.round(maxGap / 1000)}s`)
assert.ok(modelMae < heuristicMae / 2, 'in the simulation the model answer is far closer than the time curve')

console.log('probe simulation passed')
