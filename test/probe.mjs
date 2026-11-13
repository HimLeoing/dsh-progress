/**
 * Probe unit checks — run with `node test/probe.mjs`.
 * Pure functions only: prompt building and answer parsing.
 */
import assert from 'node:assert/strict'
import { buildProbePayload, parseProbeAnswer } from '../lib/model-probe.js'

const view = {
  turn: 3,
  running: true,
  projectBar: { mode: 'todos', percent: 0.42, done: 3, total: 7, elapsedMs: 754000, remainingMs: 300000 },
  task: { label: '写插件骨架：宿主侧的进度模型' },
}

const payload = buildProbePayload(view, {
  goal: '把 dsh-progress 插件做成能装在任何人的 dsh web 里、任何项目都能用的进度条\n并且估算要准',
  recentTools: ['bash', 'read', 'edit', 'edit', 'grep', 'bash'],
  lastTool: 'bash',
})
assert.ok(payload.length < 420, `payload stays small: ${payload.length}`)
assert.ok(payload.includes('3/7'), 'plan counters are included')
assert.ok(payload.includes('elapsed: 754s'), 'elapsed is included')
assert.ok(!payload.includes('\n\n'), 'no wasted blank lines')
assert.equal(payload.split('\n').length, 5, 'one line per fact')

// No plan: the payload says so instead of inventing counters.
const bare = buildProbePayload({ ...view, projectBar: { mode: 'turn', done: 0, total: null, elapsedMs: 12000 }, task: { label: '' } }, {
  goal: 'x',
  recentTools: [],
  lastTool: '',
})
assert.ok(bare.includes('plan: none'))

// Parsing: fenced, chatty, clamped, and garbage.
assert.deepEqual(parseProbeAnswer('{"p":62,"eta":480}'), { percent: 0.62, remainingMs: 480000 })
assert.deepEqual(parseProbeAnswer('sure!\n```json\n{"p": 100, "eta": 0}\n```'), { percent: 1, remainingMs: 0 })
assert.deepEqual(parseProbeAnswer('{"p":250,"eta":-5}'), { percent: 1, remainingMs: 0 }, 'clamped to [0,100] and [0,∞)')
assert.equal(parseProbeAnswer('no json here'), null)
assert.equal(parseProbeAnswer('{"p":"soon"}'), null)
assert.equal(parseProbeAnswer(''), null)

assert.deepEqual(parseProbeAnswer('{"p":60,"eta":null,"s":"wait","c":0}'), {percent:.6,remainingMs:null,phase:'wait',confidence:0})
console.log('probe checks passed')

/* ---- the call path, with a fake llm service ---- */
const { createModelProbe } = await import('../lib/model-probe.js')

function fakeCtx(reply) {
  return {
    get(key) {
      if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      if (key === 'llm') {
        return {
          stream() {
            return (async function* () {
              yield { type: 'text-delta', index: 0, text: reply }
              yield { type: 'usage', usage: { inputTokens: 128, outputTokens: 11 } }
              yield { type: 'finish', reason: { kind: 'stop' } }
            })()
          },
        }
      }
      return undefined
    },
  }
}

const okProbe = createModelProbe(fakeCtx('{"p":62,"eta":480}'))
assert.equal(okProbe.available, true)
const okAnswer = await okProbe.ask('goal: x')
assert.equal(okAnswer.percent, 0.62)
assert.equal(okAnswer.remainingMs, 480000)
assert.deepEqual(okAnswer.usage, { inputTokens: 128, outputTokens: 11 })

const badProbe = createModelProbe(fakeCtx('I think about 60%?'))
assert.equal(await badProbe.ask('x'), null)
assert.match(badProbe.lastError, /no json \(finish=stop/)

const noModel = createModelProbe({ get: () => undefined })
assert.equal(noModel.available, false)
assert.equal(await noModel.ask('x'), null)

console.log('probe call-path checks passed')
