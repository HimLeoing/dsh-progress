import assert from 'node:assert/strict'
import {commandMetadata,readCommandSignal,commandProgress} from '../lib/command-progress.js'
import {resultStatus} from '../lib/progress-evidence.js'

const epoch=1800000000000
const meta=command=>commandMetadata('bash',{command})
const show=(metadata,signal,options={})=>commandProgress({meta:metadata,signal,now:epoch,elapsedMs:0,...options})

// 1. Literal durations, with no timeout/prose/compound-command inference.
{
 const m=meta('sleep 10')
 assert.equal(m.declaredMs,10000)
 const half=show(m,null,{elapsedMs:5000});assert.equal(half.mode,'determinate');assert.equal(half.percent,.5);assert.equal(half.remainingMs,5000);assert.equal(half.estimated,true)
 for(const elapsedMs of [10000,11000,999999]){const over=show(m,null,{elapsedMs});assert.equal(over.mode,'activity');assert.equal(over.remainingMs,null);assert.equal(over.overdue,true)}
 assert.equal(show(m,null,{status:'completed',elapsedMs:11000}).percent,1)
 assert.equal(show(m,null,{status:'failed',elapsedMs:3000}).state,'failed')
 assert.equal(meta('sleep 5 && npm run build').declaredMs,null)
 assert.equal(meta('sleep 5; npm run build').declaredMs,null)
 assert.equal(meta('sleep 5 | tee output.txt').declaredMs,null)
 assert.equal(meta('sleep 5\nnode work.js').declaredMs,null)
 assert.equal(meta('echo "sleep 5"').declaredMs,null)
 assert.equal(commandMetadata('bash',{command:'npm run build',timeoutMs:10000}).declaredMs,null)
 assert.equal(meta('sleep 0').declaredMs,null);assert.equal(meta('sleep 99999999').declaredMs,null)
 assert.equal(meta('node -e \'setTimeout(() => console.log("done"), 1500)\'').declaredMs,1500)
 assert.equal(meta('node -e \'setTimeout(() => console.log("done"), 1500); setInterval(() => {}, 5)\'').declaredMs,null)
 assert.equal(meta(`node -e "setTimeout(() => console.log('$(sleep 100)'), 1000)"`).declaredMs,null,'double-quoted shell substitution precedes the Node timer')
 assert.equal(meta('node -e \'setTimeout(() => console.log("$(literal)"), 1500)\'').declaredMs,1500,'dollar text inside single shell quotes remains literal')
}

// 2. Explicit frame totals + actual wall FPS; generic fractions are unknown.
{
 const m=meta('node render.js')
 const signal=readCommandSignal(m,'Frame 120/240 fps=24',{at:epoch})
 assert.equal(signal.current,120);assert.equal(signal.total,240);assert.equal(signal.rate,24)
 const value=show(m,signal);assert.equal(value.percent,.5);assert.equal(value.remainingMs,5000)
 assert.equal(show(m,signal,{now:epoch+2000}).remainingMs,3000)
 const over=show(m,signal,{now:epoch+6000});assert.equal(over.remainingMs,null);assert.equal(over.overdue,true);assert.equal(over.percent,.5)
 const stale=show(m,signal,{now:epoch+16000});assert.equal(stale.stale,true);assert.equal(stale.remainingMs,null);assert.equal(stale.percent,.5)
 assert.equal(readCommandSignal(m,'Frame 120/240 fps=24',{at:epoch+4000,previous:signal}).at,epoch,'re-reading the same report cannot wash evidence age')
 const advanced=readCommandSignal(m,'Frame 144/240 fps=24',{at:epoch+1000,previous:signal});assert.equal(advanced.current,144);assert.equal(advanced.at,epoch+1000)
 assert.equal(readCommandSignal(m,'(no new output)',{at:epoch+1000,previous:signal}),signal)
 assert.equal(readCommandSignal(m,'(no new output)',{at:epoch+1000,previous:signal,gap:true}),null)
 for(const text of ['3/10','tests [3/10]','https://host/3/10','download 3/10','Progress: 3/10','frame -1/10','frame 11/10','frame 1/0','{"frame":null,"total":10}','{"completed":3,"total":10}'])assert.equal(readCommandSignal(m,text),null,text)
 const noRate=readCommandSignal(m,'rendered 1 of 4 frames',{at:epoch});assert.equal(show(m,noRate).percent,.25);assert.equal(show(m,noRate).remainingMs,null)
 const json=readCommandSignal(m,'{"frame":5,"total_frames":10,"fps":2,"ignored":"PRIVATE BODY"}',{at:epoch});assert.equal(show(m,json).remainingMs,2500);assert.doesNotMatch(JSON.stringify(json),/PRIVATE BODY/)
 const complete=show(m,readCommandSignal(m,'Frame 240/240 fps=24',{at:epoch}));assert.equal(complete.state,'finishing');assert.equal(complete.percent,.99);assert.equal(complete.remainingMs,null)
 assert.equal(show(m,json,{status:'failed'}).state,'failed');assert.equal(show(m,json,{status:'failed'}).percent,.5)
 assert.equal(readCommandSignal(commandMetadata('read',{file_path:'notes.md'}),'Frame 1/2 fps=1'),null,'document contents must not become read progress')
}

