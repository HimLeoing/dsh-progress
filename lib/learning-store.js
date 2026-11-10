/** Small, versioned observations. A completed turn contributes one calibration vote. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const quantile = (values, p) => {
  if (!values.length) return null
  const a = [...values].sort((x, y) => x - y), index = (a.length - 1) * p
  return a[Math.floor(index)] + (a[Math.ceil(index)] - a[Math.floor(index)]) * (index % 1)
}
export { quantile }
/** Recognize only standalone literal delays; never execute or infer arbitrary code. */
export function declaredDuration(name, raw) {
  if (name !== 'bash' && name !== 'exec_command') return null
  let args=raw
  try { if(typeof raw==='string') args=JSON.parse(raw) } catch {return null}
  const cmd=String(args?.command ?? args?.cmd ?? '').trim()
  const sleep=/^sleep\s+(\d+(?:\.\d+)?)\s*$/u.exec(cmd)
  let ms=sleep?Number(sleep[1])*1000:null
  const node=/^(?:node|nodejs|node\.exe)\s+-e\s+(['"])([\s\S]*)\1\s*$/u.exec(cmd)
  if(node) {
    const timer=/^setTimeout\(\s*\(\s*\)\s*=>\s*console\.log\(\s*(?:'[^'\\\n]*'|"[^"\\\n]*")\s*\)\s*,\s*(\d+)\s*\)\s*;?$/u.exec(node[2])
    if(timer)ms=Number(timer[1])
  }
  return Number.isFinite(ms)&&ms>0&&ms<=86400000?ms:null
}
export function toolFamily(name, raw) {
  let args = raw
  try { if (typeof raw === 'string') args = JSON.parse(raw) } catch { args = {} }
  if (name !== 'bash' && name !== 'exec_command') return name
  if (declaredDuration(name,args) !== null) return 'shell:delay'
  const cmd = String(args?.command ?? args?.cmd ?? '').trim()
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|check|lint|typecheck)\b/u.test(cmd)) return 'shell:verify'
  if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|bundle)\b/u.test(cmd)) return 'shell:build'
  if (/\b(npm|pnpm|yarn|bun|pip|pip3|uv)\s+(install|add|sync)\b/u.test(cmd)) return 'shell:install'
  const binary = /^([\w./-]+)/u.exec(cmd)?.[1]?.split('/').at(-1) ?? 'other'
  if (binary === 'node' || binary === 'nodejs') return /\s-(?:e|p)\b/u.test(cmd) ? 'shell:node-eval' : 'shell:node-script'
  return `shell:${binary.slice(0, 40)}`
}
export function durationKey(cwd, name, args) { return JSON.stringify([cwd, toolFamily(name, args)]) }
export function durationSummary(values = [], seedMs = 5000) {
  const ms = quantile(values, .6) ?? seedMs
  return { ms, upperMs: quantile(values, .9) ?? seedMs * 2.5, samples: values.length }
}
export function createLearningStore(file = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'dsh-task-progress', 'learning.json')) {
  let data = { version: 1, durations: {}, calibrations: {}, localProfiles: {} }, timer = null, dirty = false
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (saved.version === 1 && saved.durations && saved.calibrations) {
      data.durations = Object.fromEntries(Object.entries(saved.durations).slice(-512).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.filter(n=>Number.isFinite(n)&&n>0&&n<=86400000).slice(-32)]))
      data.calibrations = Object.fromEntries(Object.entries(saved.calibrations).slice(-64).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.filter(row=>typeof row?.key==='string'&&Number.isFinite(row.logRatio)).slice(-32)]))
      data.localProfiles = Object.fromEntries(Object.entries(saved.localProfiles??{}).slice(-128).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.filter(row=>typeof row?.key==='string'&&Array.isArray(row.units)&&row.units.length===4&&row.units.every(n=>Number.isFinite(n)&&n>=0&&n<=100000)).slice(-32)]))
    }
  } catch {}
  const pending = new Map()
  const flush = () => {
    if (timer) clearTimeout(timer); timer = null
    if (!dirty) return
    try { fs.mkdirSync(path.dirname(file), {recursive:true}); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data), {mode:0o600}); fs.renameSync(tmp,file); dirty = false } catch {}
  }
  const changed = () => { dirty = true; if (!timer) { timer = setTimeout(flush, 1200); timer.unref?.() } }
  const cap = (object, limit) => { const keys = Object.keys(object); for (const key of keys.slice(0, Math.max(0, keys.length-limit))) delete object[key] }
  return {
    localPrior(key, seed) {
      const rows=data.localProfiles[key]??[],n=rows.length,shrink=n>=3?n/(n+8):0
      return{samples:n,units:seed.map((v,i)=>v*(1-shrink)+Math.max(v*.3,Math.min(v*3,quantile(rows.map(r=>r.units[i]),.5)??v))*shrink)}
    },
    observeLocal(key, identity, units) {
      if(!Array.isArray(units)||units.length!==4||units.some(n=>!Number.isFinite(n)||n<0||n>100000))return
      const rows=data.localProfiles[key]??[];if(rows.some(r=>r.key===identity))return
      data.localProfiles[key]=[...rows,{key:identity,units:units.slice()}].slice(-32);cap(data.localProfiles,128);changed()
    },
    duration(key, seed) { return durationSummary((data.durations[key] ?? []).filter(v=>Number.isFinite(v)&&v>0), seed) },
    observeDuration(key, ms) {
      if (!Number.isFinite(ms) || ms < 1 || ms > 86400000) return
      data.durations[key] = [...(data.durations[key] ?? []), ms].slice(-32)
      cap(data.durations, 512); changed()
    },
    forecast(id, turn, value) {
      if (!value.route || !Number.isFinite(value.remainingMs)) return
      const key = `${id}|${turn}`, list = pending.get(key) ?? []
      list.push(value); pending.set(key,list.slice(-64))
      if (pending.size > 64) pending.delete(pending.keys().next().value)
    },
    finish({sid,turn,status,at,evidenceRevision}) {
      const key = `${sid}|${turn}`, samples = pending.get(key) ?? []; pending.delete(key)
      if (status !== 'completed') return
      const groups = new Map()
      for (const sample of samples) {
        if(Number.isFinite(evidenceRevision)&&sample.evidenceRevision!==evidenceRevision)continue
        const actual = at - sample.at
        if (actual < 5000 || sample.remainingMs < 5000) continue
        const bucket = JSON.stringify([sample.route, sample.mode ?? 'turn'])
        if (!groups.has(bucket)) groups.set(bucket, [])
        groups.get(bucket).push(Math.log(Math.max(.1, Math.min(10, actual / sample.remainingMs))))
      }
      for (const [bucket, ratios] of groups) {
        const votes = data.calibrations[bucket] ?? []
        if (!votes.some(v => v.key === key)) votes.push({key, logRatio:quantile(ratios,.5)})
        data.calibrations[bucket] = votes.slice(-32)
      }
      if (groups.size) { cap(data.calibrations,64); changed() }
    },
    calibration(route, mode = 'turn') {
      const votes = (data.calibrations[JSON.stringify([route,mode])] ?? []).filter(v=>Number.isFinite(v.logRatio))
      if (votes.length < 8) return {samples:votes.length,factor:1,range:null}
      const ratios = votes.map(v=>Math.exp(v.logRatio))
      // Walk forward: each held-out vote is judged using earlier turns only.
      let rawLoss=0, adjustedLoss=0
      for (let i=3;i<votes.length;i++) {
        const factor=Math.max(.67,Math.min(1.5,quantile(ratios.slice(0,i),.5)))
        rawLoss+=Math.abs(votes[i].logRatio)
        adjustedLoss+=Math.abs(votes[i].logRatio-Math.log(factor))
      }
      const applied=adjustedLoss<rawLoss*.95
      return {samples:votes.length,applied,factor:applied?Math.max(.67,Math.min(1.5,quantile(ratios,.5))):1,range:applied?[quantile(ratios,.1),quantile(ratios,.9)]:null}
    },
    flush,
    dispose() { flush(); pending.clear() },
  }
}
