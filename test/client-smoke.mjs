/**
 * Client-half smoke test — run with `node test/client-smoke.mjs`.
 *
 * The browser artifact is a plain script that hands itself to the page's
 * module loader. This loads it under a stub loader, calls the factory with a
 * stub React, then runs `apply` against a stub context and checks that the
 * three slot registrations land with the ids the Host expects.
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)))
assert.equal(manifest.name,'@himleoing/dsh-progress')
assert.equal(manifest.version,'0.1.1-rc3')
for(const [locale,detail] of [['en','docs/plugin.en.md'],['zh','docs/plugin.zh-CN.md']])assert.equal(JSON.parse(readFileSync(new URL(`../locale/${locale}.json`,import.meta.url))).meta.detail,detail)
assert.ok(manifest.files.includes('docs/plugin.*.md'));assert.ok(manifest.files.includes('docs/assets/*.png'))

const loaded = []
const storage = new Map([
  ['dsh-task-progress.panel.collapsed.v2', '1'],
  ['dsh-base.panel.collapsed.v2', '0'],
  ['dsh-task-progress.panel.position.v2', '{"side":"left","edge":24,"y":42}'],
  ['dsh-progress.panel.position.v2', '{"side":"right","edge":18,"y":30}'],
  ['dsh-base.panel.position.v1', '{"x":10,"y":20,"vw":1200,"vh":800}'],
])
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) },
  addEventListener: () => {},
  removeEventListener: () => {},
}
const styles=[]
globalThis.document = {
  hidden: false,
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild(style) { styles.push(style) } },
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
assert.equal(definition.id, manifest.name, 'client loader registration matches the package imported by the host')
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
assert.equal(storage.get('dsh-progress.panel.collapsed.v2'),'1','standalone browser preferences take priority over dsh-base')
assert.equal(storage.get('dsh-progress.panel.position.v2'),'{"side":"right","edge":18,"y":30}','existing new position wins')
assert.equal(storage.get('dsh-progress.panel.position.v1'),storage.get('dsh-base.panel.position.v1'),'base fallback copies older coordinates')
assert.equal(storage.get('dsh-task-progress.panel.collapsed.v2'),'1','legacy browser data is retained')
assert.equal(styles[0].dataset.dshProgress,'dsh-progress','style marker matches renamed duplicate-style selector')

assert.deepEqual(injected.sort(), [
  'conversation.composer.dock',
  'shell.overlay',
])
assert.equal(registrations.length, 2)
const bySlot = new Map(registrations.map((entry) => [entry.options.name, entry.options]))
assert.equal(bySlot.get('shell.overlay').id, 'dsh-progress-progress')
assert.equal(bySlot.get('conversation.composer.dock').id, 'dsh-progress-session')
for (const entry of registrations) assert.equal(typeof entry.component, 'function')

// Every effect registered its cleanup, and running them stops the poller.
assert.ok(disposers.every((dispose) => typeof dispose === 'function'))
for (const dispose of disposers) dispose()

console.log('client smoke checks passed')
process.exit(0)