// 3. FFmpeg machine and human stats. out_time_ms is historically MICROseconds.
{
 const m=meta('ffmpeg -y -i input.mp4 -t 60 -c:v libx264 -progress pipe:1 output.mp4')
 assert.equal(m.family,'ffmpeg');assert.equal(m.totalDurationMs,60000)
 for(const key of ['out_time_us','out_time_ms']){
  const signal=readCommandSignal(m,`${key}=30000000\nspeed=2.0x\nprogress=continue\n`,{at:epoch})
  assert.equal(signal.current,30000,key);assert.equal(show(m,signal).percent,.5);assert.equal(show(m,signal).remainingMs,15000)
 }
 const human=readCommandSignal(m,'frame= 120 fps=24 q=2.0 size=100KiB time=00:00:30.00 bitrate=1kbits/s speed=2.0x',{at:epoch});assert.equal(show(m,human).remainingMs,15000)
 const frameMeta=meta('ffmpeg -i input.mp4 -frames:v 240 -r 60 -progress pipe:1 output.mp4')
 const frames=readCommandSignal(frameMeta,'frame=120\nfps=24\nprogress=continue\n',{at:epoch});assert.equal(show(frameMeta,frames).remainingMs,5000,'output -r 60 is media FPS, not processing throughput')
 assert.equal(meta('ffmpeg -t 60 -i input.mp4 output.mp4').totalDurationMs,null,'input trim is not a whole-command output target')
 assert.equal(meta('ffmpeg -i a.mp4 -i b.mp4 -t 60 out.mp4').totalDurationMs,null)
 assert.equal(meta('ffmpeg -i a.mp4 -t 60 out.mp4 second.mp4').totalDurationMs,null,'multi-output command does not inherit one output total')
 assert.equal(meta('ffmpeg -i a.mp4 -filter_complex concat -t 60 out.mp4').totalDurationMs,null)
 const noTarget=meta('ffmpeg -i input.mp4 output.mp4')
 assert.equal(readCommandSignal(noTarget,'out_time_us=30000000\nspeed=2x\nprogress=continue'),null,'output time without credible total gives no percentage')
 assert.equal(readCommandSignal(m,'out_time_us=30000000\nspeed=2x'),null,'partial machine report does not combine unrelated records')
 const many='out_time_us=10000000\nspeed=2x\nprogress=continue\nout_time_us=20000000\nspeed=1x\nprogress=continue\n'
 assert.equal(readCommandSignal(m,many,{at:epoch}).current,20000)
 const done=readCommandSignal(m,'out_time_us=60000000\nspeed=1x\nprogress=end\n',{at:epoch});assert.equal(show(m,done).state,'finishing','progress=end is not authoritative process success')
 assert.equal(show(m,done,{status:'failed'}).state,'failed')
 assert.equal(readCommandSignal(meta('echo docs'),'out_time_us=30000000\nspeed=2x\nprogress=continue'),null)
}

