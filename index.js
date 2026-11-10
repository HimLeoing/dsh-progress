import {migrateLegacyProgress}from'./lib/migration.js'
/** Task progress, local evidence and optional Off observations for DSH Web. */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createModelProbe } from './lib/model-probe.js'
import { createLearningStore } from './lib/learning-store.js'
import {createProbeHistory} from './lib/probe-history.js'
import {createProbeCost} from './lib/probe-cost.js'
import {createAiProgress} from './lib/ai-progress.js'
import { createProbeLog } from './lib/probe-log.js'
import {workerProgress} from './lib/worker-progress.js'
import {localProgress} from './lib/local-progress.js'
import { createProgressStore } from './lib/progress-store.js'
import { createTracker } from './lib/tracker.js'

export const name = 'dsh-task-progress'
export const inject = ['webServer']

/** Reply with JSON and no caching. */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/** Boot identity: a restart produces a new pid, which the UI uses to settle. */
const BOOT_AT = Date.now()

/** Where the estimate comparison is appended. */
const PROBE_LOG = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-task-progress', 'probes.jsonl')

/** Whether the request arrived on the machine's own loopback interface. */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Same-origin check for state-changing POSTs. The browser sends `Origin` on
 * every POST, so a mismatch is cross-site. A GET from the page carries none,
 * which is why only writes are fenced by it.
 */
