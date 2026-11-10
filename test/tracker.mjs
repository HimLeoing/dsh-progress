/**
 * Tracker checks — run with `node test/tracker.mjs`.
 *
 * The tracker only asks its context for `on` and `get`, and takes persistence
 * as an injected pair, so a stub reproduces the whole fold the live Host runs.
 */
import assert from 'node:assert/strict'
import { createTracker } from '../lib/tracker.js'

let clock = 1_700_000_000_000
const realNow = Date.now
Date.now = () => clock

function makeContext(services = {}) {
  const handlers = new Map()
  const ctx = {
    on(name, fn) {
      const list = handlers.get(name) ?? []
      list.push(fn)
      handlers.set(name, list)
      return () => {}
    },
    get: (key) => services[key],
  }
  const emit = (name, ...args) => {
    for (const fn of handlers.get(name) ?? []) fn(...args)
  }
  return { ctx, emit }
}

function makeSession(id, cwd, extra = {}) {
  return { id, seq: 0, header: { cwd, ...extra }, snapshotEvents: () => [] }
}

const session = makeSession('session-test', '/Users/someone/Projects/demo-app')
const sessionsService = { list: () => [session] }
let { ctx, emit } = makeContext({ sessions: sessionsService })
let tracker = createTracker(ctx)

let seq = 0
const send = (type, data) => {
  seq += 1
  session.seq = seq
  emit('session/event', session, { type, seq, time: clock, data })
}

send('turn/start', { turn: 1 })
send('step/start', { turn: 1, step: 1 })
send('todo/write', {
  todos: [
    { content: 'Scaffold the package', status: 'in_progress' },
    { content: 'Write the host half', status: 'pending' },
    { content: 'Write the client half', status: 'pending' },
  ],
})

let view = tracker.snapshot()
assert.equal(view.project, 'demo-app')
assert.equal(view.projectBar.mode, 'todos')
assert.equal(view.projectBar.total, 3)
assert.equal(view.projectBar.done, 0)
assert.equal(view.turnStatus, 'running')
assert.equal(view.task.label, 'Scaffold the package')
assert.equal(view.projectBar.percent, 0, 'a bar that has not started reads 0%')
assert.equal(view.projectBar.known, false, 'a fresh turn has nothing to promise yet')
assert.ok(view.projectBar.remainingMs > 0, 'a plan with items left has a countdown')
assert.equal(view.task.percent, 0, 'the new item is at zero')
assert.ok(view.task.remainingMs > 0)

// A running tool also carries elapsed and remaining.
send('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"description":"List files","command":"ls"}' })
view = tracker.snapshot()
assert.equal(view.command.active, true)
assert.equal(view.command.name, 'bash')
assert.equal(view.command.label, 'List files')
assert.ok(view.command.elapsedMs >= 0)
assert.ok(view.command.remainingMs > 0)

clock += 30_000
send('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1' } })

// Time passes: the item, the plan and the countdown all move together.
clock += 120_000
view = tracker.snapshot()
assert.ok(view.task.percent > 0.5 && view.task.percent < 0.9, `item percent ${view.task.percent}`)
assert.ok(view.task.remainingMs > 0, 'the item keeps a live countdown')
assert.ok(view.projectBar.percent > 0.15, `one item well underway out of three: ${view.projectBar.percent}`)
assert.ok(view.projectBar.elapsedMs >= 150_000)

// Item 1 completes and item 2 starts.
send('todo/write', {
  todos: [
    { content: 'Scaffold the package', status: 'completed' },
    { content: 'Write the host half', status: 'in_progress' },
    { content: 'Write the client half', status: 'pending' },
  ],
})
view = tracker.snapshot()
assert.equal(view.projectBar.done, 1)
assert.equal(view.task.label, 'Write the host half')

// The turn finishes with the plan complete: 100%, no countdown.
send('todo/write', {
  todos: [
    { content: 'Scaffold the package', status: 'completed' },
    { content: 'Write the host half', status: 'completed' },
    { content: 'Write the client half', status: 'completed' },
  ],
})
send('turn/end', { turn: 1, reason: { kind: 'completed' } })
view = tracker.snapshot()
assert.equal(view.turnStatus, 'completed')
assert.equal(view.projectBar.percent, 1, 'a finished plan reads 100%')
assert.equal(view.projectBar.remainingMs, 0)
assert.equal(view.task.label, '', 'nothing is in progress after the turn')

// The next turn starts from zero — the finished 7/7 must not come back.
send('turn/start', { turn: 2 })
view = tracker.snapshot()
assert.equal(view.projectBar.mode, 'turn')
assert.equal(view.projectBar.percent, 0, 'a new turn starts at zero')
// The session already finished a turn, so this one inherits a measured
// duration and may promise a time from the first second.
assert.equal(view.projectBar.known, false, 'one completed turn is insufficient evidence for a reliable history ETA')
assert.equal(view.steps, 0, 'step counter is per turn')
assert.ok(view.projectBar.remainingMs > 0, 'the no-plan countdown comes from learned turn durations')

// Past the estimate neither readout may stall: the bar keeps creeping and the
// countdown keeps decaying (the frozen-58%-and-rising-countdown bug).
const samples = []
for (const step of [0, 120_000, 240_000, 480_000, 900_000]) {
  clock += step
  const sample = tracker.snapshot()
  samples.push({ percent: sample.projectBar.percent, remaining: sample.projectBar.remainingMs })
}
for (let i = 1; i < samples.length; i += 1) {
  const capped = samples[i - 1].percent >= 0.979
  assert.ok(
    capped ? samples[i].percent >= samples[i - 1].percent : samples[i].percent > samples[i - 1].percent,
    `percent must keep rising below the cap: ${samples.map((s) => s.percent.toFixed(3)).join(' → ')}`,
  )
  assert.ok(
    samples[i].remaining < samples[i - 1].remaining,
    `countdown must keep falling: ${samples.map((s) => Math.round(s.remaining / 1000)).join(' → ')}`,
  )
  assert.ok(samples[i].remaining >= 0, 'a countdown never goes negative')
}
assert.ok(samples[samples.length - 1].percent < 1, 'a running turn never reads 100%')

// An interrupted turn keeps the percentage it had, and never invents 100%.
clock += 60_000
send('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
view = tracker.snapshot()
assert.equal(view.turnStatus, 'interrupted')
assert.ok(view.projectBar.percent > 0 && view.projectBar.percent < 1, `interrupted percent ${view.projectBar.percent}`)
assert.equal(view.projectBar.remainingMs, 0)

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

const saved = new Map()
const persistent = createTracker(ctx, {
  persistence: { load: (id) => saved.get(id) ?? null, save: (id, record) => saved.set(id, record) },
})
persistent.snapshot('session-unknown')
assert.equal(saved.size, 0, 'nothing is written for an unknown session')

const other = makeSession('session-closed', '/tmp/closed')
const closedSessions = { list: () => [] }
const store2 = new Map([['session-closed', { turn: 4, status: 'completed', percent: 1, done: 7, total: 7, updatedAt: clock, itemEtaMs: 90000, turnEtaMs: 240000 }]])
const restored = createTracker({ on: () => () => {}, get: (key) => (key === 'sessions' ? closedSessions : undefined) }, {
  persistence: { load: (id) => store2.get(id) ?? null, save: () => {} },
})
view = restored.snapshot('session-closed')
assert.equal(view.persisted, true)
assert.equal(view.projectBar.percent, 1)
assert.equal(view.turnStatus, 'completed')
assert.ok(other !== null)

Date.now = realNow
console.log('tracker checks passed')