// 4. Actual tqdm meter with cross-checked ratio, bounded ETA and no auto-finish.
{
 const m=meta('python3 export.py')
 const signal=readCommandSignal(m,'Rendering:  50%|#####     | 50/100 [00:05<00:05, 10.00it/s]',{at:epoch})
 assert.equal(show(m,signal).percent,.5);assert.equal(show(m,signal).remainingMs,5000)
 const stale=show(m,signal,{now:epoch+10000});assert.equal(stale.remainingMs,null);assert.equal(stale.percent,.5)
 assert.equal(readCommandSignal(m,'90%|#####| 1/100 [00:05<00:05, 10.0it/s]'),null,'conflicting percent and ratio is rejected')
 assert.equal(readCommandSignal(m,'50%|#####| 50/100'),null)
 const noisy=readCommandSignal(m,'\x1b[32m 25%|##| 25/100 [00:01<00:03, 25it/s]\x1b[0m\r50%|#####| 50/100 [00:02<00:02, 25it/s]',{at:epoch})
 assert.equal(show(m,noisy).percent,.5)
}

// 5. Server lifetime is independent from background dispatch; transient work
// may also be backgrounded, and failure/stop never keeps an infinity badge.
{
 const direct=meta('python3 -m http.server 8000')
 assert.equal(show(direct,null).mode,'service');assert.equal(show(direct,null).infinite,true)
 assert.equal(show(direct,null,{status:'killed'}).infinite,false)
 assert.equal(show(direct,null,{status:'completed'}).percent,1)
 const script=meta('npm run dev');assert.equal(show(script,null).mode,'activity','a dev script alone is not proof of a ready long-lived server')
 const ready=readCommandSignal(script,'  ➜  Local: http://localhost:5173/',{at:epoch});assert.equal(show(script,ready).mode,'service')
 const node=meta('node server.js');assert.equal(show(node,readCommandSignal(node,'Server listening on port 3000',{at:epoch})).infinite,true)
 const download=commandMetadata('bash',{command:'curl http://localhost:8000/data',run_in_background:true})
 assert.equal(show(download,null,{status:'background'}).mode,'activity');assert.equal(readCommandSignal(download,'Server listening on port 3000'),null)
 assert.equal(show(meta('sleep 10'),null,{status:'background',elapsedMs:5000}).percent,.5)
 assert.equal(show(meta('vite build'),null).infinite,false)
 assert.equal(show(meta('python3 -m http.server --help'),null).infinite,false)
 for(const command of ['vite --version','vite -v','http-server --help','python3 -m http.server --version'])assert.equal(show(meta(command),null).infinite,false,command)
 assert.equal(show(script,ready,{status:'stopping'}).state,'stopping')
 const nativeFailed=resultStatus('job_output',{},'[status: completed, exit code: 7]')
 assert.equal(show(script,ready,{status:nativeFailed}).state,'failed');assert.equal(show(script,ready,{status:nativeFailed}).infinite,false,'native completed may still carry a failed command exit')
 assert.equal(show(script,ready,{status:'completed',exitCode:7}).state,'failed');assert.equal(show(script,ready,{status:'completed',exitCode:7}).infinite,false)
 assert.equal(show(script,ready,{status:'completed',exitCode:0}).percent,1)
 assert.equal(show(script,ready,{status:resultStatus('job_output',{},'[status: killed, user requested]')}).infinite,false)
}

// 6. Historical estimates require command identity, enough actual samples and
// a concentrated range. Cold seeds/wide family durations stay indeterminate.
{
 const m=meta('npm run build'),history={key:m.key,ms:10000,upperMs:12000,samples:8}
 assert.equal(show(m,null,{history,elapsedMs:5000}).remainingMs,5000)
 for(const bad of [{...history,key:'another-command'},{...history,samples:3},{...history,upperMs:40000},{...history,ms:NaN},{ms:10000,upperMs:10000,samples:50}])assert.equal(show(m,null,{history:bad}).mode,'activity')
 assert.equal(show(m,null,{history,elapsedMs:15000}).mode,'activity');assert.equal(show(m,null,{history,elapsedMs:15000}).overdue,true)
 assert.equal(show(m,null,{history,elapsedMs:100000}).remainingMs,null)
}

