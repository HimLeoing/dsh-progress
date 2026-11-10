/** Causal ETA scoring: only actual completed turns provide ground truth. */
export function evaluateProbes(records) {
  const ends = new Map()
  const key = record => `${record.sid}|${record.turn}`
  for (const record of records) {
    if (record.kind === 'end' && Number.isFinite(record.at)) {
      // An explicit durable completed end is stronger than legacy idle polls.
      const previous = ends.get(key(record))
      if (!previous || record.status === 'completed' || previous.status !== 'completed') ends.set(key(record), record)
    }
  }
  const rows = []
  for (const record of records) {
    if (record.kind !== 'probe') continue
    const end = ends.get(key(record))
    if (!end || (end.status && end.status !== 'completed') || !Number.isFinite(record.at) || end.at <= record.at) continue
    rows.push({ sid: record.sid, turn: record.turn, at: record.at, elapsedMs: record.elapsedMs, actualMs: end.at - record.at, modelMs: record.modelEtaMs, heuristicMs: record.heuristicEtaMs, legacyEnd: !end.status })
  }
  const score = (subset, field) => {
    const errors = subset.filter(row => Number.isFinite(row[field])).map(row => Math.abs(row[field] - row.actualMs))
    return { samples: errors.length, coverage:subset.length?errors.length/subset.length:null, maeMs: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null, within60: errors.length ? errors.filter(error => error <= 60000).length / errors.length : null }
  }
  const groups = new Map()
  for (const row of rows) {
    const id = key(row)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(row)
  }
  const turns = [...groups.values()].map(group => ({ sid: group[0].sid, turn: group[0].turn, samples: group.length, model: score(group, 'modelMs'), heuristic: score(group, 'heuristicMs') }))
  const macro = method => {
    const values = turns.map(turn => turn[method].maeMs).filter(Number.isFinite)
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  }
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheReportedProbes: 0 }
  for (const record of records.filter(record => record.kind === 'probe')) {
    for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
      const value = record[field] ?? (field === 'inputTokens' ? record.inTokens : field === 'outputTokens' ? record.outTokens : undefined)
      if (Number.isFinite(value)) usage[field] += value
    }
    if (Number.isFinite(record.cacheReadTokens)) usage.cacheReportedProbes++
  }
  return { samples: rows.length, completedTurns: turns.length, legacySamples: rows.filter(row => row.legacyEnd).length, model: score(rows, 'modelMs'), heuristic: score(rows, 'heuristicMs'), macroMaeMs: { model: macro('model'), heuristic: macro('heuristic') }, usage, turns, rows }
}
