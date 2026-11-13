/**
 * Progress sampler — appends one JSON line per poll so estimate drift can be
 * checked against what actually happened.
 *
 *   node tools/progress-log.mjs [intervalMs] [outFile]
 *
 * Each line: { at, sid, mode, pct, elapsed, left, status, running, task, cmd }.
 * `left` is what the card promised; comparing it with the next real transition
 * is how the estimator gets graded.
 */
import { appendFileSync } from 'node:fs'

const intervalMs = Number(process.argv[2] ?? 10000)
const outFile = process.argv[3] ?? '/tmp/dsh-progress.jsonl'
// Pin one Session: without it the Host answers for whichever Session is most
// active, and a busy conversation elsewhere silently steals the sample stream.
const pinned = process.argv[4] ?? ''
const base = 'http://127.0.0.1:3080/dsh-progress/state'
const endpoint = pinned === '' ? base : `${base}?session=${encodeURIComponent(pinned)}`

let lastFingerprint = ''
const tick = async () => {
  try {
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
    if (!response.ok) return
    const body = await response.json()
    const progress = body?.progress ?? {}
    const sample = {
      at: Date.now(),
      pinned: pinned !== '',
      sid: progress.sessionId ?? null,
      mode: progress.projectBar?.mode ?? null,
      pct: progress.display?.percent ?? progress.projectBar?.percent ?? null,
      elapsed: progress.projectBar?.elapsedMs ?? null,
      left: progress.display ? progress.display.remainingMs : progress.projectBar?.remainingMs ?? null,
      est: progress.display?.estimated ?? progress.projectBar?.estimated ?? null,
      status: progress.turnStatus ?? null,
      running: progress.running === true,
      done: progress.projectBar?.done ?? null,
      total: progress.projectBar?.total ?? null,
      task: progress.task?.label ?? '',
      taskPct: progress.task?.percent ?? null,
      taskLeft: progress.task?.remainingMs ?? null,
      cmd: progress.command?.active === true ? progress.command.name : null,
      cmdLeft: progress.command?.remainingMs ?? null,
    }
    // While a turn runs, log every tick: the countdown has to be graded at the
    // resolution it is displayed. Otherwise log changes plus a ~60s heartbeat.
    const fingerprint = `${sample.sid}|${sample.mode}|${sample.status}|${sample.done}/${sample.total}|${sample.task}|${sample.cmd}`
    const changed = fingerprint !== lastFingerprint
    lastFingerprint = fingerprint
    const heartbeat = Math.floor(sample.at / 1000) % 60 < intervalMs / 1000
    if (changed || heartbeat || sample.running) {
      appendFileSync(outFile, `${JSON.stringify(sample)}\n`)
    }
  } catch {
    /* host down — keep sampling */
  }
}

await tick()
setInterval(tick, intervalMs)
