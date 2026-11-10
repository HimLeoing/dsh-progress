import assert from 'node:assert/strict'
import { createTracker } from '../lib/tracker.js'
import { createProbeContext } from '../lib/probe-context.js'
import { createProbeScheduler } from '../lib/probe-scheduler.js'
import { createModelProbe, parseProbeAnswer } from '../lib/model-probe.js'
import { progressDisplay } from '../lib/progress-display.js'

let clock = 1_800_000_000_000
const realNow = Date.now
Date.now = () => clock
const handlers = new Map(), saved = new Map(), ended = []
const events = []
const session = { id: 'regression', header: { cwd: '/workspace/a' }, get seq() { return events.length }, snapshotEvents: () => events }
const ctx = {
  get: key => key === 'sessions' ? { list: () => [session] } : undefined,
  on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
}
const tracker = createTracker(ctx, { persistence: { load: id => saved.get(id), save: (id, record) => saved.set(id, record) }, onTurnEnd: record => ended.push(record) })
function emit(type, data = {}) {
  const event = { type, data, time: clock, seq: events.length }
  events.push(event) // the host commits before notification: seed includes this event
  handlers.get('session/event')(session, event)
}
emit('turn/start', { turn: 1 })
emit('user/message', { source: { kind: 'catalog' }, content: [{ type: 'text', text: 'This is injected catalog content, not the human task.' }] })
emit('user/message', { content: [{ type: 'text', text: 'Build the complete dashboard with tests, keyboard navigation and export.' }] })
assert.match(tracker.snapshot(session.id).probe.goal, /^Build the complete/)
assert.equal(tracker.snapshot(session.id).turn, 1, 'committed seed event is not folded twice')
emit('todo/write', { todos: [{ content: 'Implement dashboard', status: 'in_progress' }, { content: 'Test and deliver', status: 'pending' }] })
tracker.setModel(session.id, { percent: .73, remainingMs: 60000, turn: 1, at: clock })
emit('tool/call', { callId: 'a', name: 'bash', arguments: JSON.stringify({ command: 'npm test' }) })
emit('tool/call', { callId: 'b', name: 'read', arguments: JSON.stringify({ file_path: '/workspace/a/index.js' }) })
clock += 1000
emit('tool/result', { message: { toolCallId: 'b', content: [{ type: 'text', text: 'read complete' }] } })
assert.equal(tracker.snapshot(session.id).command.name, 'bash', 'finishing one parallel tool retains the other')
clock += 500
emit('turn/end', { reason: { kind: 'completed' } }) // stale unfinished plan is deliberate
let view = tracker.snapshot(session.id)
assert.equal(view.projectBar.percent, 1, 'completion dominates an unfinished todo list')
assert.equal(saved.get(session.id).percent, 1, '100% is persisted before the next poll')
assert.equal(view.command.active, false, 'pending tools disappear on completion')
assert.equal(view.model, null)
assert.equal(ended[0].at, clock, 'end time comes from the event, not a later polling tick')
assert.equal(tracker.setModel(session.id, { percent: .8, turn: 1 }), false, 'late answer cannot mutate completion')

emit('turn/start', { turn: 2 })
emit('user/message', { content: [{ type: 'text', text: 'Continue' }] })
view = tracker.snapshot(session.id, { includeTranscript: true })
assert.match(view.probe.requestContext, /dashboard/, 'continue retains the original request')
assert.equal(view.projectBar.percent, 0)
assert.equal(view.projectBar.mode, 'turn', 'old completed/unfinished plans are discarded')
tracker.setModel(session.id, { percent: .64, remainingMs: 12000, turn: 2, at: clock })
assert.equal(progressDisplay(tracker.snapshot(session.id)).remainingMs, 12000)
clock += 13000
assert.equal(progressDisplay(tracker.snapshot(session.id)).known, false, 'an expired ETA never promises zero seconds')
emit('turn/end', { reason: { kind: 'aborted' } })
view = tracker.snapshot(session.id)
assert.equal(view.projectBar.percent, .64, 'interruption freezes semantic progress')
assert.equal(progressDisplay(view).percent, .64)
tracker.dispose()
const restored = createTracker(ctx, { persistence: { load: id => saved.get(id), save() {} } })
assert.equal(restored.snapshot(session.id).projectBar.percent, .64, 'replay preserves the persisted interruption percentage')
restored.dispose()