// 7. Native producer progress is a distinct trusted channel, not stdout text.
// Two progressing reports can estimate rate without claiming more work done.
{
 const m=meta('node export.js')
 assert.equal(readCommandSignal(m,'3/10',{at:epoch}),null)
 const first=readCommandSignal(m,'',{nativeProgress:'3/10',at:epoch})
 assert.equal(first.source,'native-progress');assert.equal(show(m,first).percent,.3);assert.equal(show(m,first).remainingMs,null)
 const next=readCommandSignal(m,'',{nativeProgress:'5/10',previous:first,at:epoch+1000})
 assert.equal(next.rate,2);assert.equal(next.rateSource,'delta');assert.equal(show(m,next,{now:epoch+1000}).remainingMs,2500)
 const duplicate=readCommandSignal(m,'',{nativeProgress:'5/10',previous:next,at:epoch+2000})
 assert.equal(duplicate,next,'identical native progress cannot renew a derived-rate estimate')
 const overdue=show(m,duplicate,{now:epoch+4000});assert.equal(overdue.percent,.5);assert.equal(overdue.remainingMs,null);assert.equal(overdue.overdue,true)
 const changedTotal=readCommandSignal(m,'',{nativeProgress:'6/20',previous:next,at:epoch+2000});assert.equal(changedTotal.rate,null,'a new denominator invalidates the old local rate')
 assert.equal(changedTotal.reset,true);assert.equal(changedTotal.resetReason,'total-changed');assert.equal(show(m,changedTotal).percent,.3);assert.equal(show(m,changedTotal).remainingMs,null)
 const regressed=readCommandSignal(m,'',{nativeProgress:'2/10',previous:next,at:epoch+2000});assert.equal(regressed.resetReason,'counter-regressed');assert.equal(regressed.rate,null);assert.equal(show(m,regressed).percent,.2);assert.equal(show(m,regressed).remainingMs,null)
 assert.equal(readCommandSignal(m,'',{nativeProgress:'2/10',previous:regressed,at:epoch+2500}),regressed,'re-reading a reset report cannot restore the old throughput')
 const newPhase=readCommandSignal(m,'',{nativeProgress:'3/10',previous:regressed,at:epoch+3000});assert.equal(newPhase.rate,1);assert.equal(newPhase.reset,undefined);assert.equal(show(m,newPhase,{now:epoch+3000}).remainingMs,7000)
 assert.equal(readCommandSignal(m,'',{nativeProgress:'6/0',at:epoch}),null)
 const tooSoon=readCommandSignal(m,'',{nativeProgress:'5/10',previous:first,at:epoch+1});assert.equal(tooSoon.rate,null)
 const late=readCommandSignal(m,'',{nativeProgress:'5/10',previous:first,at:epoch+40000});assert.equal(late.rate,null)
 assert.equal(m.key,meta('node export.js').key);assert.notEqual(m.key,meta('node other.js').key);assert.match(m.key,/^cmd:[a-f0-9]{64}$/u)
}

// Bounded parsing, no body retention, cross-command isolation and immutable inputs.
{
 const m=meta('node render.js'),input=Object.freeze({command:'node render.js',description:'PRIVATE DESCRIPTION'}),metadata=commandMetadata('bash',input)
 assert.doesNotMatch(JSON.stringify(metadata),/PRIVATE|render\.js/)
 const huge='PRIVATE BODY\n'.repeat(100000)+'Frame 1/2 fps=1\n'
 const signal=readCommandSignal(m,huge,{at:epoch});assert.equal(signal.current,1);assert.doesNotMatch(JSON.stringify(signal),/PRIVATE/)
 assert.equal(readCommandSignal(meta('node other.js'),'nothing',{at:epoch,previous:signal}),null)
 assert.equal(show(meta('node other.js'),signal).known,false)
 assert.doesNotThrow(()=>commandProgress())
}
console.log('command-progress-v066 passed: literal timing, explicit frames/FPS, ffmpeg units/targets, tqdm, service lifetime, historical confidence, bounded parsing and failure boundaries')
