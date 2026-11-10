/**
 * Host-half integration check — run with `node test/host.mjs`.
 *
 * Loads the real `apply()` against a stub context and drives the registered
 * HTTP routes with fake request/response objects, so a broken route, a wrong
 * payload shape, or a throwing handler fails here instead of in the browser.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-task-progress-host-'))
process.env.DSH_HOME = home

// The registry read must not hit the network during a test.
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ latest: '1.2.3', next: '1.3.0-rc.1' }),
})

const { apply } = await import('../index.js')

const disposers = []
const routes = []
const handlers = new Map()
const sessions = []

const ctx = {
  effect(fn) {
    const dispose = fn()
    disposers.push(dispose)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  on(name, fn) {
    const list = handlers.get(name) ?? []
    list.push(fn)
    handlers.set(name, list)
    return () => {}
  },
  get(key) {
    if (key === 'sessions') return { list: () => sessions }
    if (key === 'agents' || key === 'agentTeams') return undefined
    return undefined
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

apply(ctx)

assert.deepEqual(
  routes.map((route) => route.path),
  ['/dsh-task-progress/state', '/dsh-task-progress/preferences', '/dsh-task-progress/probe'],
)
for (const route of routes) assert.equal(route.kind, 'exact')

/** Minimal ServerResponse stand-in that captures the JSON body. */
function call(route, { method = 'GET', url = route.path, origin = 'http://127.0.0.1:3080', host = '127.0.0.1:3080', remote = '127.0.0.1', localPort = 3080, payload='{}' } = {}) {
  return new Promise((resolve) => {
    let status = 0
    const chunks = []
    const res = {
      writeHead(code) {
        status = code
      },
      end(text) {
        chunks.push(typeof text === 'string' ? text : '')
        resolve({ status, body: chunks.join('') })
      },
    }
    const req = {
      async *[Symbol.asyncIterator](){yield payload},
      method,
      url,
      headers: { host, ...(origin === null ? {} : { origin }) },
      socket: { remoteAddress: remote, localPort },
    }
    route.handler(req, res)
  })
}

const state = routes.find((route) => route.path === '/dsh-task-progress/state')

const noSession = await call(state)
assert.equal(noSession.status, 200)
let body = JSON.parse(noSession.body)
assert.equal(body.ok, true)
assert.equal(typeof body.server.pid, 'number')
assert.equal(typeof body.progress.projectBar.percent, 'number', 'percent is always a number')
assert.equal(body.progress.sessionId, null)
assert.equal(body.plugin.name,'dsh-task-progress');assert.equal(body.plugin.host,'0.2.2-rc.1');assert.equal(body.version,undefined);assert.equal(body.update,undefined);assert.equal(body.restart,undefined)

// An explicit session id that has nothing live and nothing saved still answers.
const unknown = await call(state, { url: '/dsh-task-progress/state?session=session-nope' })
body = JSON.parse(unknown.body)
assert.equal(body.progress.sessionId, 'session-nope')
assert.equal(typeof body.progress.projectBar.percent, 'number')

// A live session with a plan reports numbers, a clock and a countdown.
const session = { id: 'session-live', seq: 0, header: { cwd: '/tmp/demo' }, snapshotEvents: () => [] }
sessions.push(session)
const emit = (name, ...args) => {
  for (const fn of handlers.get(name) ?? []) fn(...args)
}
const event = (type, data) => {
  session.seq += 1
  return { type, seq: session.seq, time: Date.now(), data }
}
emit('session/event', session, event('turn/start', { turn: 1 }))
emit(
  'session/event',
  session,
  event('todo/write', {
    todos: [
      { content: 'One', status: 'completed' },
      { content: 'Two', status: 'in_progress' },
    ],
  }),
)

const live = await call(state, { url: '/dsh-task-progress/state?session=session-live' })
body = JSON.parse(live.body)
assert.equal(body.progress.sessionId, 'session-live')
assert.equal(body.progress.projectBar.mode, 'todos')
assert.equal(body.progress.projectBar.done, 1)
assert.equal(body.progress.projectBar.total, 2)
assert.equal(typeof body.progress.projectBar.elapsedMs, 'number')
assert.equal(body.progress.display.remainingMs,null);assert.equal(body.progress.settings.aiEnabled,false);assert.equal(body.progress.display.percent,.5)
assert.equal(body.progress.task.label, 'Two')
assert.ok(body.progress.projectBar.percent === 0.5, `half the plan with one item running: ${body.progress.projectBar.percent}`)

const child={id:'session-child',seq:0,header:{origin:'subagent',parentSession:'session-live',createdAt:Date.now()},snapshotEvents:()=>[]};sessions.push(child)
for(const [type,data]of [['subagent/descriptor',{label:'Forest'}],['turn/start',{turn:1}]])emit('session/event',child,{seq:++child.seq,type,data,time:Date.now()})
const focused=JSON.parse((await call(state,{url:'/dsh-task-progress/state?session=session-live&worker=session-child'})).body)
assert.equal(focused.progress.sessionId,'session-live');assert.equal(focused.worker.sessionId,'session-child');assert.equal(focused.worker.label,'Forest');assert.equal(focused.worker.children.length,0);assert.equal(focused.worker.probe,undefined,'no private probe inputs in drill-down');assert.equal(JSON.parse((await call(state,{url:'/dsh-task-progress/state?session=session-live&worker=unrelated'})).body).worker,null)

// Progress never registers host management controls.
assert.ok(routes.every(route=>!/(restart|update)/u.test(route.path)))

const preferences=routes.find(row=>row.path==='/dsh-task-progress/preferences')
assert.equal((await call(preferences,{method:'GET'})).status,405)
assert.equal((await call(preferences,{method:'POST',remote:'10.0.0.9'})).status,403)
assert.equal((await call(preferences,{method:'POST',origin:'https://evil.example'})).status,403)
assert.equal((await call(preferences,{method:'POST',payload:'{bad'})).status,400)
assert.equal((await call(preferences,{method:'POST',payload:'x'.repeat(1025)})).status,413)
assert.equal((await call(preferences,{method:'POST',payload:'{"aiEnabled":"yes"}'})).status,400)
const configured=await call(preferences,{method:'POST',payload:'{"aiEnabled":true,"aiScope":"all"}'})
assert.equal(JSON.parse(configured.body).settings.aiEnabled,true)
assert.equal((await call(routes.find(row=>row.path==='/dsh-task-progress/probe'),{method:'POST'})).status,400)
console.log('host checks passed: state, local default, bounded preferences, same-origin writes, manual probe')

for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose()
rmSync(home, { recursive: true, force: true })
