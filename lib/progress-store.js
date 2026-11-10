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
  const trim = () => {
    const ids = Object.keys(sessions)
    if (ids.length > MAX_SESSIONS) {
      ids.sort((left, right) => (sessions[left]?.updatedAt ?? 0) - (sessions[right]?.updatedAt ?? 0))
      for (const stale of ids.slice(0, ids.length - MAX_SESSIONS)) delete sessions[stale]
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
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, sessions }), { mode: 0o600 })
      fs.renameSync(temporary, file)
      dirty = false
    } catch {
      /* a read-only home only costs the fallback */
    }
  }

  return {
    get(id) {
      const record = Object.hasOwn(sessions, id) ? sessions[id] : null
      return record === null || typeof record !== 'object' ? null : record
    },
    set(id, record) {
      sessions[id] = record
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
