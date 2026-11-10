/** Bounded, pure command evidence adapters. No execution, polling, files or LLM.
 * Counts are reported work, not process completion. Only a host terminal status
 * completes a command. Unsupported/ambiguous output stays an activity bar.
 * FFmpeg primary source: fftools/ffmpeg.c print_report(): out_time_us AND the
 * historical out_time_ms carry AV_TIME_BASE microseconds; fps is wall throughput.
 * https://github.com/FFmpeg/FFmpeg/blob/master/fftools/ffmpeg.c
 * tqdm protocol: https://tqdm.github.io/docs/tqdm/#format_meter
 * DSH jobs: JobView.progress is producer text, output.total counts emitted bytes
 * (NOT work total), and background registration is NOT server lifetime.
 */
import {createHash} from 'node:crypto'
const MAX_TAIL=8192,MAX_LINES=64,MAX_COMMAND=32768,MAX_TIME=86400000
const shellNames=new Set(['bash','exec_command','pwsh'])
const finite=value=>typeof value==='number'&&Number.isFinite(value)
const positive=value=>finite(Number(value))&&Number(value)>0?Number(value):null
const count=value=>(typeof value==='number'||typeof value==='string'&&/^\d+$/u.test(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null
const clamp=value=>Math.max(0,Math.min(1,value))

/** Literal shell words only. Refuse pipelines, substitution, redirection and
 * sequencing, rather than interpreting one finite part as the entire command. */
function words(command){
 const out=[];let word='',quote=null,started=false
 for(let i=0;i<command.length;i++){
  const char=command[i]
  if(quote){if(char===quote)quote=null;else{if(quote==='"'&&/[$`\\]/u.test(char))return [];word+=char}continue}
  if(char==='"'||char==="'"){quote=char;started=true;continue}
  if(/[|;&<>`$\n\r\\]/u.test(char))return []
  if(/\s/u.test(char)){if(started){out.push(word);word='';started=false}}else{word+=char;started=true}
 }
 if(quote)return [];if(started)out.push(word);return out
}
function duration(value){
 if(typeof value!=='string')return null
 let seconds=null
 if(/^\d+(?:\.\d+)?$/u.test(value))seconds=Number(value)
 else if(/^\d+(?:\.\d+)?(?:ms|s)$/u.test(value))seconds=Number.parseFloat(value)/(value.endsWith('ms')?1000:1)
 else if(/^\d+:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)){
  const [hours,minutes,secs]=value.split(':').map(Number)
  if(minutes<60&&secs<60)seconds=hours*3600+minutes*60+secs
 }else if(/^\d+:\d{2}(?:\.\d+)?$/u.test(value)){
  const [minutes,secs]=value.split(':').map(Number);if(secs<60)seconds=minutes*60+secs
 }
 const ms=seconds===null?null:seconds*1000
 return finite(ms)&&ms>=0&&ms<=MAX_TIME?ms:null
}

/** Derive compact metadata once, before dropping command/code arguments.
 * - timeoutMs is a runner wait/promotion limit, never a workload duration.
 * - ffmpeg -t/-frames are output targets, not proof of available input work.
 * - direct HTTP-server intent may be infinite while starting; generic dev
 * scripts need an actual ready/listening line before receiving infinity.
 */
export function commandMetadata(name,raw){
 let args=shellNames.has(name)?raw:null;try{if(typeof args==='string')args=JSON.parse(args)}catch{args=null}
 const command=shellNames.has(name)?String(args?.command??args?.cmd??'').trim():''
 const meta={key:`cmd:${createHash('sha256').update(String(name)+'\0'+command).digest('hex')}`,name,family:'unknown',declaredMs:null,totalFrames:null,totalDurationMs:null,serviceIntent:null}
 if(!command||command.length>MAX_COMMAND)return meta
 const tokens=words(command),binary=String(tokens[0]??'').split(/[\\/]/u).at(-1).toLowerCase().replace(/\.exe$/u,'')
 const sleep=/^sleep\s+(\d+(?:\.\d+)?)\s*$/u.exec(command)
 if(sleep){const ms=Number(sleep[1])*1000;if(ms>0&&ms<=MAX_TIME){meta.declaredMs=ms;meta.family='delay'}}
 const node=/^(?:node|nodejs|node\.exe)\s+-e\s+(['"])([\s\S]*)\1\s*$/u.exec(command)
 if(node&&tokens.length===3&&tokens[1]==='-e'&&tokens[2]===node[2]){const timer=/^setTimeout\(\s*\(\s*\)\s*=>\s*console\.log\(\s*(?:'[^'\\\n]*'|"[^"\\\n]*")\s*\)\s*,\s*(\d+)\s*\)\s*;?$/u.exec(node[2]);const ms=timer?Number(timer[1]):null;if(ms>0&&ms<=MAX_TIME){meta.declaredMs=ms;meta.family='delay'}}
 if(binary==='ffmpeg'){
  meta.family='ffmpeg'
  const inputPositions=tokens.flatMap((token,index)=>token==='-i'?[index]:[]),lastInput=inputPositions.at(-1)??-2
  const values=new Set(['-i','-t','-frames:v','-vframes','-f','-c','-c:v','-c:a','-codec:v','-codec:a','-r','-s','-s:v','-vf','-af','-b:v','-b:a','-ar','-ac','-pix_fmt','-preset','-crf','-movflags','-loglevel','-v','-progress','-stats_period','-threads','-filter_threads','-tune','-stream_loop'])
  const flags=new Set(['-y','-n','-an','-vn','-sn','-dn','-nostdin','-nostats','-stats','-hide_banner'])
  let outputs=0,supported=true
  for(let i=1;i<tokens.length;i++){if(values.has(tokens[i])){if(++i>=tokens.length)supported=false}else if(!flags.has(tokens[i])){if(tokens[i].startsWith('-')&&tokens[i]!=='-')supported=false;else outputs++}}
  // A single-output simple invocation is the only supported inferred target.
  // Multiple inputs, complex filters, -copyts and offsets can invalidate it.
  if(supported&&outputs===1&&inputPositions.length===1&&!tokens.some(token=>['-filter_complex','-copyts','-ss','-itsoffset','-itsscale'].includes(token))){
   for(let i=Math.max(1,lastInput+2);i<tokens.length-1;i++){
    if(tokens[i]==='-t'){const ms=duration(tokens[i+1]);if(ms>0)meta.totalDurationMs=ms}
    if(['-frames:v','-vframes'].includes(tokens[i])){const total=count(tokens[i+1]);if(total>0)meta.totalFrames=total}
   }
  }
 }
 if(tokens.some(token=>['--help','-h','--version','-v'].includes(token)))return meta
 if(/^python(?:\d+(?:\.\d+)?)?$/u.test(binary)&&tokens[1]==='-m'&&tokens[2]==='http.server')meta.serviceIntent='explicit'
 else if(binary==='vite'&&!tokens.includes('build'))meta.serviceIntent='explicit'
 else if(['http-server','serve'].includes(binary))meta.serviceIntent='explicit'
 else if((binary==='next'&&['dev','start'].includes(tokens[1]))||(['npm','pnpm','yarn','bun'].includes(binary)&&tokens.some((token,i)=>['dev','start','serve','preview'].includes(token)&&(i===1||tokens[i-1]==='run')))||(['node','nodejs'].includes(binary)&&tokens.length===2&&!tokens[1].startsWith('-')))meta.serviceIntent='candidate'
 return meta
}

function measured(meta,source,current,total,rate,at,extra={}){
 current=count(current);total=count(total)
 if(current===null||total===null||total<=0||current>total)return null
 rate=positive(rate)
 const remainingMs=finite(extra.remainingMs)&&extra.remainingMs>=0?extra.remainingMs:rate?(total-current)/rate*1000:null
 return{key:meta.key,source,current,total,unit:extra.unit??'frames',rate,at,...extra,remainingMs}
}
function ffmpegSignal(meta,lines,at){
 if(meta.family!=='ffmpeg')return null
 let fields={},latest=null
 for(const line of lines){
  const pair=/^(frame|fps|out_time_us|out_time_ms|out_time|speed|progress)=(\S+)\s*$/u.exec(line)
  if(pair){fields[pair[1]]=pair[2];if(pair[1]==='progress'){latest=fields;fields={}}}
  // The human stats line also has explicit frame/time/rate fields. It is
  // trusted only for a known ffmpeg command, never arbitrary echo output.
  else if(/^frame=\s*\d+\s+fps=/u.test(line)){
   latest={};for(const match of line.matchAll(/\b(frame|fps|time|speed)=\s*([^\s]+)/gu))latest[match[1]==='time'?'out_time':match[1]]=match[2]
  }
 }
 if(!latest)return null
 const end=latest.progress==='end'
 if(meta.totalFrames&&count(latest.frame)!==null)return measured(meta,'ffmpeg-frames',latest.frame,meta.totalFrames,latest.fps,at,{reportedEnd:end})
 let elapsed=null
 for(const key of ['out_time_us','out_time_ms'])if(/^\d+$/u.test(latest[key]??'')){elapsed=Number(latest[key])/1000;break}
 if(elapsed===null)elapsed=duration(latest.out_time)
 const total=meta.totalDurationMs,speed=positive(String(latest.speed??'').replace(/x$/u,''))
 if(!total||!finite(elapsed)||elapsed<0||elapsed>total)return null
 // Milliseconds form a continuous workload quantity, unlike frame counts.
 return{key:meta.key,source:'ffmpeg-time',current:elapsed,total,unit:'media-ms',rate:speed,remainingMs:speed?(total-elapsed)/speed:null,at,reportedEnd:end}
}
function frameSignal(meta,line,at){
 if(line.length>1200)return null
 if(line.startsWith('{'))try{
  const value=JSON.parse(line)
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'frame'))return measured(meta,'frames',value.frame,value.total_frames??value.totalFrames??value.total,value.fps,at)
 }catch{}
 line=line.replace(/^render(?:ed|ing)?\s+(\d+\s*(?:\/|of)\s*\d+\s+frames?)/iu,'Frame $1')
 const match=/^(?:render(?:ed|ing)?\s+)?frames?\s*[:=]?\s*(\d+)\s*(?:\/|of)\s*(\d+)(?:\s+frames?)?(?:\s*[,;|]?\s*(?:fps\s*[:=]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*fps))?\s*\.?$/iu.exec(line)
 return match?measured(meta,'frames',match[1],match[2],match[3]??match[4],at):null
}
function tqdmSignal(meta,line,at){
 // Require the entire recognizable meter, not an arbitrary test [x/y], URL,
 // fraction or file size. Reject conflicting printed percentage/counts.
 const match=/^(?:[^\n|]{0,80}:\s*)?(\d{1,3})%\|[^|\n]*\|\s*(\d+)\/(\d+)\s*\[([^\]\n]+)\]\s*$/u.exec(line)
 if(!match)return null
 const current=count(match[2]),total=count(match[3])
 if(current===null||!total||Math.abs(Number(match[1])/100-current/total)>.015)return null
 const timing=/^([^<,]+)<([^,]+)(?:,\s*(\d+(?:\.\d+)?)\s*(?:it|frames?|files?|B)\/s)?$/u.exec(match[4]),eta=timing?duration(timing[2]):null
 return measured(meta,'tqdm',current,total,timing?.[3],at,{unit:'items',remainingMs:eta})
}
function serviceSignal(meta,lines,at){
 if(!meta.serviceIntent)return null
 for(const line of [...lines].reverse())if(/^(?:\s*(?:➜|[-*>])\s*)?(?:Local:\s*https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\S*|(?:Server\s+)?[Ll]istening\s+(?:on|at)\s+(?:port\s+\d+|https?:\/\/\S+|(?:0\.0\.0\.0|127\.0\.0\.1|localhost):\d+)|Serving HTTP on .+ port \d+.*)\s*$/u.test(line))return{key:meta.key,source:'service-ready',at}
 return null
}

/** Parse at most the last 8 KiB / 64 lines. The returned object never includes
 * raw text, commands, code or arbitrary labels. Re-reading the exact same
 * observation does not wash its evidence timestamp forward. */
export function readCommandSignal(meta,output,{at=Date.now(),previous=null,gap=false,nativeProgress=null}={}){
 // A read_file result containing a sample progress line is document content,
 // not execution progress. Background reads must use their originating shell
 // metadata, rather than parsing the job_output read as a new command.
 if(!meta||!shellNames.has(meta.name)&&typeof nativeProgress!=='string')return null
 let tail=typeof output==='string'?output:''
 if(tail.length>MAX_TAIL){tail=tail.slice(-MAX_TAIL);tail=tail.slice(tail.indexOf('\n')+1)}
 const lines=tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu,'').replace(/\r/gu,'\n').split('\n').slice(-MAX_LINES).map(line=>line.trim())
 // Only the registry's producer-specific JobView.progress channel has this
 // trusted origin. Bare x/y from stdout, logs or a user description is ignored.
 const native=typeof nativeProgress==='string'&&nativeProgress.length<=256?/^\s*(\d+)\s*\/\s*(\d+)\s*$/u.exec(nativeProgress):null
 let signal=native?measured(meta,'native-progress',native[1],native[2],null,at,{unit:'items'}):null
 signal??=serviceSignal(meta,lines,at)??ffmpegSignal(meta,lines,at)
 if(!signal)for(const line of [...lines].reverse()){signal=frameSignal(meta,line,at)??tqdmSignal(meta,line,at);if(signal)break}
 const old=!gap&&previous?.key===meta.key?previous:null
 if(!signal)return old
 if(old&&finite(old.current)&&finite(signal.current)){
  const reason=old.source!==signal.source||old.unit!==signal.unit?'adapter-changed':old.total!==signal.total?'total-changed':signal.current<old.current?'counter-regressed':null
  if(reason){signal={...signal,rate:null,remainingMs:null,reset:true,resetReason:reason}}
  else if(old.reset&&signal.current===old.current)return old
 }
 if(old?.rateSource==='delta'&&signal.rate===null&&signal.source===old.source&&signal.current===old.current&&signal.total===old.total&&signal.unit===old.unit&&signal.reportedEnd===old.reportedEnd)return old
 // A second real count observation can supply local throughput. Arrival-time
 // deltas are explicitly estimates, never extrapolated into completed units.
 const delta=old?at-old.at:0
 if(!signal.reset&&signal.rate===null&&old?.source===signal.source&&old.total===signal.total&&old.unit===signal.unit&&signal.current>old.current&&delta>=250&&delta<=30000){
  signal.rate=(signal.current-old.current)/(delta/1000);signal.remainingMs=(signal.total-signal.current)/signal.rate*1000;signal.rateSource='delta'
 }
 const signature=value=>JSON.stringify([value.source,value.current,value.total,value.rate,value.remainingMs,value.reportedEnd])
 return old&&signature(old)===signature(signal)?old:signal
}

/** Render only observed work or a justified duration estimate. ETA may shrink
 * between observations; at zero it becomes unknown/overdue, never restarts.
 * History must be exact-command, sufficiently sampled and concentrated: broad
 * shell-family seeds cannot give a deterministic-looking command percentage.
 */
export function commandProgress({meta,signal=null,elapsedMs=0,now=Date.now(),status='running',exitCode=null,history=null}={}){
 elapsedMs=finite(elapsedMs)?Math.max(0,elapsedMs):0
 // DSH's generic native job status "completed" reports process settlement;
 // a known nonzero process exit is still a command failure, including servers.
 if(status==='completed'&&finite(exitCode)&&exitCode!==0)status='failed'
 const base={mode:'activity',known:false,indeterminate:true,percent:0,remainingMs:null,source:'unknown',estimated:false,infinite:false,overdue:false,stale:false,state:'running',elapsedMs}
 if(status==='completed')return{...base,mode:'terminal',known:true,indeterminate:false,percent:1,remainingMs:0,source:'terminal',state:'completed'}
 const failed=['failed','killed','interrupted'].includes(status)
 if(signal?.key!==meta?.key)signal=null
 if(meta?.serviceIntent==='explicit'||signal?.source==='service-ready')return{...base,mode:failed?'terminal':'service',infinite:!failed,source:signal?.source??'service-intent',state:failed?'failed':status==='stopping'?'stopping':'service'}
 const age=signal&&finite(signal.at)?Math.max(0,now-signal.at):Infinity
 if(signal&&finite(signal.current)&&finite(signal.total)&&signal.total>0&&signal.current>=0&&signal.current<=signal.total){
  const complete=signal.current===signal.total,stale=age>15000
  const rawRemaining=finite(signal.remainingMs)&&signal.remainingMs>0?signal.remainingMs-age:null
  const overdue=!complete&&!stale&&rawRemaining!==null&&rawRemaining<=0
  return{...base,mode:failed?'terminal':'determinate',known:true,indeterminate:false,percent:Math.min(.99,clamp(signal.current/signal.total)),remainingMs:failed||complete||stale||overdue?null:rawRemaining,source:signal.source,estimated:rawRemaining!==null,overdue,stale,state:failed?'failed':complete?'finishing':status==='stopping'?'stopping':'running',current:signal.current,total:signal.total,unit:signal.unit,rate:signal.rate??null,evidenceAt:signal.at,...(signal.reset?{reset:true,resetReason:signal.resetReason}:{})}
 }
 const historical=!!history&&!!meta&&history.key===meta.key&&history.samples>=8&&positive(history.ms)&&positive(history.upperMs)&&history.ms<=MAX_TIME&&history.upperMs>=history.ms&&history.upperMs<=history.ms*1.35
 const expected=meta?.declaredMs??(historical?history.ms:null)
 if(expected&&expected>0&&elapsedMs<expected&&!failed)return{...base,mode:'determinate',known:true,indeterminate:false,percent:Math.min(.99,elapsedMs/expected),remainingMs:expected-elapsedMs,source:meta?.declaredMs?'declared':'history',estimated:true}
 return{...base,mode:failed?'terminal':'activity',state:failed?'failed':status==='stopping'?'stopping':'running',overdue:!!expected&&elapsedMs>=expected}
}
