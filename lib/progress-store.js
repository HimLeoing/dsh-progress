/**
 * The tiny per-Session record the card falls back to.
 *
 * A Session that is not live — closed, or simply not opened yet after a Host
 * restart — still has to answer "where did this task end up". One JSON file
 * under the DSH home holds the last percentage each Session reported, written
 * debounced and atomically; nothing else is stored.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_SESSIONS = 200
const MAX_TURNS = 32
const MAX_STORE_BYTES = 8 * 1024 * 1024
const FLUSH_DELAY_MS = 1200

/** Absolute path of the store, honouring DSH_HOME. */
export function progressFile() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-task-progress', 'progress.json')
}

/**
 * @param file - store path; defaults to {@link progressFile}.
 * @returns `{ get, set, flush }`.
 */
export function createProgressStore(file = progressFile()) {
  let sessions = Object.create(null)
  let writable = true
  const turns = Object.create(null)
  const remember = (id, record) => {
    if (!Number.isSafeInteger(record?.turn) || record.turn < 1) return
    const bucket = turns[id] ??= Object.create(null)
    bucket[record.turn] = record
    const keys = Object.keys(bucket).map(Number).sort((a,b)=>b-a)
    for (const turn of keys.slice(MAX_TURNS)) delete bucket[turn]
  }
  const trim = () => {
    const ids = Object.keys(sessions)
    if (ids.length > MAX_SESSIONS) {
      ids.sort((left, right) => (sessions[left]?.updatedAt ?? 0) - (sessions[right]?.updatedAt ?? 0))
      for (const stale of ids.slice(0, ids.length - MAX_SESSIONS)) { delete sessions[stale]; delete turns[stale] }
    }
  }
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(fd).size
      if (size > MAX_STORE_BYTES) writable = false
      else {
        // One extra byte catches growth after fstat without an unbounded read.
        const buffer = Buffer.alloc(Math.min(size + 1, MAX_STORE_BYTES + 1))
        let length = 0, read
        while (length < buffer.length && (read = fs.readSync(fd, buffer, length, buffer.length - length, length)) > 0) length += read
        if (length > size) writable = false
        else {
          const parsed = JSON.parse(buffer.toString('utf8', 0, length))
          if (parsed === null || typeof parsed !== 'object' || parsed.sessions === null || typeof parsed.sessions !== 'object' || Array.isArray(parsed.sessions)) throw new Error('invalid progress store')
          for (const [id, record] of Object.entries(parsed.sessions)) if (record !== null && typeof record === 'object' && !Array.isArray(record)) sessions[id] = record
          for (const [id, record] of Object.entries(sessions)) {
            const saved = parsed.turns?.[id]
            if (saved && typeof saved === 'object' && !Array.isArray(saved))
              for (const record of Object.values(saved)) if (record && typeof record === 'object' && !Array.isArray(record)) remember(id, record)
            remember(id, record)
          }
          trim()
        }
      }
    } finally { fs.closeSync(fd) }
  } catch (error) {
    // Keep unreadable/corrupt/oversized source data for explicit recovery.
    // Missing records remain unknown; live updates may still be held in memory.
    if (error?.code !== 'ENOENT') writable = false
  }

  let timer = null
  let dirty = false

  const flush = () => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    if (!dirty || !writable) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      let body = JSON.stringify({ version: 2, sessions, turns })
      // Keep the same byte bound on writes and reads. Evict oldest historical
      // turns first, then oldest sessions, retaining complete records only.
      if (Buffer.byteLength(body)>MAX_STORE_BYTES) {
        const old = Object.entries(turns).flatMap(([id,bucket])=>Object.entries(bucket).filter(([turn])=>Number(turn)!==sessions[id]?.turn).map(([turn,record])=>({id,turn,at:record.updatedAt??0}))).sort((a,b)=>a.at-b.at)
        let bytes=Buffer.byteLength(body)
        for (const entry of old) {
          bytes-=Buffer.byteLength(JSON.stringify(turns[entry.id][entry.turn]))+String(entry.turn).length+4
          delete turns[entry.id][entry.turn]
          if(bytes<=MAX_STORE_BYTES-1024)break
        }
        body=JSON.stringify({version:2,sessions,turns});bytes=Buffer.byteLength(body)
        if(bytes>MAX_STORE_BYTES) {
          for (const id of Object.keys(sessions).sort((a,b)=>(sessions[a]?.updatedAt??0)-(sessions[b]?.updatedAt??0))) {
            bytes-=Buffer.byteLength(JSON.stringify(sessions[id]))+Buffer.byteLength(JSON.stringify(turns[id]??{}))+id.length*2+8
            delete sessions[id];delete turns[id]
            if(bytes<=MAX_STORE_BYTES-1024)break
          }
          body=JSON.stringify({version:2,sessions,turns})
        }
      }
      fs.writeFileSync(temporary, body, { mode: 0o600 })
      fs.renameSync(temporary, file)
      dirty = false
    } catch {
      /* a read-only home only costs the fallback */
    }
  }

  return {
    get(id, turn) {
      const record = turn === undefined ? (Object.hasOwn(sessions, id) ? sessions[id] : null) : turns[id]?.[turn] ?? null
      return record === null || typeof record !== 'object' ? null : record
    },
    listTurns(id) { return Object.keys(turns[id] ?? {}).map(Number).sort((a,b)=>a-b) },
    set(id, record) {
      remember(id, record)
      if (!sessions[id] || (record.turn ?? 0) >= (sessions[id].turn ?? 0)) sessions[id] = record
      trim()
      dirty = true
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, FLUSH_DELAY_MS)
        if (typeof timer.unref === 'function') timer.unref()
      }
    },
    flush,
  }
}
