/** node tools/compare.mjs [probes.jsonl] [--json] */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { evaluateProbes } from '../lib/evaluation.js'
const args = process.argv.slice(2)
const file = args.find(arg => !arg.startsWith('--')) ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-progress', 'probes.jsonl')
const records = []
let skippedLines = 0
try {
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    try { records.push(JSON.parse(line)) } catch { skippedLines++ }
  }
} catch (error) {
  console.error(`Cannot read probe log: ${error.message}`)
  process.exitCode = 1
}
const report = { ...evaluateProbes(records), skippedLines }
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
else {
  const seconds = ms => ms === null ? '—' : `${Math.round(ms / 1000)}s`
  console.log(`graded probes: ${report.samples}; completed turns: ${report.completedTurns}`)
  for (const method of ['model', 'heuristic']) {
    const value = report[method]
    console.log(`${method.padEnd(10)}MAE ${seconds(value.maeMs)}; numeric ETA ${value.samples}/${report.samples}; ±60s ${value.within60 === null ? '—' : `${Math.round(value.within60 * 100)}%`}; equal-turn MAE ${seconds(report.macroMaeMs[method])}`)
  }
  console.log(`tokens: uncached input ${report.usage.inputTokens}, cached read ${report.usage.cacheReadTokens}, cached write ${report.usage.cacheWriteTokens}, output ${report.usage.outputTokens}`)
  if (report.legacySamples) console.log(`Legacy end times (poll-based, approximate): ${report.legacySamples} samples`)
  if (skippedLines) console.log(`Ignored incomplete/invalid lines: ${skippedLines}`)
  console.log('Accuracy on these recorded turns is not evidence for unseen projects.')
}
