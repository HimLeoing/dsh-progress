import {commandMetadata,commandProgress}from'./command-progress.js'
import {createJobProgress}from'./job-progress.js'
import { taskGraphRemaining } from './task-graph.js'
import { declaredDuration, durationKey, durationSummary } from './learning-store.js'
import { activePhase, operationPhase, planScopeChanged, resultStatus, jobOutcome } from './progress-evidence.js'
import {planCoverage,planKey,normalizeWeights} from './weighted-progress.js'
import {createChildMetadata,workElapsed,belongsToTurn} from './child-metadata.js'
import {freezeLocalCheckpoint}from'./local-continuity.js'
import {localProgress,modelContinuity} from './local-progress.js'
import {workerProgress} from './worker-progress.js'
import {createLocalEvidence,readLocalEvidence,setLocalGoal,syncLocalPlan,bindLocalItems,recordLocalOperation,estimateLocalProgress,trainLocalScope,localOperationPhase} from './local-estimator.js'
import {localWorkFacts,localVerificationGrade} from './local-work-evidence.js'
/**
 * Durable per-turn execution evidence, checklists, team rosters and tool clocks.
 * Legacy timing estimates remain internal for compatibility; the public panel
 * uses localProgress: observable counts, optional weighted estimates, no ETA.
 * A successful turn ends at 100%; interrupted turns retain their last evidence.
 */

/** Cold-start duration per tool, replaced by observation as soon as it exists. */
const DEFAULT_TOOL_MS = {
  bash: 14000,
  read: 900,
  edit: 1600,
  write: 2400,
  glob: 700,
  grep: 2600,
  web_fetch: 6000,
  web_search: 7000,
  read_image: 2600,
  present: 600,
  todo_write: 400,
}

/** EWMA weight for learned durations. */
const TOOL_EWMA = 0.35
const ITEM_EWMA = 0.35
const TURN_EWMA = 0.3

const ITEM_ETA_SEED_MS = 90000
const ITEM_ETA_MIN_MS = 4000
const ITEM_ETA_MAX_MS = 3600000
const STEP_ETA_SEED_MS = 60000
const STEP_ETA_MIN_MS = 3000
const STEP_ETA_MAX_MS = 1800000
const TURN_ETA_SEED_MS = 240000
const TURN_ETA_MIN_MS = 15000
const TURN_ETA_MAX_MS = 3 * 3600000

/** Events replayed per session when the tracker first meets it. */
const MAX_TRANSCRIPT_CHARS = 120000
const MAX_STATES = 128
const MAX_JOB_FAILURES = 128

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

/**
 * One curve for every bar, and both readouts come out of it together:
 *   percent   = 1 - e^(-t/eta)
 *   remaining = eta · e^(-t/eta) = eta · (1 - percent)
 * The pair is self-consistent (their sum is eta), so the countdown can never
 * run past zero while the bar is still moving, and neither ever freezes: past
 * the estimate the bar creeps towards 100% and the countdown decays towards
 * zero instead of stopping.
 */
function estimate(elapsedMs, etaMs) {
  const eta = Math.max(1000, etaMs)
  const ratio = Math.max(0, elapsedMs) / eta
  const raw = 1 - Math.exp(-ratio)
  return { percent: raw, remainingMs: eta * (1 - raw) }
}

/** Epoch milliseconds from an event's `time`, else now. */
function stamp(time) {
  return typeof time === 'number' && Number.isFinite(time) && time > 1e12 ? time : Date.now()
}

/** Normalize a `todo/write` payload into `[{ content, status }]`. */
function normalizeTodos(raw) {
  if (!Array.isArray(raw)) return []
  const todos = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (content === '') continue
    const status = item.status === 'completed' ? 'completed' : item.status === 'in_progress' ? 'in_progress' : 'pending'
    todos.push({ content, status,...(typeof item.id==='string'?{id:item.id}:{}),...(Number.isFinite(item.weight)&&item.weight>0?{weight:item.weight}:{}),...(typeof item.owner==='string'?{owner:item.owner}:{}),...(Array.isArray(item.blockedBy)?{blockedBy:item.blockedBy.slice(0,32)}:{}) })
  }
  return todos
}

/** A short, human-readable excerpt of a tool call's arguments. */
function summarizeArgs(rawArgs) {
  let args = null
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
  } catch {
    return ''
  }
  if (args === null || typeof args !== 'object') return ''
  const keys = ['description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'name', 'job_id']
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') {
      const target=['file_path','path'].includes(key)?value.split(/[\\/]/u).filter(Boolean).slice(-2).join('/'):value
      const line = target.replace(/\s+/gu, ' ').trim()
      return line.length > 56 ? `${line.slice(0, 56)}…` : line
    }
  }
  return ''
}

/** Keep operation metadata, never file bodies or generated code, in local-mode caches. */
function compactArgs(raw) {
 try{const args=typeof raw==='string'?JSON.parse(raw):raw;return JSON.stringify(Object.fromEntries(['description','command','cmd','path','file_path','pattern','url','query','name','job_id'].filter(key=>typeof args?.[key]==='string').map(key=>[key,args[key].slice(0,1200)])))}catch{return '{}'}
}

/**
 * Build the tracker bound to one Host context.
 * @param ctx - context carrying the optional `sessions`, `agents`, `agentTeams`.
 * @param options.persistence - `{ load(id), save(id, record) }`, optional.
 */