function originMatches(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Register the routes and the progress tracker.
 * @param ctx - Host plugin context carrying `webServer`.
 */
export function apply(ctx) {
  migrateLegacyProgress()
  const probeLog = createProbeLog(PROBE_LOG)
  const logProbe = (record) => probeLog.write(record)
  const store = createProgressStore()
  const learning = createLearningStore()
  let ai
  const tracker = createTracker(ctx, {
    learning,
    captureTranscript:false,
    localProgress:true,
    onStepEnd:(id,view,step)=>ai?.completedStep(id,view,step),
    onEvidence:(id,view,event)=>{if(ai?.completedStep(id,view,event))void ai.tick().catch(error=>logProbe({kind:'failure',error:error.message,at:Date.now()}))},
    onTurnEnd: (record) => {
      logProbe(record)
      learning.finish(record)
      ai?.cancel(record.sid,{drain:true})
      if(record.parentSession&&ai?.settings.cadence!=='step')ai?.completedStep(record.parentSession,tracker.snapshot(record.parentSession),{seq:'terminal:'+record.sid+':'+record.turn,step:0,owner:record.sid,kind:'worker-terminal',at:record.at})
    },
    persistence: {
      load: (id) => store.get(id),
      save: (id, record) => store.set(id, record),
    },
  })

  // Explicitly enabled, compact Off observations. Local mode never calls a model.
  const probe = createModelProbe(ctx,{reasoningEffort:'off',percentOnly:true,maxTokens:320})
  const quote=createProbeCost()
  ai=createAiProgress({probe,snapshot:id=>tracker.snapshot(id),setModel:(id,value)=>tracker.setModel(id,value),recordObservation:(id,value)=>tracker.recordObservation(id,value),quote,history:createProbeHistory(PROBE_LOG,{quote}),log:logProbe})
  ctx.effect(()=>{
    const timer=setInterval(()=>{void ai.tick().catch(error=>logProbe({kind:'failure',error:error.message,at:Date.now()}))},200)
    timer.unref?.()
    return()=>{clearInterval(timer);ai.dispose()}
  },'dsh-task-progress: optional Off observer')

  // A restart goes through SIGTERM; flush the last percentages first.
  const flushOnExit = () => {
    try {
      tracker.dispose()
      store.flush()
      learning.flush()
    } catch {
      /* nothing left to do at shutdown */
    }
  }
  process.on('SIGTERM', flushOnExit)
  process.on('SIGINT', flushOnExit)
  ctx.effect(() => () => {
    process.off('SIGTERM', flushOnExit)
    process.off('SIGINT', flushOnExit)
    store.flush()
    learning.dispose()
  }, 'dsh-task-progress: progress store')

  const routes = [
    {
      kind: 'exact',
      path: '/dsh-task-progress/state',
      handler: async (req, res) => {
        if (!isLoopback(req)) {
          sendJson(res, 403, { ok: false, error: 'loopback only' })
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'GET only' })
          return
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
        const sessionId = url.searchParams.get('session') ?? undefined
        if(req.method==='GET'&&url.searchParams.has('foreground'))ai.observe(url.searchParams.get('foreground')==='1'?sessionId:null)
        const view=tracker.snapshot(sessionId),observer=ai.status(view.sessionId)
        const publicProgress=(value)=>{const{probe:_probe,...publicView}=value;return publicView}
        const children=(view.children??[]).map(child=>workerProgress(child,tracker.snapshot(child.id),view,ai.settings))
        const focus=children.find(child=>child.id===url.searchParams.get('worker'))
        let worker=null
        if(focus){
          const own=tracker.snapshot(focus.id),ownObserver=ai.status(focus.id)
          worker={...publicProgress(own),...focus,sessionId:focus.id,label:focus.label,rootSessionId:view.sessionId,running:focus.status==='running',turnStatus:focus.status,
            plan:{items:focus.items,done:focus.done,total:focus.total},projectBar:{...own.projectBar,elapsedMs:focus.elapsedMs},children:[],
            observer:{...ownObserver,turnUsage:observer.workerUsage?.[focus.id]??ownObserver.turnUsage},settings:ai.settings,display:focus.display}
        }
        sendJson(res,200,{ok:true,server:{pid:process.pid,startedAt:BOOT_AT},plugin:{name,version:'0.1.1-alpha1',host:'0.2.2-rc.1'},
          progress:{...publicProgress(view),children,observer,settings:ai.settings,display:localProgress({...view,children},ai.settings)},worker})
      },
    },
    {
      kind:'exact',path:'/dsh-task-progress/preferences',
      handler:async(req,res)=>{
        if(!isLoopback(req)||!originMatches(req))return sendJson(res,403,{ok:false,error:'same-origin loopback only'})
        if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'POST only'})
        try{
          let raw=''
          for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>1024)return sendJson(res,413,{ok:false,error:'body too large'})}
          const value=JSON.parse(raw)
          if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['aiEnabled','aiScope','cadence'].includes(key))||'aiEnabled' in value&&typeof value.aiEnabled!=='boolean'||'aiScope' in value&&!['no-plan','all'].includes(value.aiScope)||'cadence' in value&&!['step','balanced','every-2','adaptive','milestones'].includes(value.cadence))return sendJson(res,400,{ok:false,error:'invalid preferences'})
          const previous=ai.settings,settings=ai.configure(value);tracker.configureLocalMode(previous,settings)
          sendJson(res,200,{ok:true,settings})
        }catch(error){sendJson(res,error instanceof SyntaxError?400:500,{ok:false,error:error.message})}
      }
    },
    {
      kind:'exact',path:'/dsh-task-progress/probe',
      handler:async(req,res)=>{
        if(!isLoopback(req)||!originMatches(req))return sendJson(res,403,{ok:false,error:'same-origin loopback only'})
        if(req.method!=='POST')return sendJson(res,405,{ok:false,error:'POST only'})
        const url=new URL(req.url??'/',`http://${req.headers.host??'127.0.0.1'}`),id=url.searchParams.get('session')
        if(!id)return sendJson(res,400,{ok:false,error:'session required'})
        try{const result=await ai.request(id,{manual:true});sendJson(res,result.ok?200:409,result)}catch(error){sendJson(res,500,{ok:false,error:error.message})}
      }
    },

  ]

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
    }
  }, 'dsh-task-progress: routes')

  ctx.effect(() => () => tracker.dispose(), 'dsh-task-progress: tracker')
}
