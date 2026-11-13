import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {Readable} from 'node:stream'
import {createGithubTransport,createProxyResolver} from '../lib/github-transport.js'
let time=0,systemReads=0,system='HTTPSEnable : 1\nHTTPSProxy : localhost\nHTTPSPort : 18181\n',failure=false
const env={},proxy=createProxyResolver({env,platform:'darwin',now:()=>time,cacheMs:30,readSystemProxy:async()=>{systemReads++;if(failure)throw Error('unavailable');return system}})
assert.deepEqual(await proxy(),{https_proxy:'http://localhost:18181'})
system='HTTPSEnable : 0\nHTTPSProxy : localhost\nHTTPSPort : 18181\n';await proxy();assert.equal(systemReads,1,'system settings use short cache')
time=31;assert.deepEqual(await proxy(),{});assert.equal(systemReads,2,'disabled proxy is refreshed after expiry')
time=62;failure=true;assert.deepEqual(await proxy(),{});await proxy();assert.equal(systemReads,3,'lookup errors fall back to direct and are cached')
env.HTTPS_PROXY='http://explicit.invalid:8080';env.NO_PROXY='api.github.com';assert.deepEqual(await proxy(),{https_proxy:'http://explicit.invalid:8080',no_proxy:'api.github.com'});assert.equal(systemReads,3,'explicit settings bypass system lookup')
env.https_proxy='';env.no_proxy='*';assert.deepEqual(await proxy(),{https_proxy:'',no_proxy:'*'},'lowercase and explicit disabling take precedence')
delete env.https_proxy;delete env.HTTPS_PROXY;delete env.no_proxy;delete env.NO_PROXY;failure=false;time=100;system='HTTPSEnable : 1\nHTTPSProxy : user:secret@host\nHTTPSPort : 80\n';assert.deepEqual(await proxy(),{},'invalid static settings are ignored')
assert.deepEqual(await createProxyResolver({env:{},platform:'linux',readSystemProxy:()=>assert.fail('non-macOS must not query scutil')})(),{})
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
const agents=[]
const transport=createGithubTransport({request:fakeRequest,certificates,timeoutMs:5,proxy:async()=>({https_proxy:'http://proxy.invalid:8080',no_proxy:'api.github.com'}),createAgent:options=>{agents.push(options);return{options}}})
sequence=[{status:302,headers:{location:'https://release-assets.githubusercontent.com/private?sig=x'}},{headers:{'content-length':'2'}}]
const response=await transport('https://github.com/HimLeoing/dsh-progress/releases/download/v0.1.1-rc1/file.tgz')
assert.equal(response.status,200);assert.equal(response.ok,true);assert.equal(response.headers.get('Content-Length'),'2')
assert.deepEqual(requests[0].options.ca,['node-root','shared','os-root']);assert.equal(requests[0].options.rejectUnauthorized,true)
assert.deepEqual(agents[0].proxyEnv,{https_proxy:'http://proxy.invalid:8080',no_proxy:'api.github.com'},'native Agent receives proxy and NO_PROXY without modifying global agents')
assert.equal(agents[0].rejectUnauthorized,true);assert.equal(requests[0].options.agent,requests[1].options.agent,'redirects reuse the owned proxy agent')
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
const noRoots=createGithubTransport({request:fakeRequest,certificates:()=>[],proxy:async()=>({})});await assert.rejects(noRoots('https://github.com/a'),/No trusted HTTPS certificates/)
console.log('GitHub HTTPS transport passed: explicit/system proxies, cache expiry, disabled/error fallback, NO_PROXY, OS + Node roots, TLS verification, redirects, destination allowlist, abort/timeout')
