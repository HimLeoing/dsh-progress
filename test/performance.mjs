/** Synthetic load, NOT prediction-accuracy evidence. */
import { performance } from 'node:perf_hooks'
import { createTracker } from '../lib/tracker.js'
const listeners = new Map()
const session = { id: 'load', seq: 0, header: { cwd: '/synthetic' }, snapshotEvents: () => [] }
const tracker = createTracker({ on: (name, fn) => { listeners.set(name, fn); return () => {} }, get: key => key === 'sessions' ? { list: () => [session] } : undefined })
const emit = (type, data) => listeners.get('session/event')(session, { seq: ++session.seq, type, time: Date.now(), data })
global.gc?.()
const before = process.memoryUsage().heapUsed
const start = performance.now()
emit('turn/start', { turn: 1 })
for (let i = 0; i < 10000; i++) {
  emit('tool/call', { callId: String(i), name: 'read', arguments: JSON.stringify({ file_path: `/synthetic/file-${i}` }) })
  emit('tool/result', { message: { toolCallId: String(i), content: [{ type: 'text', text: 'x'.repeat(2000) }] } })
}
const feedMs = performance.now() - start
const pollStart = performance.now()
for (let i = 0; i < 1000; i++) tracker.snapshot(session.id)
const snapshotMs = performance.now() - pollStart
const internal = tracker.snapshot(session.id, { includeTranscript: true })
global.gc?.()
const retainedHeapBytes = Math.max(0, process.memoryUsage().heapUsed - before)
console.log(JSON.stringify({ synthetic: true, events: 20001, feedMs, snapshot1000Ms: snapshotMs, retainedHeapBytes, transcriptChars: internal.probe.transcript.join('\n').length, offset: internal.probe.transcriptOffset }, null, 2))
tracker.dispose()
