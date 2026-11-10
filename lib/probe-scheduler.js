/** Bounded observer scheduling. Never wakes, injects into, or pauses an agent. */
export function createProbeScheduler({ probe, snapshot, buildRequest, onAnswer, setModel, log, now = () => Date.now(), options = {} }) {
  const intervalMs = options.intervalMs ?? 10000
  const minGapMs = options.minGapMs ?? 5000
  const maxBackoffMs = options.maxBackoffMs ?? 60000
  const maxPerTurn = options.maxPerTurn ?? Infinity
  const states = new Map()
  let inFlight = false
  let pendingSince = 0
  let controller = null
  let activeSession = null
  let disposed = false
  const attempts = []
  const fastPerHour = options.fastPerHour ?? 180
  const maxPerHour = options.maxPerHour ?? 240

  const stateOf = (id) => {
    let state = states.get(id)
    if (!state) {
      state = { interval: intervalMs, next: 0, lastAt: -Infinity, turn: -1, startedAt: 0, count: 0, failures: 0, lastPercent: null, lastEtaMs: null, endedTurn: -1, status:'calculating', lastError:null, lastAnswerAt:0, revision:null }
      states.set(id, state)
      if (states.size > 128) states.delete(states.keys().next().value)
    }
    return state
  }
  const write = (record) => { try { log?.(record) } catch { /* diagnostics never stop work */ } }

  return {
    stateOf,
    statusOf(id) {
      const state = states.get(id)
      return state ? {state:state.status,attempts:state.count,failures:state.failures,lastAnswerAt:state.lastAnswerAt,nextAt:state.next,intervalMs:state.interval,error:state.lastError,budgetLimited:attempts.length>=fastPerHour} : {state:'calculating',attempts:0,failures:0,lastAnswerAt:0}
    },
    get pendingSince() { return pendingSince },
    async tick(sessionId) {
      if (disposed) return { probed: false, reason: 'disposed' }
      if (inFlight) return { probed: false, reason: 'busy' }
      if (!sessionId) return { probed: false, reason: 'no-session' }
      const at = now()
      const state = stateOf(sessionId)
      const view = snapshot(sessionId)
      if (view.running !== true) {
        if (options.logIdleEnd !== false && state.count > 0 && state.endedTurn !== state.turn && view.turn === state.turn) {
          state.endedTurn = state.turn
          write({ at: view.endedAt || at, kind: 'end', sid: sessionId, turn: state.turn, status: view.turnStatus, elapsedMs: view.projectBar?.elapsedMs ?? 0 })
        }
        state.status = 'idle'
        return { probed: false, reason: 'idle' }
      }
      if (probe === null || !probe.available) {state.status='unavailable';return { probed: false, reason: 'no-model' }}
      if (view.turn !== state.turn || (view.startedAt ?? 0) !== state.startedAt) {
        Object.assign(state, { turn: view.turn, startedAt: view.startedAt ?? 0, count: 0, failures: 0, interval: intervalMs, next: at + intervalMs, lastPercent: null, lastEtaMs: null, status:'calculating', lastError:null, lastAnswerAt:0, revision:null })
      }
      if (state.count >= maxPerTurn) { state.status='budget'; return { probed: false, reason: 'capped' } }
      while (attempts.length && attempts[0] <= at-3600000) attempts.shift()
      if (attempts.length >= maxPerHour) {state.status='budget';state.next=Math.max(state.next,attempts[0]+3600000);return {probed:false,reason:'budget'}}
      if (state.revision !== null && view.probe?.revision !== state.revision && state.interval > intervalMs && at-state.lastAt >= intervalMs) state.next=Math.min(state.next,at)

      if (at < state.next) return { probed: false, reason: 'waiting' }
      if (at - state.lastAt < minGapMs) return { probed: false, reason: 'gap' }

      inFlight = true
      pendingSince = at
      controller = new AbortController()
      activeSession = sessionId
      const requestTurn = view.turn
      const requestStart = view.startedAt
      state.count += 1 // failures are billable attempts too
      attempts.push(at)
      state.status = 'updating'
      state.revision = view.probe?.revision ?? null
      let answer = null
      let payload
      let failure = null
      try {
        payload = buildRequest ? buildRequest(sessionId, view) : view.probe?.payload ?? ''
        answer = await probe.ask(payload, controller.signal, { sessionId })
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      } finally {
        inFlight = false
        pendingSince = 0
        controller = null
        activeSession = null
      }
      state.lastAt = now()
      // A probe can finish after turn/end, after the next turn started, or
      // after the plugin unloaded. Its answer belongs to none of those states.
      const latest = snapshot(sessionId)
      if (disposed || latest.running !== true || latest.turn !== requestTurn || latest.startedAt !== requestStart) {
        return { probed: false, reason: 'superseded' }
      }
      if (!answer || !Number.isFinite(answer.percent) || (!Number.isFinite(answer.remainingMs) && !(answer.remainingMs === null && (answer.phase === 'wait' || answer.confidence === 0)))) {
        state.failures += 1
        state.status = 'retrying'
        state.lastError = failure ?? probe.lastError ?? 'no answer'
        state.interval = Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(6, state.failures))
        state.next = state.lastAt + state.interval
        write({ at: state.lastAt, kind: 'failure', sid: sessionId, turn: requestTurn, error: failure ?? probe.lastError ?? 'no answer' })
        return { probed: false, reason: 'failed' }
      }
      state.failures = 0
      state.status = 'ready'
      state.lastError = null
      state.lastAnswerAt = state.lastAt
      const samePercent = state.lastPercent !== null && Math.abs(answer.percent - state.lastPercent) < 0.005
      const sameEta = answer.remainingMs===null ? state.lastEtaMs===null : state.lastEtaMs!==null&&Math.abs(answer.remainingMs-state.lastEtaMs)<5000
      state.lastPercent = answer.percent
      state.lastEtaMs = answer.remainingMs
      state.interval = samePercent && sameEta ? Math.min(maxBackoffMs, Math.round(state.interval * 1.6)) : intervalMs
      // Cadence is measured start-to-start, not response-to-start. Avoid the
      // accidental 15-second interval caused by 10 s + latency + a 5 s tick.
      if (attempts.length >= fastPerHour) state.interval=Math.max(state.interval,60000)
      if (answer.phase === 'wait' && answer.remainingMs === null && !(latest.commands?.length || latest.command?.active || latest.preparing)) state.interval = Math.max(state.interval,300000)
      state.next = Math.max(at + state.interval, state.lastAt + minGapMs)
      const remainingMs = answer.remainingMs === null ? null : Math.max(1000, answer.remainingMs - Math.max(0, state.lastAt - at))
      setModel(sessionId, {
        percent: Math.max(0, Math.min(0.99, answer.percent)), remainingMs,
        at: state.lastAt, turn: requestTurn, latencyMs: answer.latencyMs ?? null,
        evidenceRevision:view.evidenceRevision ?? 0,
        phase:answer.phase ?? 'unknown', confidence:answer.confidence ?? null, route:`${answer.provider ?? ''}:${answer.model ?? ''}:${answer.estimatorVersion ?? 'legacy'}`, 
      })
      onAnswer?.(sessionId, answer, view)
      const promptChars = typeof payload === 'string' ? payload.length : JSON.stringify(payload).length
      write({
        at: state.lastAt, requestedAt: at, kind: 'probe', sid: sessionId, turn: requestTurn,
        estimatorVersion:answer.estimatorVersion ?? 'legacy', evidenceRevision:view.evidenceRevision ?? 0, modelPercent: answer.percent, modelEtaMs: answer.confidence===0?null:remainingMs, rawEtaMs:remainingMs, phase:answer.phase ?? 'unknown', confidence:answer.confidence ?? null,
        heuristicPercent: latest.projectBar?.percent ?? null, heuristicEtaMs: latest.projectBar?.remainingMs ?? null,
        elapsedMs: latest.projectBar?.elapsedMs ?? 0, mode: latest.projectBar?.mode ?? null,
        promptChars, inTokens: answer.usage?.inputTokens ?? null, outTokens: answer.usage?.outputTokens ?? null,
        cacheReadTokens: answer.usage?.cacheReadTokens ?? null, cacheWriteTokens: answer.usage?.cacheWriteTokens ?? null,
        reasoningTokens: answer.usage?.reasoningTokens ?? null, provider: answer.provider, model: answer.model,
        latencyMs: answer.latencyMs ?? null,
      })
      return { probed: true, interval: state.interval, percent: answer.percent }
    },
    cancel(id) { if (activeSession === id) controller?.abort() },
    dispose() { disposed = true; controller?.abort(); states.clear() },
  }
}