export function createTracker(ctx, options = {}) {
  const states = new Map()
  const archived = new Map()
  const runningById = new Map()
  const toolEta = new Map()
  const persistence = options.persistence ?? null
  const childMetadata=createChildMetadata(ctx)
  const metadataJobs=new Map()
  const jobProgress=createJobProgress(ctx)

  function etaFor(name, cwd = '', args = '') {
    const key = durationKey(cwd, name, args)
    const seed = DEFAULT_TOOL_MS[name] ?? 5000
    const local = toolEta.get(key) ?? []
    const stored = options.learning?.duration(key, seed)
    return stored && stored.samples >= local.length ? stored : durationSummary(local, seed)
  }

  function learnTool(state, tool, ms) {
    if (!Number.isFinite(ms) || ms <= 0) return
    const key = durationKey(state.cwd, tool.name, tool.args)
    toolEta.set(key, [...(toolEta.get(key) ?? []), ms].slice(-32))
    if (!state.replaying) options.learning?.observeDuration(key, ms)
    if(!state.replaying&&['bash','exec_command','pwsh'].includes(tool.name)&&tool.commandMeta?.key)options.learning?.observeDuration(JSON.stringify([state.cwd,tool.commandMeta.key]),ms)
    if (toolEta.size > 512) toolEta.delete(toolEta.keys().next().value)
  }

  function createState(session) {
    const restored = persistence?.load(String(session.id)) ?? null
    const learned = Number(session.seq ?? 0) > 0 ? null : restored
    return {
      id: String(session.id),
      origin: session.header?.origin,
      parentSession: session.header?.parentSession,
      agentName: restored?.agentName??null,
      createdAt: session.header?.createdAt ?? 0,
      childRoster: new Map(),
      replaying: false,
      teamBaseline: new Set(),
      lastPhase: restored?.phase ?? 'unknown',
      evidenceRevision: 0,
      boundary: null,
      observedPhase: null,
      stream: null,
      lastTeamItems: null,
      cwd: typeof session.header?.cwd === 'string' ? session.header.cwd : '',
      turn: restored?.turn ?? 0,
      steps: 0,
      stepsThisTurn: 0,
      turns: new Map(),
      running: false,
      turnStartedAt: 0,
      turnEndedAt: 0,
      turnStatus: restored?.status ?? 'idle',
      runningTool: null,
      runningTools: new Map(),
      lastTool: learned?.lastTool ?? null,
      recentOperations: [],
      completedOperations: learned?.operations?.completed ?? 0,
      failedOperations: learned?.operations?.failed ?? 0,
      jobFailures: new Map(),finishMaterial:0,finalReadyMaterial:null,finalPlanState:null,finishNotified:new Set(),finishEvidence:null,
      notifiedTurnEndSeq: null,
      activeKey: null,
      activeSince: 0,
      itemEtaMs: learned?.itemEtaMs ?? ITEM_ETA_SEED_MS,
      turnEtaMs: learned?.turnEtaMs ?? TURN_ETA_SEED_MS,
      itemEtaSamples: learned?.itemEtaSamples ?? 0,
      turnEtaSamples: learned?.turnEtaSamples ?? 0,
      stepStartedAt: 0,
      stepEtaMs: STEP_ETA_SEED_MS,
      stepEtaSamples: 0,
      frozenPercent: restored?.percent ?? 0,
      frozenDone: restored?.done ?? 0,
      frozenTotal: restored?.total ?? 0,
      lastEventAt: 0,
      lastActivityAt: Date.now(),
      events: 0,
      seeded: false,
      goal: '',
      recentTools: [],
      model: null,
      lastKnownProgress:restored?.lastKnownProgress??null,
      localEvidence:readLocalEvidence(learned?.localEvidence)??createLocalEvidence('',{learning:options.learning,cwd:session.header?.cwd??''}),
      weightPlan:null,localBridge:restored?.localBridge??null,lastAiReference:restored?.lastAiReference??null,
      observations:[],probeStats:null,
      changedFiles:[],checks:[],milestones:[],assistantSummary:'',assistantRevision:0,notifiedStepSeq:null,
      transcript: [],
      transcriptOffset: 0,
      transcriptChars: 0,
      requestContext: '',
      lastSeq: -1,
      lastPersistAt: 0,
      restored,
    }
  }

  /**
   * Append one transcript line. Bounded by *count* only at turn boundaries:
   * within a turn the array is append-only so the probe's conversation keeps an
   * identical prefix and the provider can serve it from cache.
   */
  function push(state, now, line) {
    if(options.captureTranscript===false)return
    line = String(line).slice(0, 32000)
    const seconds = state.turnStartedAt > 0 ? Math.round((now - state.turnStartedAt) / 1000) : 0
    state.transcript.push(`[+${seconds}s] ${line}`)
    state.transcriptChars += state.transcript.at(-1).length
    while (state.transcriptChars > MAX_TRANSCRIPT_CHARS && state.transcript.length > 1) {
      state.transcriptChars -= state.transcript.shift().length
      state.transcriptOffset += 1
    }
  }

  /** Re-point the current-item clock; a change teaches the item estimate. */
  function noteActive(state, key, now) {
    if (key === state.activeKey) return
    if (state.activeKey !== null && state.activeSince > 0) {
      const spent = now - state.activeSince
      if (spent > 2000) {
        state.itemEtaMs = clamp(state.itemEtaMs + (spent - state.itemEtaMs) * ITEM_EWMA, ITEM_ETA_MIN_MS, ITEM_ETA_MAX_MS)
        state.itemEtaSamples += 1
      }
    }
    state.activeKey = key
    state.activeSince = key === null ? 0 : now
  }

  function learnStep(state, ms) {
    if (!Number.isFinite(ms) || ms < 500) return
    state.stepEtaMs = clamp(state.stepEtaMs + (ms - state.stepEtaMs) * TURN_EWMA, STEP_ETA_MIN_MS, STEP_ETA_MAX_MS)
    state.stepEtaSamples += 1
  }

  function learnTurn(state, ms) {
    if (!Number.isFinite(ms) || ms < 5000) return
    state.turnEtaMs = clamp(state.turnEtaMs + (ms - state.turnEtaMs) * TURN_EWMA, TURN_ETA_MIN_MS, TURN_ETA_MAX_MS)
    state.turnEtaSamples += 1
  }

  function finishEvidence(state,event,kind,ready=true){
    if(ready)state.finalReadyMaterial=state.finishMaterial
    const key=`${state.turn}:${state.finishMaterial}:${state.evidenceRevision}:${kind}`
    if(state.finishNotified.has(key))return
    state.finishNotified.add(key);if(state.finishNotified.size>128)state.finishNotified.delete(state.finishNotified.values().next().value)
    if(!state.replaying)state.finishEvidence={nativeSeq:event.seq,seq:`evidence:${event.seq}`,step:state.stepsThisTurn,at:stamp(event.time),kind:'finish-evidence',evidenceKind:kind,evidenceKey:key}
  }

  function syncFinalPlan(state, items) {
    const complete=items.length>0&&items.every(item=>item.status==='completed')
    const key=complete?planKey(items):null
    if(!complete)state.finalPlanState=null
    else if(state.finalPlanState?.key!==key)state.finalPlanState={key,material:state.finishMaterial}
    return complete
  }

  function localItemsFor(state) {
    const own=state.turns.get(state.turn)??[]
    if(own.length)return own
    const parent=states.get(String(state.parentSession)),labels=new Set([state.id,state.agentName,parent?.childRoster.get(state.id)?.label].filter(Boolean))
    const assigned=items=>state.parentSession?items.filter(item=>labels.has(item.owner)):items
    const team=readTeam(state.id,state.teamBaseline)
    for(const member of team?.members??[])if(String(member.id)===state.id&&member.name)labels.add(member.name)
    if(team?.items?.length)return assigned(team.items)
    if(state.lastTeamItems?.length)return assigned(state.lastTeamItems)
    const parentTeam=parent?readTeam(parent.id,parent.teamBaseline):null
    for(const member of parentTeam?.members??[])if(String(member.id)===state.id&&member.name)labels.add(member.name)
    const board=parent?(parentTeam?.items??parent.lastTeamItems??[]):[]
    return board.filter(item=>labels.has(item.owner))
  }

  function syncLocal(state,items,train=false) {
    state.localEvidence??=createLocalEvidence(state.goal,{learning:options.learning,cwd:state.cwd})
    syncLocalPlan(state.localEvidence,items,{learning:options.learning,cwd:state.cwd})
    if(train&&!state.replaying)for(const key of state.localEvidence.keys){const s=state.localEvidence.items[key];if(s?.status==='completed')trainLocalScope(state.localEvidence,options.learning,state.cwd,key,s,`${state.id}:${state.turn}:${key}:${s.cycle??0}`)}
  }

  function apply(state, event) {
    // ensure() may seed the event currently being delivered. Never fold it
    // twice, or clocks, learning and turn numbers can all be corrupted.
    if (typeof event.seq === 'number' && event.seq <= state.lastSeq) return
    const now = stamp(event.time)
    let data = event.data ?? {}, type=event.type, newFailureEvidence=false
    const dispatchedWork=type==='tool/ptc-dispatch-start'?localWorkFacts(data.name,data.arguments):null
    if(type==='tool/ptc-dispatch-start') {type='tool/call';data={...data,callId:`ptc:${data.subCallId}`,nested:true,arguments:JSON.stringify(Object.fromEntries(Object.entries(data.arguments ?? {}).filter(([key])=>key!=='content').map(([key,value])=>[key,typeof value==='string'?value.slice(0,1200):value])))}}
    else if(type==='tool/ptc-dispatch') {type='tool/result';data={error:data.error,message:{toolCallId:`ptc:${data.subCallId}`,content:data.content,isError:data.isError}}}
    switch (type) {
      case 'subagent/descriptor':
        if(typeof data.label==='string')state.agentName=data.label.trim().slice(0,240)||state.agentName
        break
      case 'turn/start':
        if (state.turnStartedAt > 0) persist(state)
        state.turn = typeof data.turn === 'number' ? data.turn : state.turn + 1
        state.running = true
        state.turnStatus = 'running'
        state.turnStartedAt = now
        state.turnEndedAt = 0
        // A plan belongs to ONE turn: dropping it here is what stops a finished
        // 7/7 from following the conversation into the next turn.
        state.teamBaseline = new Set((readTeam(state.id)?.items ?? []).filter(item => item.status === 'completed').map(item => item.id))
        state.turns.clear()
        state.stepsThisTurn = 0
        state.activeKey = null
        state.activeSince = 0
        state.runningTool = null
        state.runningTools.clear()
        state.lastTool = null
        state.frozenPercent = 0
        state.frozenDone = 0
        state.frozenTotal = 0
        state.goal = ''
        state.localEvidence=createLocalEvidence('',{learning:options.learning,cwd:state.cwd})
        state.recentTools = []
        state.recentOperations=[]
        state.model = null
        state.lastKnownProgress=null
        state.weightPlan=null;state.localBridge=null;state.lastAiReference=null
        state.observations=[];state.probeStats=null;state.changedFiles=[];state.checks=[];state.milestones=[];state.assistantSummary='';state.assistantRevision=0;state.notifiedStepSeq=null
        state.lastPhase = 'unknown'
        state.completedOperations=0
        state.failedOperations=0
        state.jobFailures.clear();state.finishMaterial=0;state.finalReadyMaterial=null;state.finalPlanState=null;state.finishNotified.clear();state.finishEvidence=null
        state.evidenceRevision = 0
        state.boundary=null
        state.observedPhase = null
        state.stream = null
        state.lastTeamItems = null
        state.childRoster.clear()
        state.transcript = []
        state.transcriptOffset = 0
        state.transcriptChars = 0
        state.restored = null
        break
      case 'turn/end': {
        if(data.turn!==undefined&&data.turn!==state.turn)break
        // Capture the last displayed semantic percentage before clearing live
        // state. A cancelled turn must never jump to the unrelated clock curve.
        if (state.model?.turn === state.turn) state.frozenPercent = Math.min(0.99, state.model.percent)
        if(state.localEvidence)state.localEvidence.lastPercent=localProgress(view(state),{aiEnabled:false}).percent
        state.running = false
        state.turnEndedAt = now
        const kind = data.reason?.kind ?? 'completed'
        state.turnStatus = kind === 'completed' ? 'completed' : 'interrupted'
        state.runningTool = null
        state.runningTools.clear()
        state.model = null
        state.stream = null
        if (state.turnStatus === 'completed') state.frozenPercent = 1
        if (state.turnStatus === 'completed' && state.turnStartedAt > 0) learnTurn(state, now - state.turnStartedAt)
        if(state.turnStatus==='completed'&&!state.replaying&&state.localEvidence)trainLocalScope(state.localEvidence,options.learning,state.cwd,'root',state.localEvidence.root,`${state.id}:${state.turn}:root`)
        break
      }
      case 'step/start':
        state.steps += 1
        state.stepsThisTurn += 1
        // One clock per step: it is what the "current work" bar measures when
        // no tool is running (the model is thinking inside this step).
        state.stepStartedAt = now
        break
      case 'step/end':
        if (state.stepStartedAt > 0) learnStep(state, Math.max(0, now - state.stepStartedAt))
        state.stepStartedAt = 0
        break
      case 'assistant/message': {
        const blocks = Array.isArray(data.message?.content) ? data.message.content : []
        const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(' ').trim()
        if(text!==''){state.assistantSummary=text.slice(-700);state.assistantRevision++}
        if(text.length>=80)recordLocalOperation(state.localEvidence,{name:'assistant/output',label:'response',fingerprint:text.slice(0,400),phase:['research','general'].includes(state.localEvidence?.root.kind)?'discover':'implement',status:'completed',credit:.2,owners:bindLocalItems(state.localEvidence,state.turns.get(state.turn)??[])})
        if (text !== '') push(state, now, `assistant: ${text.slice(0, 12000)}`)
        break
      }
      case 'user/message': {
        // User-role injected catalogs/system instructions are not the human's
        // task. Including them inflated probes and could replace the real goal.
        if (data.source && data.source.kind !== 'user' && !(state.origin === 'subagent' && data.source.kind === 'agent-message')) break
        {
          const blocks = Array.isArray(data.content) ? data.content : []
          const text = blocks.filter((block) => block?.type === 'text').map(block => block.text ?? '').join('\n')
          if (typeof text === 'string' && text.trim() !== '') {
            const content = text.trim().slice(0, options.captureTranscript===false?4000:24000)
            if (state.goal !== '' && state.goal !== content) state.evidenceRevision += 1
            if(options.captureTranscript===false){
              const previous=state.requestContext??''
              state.goal=previous&&content.length<1600&&previous!==content?`CURRENT: ${content}\nEARLIER REQUEST (reference only): ${previous.slice(0,2200)}`:content
            }else if (state.goal === '') state.goal = content
            // Keep substantive request history across "continue" turns. This
            // is reference context only; it never goes into the user's inbox.
            if (!data.source || data.source.kind === 'human' || data.source.kind === 'user' || state.origin === 'subagent' && data.source.kind === 'agent-message') {
              state.requestContext = options.captureTranscript===false?state.goal.slice(0,4000):`${state.requestContext}\n${content}`.slice(-32000)
            }
            push(state, now, `user: ${content}`)
            setLocalGoal(state.localEvidence,state.goal,{learning:options.learning,cwd:state.cwd})
          }
        }
        break
      }
      case 'tool/call':
        syncFinalPlan(state,localItemsFor(state))
        syncLocal(state,localItemsFor(state))
        if(data.name==='present'){state.observedPhase='deliver';finishEvidence(state,event,'delivery-ready',false)}
        if(data.nested){const outer=state.runningTools.get(String(data.rootCallId));if(outer)outer.hasChildren=true}
        {const phase=operationPhase(data.name,data.arguments);if(phase&&!(phase==='discover'&&['verify','deliver'].includes(state.observedPhase)))state.observedPhase=phase}
        push(state, now, `tool ${String(data.name ?? '?')}: ${typeof data.arguments === 'string' ? data.arguments.slice(0, 6000) : JSON.stringify(data.arguments ?? {}).slice(0, 6000)}`)
        if (typeof data.name === 'string') {
          state.recentTools.push(data.name)
          if (state.recentTools.length > 12) state.recentTools.shift()
        }
        state.runningTool = {
          callId: String(data.callId ?? ''),
          name: typeof data.name === 'string' ? data.name : 'tool',
          commandMeta:commandMetadata(data.name,data.arguments),
          localWork:dispatchedWork??localWorkFacts(data.name,data.arguments),
          args: options.captureTranscript===false ? compactArgs(data.arguments) : typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}),
          startedAt: now,
          step: typeof data.step === 'number' ? data.step : 0,
          nested:data.nested===true,
          rootCallId:data.rootCallId,
          localOwners:bindLocalItems(state.localEvidence,localItemsFor(state)),
        }
        state.runningTools.set(state.runningTool.callId, state.runningTool)
        break
      case 'job/registered': {
        const call=String(data.toolCall?.callId??''),tool=state.runningTools.get(call)??state.runningTools.get('ptc:'+call)
        jobProgress.bind(data,{meta:tool?.commandMeta,label:tool?summarizeArgs(tool.args):'',turn:state.turn,owner:state.id})
        break
      }
      case 'tool/result': {
        const callId = String(data.message?.toolCallId ?? '')
        const tool = callId ? state.runningTools.get(callId) : state.runningTool
        if (tool === null || tool === undefined) break
        if (callId !== '' && tool.callId !== '' && callId !== tool.callId) break
        const ms = Math.max(0, now - tool.startedAt)
        const text = options.captureTranscript===false ? ['bash','exec_command','pwsh','job_output'].includes(tool.name)?(data.message?.content??[]).filter(block=>block?.type==='text').slice(-2).map(block=>String(block.text??'').slice(-4096)).join('\n'):'' : (data.message?.content ?? []).filter?.(block => block?.type === 'text').map(block => block.text ?? '').join('\n') ?? ''
        const status=resultStatus(tool.name,data,text,tool.args)
        if(status==='completed') learnTool(state, tool, ms)
        const failed=status==='failed'
        const jobRead=tool.name==='job_output'&&!data.error&&data.message?.isError!==true
        const job=jobRead?jobOutcome(text):null
        let jobId=null
        if(jobRead)try{const id=JSON.parse(tool.args)?.job_id;if(typeof id==='string'&&id.length>0&&id.length<=1200)jobId=id}catch{}
        let newFailure=failed
        if(failed&&jobId&&job&&['completed','failed','killed'].includes(job.state)){
          newFailure=!state.jobFailures.has(jobId)
          if(newFailure){state.jobFailures.set(jobId,job.state);if(state.jobFailures.size>MAX_JOB_FAILURES)state.jobFailures.delete(state.jobFailures.keys().next().value)}
        }
        // A successful output read and the work's failed outcome are separate:
        // each read completes, but an immutable failed job is new evidence once.
        if(tool.name!=='run_code'||!tool.hasChildren){if(status==='completed'||jobRead)state.completedOperations++;if(newFailure)state.failedOperations++}
        const verification=localVerificationGrade(tool.localWork,text)
        if((tool.name!=='run_code'||!tool.hasChildren)&&tool.name!=='job_output')recordLocalOperation(state.localEvidence,{...tool.localWork,verification,name:tool.name,label:summarizeArgs(tool.args),fingerprint:tool.localWork?.fingerprint??compactArgs(tool.args),phase:localOperationPhase(tool.name,tool.args,operationPhase(tool.name,tool.args),state.localEvidence.root.kind),status,infinite:tool.commandMeta?.serviceIntent==='explicit',owners:tool.localOwners})
        if(tool.name==='job_output'&&newFailure)recordLocalOperation(state.localEvidence,{name:'background-job',phase:'implement',status:'failed',owners:tool.localOwners})
        if(status==='completed'&&!state.replaying)for(const key of tool.localOwners??[]){const s=state.localEvidence?.items[key];if(s?.status==='completed')trainLocalScope(state.localEvidence,options.learning,state.cwd,key,s,`${state.id}:${state.turn}:${key}:${s.cycle??0}`)}
        if(status==='completed'&&['write','edit','apply_patch','write_file','edit_file'].includes(tool.name)){
          try{const args=JSON.parse(tool.args),target=String(args.file_path??args.path??'').split(/[\\/]/u).slice(-3).join('/');if(target){state.changedFiles=state.changedFiles.filter(file=>file!==target);state.changedFiles.push(target);if(state.changedFiles.length>24)state.changedFiles.shift()}}catch{}
        }
        if(['verify','deliver'].includes(operationPhase(tool.name,tool.args))||newFailure){state.checks.push({name:tool.name,label:summarizeArgs(tool.args),status});if(state.checks.length>6)state.checks.shift()}
        if(status==='completed'&&(['implement','verify','deliver'].includes(operationPhase(tool.name,tool.args))||/write|edit|fix|patch|update|create|implement|rework|修复|修改|创建|实现/iu.test(summarizeArgs(tool.args)))){state.milestones.push({name:tool.name,label:summarizeArgs(tool.args)});if(state.milestones.length>10)state.milestones.shift()}
        if(newFailure)state.evidenceRevision += 1
        if(newFailure||status==='completed'&&operationPhase(tool.name,tool.args)==='implement')state.finishMaterial++
        if(status==='completed'&&verification>=2)finishEvidence(state,event,'verification-ready')
        if(status==='completed'&&tool.name==='present'&&state.localEvidence.root.delivered)finishEvidence(state,event,'delivery-confirmed')
        newFailureEvidence=newFailure
        if(tool.name!=='run_code'||!tool.hasChildren||failed)state.lastTool = { id:`${state.turn}:${event.seq??state.events}:${tool.callId}`, name: tool.name, label: summarizeArgs(tool.args), ms, finishedAt: now, status, phase:operationPhase(tool.name,tool.args),...(jobId?{jobId}:{}),...(job?{jobState:job.state}:{}) }
        if(tool.name!=='run_code'||!tool.hasChildren||failed){state.recentOperations.push({...state.lastTool});if(state.recentOperations.length>6)state.recentOperations.shift()}
        push(state, now, `result ${tool.name}: ${ms}ms; outcome=${status}\n${text.slice(0, 3000)}`)
        state.runningTools.delete(tool.callId)
        state.runningTool = [...state.runningTools.values()].at(-1) ?? null
        break
      }
      case 'todo/write': {
        const next=normalizeTodos(data.todos)
        if(planScopeChanged(state.turns.get(state.turn) ?? [],next))state.evidenceRevision += 1
        state.turns.set(state.turn, next)
        syncFinalPlan(state,next)
        syncLocal(state,next,true)
        const list = state.turns.get(state.turn)
        const active = state.running ? list.find((item) => item.status === 'in_progress') ?? null : null
        push(state, now, `plan: ${JSON.stringify(list)}`)
        noteActive(state, active === null ? null : active.content, now)
        break
      }
      default:
        break
    }
    if(['step/end','tool/result','todo/write'].includes(type))state.boundary={seq:event.seq??state.events+1,at:now,kind:type,important:type==='todo/write'||newFailureEvidence}
    state.events += 1
    if (typeof event.seq === 'number') state.lastSeq = event.seq
    state.lastEventAt = now
    state.lastActivityAt = Date.now()
  }

  function seed(state, session) {
    state.seeded = true
    state.replaying = true
    try {
      // One initial replay, then an event watermark. Starting at the last
      // 2000 events can omit turn/start and resurrect a stopped turn as live.
      for (const event of session.snapshotEvents(0)) apply(state, event)
    } catch {
      /* an unreadable log only costs a cold start */
    } finally { state.replaying = false }
  }

  function ensure(session, liveEvent = false) {
    const id = String(session.id)
    let state = states.get(id)
    if (state === undefined) {
      state = createState(session)
      states.set(id, state)
      seed(state, session)
      if (!liveEvent && state.turnStartedAt > 0 && state.running && runningById.get(id) !== true) {
        // An open log after a crash is interrupted unless the live API has
        // explicitly announced that its agent is still running.
        const agent = ctx.get('agents')?.get?.(id)
        if (agent?.status !== 'running') {
          state.running = false
          state.turnStatus = 'interrupted'
          state.turnEndedAt = state.lastEventAt
          state.runningTool = null
          state.runningTools.clear()
        }
      }
      const restored = persistence?.load(id)
      const oldLocal=restored?.turn===state.turn?readLocalEvidence(restored.localEvidence):null
      if(oldLocal){
        // Keep priors frozen across replay; new evidence since the last save is retained.
        for(const [live,saved] of [[state.localEvidence.root,oldLocal.root],...Object.entries(state.localEvidence.items).map(([key,s])=>[s,oldLocal.items[key]])])if(saved){live.prior=saved.prior.slice();live.samples=saved.samples}
        state.localEvidence.trained=oldLocal.trained;state.localEvidence.lastPercent=oldLocal.lastPercent
        if(state.localEvidence.signature===oldLocal.signature)state.localEvidence.weights=oldLocal.weights.slice()
      }
      if(restored?.turn===state.turn){if(restored.lastKnownProgress)state.lastKnownProgress=restored.lastKnownProgress;if(restored.weightPlan)state.weightPlan=restored.weightPlan;state.localBridge=restored.localBridge??null;state.lastAiReference=restored.lastAiReference??null;state.observations=restored.observations??state.observations;state.probeStats=restored.probeStats??state.probeStats;for(const child of restored.children??[])state.childRoster.set(child.id,child);if(restored.teamBaseline)state.teamBaseline=new Set(restored.teamBaseline);if(restored.mode==='team'&&restored.plan?.length)state.lastTeamItems=restored.plan}
      if (!state.running && state.turnStatus !== 'completed' && restored?.turn === state.turn) {
        state.frozenPercent = restored.percent ?? state.frozenPercent
        state.frozenDone = restored.done ?? state.frozenDone
        state.frozenTotal = restored.total ?? state.frozenTotal
      }
      if (states.size > MAX_STATES) {
        for (const [staleId, stale] of states) {
          if (states.size <= MAX_STATES) break
          if (staleId !== id && !stale.running) { persist(stale); states.delete(staleId) }
        }
      }
    }
    return state
  }

  const offEvent = ctx.on('session/event', (session, event) => {
    if (session === null || session === undefined) return
    const state = ensure(session, true)
    if (!state.seeded) seed(state, session)
    const revisionBefore = state.evidenceRevision
    const fresh = typeof event.seq !== 'number' || event.seq > state.lastSeq
    apply(state, event)
    const parent=states.get(String(state.parentSession))
    if(fresh&&parent?.running&&parent.childRoster.has(state.id)){
      const saved=parent.childRoster.get(state.id)??{id:state.id}
      try{const clock=childMetadata.event(session,event,parent.turnStartedAt,0,saved.workClock);parent.childRoster.set(state.id,{...saved,workClock:clock,elapsedMs:workElapsed(clock,{running:state.running}),elapsedBasis:'cumulative'})}catch{}
    }
    if(fresh&&parent?.running&&state.boundary?.seq===event.seq){
      parent.boundary={...state.boundary,seq:`child:${state.id}:${event.seq}`,kind:`child/${state.boundary.kind}`}
      // Normal checklist completions are evidence of progress, not new scope.
      if(state.evidenceRevision>revisionBefore)parent.evidenceRevision++
    }
    if(fresh&&state.finishEvidence?.nativeSeq===event.seq){
      const evidence={...state.finishEvidence};delete evidence.nativeSeq
      options.onEvidence?.(state.id,view(state),evidence)
      if(parent?.running){const parentView=view(parent);options.onEvidence?.(parent.id,parentView,{...evidence,owner:state.id,ownerLabel:parentView.children.find(child=>child.id===state.id)?.label,evidenceKey:state.id+':'+evidence.evidenceKey})}
    }
    if(event.type==='step/end'&&event.seq===state.lastSeq&&state.notifiedStepSeq!==event.seq){
      state.notifiedStepSeq=event.seq
      options.onStepEnd?.(state.id,view(state),{seq:event.seq,step:state.stepsThisTurn,at:stamp(event.time)})
      if(parent?.running){const parentView=view(parent);options.onStepEnd?.(parent.id,parentView,{seq:event.seq,step:state.stepsThisTurn,at:stamp(event.time),owner:state.id,ownerLabel:parentView.children.find(child=>child.id===state.id)?.label})}
    }
    if ((event.type === 'turn/end' || event.type === 'turn/start')&&event.seq===state.lastSeq&&(event.data?.turn===undefined||event.data.turn===state.turn)) {
      view(state)
      persist(state)
      if (event.type === 'turn/end'&&!state.running&&state.turnEndedAt>0&&state.notifiedTurnEndSeq!==event.seq) {
        state.notifiedTurnEndSeq=event.seq
        options.onTurnEnd?.({ at: stamp(event.time), kind: 'end', sid: state.id, parentSession:state.parentSession??null, turn: state.turn, status: state.turnStatus, elapsedMs: state.turnEndedAt - state.turnStartedAt, evidenceRevision:state.evidenceRevision })
      }
    }
  })

  const offStatus = ctx.on('api-session/status', (sessionId, running) => {
    runningById.set(String(sessionId), running === true)
    const state = states.get(String(sessionId))
    if (state !== undefined) {
      // status=false precedes/follows turn/end on different host versions.
      // It cannot turn a durable completion back into a running turn.
      if (running === true) state.running = state.turnStatus === 'running'
      else if (state.running) {
        const beforeStop=view(state)
        if(state.localEvidence)state.localEvidence.lastPercent=localProgress(beforeStop,{aiEnabled:false}).percent
        state.running = false
        state.turnStatus = 'interrupted'
        state.turnEndedAt = state.lastEventAt || Date.now()
        state.runningTool = null
        state.runningTools.clear()
        state.stream = null
        persist(state)
      }
      state.lastActivityAt = Date.now()
    }
  })

  // Public transient frames reveal that a call is being prepared. Keep only a
  // bounded argument prefix to extract its target; never retain reasoning/text.
  const offStream=ctx.on('agent/assistant-stream',({agent,frame}={})=>{
    const state=states.get(String(agent?.id))
    if(!state?.running||!frame)return
    if(frame.type==='start') {
      if(frame.turn!==state.turn)return
      state.stream={attemptId:frame.attemptId,revision:frame.revision,kind:'request',startedAt:Date.now(),name:'',label:'',prefix:'',tail:'',toolId:null}
      return
    }
    const stream=state.stream
    if(!stream||stream.attemptId!==frame.attemptId||frame.revision<=stream.revision)return
    stream.revision=frame.revision
    if(frame.type==='end'){state.stream=null;return}
    const chunk=frame.chunk
    if(chunk?.type==='tool-call-delta') {
      if(stream.toolId!==chunk.id){stream.toolId=chunk.id;stream.prefix='';stream.tail='';stream.name='';stream.label='';stream.startedAt=stamp(frame.time)}
      stream.kind='tool'
      if(chunk.name)stream.name=String(chunk.name).slice(0,80)
      if(stream.prefix.length<512)stream.prefix=(stream.prefix+String(chunk.argumentsDelta ?? '')).slice(0,512)
      stream.tail=(stream.tail+String(chunk.argumentsDelta??'')).slice(-512)
      const candidates=[stream.prefix,stream.tail]
      const target=candidates.map(value=>/"(?:file_path|path)"\s*:\s*("(?:[^"\\]|\\.)*")/u.exec(value)).find(Boolean)
      const description=!target&&candidates.map(value=>/"description"\s*:\s*("(?:[^"\\]|\\.)*")/u.exec(value)).find(Boolean)
      if(target){try{stream.label=String(JSON.parse(target[1])).split(/[\\/]/u).at(-1).slice(0,100)}catch{}}
      else if(description){try{stream.label=String(JSON.parse(description[1])).slice(0,100)}catch{}}

    } else if(chunk?.type==='reasoning-delta'&&stream.kind!=='tool')stream.kind='reasoning'
    else if(chunk?.type==='text-delta'&&stream.kind!=='tool')stream.kind='text'
  })

  /** The Lead's shared task board, when this session is a Team member. */
  function readTeam(sessionId, ignored = new Set()) {
    const agents = ctx.get('agents')
    const team = ctx.get('agentTeams')
    if (agents === undefined || team === undefined) return null
    try {
      const agent = agents.get(sessionId)
      if (agent === undefined) return null
      if (typeof team.tryMembership === 'function' && team.tryMembership(agent) === undefined) return null
      const tasks = team.listTasks(agent)
      if (!Array.isArray(tasks) || tasks.length === 0) return null
      const live = tasks.filter(task => task.status !== 'deleted' && !(task.status === 'completed' && ignored.has(String(task.id))))
      if (live.length === 0) return null
      const done = live.filter((task) => task.status === 'completed').length
      const active = live.find((task) => task.status === 'in_progress') ?? null
      return {
        done,
        total: live.length,
        activeId: active === null ? null : String(active.id),
        activeLabel: active === null ? '' : String(active.subject ?? ''),
        items: live.slice(0, 32).map(task => ({id:String(task.id),content:String(task.subject ?? '').slice(0,240),status:task.status,blockedBy:task.blockedBy ?? [],owner:task.ownerName ?? '',revision:task.revision})),
        members: typeof team.listMembers === 'function' ? team.listMembers(agent) : [],
      }
    } catch {
      return null
    }
  }

  /** Child Sessions this session spawned, and how many have gone quiet. */
  function readChildren(state, members = []) {
    const sessions = ctx.get('sessions')
    if (!sessions) return []
    try {
      const roster = new Map(members.filter(member => String(member.id) !== state.id).map(member => [String(member.id), member]))
      const listed=sessions.list()
      for(const candidate of listed)if(candidate.header?.parentSession&&String(candidate.header.parentSession)!==state.id||state.turnEndedAt&&candidate.header?.createdAt>state.turnEndedAt)state.childRoster.delete(String(candidate.id))
      const siblings=states.get(String(state.parentSession))?.childRoster
      if(siblings)for(const id of siblings.keys())if(!listed.some(candidate=>String(candidate.id)===id&&String(candidate.header?.parentSession)===state.id))state.childRoster.delete(id)
      const candidates = listed.filter(candidate => {
        const id = String(candidate.id), child = states.get(id)
        if(state.turnEndedAt&&candidate.header?.createdAt>state.turnEndedAt)return false
        const currentTurn=candidate.header?.createdAt >= state.turnStartedAt || child?.turnStartedAt >= state.turnStartedAt
        return state.childRoster.has(id) || currentTurn && String(candidate.header?.parentSession) === state.id && (roster.has(id) || candidate.header?.origin === 'subagent')
      })
      for(const candidate of candidates) {
        const id=String(candidate.id)
        if(state.childRoster.has(id)||state.childRoster.size<12){const saved=state.childRoster.get(id);state.childRoster.set(id,{...saved,id,createdAt:candidate.header?.createdAt??saved?.createdAt,localOwners:saved?.localOwners??bindLocalItems(state.localEvidence,localItemsFor(state))})}
        if(!states.has(id))ensure(candidate)
      }
      // Hosts unload completed sessions and remove members. Keep this turn's
      // observed roster, in stable spawn order, until the next parent turn.
      const rows=[...state.childRoster.values()].filter(saved=>belongsToTurn(saved,state.turnEndedAt)).map(saved => {
        const id = saved.id, child = states.get(id), record = persistence?.load(id), member = roster.get(id)
        const running = child ? child.running === true && child.turnStatus === 'running' : record && record.status !== 'running' ? false : runningById.get(id) === true || member?.status === 'running'
        const savedStatus = child?.turnStatus ?? record?.status ?? (member?.status === 'failed' ? 'failed' : saved.status ?? 'idle')
        const status = running ? 'running' : savedStatus === 'running' ? 'interrupted' : savedStatus
        const liveOwn=child?.turns.get(child.turn),ownItems=liveOwn??record?.ownPlan??(record?.mode==='todos'?record.plan:null),done=liveOwn?liveOwn.filter(item=>item.status==='completed').length:record?.ownPlanCounts?.done??(ownItems?ownItems.filter(item=>item.status==='completed').length:saved.done??0),total=liveOwn?.length??record?.ownPlanCounts?.total??ownItems?.length??saved.total??0
        const model = child?.model, age = model ? Math.max(0, Date.now() - (model.evidenceAt??model.at)) : Infinity
        const session=listed.find(candidate=>String(candidate.id)===id)
        let clock=saved.workClock
        try{if(session)clock=childMetadata.live(session,state.turnStartedAt,state.turnEndedAt||0,clock)}catch{}
        const elapsedMs=clock?workElapsed(clock,{running,now:Date.now()}):child?.turnStartedAt?Math.max(0,(running?Date.now():child.turnEndedAt)-child.turnStartedAt):record?.elapsedMs??saved.elapsedMs??0
        const modelKnown=running&&model?.turn===child?.turn&&model.evidenceRevision===child.evidenceRevision&&model.confidence!==0&&Number.isFinite(model.percent)&&age<600000
        const localView={turn:child?.turn??record?.turn,running,turnStatus:status,evidenceRevision:child?.evidenceRevision,model:modelKnown?model:null,plan:{items:ownItems??[],done,total},localEvidence:child?.localEvidence??record?.localEvidence,operations:{completed:child?.completedOperations??record?.operations?.completed??0,failed:child?.failedOperations??record?.operations?.failed??0},projectBar:{mode:'todos'},lastTool:child?.lastTool??record?.lastTool}
        const ownDisplay=localProgress(localView,{aiEnabled:true,aiScope:'all'})
        const percentKnown=ownDisplay.percentKnown
        const result={id,createdAt:saved.createdAt,localOwners:saved.localOwners??[],turn:child?.turn??record?.turn??saved.turn??1,done,total,operations:{completed:child?.completedOperations??record?.operations?.completed??0,failed:child?.failedOperations??record?.operations?.failed??0},lastTool:child?.lastTool??record?.lastTool??saved.lastTool??null,
          label:member?.name||(saved.named?saved.label:null)||child?.agentName||record?.agentName||clock?.label||child?.goal?.slice(0,80)||saved.label||'#'+id.slice(-6),named:!!(member?.name||child?.agentName||record?.agentName||clock?.label||saved.named),
          status,percent:ownDisplay.percent??0,percentKnown,localPercent:estimateLocalProgress(localView).percent,
          remainingMs:running&&age<300000&&Number.isFinite(model?.remainingMs)&&model.remainingMs>0?Math.max(0,model.remainingMs-age):null,
          elapsedMs,elapsedBasis:clock?'cumulative':'turn',workClock:clock,phase:model?.phase??child?.lastPhase??'unknown'}
        const parentBoard=readTeam(state.id,state.teamBaseline),parentItems=parentBoard?.items??state.lastTeamItems??state.turns.get(state.turn)??[]
        result.localPercent=workerProgress(result,{...localView,ownPlan:{items:ownItems??[],done,total}}, {plan:{items:parentItems,total:parentBoard?.total??state.lastTeamTotal??parentItems.length}}, {aiEnabled:false}).display.percent
        state.childRoster.set(id,result)
        return result
      })
      void refreshChildMetadata(state.id)
      return rows
    } catch { return [] }
  }

  /** Cold metadata recovery is serialized, read-only and independent of UI/LLM work. */
  function refreshChildMetadata(id) {
    if(metadataJobs.has(id))return metadataJobs.get(id)
    const live=states.get(id),record=persistence?.load(id),turn=live?.turn??record?.turn
    const children=live?[...live.childRoster.values()]:record?.children??[]
    if(!children.length)return Promise.resolve()
    const job=(async()=>{
      let from=live?.turnStartedAt||record?.startedAt||0,until=live?.turnEndedAt||record?.endedAt||0
      if(!from){const parent=await childMetadata.recover(id,0);if(!parent?.lastStart)return;from=parent.lastStart;until=parent.lastEnd||0}
      for(const saved of children.slice(0,12)){
        if(saved.workClock?.complete&&(saved.status==='running'||saved.workClock.openSince===null)&&saved.workClock.from===from&&saved.workClock.until===until&&saved.named)continue
        const clock=await childMetadata.recover(saved.id,from,until,saved.workClock)
        if(!clock?.complete)continue
        if(live&&(live.turn!==turn||live.turnStartedAt!==from||(live.turnEndedAt||0)!==until))break
        const next={...saved,workClock:clock,elapsedMs:workElapsed(clock),elapsedBasis:'cumulative',...(!saved.named&&clock.label?{label:clock.label,named:true}:{})}
        if(live){const current=live.childRoster.get(saved.id);if(current&&(current.workClock?.seq??-1)<=clock.seq)live.childRoster.set(saved.id,{...current,workClock:clock,elapsedMs:workElapsed(clock),elapsedBasis:'cumulative',...(!current.named&&clock.label?{label:clock.label,named:true}:{})});persist(live)}
        else{const current=persistence?.load(id);if(current?.turn!==turn)break;persistence?.save(id,{...current,startedAt:from,endedAt:until,children:current.children.map(child=>child.id===saved.id?next:child)})}
      }
    })().finally(()=>metadataJobs.delete(id))
    metadataJobs.set(id,job);return job
  }

  function pick() {
    const sessions = ctx.get('sessions')
    if (sessions === undefined) return null
    let best = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (const state of states.values()) {
      const score = (state.running ? 1e15 : 0) + state.lastActivityAt
      if (score > bestScore) {
        bestScore = score
        best = state
      }
    }
    if (best === null) {
      const session = sessions.list().reduce((latest, candidate) => !latest || (candidate.header?.createdAt ?? 0) > (latest.header?.createdAt ?? 0) ? candidate : latest, null)
      if (session) best = ensure(session)
    }
    return best
  }

  /** Compact record kept on disk so a closed Session still reports its state. */
  function persist(state) {
    const percent = state.frozenPercent
    const record = {
      turn: state.turn,steps:state.stepsThisTurn,
      parentSession:state.parentSession??null,
      agentName:state.agentName,startedAt:state.turnStartedAt,endedAt:state.turnEndedAt,
      status: state.turnStatus,
      percent,
      done: state.frozenDone,
      total: state.frozenTotal,
      elapsedMs: state.turnStartedAt > 0 ? Math.max(0, (state.turnEndedAt || Date.now()) - state.turnStartedAt) : 0,
      itemEtaMs: Math.round(state.itemEtaMs),
      turnEtaMs: Math.round(state.turnEtaMs),
      itemEtaSamples: state.itemEtaSamples,
      turnEtaSamples: state.turnEtaSamples,
      project: state.cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? '',
      mode: state.lastMode ?? 'turn',
      phase: state.lastPhase,
      lastTool: state.lastTool,
      operations:{completed:state.completedOperations,failed:state.failedOperations},
      weightPlan:state.weightPlan,lastKnownProgress:state.lastKnownProgress,localBridge:state.localBridge,lastAiReference:state.lastAiReference,
      localEvidence:state.localEvidence,
      observations:state.observations,probeStats:state.probeStats,
      children:[...state.childRoster.values()],
      teamBaseline:[...state.teamBaseline],
      plan: (state.lastMode==='team'?state.lastTeamItems??[]:state.turns.get(state.turn) ?? []).slice(0,32).map(item=>({...item,content:item.content.slice(0,240)})),
      ownPlanCounts:{total:(state.turns.get(state.turn)??[]).length,done:(state.turns.get(state.turn)??[]).filter(item=>item.status==='completed').length},
      ownPlan:(state.turns.get(state.turn)??[]).slice(0,32).map(item=>({...item,content:item.content.slice(0,240)})),
      updatedAt: state.replaying ? state.lastEventAt : Date.now(),
    }
    // Archive immutable turn records; replay must not overwrite saved AI observations.
    const bucket = archived.get(state.id) ?? new Map()
    if (!state.replaying || !bucket.has(state.turn)) bucket.set(state.turn, record)
    archived.set(state.id, bucket)
    while (bucket.size > 32) bucket.delete(bucket.keys().next().value)
    while ([...archived.values()].reduce((n,b)=>n+b.size,0)>256) {
      const oldest=archived.keys().next().value, old=archived.get(oldest)
      old.delete(old.keys().next().value);if(!old.size)archived.delete(oldest)
    }
    if (!state.replaying) persistence?.save(state.id, record)
    state.lastPersistAt = Date.now()
  }

  function view(state, includeTranscript = false) {
    const now = Date.now()
    if (state.restored && state.events === 0) return fromRecord(state.id, state.restored)
    const current = state.turns.get(state.turn) ?? null
    const running = state.running
    const activeTodo = running && Array.isArray(current) ? current.find((item) => item.status === 'in_progress') ?? null : null
    const liveTeam = readTeam(state.id, state.teamBaseline)
    const team = liveTeam ?? (!running && state.lastTeamItems?.length ? {items:state.lastTeamItems,done:state.lastTeamItems.filter(item=>item.status==='completed').length,total:state.lastTeamItems.length,activeId:null,members:[]} : null)
    if(liveTeam) {
      if(running&&state.lastTeamItems&&planScopeChanged(state.lastTeamItems,liveTeam.items))state.evidenceRevision += 1
      state.lastTeamItems=liveTeam.items.map(item=>({...item}))
      state.lastTeamTotal=liveTeam.total
    }
    syncLocal(state,localItemsFor(state))
    const children = readChildren(state, team?.members ?? [])

    let mode = 'turn'
    let done = 0
    let total = 0
    let activeLabel = ''
    let activeKey = null

    if (team !== null) {
      mode = 'team'
      done = team.done
      total = team.total
      activeLabel = running && team.activeId !== null ? team.activeLabel : ''
      activeKey = running && team.activeId !== null ? `team:${team.activeId}` : null
    } else if (Array.isArray(current) && current.length > 0) {
      mode = 'todos'
      total = current.length
      for (const item of current) if (item.status === 'completed') done += 1
      activeLabel = activeTodo !== null ? activeTodo.content : ''
      activeKey = activeTodo === null ? null : activeTodo.content
    } else if (children.length > 0) {
      mode = 'agents'
      done = children.filter(child=>child.status === 'completed').length
      total = children.length
    }

    state.lastMode = mode
    noteActive(state, activeKey, now)

    const turnElapsedMs = state.turnStartedAt > 0 ? Math.max(0, (running ? now : state.turnEndedAt || now) - state.turnStartedAt) : 0

    let percent = 0
    let remainingMs = 0
    let itemPercent = 0
    let itemElapsedMs = 0
    let itemRemainingMs = 0
    let graphKnown = true

    if (mode === 'todos' || mode === 'team') {
      const itemElapsed = activeKey !== null && state.activeSince > 0 ? Math.max(0, now - state.activeSince) : 0
      if (activeKey !== null && state.activeSince > 0) {
        itemElapsedMs = itemElapsed
        const item = estimate(itemElapsed, state.itemEtaMs)
        itemPercent = clamp(item.percent, 0, 0.98)
        itemRemainingMs = item.remainingMs
      }
      const itemsLeft = Math.max(0, total - done - (activeKey !== null ? itemPercent : 0))
      percent = total > 0 ? clamp((done + (activeKey !== null ? itemPercent : 0)) / total, 0, 1) : 0
      remainingMs = itemsLeft * state.itemEtaMs
      if (mode === 'team') {
        const parallel = taskGraphRemaining(team.items,id=>id===team.activeId?itemRemainingMs:state.itemEtaMs,team.members.length)
        if (parallel !== null) remainingMs=parallel
        else graphKnown=false
      }
    } else if (mode === 'agents') {
      percent = total > 0 ? done / total : 0
      remainingMs = Math.max(0, total - done) * state.itemEtaMs
    } else {
      const turn = estimate(turnElapsedMs, state.turnEtaMs)
      percent = clamp(turn.percent, 0, 0.98)
      remainingMs = turn.remainingMs
    }

    if (state.turnStatus === 'completed') {
      percent = 1
      remainingMs = 0
      itemPercent = 0
      itemRemainingMs = 0
      state.frozenDone = done
      state.frozenTotal = total
    } else if (state.turnStatus === 'interrupted') {
      percent = state.frozenPercent > 0 ? state.frozenPercent : percent
      remainingMs = 0
    }

    if(options.localProgress){
      if(running)percent=total>0?done/total:0
      else if(state.turnStatus==='interrupted')percent=state.frozenPercent
      remainingMs=null
    }

    // Freeze what the card last reported, so a restart can replay it.
    if (running) {
      percent = Math.min(options.localProgress?1:0.99, percent)
      state.frozenPercent = state.model?.turn === state.turn ? Math.min(0.99, state.model.percent) : percent
      state.frozenDone = done
      state.frozenTotal = total
      if (!state.replaying && now - state.lastPersistAt >= 5000) persist(state)
    }

    const tool = running ? state.runningTool : null
    const activeTools=[...state.runningTools.values()]
    let commands = running ? activeTools.filter(tool=>tool.name!=='run_code'||!activeTools.some(child=>child.nested&&String(child.rootCallId)===tool.callId)).map(activeTool => {
      const learned = etaFor(activeTool.name, state.cwd, activeTool.args)
      const elapsedMs = Math.max(0, now-activeTool.startedAt)
      const hint = declaredDuration(activeTool.name,activeTool.args)
      const expected = hint ?? learned.ms
      const known = (hint !== null || !options.localProgress && learned.samples >= 3) && elapsedMs < expected
      const history=options.learning?.duration(JSON.stringify([state.cwd,activeTool.commandMeta?.key]),0)
      const observed=options.localProgress?jobProgress.progress(state.id,activeTool.callId,{meta:activeTool.commandMeta,elapsedMs,now,history:history&&['bash','exec_command','pwsh'].includes(activeTool.name)?{...history,key:activeTool.commandMeta?.key}:null}):null
      return {active:true,id:activeTool.callId,name:activeTool.name,label:summarizeArgs(activeTool.args),phase:operationPhase(activeTool.name,activeTool.args),localOwners:activeTool.localOwners,elapsedMs,percent:clamp(elapsedMs/Math.max(1,expected),0,.97),remainingMs:Math.max(0,expected-elapsedMs),etaMs:Math.round(expected),durationHintMs:hint,source:hint===null?'history':'declared',samples:learned.samples,estimated:true,known,indeterminate:!known,...observed}
    }).slice(-6) : []
    if(running&&options.localProgress)commands=[...commands,...jobProgress.background(state.id,{turn:state.turn,startedAt:state.turnStartedAt,activeIds:new Set(activeTools.map(tool=>tool.callId)),now})].slice(-6)
    const command = commands.at(-1) ?? {active:false,name:'',label:'',elapsedMs:0,percent:0,remainingMs:0,indeterminate:false,estimated:true,known:false}
    const preparing=running&&state.stream?.kind==='tool'?{name:state.stream.name,label:state.stream.label,phase:operationPhase(state.stream.name,null),elapsedMs:Math.max(0,now-state.stream.startedAt)}:null

    const finalItems=localItemsFor(state)
    const completePlan=syncFinalPlan(state,finalItems)
    // Text is not a protocol-level final marker. This reversible candidate only
    // follows completed work evidence; any subsequent tool/reasoning invalidates it.
    const finalResponseCandidate=!!(running&&state.stream?.kind==='text'&&activeTools.length===0&&!preparing&&children.every(child=>child.status==='completed')&&
      (state.finalReadyMaterial!==null&&state.finalReadyMaterial===state.finishMaterial||completePlan&&state.finalPlanState?.material===state.finishMaterial))

    // What the agent is doing *right now*, whether or not a plan exists. A
    // running tool wins; otherwise the step clock stands in for "thinking".
    let currentWork = { active: false, kind: 'idle', label: '', percent: 0, elapsedMs: 0, remainingMs: 0, estimated: true, etaMs: 0 }
    if (tool !== null) {
      currentWork = {
        active: true,
        kind: 'tool',
        label: command.label === '' ? command.name : `${command.name} · ${command.label}`,
        percent: command.percent,
        elapsedMs: command.elapsedMs,
        remainingMs: command.remainingMs,
        estimated: command.estimated,
        etaMs: command.etaMs,
        known: command.known,
      }
    }
    // Thinking has no measurable duration, so it gets no bar: the current row
    // only exists while a tool with a learned duration is actually running.

    return {
      sessionId: state.id,
      project: typeof state.cwd === 'string' && state.cwd !== '' ? (state.cwd.split(/[\\/]/u).filter(Boolean).pop() ?? '') : '',
      running,
      startedAt: state.turnStartedAt,
      endedAt: state.turnEndedAt,
      turn: state.turn,
      steps: state.stepsThisTurn,
      turnStatus: state.turnStatus,
      finalResponseCandidate,
      persisted: false,
      projectBar: {
        mode,
        percent,
        done,
        total: mode === 'turn' ? null : total,
        itemPercent,
        elapsedMs: turnElapsedMs,
        remainingMs,
        etaMs: Math.round(state.turnEtaMs),
        estimated: true,
        // Nothing has happened yet on a fresh turn: say "calculating" instead of
        // promising a time the seed made up.
        known:
          mode === 'turn'
            ? state.turnEtaSamples >= 3
            : graphKnown && state.itemEtaSamples >= 3,
      },
      task: {
        label: running && activeLabel !== '' ? activeLabel : '',
        percent: itemPercent,
        elapsedMs: itemElapsedMs,
        remainingMs: itemRemainingMs,
        etaMs: Math.round(state.itemEtaMs),
        estimated: true,
        known: state.itemEtaSamples >= 3,
        index: Array.isArray(current) && activeTodo !== null ? current.indexOf(activeTodo) + 1 : null,
        count: Array.isArray(current) ? current.length : null,
      },
      current: currentWork,
      commands,
      preparing,
      children,
      observations:state.observations,probeStats:state.probeStats,
      ownPlan:{items:(current??[]).slice(0,32),done:(current??[]).filter(item=>item.status==='completed').length,total:current?.length??0},
      plan: {items:team?.items ?? (current ?? []).slice(0,32),done:mode==='agents'?0:done,total:['turn','agents'].includes(mode) ? 0 : total,coverage:team?planCoverage(team.items,children):'checklist'},
      phase: activePhase([...commands,...(preparing?[{...preparing,active:true}]:[])],state.model?.phase) ?? state.model?.phase ?? state.lastPhase,
      evidenceRevision: state.evidenceRevision,
      observedPhase: state.observedPhase,
      boundary:state.boundary,
      // The model's own answer, when a probe has run recently. A finished turn
      // is 100% by definition, whatever the last probe guessed.
      model: running ? state.model : null,
      lastKnownProgress:state.lastKnownProgress,localBridge:state.localBridge,lastAiReference:state.lastAiReference,
      localEvidence:state.localEvidence,
      probe: { revision:`${state.lastSeq}|${team?.items.map(item=>`${item.id}:${item.revision}`).join(',') ?? ''}|${state.stream?.toolId ?? ''}`, goal: state.goal, recentTools: state.recentTools.slice(-8), lastTool: state.lastTool?.name ?? '', recentOperations:state.recentOperations, lockedWeights:state.weightPlan?.turn===state.turn?state.weightPlan:null, evidence:{changedFiles:state.changedFiles,checks:state.checks,milestones:state.milestones,assistantClaim:state.assistantSummary}, ...(includeTranscript ? { transcript: state.transcript.slice(), transcriptOffset: state.transcriptOffset, requestContext: state.requestContext } : {}), turn: state.turn },
      command,
      lastTool: state.lastTool,
      operations:{completed:state.completedOperations,failed:state.failedOperations,active:commands.length},
      activityAt: state.lastEventAt,
      updatedAt: now,
    }
  }

  /** The last persisted record, shaped like a live view. */
  function fromRecord(id, record, historical = false) {
    if (!historical) void refreshChildMetadata(id)
    // A finished turn is 100% whatever the saved snapshot happened to say: the
    // record may have been written by a build whose estimate froze mid-way.
    const percent = record.status === 'completed' ? 1 : Number.isFinite(record.percent) ? clamp(record.percent, 0, 0.99) : 0
    const parent=historical?null:(states.get(String(record.parentSession))??[...states.values()].find(state=>state.id!==id&&state.childRoster.has(id)))
    const children=(record.children??[]).filter(child=>belongsToTurn(child,record.endedAt)&&child.id!==id&&child.id!==parent?.id&&!parent?.childRoster.has(child.id))
    return {
      sessionId: id,
      project: record.project ?? '',
      running: false,startedAt:record.startedAt??0,endedAt:record.endedAt??0,
      plan: {items:record.plan ?? [],done:record.mode==='agents'?0:record.done??0,total:record.mode==='agents'?0:record.total??0,coverage:record.mode==='team'?planCoverage(record.plan,record.children):'checklist'},
      ownPlan:{items:record.ownPlan??(record.mode==='todos'?record.plan??[]:[]),done:record.ownPlanCounts?.done??(record.ownPlan??(record.mode==='todos'?record.plan??[]:[])).filter(item=>item.status==='completed').length,total:record.ownPlanCounts?.total??(record.ownPlan??(record.mode==='todos'?record.plan??[]:[])).length},
      phase:record.phase ?? 'unknown',
      children:children.map(child=>({...child,status:child.status==='running'?'interrupted':child.status})),commands:[],
      turn: record.turn ?? 0,
      steps: record.steps ?? 0,
      historical,
      turnStatus: record.status === 'running' ? 'interrupted' : record.status ?? 'idle',
      persisted: true,
      projectBar: {
        mode: record.mode ?? 'turn',
        percent,
        done: record.done ?? 0,
        total: record.total ?? null,
        itemPercent: 0,
        elapsedMs: typeof record.elapsedMs === 'number' ? record.elapsedMs : null,
        remainingMs: 0,
        etaMs: record.turnEtaMs ?? TURN_ETA_SEED_MS,
        estimated: true,
        known: true,
      },
      task: { label: '', percent: 0, elapsedMs: 0, remainingMs: 0, etaMs: 0, estimated: true, known: false, index: null, count: null },
      current: { active: false, kind: 'idle', label: '', percent: 0, elapsedMs: 0, remainingMs: 0, estimated: true, known: false, etaMs: 0 },
      model: null,lastKnownProgress:record.lastKnownProgress??null,localBridge:record.localBridge??null,lastAiReference:record.lastAiReference??null,
      localEvidence:readLocalEvidence(record.localEvidence),
      probe: { goal: '', recentTools: [], lastTool: '', transcript: [], turn: 0 },
      command: { active: false, name: '', label: '', elapsedMs: 0, percent: 0, remainingMs: 0, indeterminate: false, estimated: true },
      observations:record.observations??[],probeStats:record.probeStats??null,
      lastTool: record.lastTool ?? null,
      operations: record.operations ?? {completed:0,failed:0,active:0},
      updatedAt: record.updatedAt ?? Date.now(),
    }
  }

  const EMPTY = {
    sessionId: null,
    project: '',
    running: false,
    turn: 0,
    steps: 0,
    turnStatus: 'idle',
    persisted: false,
    projectBar: { mode: 'turn', percent: 0, done: 0, total: null, itemPercent: 0, elapsedMs: 0, remainingMs: 0, etaMs: TURN_ETA_SEED_MS, estimated: true },
    task: { label: '', percent: 0, elapsedMs: 0, remainingMs: 0, etaMs: 0, estimated: true, known: false, index: null, count: null },
    current: { active: false, kind: 'idle', label: '', percent: 0, elapsedMs: 0, remainingMs: 0, estimated: true, known: false, etaMs: 0 },
    model: null,
    probe: { goal: '', recentTools: [], lastTool: '' },
    command: { active: false, name: '', label: '', elapsedMs: 0, remainingMs: 0, indeterminate: false, estimated: true },
    lastTool: null,
    updatedAt: Date.now(),
  }

  return {
    refreshChildMetadata,
    configureLocalMode(previous,next){
      for(const state of states.values()){
        if(!state.running)continue
        const snapshot=view(state)
        if(previous.aiEnabled&&!next.aiEnabled){
          const display=localProgress(snapshot,{...previous,now:Date.now()})
          const actualAi=!!state.model&&display.estimated&&['model','weighted'].includes(display.source)
          if(actualAi&&display.percentKnown)state.lastAiReference={percent:display.percent,at:state.model?.evidenceAt??state.model?.at??Date.now(),step:state.model?.forStep??snapshot.steps,turn:state.turn}
          state.localBridge=actualAi||snapshot.localBridge?freezeLocalCheckpoint(snapshot,display):null
        }
        if(!previous.aiEnabled&&next.aiEnabled){const local=localProgress(snapshot,{...previous,now:Date.now()});if(local.percentKnown&&local.source==='local-bridge')state.lastKnownProgress={percent:local.percent,at:Date.now(),source:local.source}}
        if(previous.aiEnabled!==next.aiEnabled||previous.aiScope!==next.aiScope){state.model=null;persist(state)}
      }
    },
    recordObservation(sessionId,{turn,record,stats}){
      const state=states.get(String(sessionId))
      if(!state){const saved=persistence?.load(String(sessionId));if(saved?.turn!==turn)return false;persistence.save(String(sessionId),{...saved,probeStats:{...stats},...(record?{observations:[...(saved.observations??[]),{...record}].slice(-32)}:{})});return true}
      if(state.turn!==turn)return false
      if(record)state.observations.push({...record});if(state.observations.length>32)state.observations.shift()
      state.probeStats={...stats};persist(state);return true
    },
    /** Record one model answer for a Session. */
    setModel(sessionId, estimate) {
      const state = states.get(String(sessionId))
      if (state === undefined || !state.running || state.turn !== estimate.turn) return false
      state.localBridge=null
      const continuity=estimate.continuity??(estimate.evidenceRevision===undefined||estimate.evidenceRevision===state.evidenceRevision?modelContinuity(view(state)):null)
      state.model = { ...estimate,continuity, evidenceRevision:estimate.evidenceRevision ?? state.evidenceRevision, percent: clamp(estimate.percent, 0, 0.99), remainingMs: estimate.remainingMs === null ? null : Math.max(1000, estimate.remainingMs) }
      if(estimate.weights&&estimate.planKey)state.weightPlan={turn:state.turn,planKey:estimate.planKey,weights:estimate.weights}
      if(estimate.planKey===planKey(localItemsFor(state))){const weights=normalizeWeights(estimate.weights,state.localEvidence.keys.length);if(weights)state.localEvidence.weights=weights}
      const display=localProgress(view(state),{aiEnabled:true,aiScope:'all'})
      if(display.percentKnown&&['model','weighted'].includes(display.source))state.lastKnownProgress={percent:display.percent,at:estimate.at}
      state.lastPhase = estimate.phase ?? 'unknown'
      state.frozenPercent = state.model.percent
      persist(state)
      return true
    },
    runningSessionIds() { return [...states.values()].filter(state => state.running).map(state => state.id) },
    /**
     * @param sessionId - the Session the page is looking at; when it is not
     *   live, its persisted record answers instead of an empty card.
     */
    turns(sessionId) {
      const ids = new Set([...(persistence?.listTurns?.(sessionId) ?? []), ...(archived.get(sessionId)?.keys() ?? [])])
      const latest = states.get(sessionId)?.turn ?? persistence?.load(sessionId)?.turn
      if (latest > 0) ids.add(latest)
      return [...ids].sort((a,b)=>a-b)
    },
    snapshot(sessionId, { includeTranscript = false, turn } = {}) {
      if (Number.isSafeInteger(turn) && turn > 0 && typeof sessionId === 'string') {
        let live = states.get(sessionId)
        const session = ctx.get('sessions')?.list().find(candidate => String(candidate.id) === sessionId)
        if (!live && session) live = ensure(session)
        if (live?.turn === turn) return view(live, includeTranscript)
        const record = persistence?.loadTurn?.(sessionId, turn) ?? archived.get(sessionId)?.get(turn) ?? (persistence?.load(sessionId)?.turn === turn ? persistence.load(sessionId) : null)
        return record ? fromRecord(sessionId, record, true) : { ...EMPTY, sessionId, turn, historical:true, unavailable:true }
      }
      if (sessionId === '') return { ...EMPTY, updatedAt: Date.now() }
      if (typeof sessionId === 'string' && sessionId !== '') {
        const live = states.get(sessionId)
        if (live !== undefined) return view(live, includeTranscript)
        const sessions = ctx.get('sessions')
        const session = sessions?.list().find((candidate) => String(candidate.id) === sessionId)
        if (session !== undefined) return view(ensure(session), includeTranscript)
        const record = persistence?.load(sessionId) ?? null
        if (record !== null) return fromRecord(sessionId, record)
        return { ...EMPTY, sessionId }
      }
      const state = pick()
      if (state !== null) return view(state, includeTranscript)
      return EMPTY
    },
    dispose() {
      if (typeof offEvent === 'function') offEvent()
      if (typeof offStatus === 'function') offStatus()
      if (typeof offStream === 'function') offStream()
      for (const state of states.values()) persist(state)
      childMetadata.dispose();jobProgress.dispose()
      states.clear();archived.clear()
    },
  }
}
