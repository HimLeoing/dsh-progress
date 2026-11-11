import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {Readable} from 'node:stream'
import {createGithubTransport} from '../lib/github-transport.js'
const requests=[],reads=[]
let sequence=[]
function fakeRequest(url,options,callback){
 const row={url:String(url),options};requests.push(row)
 const request=new EventEmitter()
 request.end=()=>{const next=sequence.shift();if(next==='hang'){
  const abort=()=>{options.signal.removeEventListener('abort',abort);row.cleaned=true;request.emit('error',options.signal.reason)}
  options.signal.addEventListener('abort',abort,{once:true});return
 }
 queueMicrotask(()=>{const response=Readable.from([Buffer.from(next.body??'ok')]);response.statusCode=next.status??200;response.headers=next.headers??{};row.response=response;callback(response)})}
 return request
}
const certificates=kind=>{reads.push(kind);return kind==='default'?['node-root','shared']:['os-root','shared']}
const transport=createGithubTransport({request:fakeRequest,certificates,timeoutMs:5})
sequence=[{status:302,headers:{location:'https://release-assets.githubusercontent.com/private?sig=x'}},{headers:{'content-length':'2'}}]
const response=await transport('https://github.com/HimLeoing/dsh-task-progress/releases/download/v0.1.1-rc1/file.tgz')
assert.equal(response.status,200);assert.equal(response.ok,true);assert.equal(response.headers.get('Content-Length'),'2')
assert.deepEqual(requests[0].options.ca,['node-root','shared','os-root']);assert.equal(requests[0].options.rejectUnauthorized,true)
assert.ok(requests[0].response.destroyed,'redirect bodies are closed, not downloaded')
let body='';for await(const bytes of response.body)body+=bytes.toString();assert.equal(body,'ok')
assert.deepEqual(reads,['default','system'],'trusted roots are cached per transport')
for(const target of ['http://github.com/a','https://github.com.evil.test/a','https://user:secret@github.com/a','https://github.com:444/a'])await assert.rejects(transport(target),/Unexpected GitHub/)
sequence=[{status:302,headers:{location:'https://evil.test/a'}}];await assert.rejects(transport('https://github.com/a'),/Unexpected GitHub/)
sequence=Array.from({length:5},()=>({status:302,headers:{location:'/again'}}));await assert.rejects(transport('https://github.com/a'),/Too many/)
sequence=['hang'];const keepAlive=setTimeout(()=>{},100)
try{await assert.rejects(transport('https://api.github.com/repos/test'),/timeout/)}finally{clearTimeout(keepAlive)}
assert.equal(requests.at(-1).cleaned,true,'request signal releases abort handler on timeout')
const controller=new AbortController();controller.abort(new Error('fixture cancelled'))
const count=requests.length;await assert.rejects(transport('https://github.com/a',{signal:controller.signal}),/fixture cancelled/);assert.equal(requests.length,count)
const noRoots=createGithubTransport({request:fakeRequest,certificates:()=>[]});await assert.rejects(noRoots('https://github.com/a'),/No trusted HTTPS certificates/)
console.log('Alpha3 GitHub HTTPS transport passed: OS + Node roots, TLS verification, redirects, destination allowlist, abort/timeout')
