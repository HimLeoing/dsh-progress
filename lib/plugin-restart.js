/** Restart the same Web host after a successful plugin installation. */
import {mkdtempSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
export function restartPluginHost(port,{spawnProcess=spawn,schedule=setTimeout,kill=()=>process.kill(process.pid,'SIGTERM')}={}){
 if(!process.argv[1]||!Number.isInteger(port)||port<1||port>65535)throw new Error('The running Web host cannot be restarted')
 const launch={file:process.execPath,args:[...process.execArgv,...process.argv.slice(1)],cwd:process.cwd(),port,log:join(mkdtempSync(join(tmpdir(),'dsh-progress-update-')),'restart.log')}
 const source=`const {spawn}=require('node:child_process'),fs=require('node:fs'),net=require('node:net');const x=JSON.parse(process.argv[1]);const sleep=ms=>new Promise(r=>setTimeout(r,ms));const listening=()=>new Promise(r=>{const s=net.connect({host:'127.0.0.1',port:x.port});let done=false;const end=v=>{if(done)return;done=true;s.destroy();r(v)};s.on('connect',()=>end(true));s.on('error',()=>end(false));s.setTimeout(400,()=>end(false))});(async()=>{const until=Date.now()+30000;while(Date.now()<until&&await listening())await sleep(200);if(await listening())return;const fd=fs.openSync(x.log,'a',0o600);const child=spawn(x.file,x.args,{cwd:x.cwd,env:process.env,detached:true,stdio:['ignore',fd,fd],windowsHide:true});child.on('error',e=>fs.appendFileSync(x.log,e.message+'\\n'));child.unref()})()`
 return new Promise((resolve,reject)=>{
 const helper=spawnProcess(process.execPath,['-e',source,JSON.stringify(launch)],{detached:true,stdio:'ignore',windowsHide:true})
 helper.once('error',reject)
 helper.once('spawn',()=>{helper.unref();schedule(kill,700).unref?.();resolve({restarting:true})})
 })
}
