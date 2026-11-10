/** Strong operation evidence only. Unknown commands leave phase inference to the observer. */
export function operationPhase(name, raw) {
  if (['write','edit','apply_patch','write_file','edit_file'].includes(name)) return 'implement'
  if (['read','glob','grep','read_file','web_fetch','web_search','read_image'].includes(name)) return 'discover'
  if (!['bash','exec_command','pwsh'].includes(name)) return null
  let args=raw
  try { if(typeof args==='string')args=JSON.parse(args) } catch {return null}
  const command=String(args?.command ?? args?.cmd ?? '')
  if (/\bnode(?:js)?\b[^\n]*\s--(?:test|check)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck)\b/u.test(command)) return 'verify'
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|bundle|install|add)\b|\b(?:cat|tee)\s*(?:>[^&]|[^\n]*<<)|\b(?:writeFile|write_text|write_bytes|copyFile)\s*\(/u.test(command)) return 'implement'
  if (/^\s*(?:ls|pwd|cat|rg|find|head|tail|wc)\b|^\s*sed\s+-n\b/u.test(command)) return 'discover'
  return null
}

export function activePhase(commands=[],forecastPhase) {
  for(const phase of ['verify','implement','discover']) if(commands.some(row=>row.active!==false&&row.phase===phase)) {
    // Reading can also be verification or delivery; it does not prove a return to exploration.
    if(phase==='discover'&&['implement','verify','deliver'].includes(forecastPhase))return null
    return phase
  }
  return null
}

/** Completing a known item is ordinary progress; new/reopened/removed work changes scope. */
export function planScopeChanged(previous=[], next=[]) {
  if (!previous.length) return false
  const key=item=>String(item.id ?? item.content)
  const before=new Map(previous.map(item=>[key(item),item.status]))
  const after=new Map(next.map(item=>[key(item),item.status]))
  return next.some(item=>item.status!=='completed'&&(!before.has(key(item))||before.get(key(item))==='completed')) || previous.some(item=>item.status!=='completed'&&!after.has(key(item)))
}

/** The job tool owns this suffix; arbitrary shell text does not. */
export function jobOutcome(text) {
  const match=/(?:^|\n)\[status: (running|stopping|completed|killed|failed)(?:, ([^\n]*))?\]$/u.exec(String(text).trimEnd())
  if(!match)return null
  const exit=/(?:^|[;,]\s*)exit code: (-?\d+|null)(?:$|[;,])/u.exec(match[2]??'')
  return{state:match[1],exitCode:exit&&exit[1]!=='null'?Number(exit[1]):null}
}

/** Shell tools report command exits as ordinary results, using terminal suffix markers. */
export function resultStatus(name,data,text,rawArgs) {
  if(data.error||data.message?.isError)return 'failed'
  if(!['bash','exec_command','pwsh','job_output'].includes(name))return 'completed'
  const tail=String(text).trimEnd()
  const job=name==='job_output'?jobOutcome(tail):null
  if(job)return ['running','stopping'].includes(job.state)?'background':['failed','killed'].includes(job.state)||job.exitCode!==null&&job.exitCode!==0?'failed':'completed'
  let args=rawArgs
  try{if(typeof args==='string')args=JSON.parse(args)}catch{args=null}
  // Recognize the explicit pipeline-status wrapper observed in the real Max run.
  // Arbitrary error-looking output is not proof that a command failed.
  const command=String(args?.command??args?.cmd??'')
  const pipelineExit=/\nEXIT=(\d+)$/u.exec(tail)
  if(pipelineExit&&command.includes('EXIT=${PIPESTATUS[0]}')&&/\becho\b/u.test(command)&&Number(pipelineExit[1])!==0)return 'failed'
  if(/^started background job \S+$/u.test(tail)||/\[still running after \d+ms; moved to background job [^\]\n]+\]$/u.test(tail))return 'background'
  const exit=/\n\[exit code: (\d+)\]$/u.exec(tail)
  if(exit&&Number(exit[1])!==0||/\n\[(?:killed by signal: [^\]\n]+|timed out after \d+ms|stopped: [^\]\n]+)\]$/u.test(tail))return 'failed'
  return 'completed'
}