// Prefix caching and rolling transcript cursors: >400 events must keep flowing.
const history = createProbeContext()
const base = { running: true, turn: 1, startedAt: 1000, projectBar: { mode: 'turn', elapsedMs: 10000 }, probe: { goal: 'whole task', transcript: ['event-0'], transcriptOffset: 0 } }
const first = history.build('x', base)
history.accept('x', { percent: .2, remainingMs: 40000 }, base)
const next = history.build('x', { ...base, projectBar: { ...base.projectBar, elapsedMs: 22000 }, probe: { ...base.probe, transcript: ['event-0', 'new-output'] } })
assert.deepEqual(next.slice(0, first.length), first, 'the entire previous request is an unchanged prefix')
assert.equal(next[first.length].role, 'assistant', 'answers really enter the same probe conversation')
assert.equal(next[first.length].source.kind, 'model', 'DSH adapters require assistant source metadata')
assert.ok(next.every(message => message.id && message.source), 'all messages carry their canonical identity and source')
assert.match(JSON.stringify(next.at(-1)), /elapsed: 22s/)
assert.match(JSON.stringify(next.at(-1)), /new-output/)
const rolled = history.build('x', { ...base, probe: { ...base.probe, transcript: ['event-800', 'event-801'], transcriptOffset: 800 } })
assert.match(JSON.stringify(rolled), /event-801/, 'rolling-buffer rollover cannot freeze the context cursor')

const bounded = createProbeContext()
bounded.build('cap', base)
bounded.accept('cap', {percent:.5, remainingMs:1000, message:{id:'huge',role:'assistant',source:{kind:'model',provider:'p',model:'m',replayState:'x'.repeat(190000)},content:[{type:'text',text:'{}'}]}}, base)
assert.ok(JSON.stringify(bounded.build('cap', base)).length < 10000, 'native replay metadata counts toward the context budget')

// In-flight results from a previous turn are rejected even if the provider succeeds.
let answerLater, recorded = 0
let schedulerView = { running: true, turn: 1, startedAt: 10, projectBar: {} }
const scheduler = createProbeScheduler({ now: () => clock, snapshot: () => schedulerView, probe: { available: true, ask: () => new Promise(resolve => { answerLater = resolve }) }, setModel: () => { recorded++ }, log() {}, options: { intervalMs: 10, minGapMs: 0 } })
await scheduler.tick('x'); clock += 20
const pending = scheduler.tick('x')
schedulerView = { ...schedulerView, turn: 2, startedAt: 20 }
answerLater({ percent: .7, remainingMs: 1000 })
assert.equal((await pending).reason, 'superseded')
assert.equal(recorded, 0)
scheduler.dispose()

// Failed attempts count toward the cap and back off too.
let calls = 0
const failures = createProbeScheduler({ now: () => clock, snapshot: () => schedulerView, probe: { available: true, async ask() { calls++; return null } }, setModel() {}, log() {}, options: { intervalMs: 10, minGapMs: 0, maxPerTurn: 2 } })
await failures.tick('x'); clock += 20; await failures.tick('x'); clock += 100; await failures.tick('x'); clock += 100
assert.equal((await failures.tick('x')).reason, 'capped')
assert.equal(calls, 2)
failures.dispose()
assert.equal(parseProbeAnswer('{"p":null,"eta":false}'), null, 'invalid JSON types are not silently converted into completion')

// Host services may appear after plugin activation; use the session's route.
let llm, routed
const probe = createModelProbe({ get(key) {
  if (key === 'llm') return llm
  if (key === 'agents') return { get: id => id === 'x' ? { model: { current: () => ({ provider: 'p', model: 'session-model' }) } } : undefined }
} }, { timeoutMs: 30 })
assert.equal(probe.available, false)
llm = { async resolveModelInfo() { return { reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }] } } }, async *stream(request) { routed = request; yield { type: 'text-delta', text: '{"p":25,"eta":30}' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"p":25,"eta":30}' } }; yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { kind: 'adapter-response' }, blocks: [{ type: 'text' }] } } } }
assert.equal(probe.available, true)
assert.equal((await probe.ask('request', undefined, { sessionId: 'x' })).percent, .25)
assert.equal(routed.model, 'session-model')
assert.equal(routed.reasoningEffort, 'low')
assert.equal(routed.maxTokens, 40)
const nativeAnswer = await probe.ask('request', undefined, { sessionId: 'x' })
assert.equal(nativeAnswer.message.source.provider, 'p')
assert.equal(nativeAnswer.message.source.model, 'session-model')
assert.equal(nativeAnswer.message.source.replayState.response.kind, 'adapter-response', 'native replay metadata stays attached to the exact response blocks')
llm = { resolveModelInfo: () => new Promise(() => {}), async *stream() { await new Promise(() => {}) } }
assert.equal(await probe.ask('x', undefined, { sessionId: 'x' }), null, 'timeout settles even an adapter that ignores abort')
assert.match(probe.lastError, /timeout/)
Date.now = realNow
console.log('regression checks passed: replay, completion, cancellation, parallel tools, context, race, budgets, routing, timeout')
