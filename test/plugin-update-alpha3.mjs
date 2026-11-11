import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {EventEmitter} from 'node:events'
import {createPluginUpdater,selectRelease} from '../lib/plugin-update.js'
import {restartPluginHost} from '../lib/plugin-restart.js'
const dir=await mkdtemp(join(tmpdir(),'dtp-updater-test-'))
const version='0.1.1-alpha3',target='0.1.1-rc1',filename=`dsh-task-progress-${target}.tgz`,tag=`v${target}`
const base=`https://github.com/HimLeoing/dsh-task-progress/releases/download/${tag}/`
const release={tag_name:tag,draft:false,assets:[filename,'SHA256SUMS'].map(name=>({name,browser_download_url:base+name}))}
const row=v=>({...release,tag_name:`v${v}`})
assert.equal(selectRelease([row('0.1.1-rc2'),row('0.1.1-rc10'),row('0.1.1-alpha20'),row('0.1.2'),{...row('0.1.2-rc1'),draft:true}],version).tag_name,'v0.1.1-rc10')
assert.equal(selectRelease([row('0.1.0-rc1'),row('0.1.1-rc1')],'0.1.1'),null,'never downgrade a stable release')
assert.equal(selectRelease([row('0.1.1-rc1')],'0.1.1-rc2'),null)
try {
 const home=join(dir,'home'),entry=join(dir,'host','lib','bin.js'),profile={name:'web',home,dir:join(home,'profiles','web')}
 await mkdir(join(dir,'host','lib'),{recursive:true});await writeFile(join(dir,'host','package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.2-rc.1'}))
 const archive=gzipSync(Buffer.from('fixture tar stream; extraction is mocked'))
 const hash=createHash('sha256').update(archive).digest('hex')
 function fixture({running=false,changedRunning=false,badHash=false,unsafe=false,badManifest=false,dependency=false,installScript=false,installFail=false,bomb=false}={}){
  const calls=[],requests=[];let countRunning=0,restarts=0
  const bytes=bomb?gzipSync(Buffer.alloc(17*1024*1024)):archive
  const sum=badHash?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex')
  const updater=createPluginUpdater({version,profile,entry,home,
   isRunning:()=>{countRunning++;return running||changedRunning&&countRunning>1},restart:async()=>{restarts++},
   fetcher:async(url)=>{requests.push(url);return new Response(url.includes('api.github.com')?JSON.stringify([release]):url.endsWith('SHA256SUMS')?`${sum}  ${filename}\n`:bytes)},
   run:async(command,args,options)=>{calls.push({command,args,options})
    if(command==='tar'){
     if(args[0]==='-tvzf')return{stdout:unsafe?'lrwxr-xr-x 0 u g 2 Jan 1 00:00 package/link\n':'-rw-r--r-- 0 u g 32 Jan 1 00:00 package/package.json\n'}
     if(args[0]==='-tzf')return{stdout:unsafe?'package/../../escape\n':'package/package.json\n'}
     const pkgDir=join(args[args.indexOf('-C')+1],'package');await mkdir(pkgDir,{recursive:true})
     await writeFile(join(pkgDir,'package.json'),JSON.stringify({name:'dsh-task-progress',version:target,engines:{dsh:badManifest?'0.2.1':'0.2.2-rc.1'},...(dependency?{dependencies:{bad:'*'}}:{}),...(installScript?{scripts:{postprepare:'unsafe'}}:{})}));return{stdout:''}
    }
    if(installFail)throw new Error('fixture official CLI failure')
    return{stdout:''}
   }})
  return{updater,calls,requests,get restarts(){return restarts}}
 }
 const happy=fixture();const first=happy.updater.apply(),second=happy.updater.apply();assert.equal(first,second,'two immediate applies share the same full operation')
 await first;assert.equal(happy.restarts,1)
 const cli=happy.calls.filter(call=>call.command===process.execPath);assert.equal(cli.length,1)
 assert.deepEqual(cli[0].args,[entry,'plugin','--profile','web','add',join(home,'dsh-task-progress','updates',target,'package')])
 assert.equal(cli[0].options.env.DSH_HOME,home);assert.equal(happy.updater.view().phase,'restarting')
 const stopped=fixture({running:true});await assert.rejects(stopped.updater.apply(),/Finish running/);assert.equal(stopped.requests.length,0);assert.equal(stopped.calls.length,0)
 for(const [options,error] of [[{badHash:true},/checksum does not match/],[{unsafe:true},/unsafe paths/],[{badManifest:true},/incompatible/],[{dependency:true},/runtime dependencies/],[{installScript:true},/incompatible/],[{installFail:true},/official CLI failure/],[{changedRunning:true},/task started/],[{bomb:true},/larger than/]]){
  const test=fixture(options);await assert.rejects(test.updater.apply(),error);assert.equal(test.restarts,0);assert.equal(test.updater.view().phase,'failed')
  if(!options.installFail)assert.equal(test.calls.some(call=>call.command===process.execPath),false)
 }
 const stoppedUpdater=fixture();stoppedUpdater.updater.dispose();await assert.rejects(stoppedUpdater.updater.apply(),/stopped/)
 // Restart only terminates the host after a helper successfully spawned.
 let killed=0,scheduled=0,launch
 const restart=restartPluginHost(3080,{spawnProcess(file,args){launch={file,args};const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child},schedule(fn,ms){scheduled++;assert.equal(ms,700);fn();return{unref(){}}},kill(){killed++}})
 assert.deepEqual(await restart,{restarting:true});assert.equal(killed,1);assert.equal(scheduled,1)
 const config=JSON.parse(launch.args[2]);assert.equal(config.file,process.execPath);assert.equal(config.port,3080);assert.deepEqual(config.args,[...process.execArgv,...process.argv.slice(1)])
 await assert.rejects(restartPluginHost(3080,{spawnProcess(){const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('fixture spawn error')));return child},schedule(){assert.fail('must not terminate on failed helper')}}),/fixture spawn error/)
 assert.throws(()=>restartPluginHost(0),/cannot be restarted/)
 await rm(config.log.slice(0,config.log.lastIndexOf('/')),{recursive:true,force:true})
 console.log('Alpha3 updater passed: RC ordering, concurrent apply, checksum, archive safety, host manifest, official CLI, idle gating, failures, safe restart')
}finally{await rm(dir,{recursive:true,force:true})}
