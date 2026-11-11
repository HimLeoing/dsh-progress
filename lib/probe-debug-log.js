import { randomUUID } from 'node:crypto'
import { appendFile, chmod, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_BYTES = 5 * 1024 * 1024
const PAYLOAD_BYTES = 1024 * 1024

/** Explicitly enabled, local-only adapter diagnostics. No credentials or signals
 * are added: input is exactly the request handed to the host's LLM service.
 * This is not the provider's HTTP wire representation (owned by its adapter).
 */
export function createProbeDebugLog(file, { enabled = () => false, maxBytes = DEFAULT_BYTES, payloadBytes = PAYLOAD_BYTES } = {}) {
  maxBytes = Math.max(4096, Math.min(DEFAULT_BYTES, maxBytes))
  payloadBytes = Math.max(1024, Math.min(PAYLOAD_BYTES, payloadBytes, Math.floor(maxBytes / 3)))
  let queue = Promise.resolve(), pending = 0, generation = 0, dropped = 0
  function write(record) {
    if (pending >= 64) { dropped++; return }
    pending++
    const line = `${JSON.stringify(record)}\n`, epoch = generation
    queue = queue.then(async () => {
      if (epoch !== generation) return
      await mkdir(dirname(file), { recursive: true, mode: 0o700 })
      const size = await stat(file).then(s => s.size, () => 0)
      if (size + Buffer.byteLength(line) > maxBytes) await rename(file, `${file}.1`).catch(e => { if(e.code !== 'ENOENT') throw e })
      await appendFile(file, line, { mode: 0o600 })
      await chmod(file, 0o600)
    }).catch(() => { dropped++ }).finally(() => {pending--})
  }
  function capture(value) {
    try {
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) <= payloadBytes) return { value: JSON.parse(text), truncated: false }
      return { value: { serializedPrefix: Buffer.from(text).subarray(0, payloadBytes).toString('utf8') }, truncated: true }
    } catch { return { value: null, truncated: true } }
  }
  async function rows(path) {
    let fd
    try {
      fd = await open(path, 'r')
      const size = (await fd.stat()).size
      const length = Math.min(size, maxBytes), buffer = Buffer.alloc(length)
      const {bytesRead} = await fd.read(buffer, 0, length, size - length)
      const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
      if(size > length) lines.shift()
      return lines.flatMap(line => {try { return [JSON.parse(line)] } catch {return []}})
    } catch { return [] } finally { await fd?.close() }
  }
  return {
    begin(metadata, request) {
      if(!enabled()) return null
      const epoch = generation, input = capture(request), id = randomUUID()
      // Explicit allowlist: callers cannot accidentally log context services.
      const record = {id, sessionId: metadata.sessionId ?? null, turn: metadata.turn ?? null,
        rootSessionId: metadata.rootSessionId ?? metadata.sessionId ?? null,
        rootTurn: metadata.rootTurn ?? metadata.turn ?? null, step: metadata.step ?? null,
        call: metadata.call ?? 1, startedAt: metadata.startedAt ?? Date.now(),
        reasoningEffort: request.reasoningEffort ?? null, input: input.value,
        inputTruncated: input.truncated, status: 'running'}
      write({event:'start', ...record})
      const chunks = []; let bytes = 0, truncated = false, finished = false
      return {
        chunk(value) {
          if(finished || epoch !== generation) return
          const captured = capture(value), n = Buffer.byteLength(JSON.stringify(captured.value))
          if(bytes + n > payloadBytes) {truncated = true; return}
          bytes += n; chunks.push(captured.value); truncated ||= captured.truncated
        },
        finish({error = null, usage = null, finishKind = null, finishedAt = Date.now()} = {}) {
          if(finished) return
          finished = true
          if(epoch !== generation) return
          write({event:'end', id, finishedAt, status:error ? 'error' : 'finished', error,
            usage, finishKind, output:{chunks}, outputTruncated:truncated})
        },
      }
    },
    async read({ sessionIds = [], turn, rootSessionId, rootTurn, limit = 100 } = {}) {
      await queue
      const records = new Map(), ids = new Set(sessionIds)
      for(const row of [...await rows(`${file}.1`), ...await rows(file)]) {
        if(row.event === 'start') records.set(row.id, row)
        else if(row.event === 'end' && records.has(row.id)) records.set(row.id, {...records.get(row.id), ...row, event:undefined})
      }
      const matching = [...records.values()].filter(row =>
        (!ids.size || ids.has(row.sessionId)) && (turn === undefined || row.turn === turn) &&
        (rootSessionId === undefined || row.rootSessionId === rootSessionId) && (rootTurn === undefined || row.rootTurn === rootTurn))
      const count = Math.max(1, Math.min(1000, Math.trunc(limit) || 100))
      return {records:matching.slice(-count), truncated:matching.length > count, dropped,
        retention:{maxBytesPerFile:maxBytes, files:2, maxPayloadBytes:payloadBytes}, path:file}
    },
    flush() {return queue},
    async clear() {
      generation++
      await queue
      await Promise.all([file,`${file}.1`].map(path => unlink(path).catch(e => {if(e.code !== 'ENOENT') throw e})))
    },
  }
}
