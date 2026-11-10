/**
 * Client-half smoke test — run with `node test/client-smoke.mjs`.
 *
 * The browser artifact is a plain script that hands itself to the page's
 * module loader. This loads it under a stub loader, calls the factory with a
 * stub React, then runs `apply` against a stub context and checks that the
 * three slot registrations land with the ids the Host expects.
 */
import assert from 'node:assert/strict'

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.document = {
  hidden: false,
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
  addEventListener: () => {},
  removeEventListener: () => {},
}

const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
}
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })

await import('../client.js')

assert.equal(loaded.length, 1, 'client.js registers exactly one module')
const definition = loaded[0]
assert.equal(definition.id, 'dsh-task-progress')
const clientModule = definition.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`unexpected require(${specifier})`)
})
assert.deepEqual(clientModule.inject, ['slots'])
assert.equal(typeof clientModule.apply, 'function')

const registrations = []
const injected = []
const disposers = []
const ctx = {
  effect(fn) {
    const dispose = fn()
    disposers.push(dispose)
    return () => {}
  },
  get(key) {
    if (key === 'locale') return { getLocale: () => ({ id: 'zh-CN' }), subscribe: () => () => {} }
    return undefined
  },
  slots: {
    inject(slot, callback) {
      injected.push(slot)
      const dispose = callback()
      assert.equal(typeof dispose, 'function', `inject(${slot}) must return a disposer`)
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

clientModule.apply(ctx)

assert.deepEqual(injected.sort(), [
  'conversation.composer.dock',
  'shell.overlay',
])
assert.equal(registrations.length, 2)
const bySlot = new Map(registrations.map((entry) => [entry.options.name, entry.options]))
assert.equal(bySlot.get('shell.overlay').id, 'dsh-task-progress-progress')
assert.equal(bySlot.get('conversation.composer.dock').id, 'dsh-task-progress-session')
for (const entry of registrations) assert.equal(typeof entry.component, 'function')

// Every effect registered its cleanup, and running them stops the poller.
assert.ok(disposers.every((dispose) => typeof dispose === 'function'))
for (const dispose of disposers) dispose()

console.log('client smoke checks passed')
process.exit(0)
