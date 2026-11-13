/** Per-request GitHub HTTPS transport. Trust Node roots plus the OS trust store
 * without changing process-wide TLS settings or disabling verification. */
import {request as httpsRequest,Agent} from 'node:https'
import {getCACertificates} from 'node:tls'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {isIP} from 'node:net'

const execute=promisify(execFile)
/** Read static macOS HTTPS settings only. PAC scripts are never executed. */
export function createProxyResolver({env=process.env,platform=process.platform,now=Date.now,cacheMs=30000,readSystemProxy=async()=>{
 return(await execute('/usr/sbin/scutil',['--proxy'],{timeout:1500,maxBuffer:32768,windowsHide:true})).stdout
}}={}){
 let cached=null,expires=0,pending=null
 return async()=>{
  const bypass=env.no_proxy??env.NO_PROXY
  const result=proxy=>({...proxy,...(bypass!==undefined?{no_proxy:bypass}:{})})
  // An explicitly empty variable disables proxying and suppresses system fallback.
  if(env.https_proxy!==undefined||env.HTTPS_PROXY!==undefined)return result({https_proxy:env.https_proxy??env.HTTPS_PROXY})
  if(platform!=='darwin')return result({})
  if(now()<expires)return result(cached??{})
  if(!pending)pending=(async()=>{
   let selected={}
   try{
    const text=await Promise.resolve().then(readSystemProxy),get=key=>new RegExp(`^\\s*${key}\\s*:\\s*(.*?)\\s*$`,'mu').exec(text)?.[1]
    const host=get('HTTPSProxy'),port=Number(get('HTTPSPort'))
    if(get('HTTPSEnable')==='1'&&host&&Number.isInteger(port)&&port>0&&port<=65535&&(/^[a-zA-Z0-9.-]+$/u.test(host)||isIP(host))){
     selected={https_proxy:`http://${isIP(host)===6?'['+host+']':host}:${port}`}
    }
   }catch{} // A missing/disabled/invalid system proxy falls back to direct HTTPS.
   cached=selected;expires=now()+cacheMs;pending=null
   return selected
  })()
  return result(await pending)
 }
}

function allowedUrl(value) {
 const url=new URL(value)
 const allowed=['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)||/^objects-[a-z0-9-]+\.githubusercontent\.com$/u.test(url.hostname)
 if(url.protocol!=='https:'||!allowed||url.username||url.password||url.port&&url.port!=='443')throw new Error('Unexpected GitHub download destination')
 return url
}
export function createGithubTransport({request=httpsRequest,certificates=getCACertificates,timeoutMs=15000,proxy=createProxyResolver(),createAgent=options=>new Agent(options)}={}) {
 let ca,agent,agentKey
 function roots(){
  if(ca)return ca
  const values=[]
  for(const kind of ['default','system'])try{values.push(...certificates(kind))}catch{}
  ca=[...new Set(values)]
  if(!ca.length)throw new Error('No trusted HTTPS certificates are available')
  return ca
 }
 return async function githubRequest(value,{headers={},signal}={}){
  const activeSignal=signal??AbortSignal.timeout(timeoutMs)
  async function visit(destination,redirects){
   activeSignal.throwIfAborted()
   const url=allowedUrl(destination)
   const proxyEnv=await proxy(),key=JSON.stringify(proxyEnv)
   activeSignal.throwIfAborted()
   if(!agent||key!==agentKey){agent=createAgent({proxyEnv,ca:roots(),rejectUnauthorized:true,keepAlive:false});agentKey=key}
   const response=await new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',headers,agent,ca:roots(),rejectUnauthorized:true,signal:activeSignal},resolve)
    req.once('error',reject)
    req.end()
   })
   const status=response.statusCode??0
   if([301,302,303,307,308].includes(status)){
    response.destroy()
    if(redirects>=4)throw new Error('Too many GitHub download redirects')
    const location=response.headers.location
    if(typeof location!=='string')throw new Error('GitHub redirect has no destination')
    return visit(new URL(location,url),redirects+1)
   }
   return{ok:status>=200&&status<300,status,headers:{get(name){const value=response.headers[String(name).toLowerCase()];return Array.isArray(value)?value.join(', '):value??null}},body:response}
  }
  return visit(value,0)
 }
}
export const githubRequest=createGithubTransport()
