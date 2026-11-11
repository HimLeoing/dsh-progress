/** Per-request GitHub HTTPS transport. Trust Node roots plus the OS trust store
 * without changing process-wide TLS settings or disabling verification. */
import {request as httpsRequest} from 'node:https'
import {getCACertificates} from 'node:tls'

function allowedUrl(value) {
 const url=new URL(value)
 const allowed=['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)||/^objects-[a-z0-9-]+\.githubusercontent\.com$/u.test(url.hostname)
 if(url.protocol!=='https:'||!allowed||url.username||url.password||url.port&&url.port!=='443')throw new Error('Unexpected GitHub download destination')
 return url
}
export function createGithubTransport({request=httpsRequest,certificates=getCACertificates,timeoutMs=15000}={}) {
 let ca
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
   const response=await new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',headers,ca:roots(),rejectUnauthorized:true,signal:activeSignal},resolve)
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
