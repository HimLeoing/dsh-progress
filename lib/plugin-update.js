/** RC updates with opt-in Alpha observations. Fixed upstream, verified assets, official profile CLI. */
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join,dirname,resolve} from 'node:path'
import {homedir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {githubRequest,createProxyResolver} from './github-transport.js'
import {compareVersions} from './version-order.js'
import {supportsHost} from './host-range.js'
const exec=promisify(execFile)
const REPO='HimLeoing/dsh-progress',MAX_ARCHIVE=4*1024*1024,CACHE_MS=30*60*1000
const orderedVersion=value=>String(value).replace(/-(rc|alpha)[.-]?(\d+)$/u,'-$1.$2')
export function selectRelease(rows,current,{includeAlpha=false}={}){
 return (Array.isArray(rows)?rows:[]).filter(row=>!row.draft&&(includeAlpha?/^v\d+\.\d+\.\d+-(?:rc|alpha)[.-]?\d+$/u:/^v\d+\.\d+\.\d+-rc[.-]?\d+$/u).test(row.tag_name??'')&&compareVersions(orderedVersion(row.tag_name.slice(1)),orderedVersion(current))>0)
  .sort((a,b)=>compareVersions(orderedVersion(b.tag_name.slice(1)),orderedVersion(a.tag_name.slice(1))))[0]??null
}
function assetUrl(release,name){
 const url=release.assets?.find(row=>row.name===name)?.browser_download_url
 const expected=`https://github.com/${REPO}/releases/download/${release.tag_name}/${name}`
 if(url!==expected)throw new Error('Release asset is missing or has an unexpected URL')
 return url
}
async function readBounded(response,limit){
 if(!response.ok){response.body?.destroy?.();throw new Error(`GitHub HTTP ${response.status}`)}
 if(Number(response.headers?.get('content-length'))>limit){response.body?.destroy?.();throw new Error('Release response exceeds size limit')}
 const pieces=[];let size=0
 for await(const piece of response.body){size+=piece.length;if(size>limit)throw new Error('Release response exceeds size limit');pieces.push(piece)}
 return Buffer.concat(pieces)
}
export function installerEnvironment(profileHome,proxyEnv,env=process.env){
 const proxy=proxyEnv.https_proxy??proxyEnv.HTTPS_PROXY??'',bypass=proxyEnv.no_proxy??proxyEnv.NO_PROXY??''
 const child={...env,DSH_HOME:profileHome,NODE_USE_ENV_PROXY:'1',https_proxy:proxy,HTTPS_PROXY:proxy,no_proxy:bypass,NO_PROXY:bypass}
 // Prevent curl/Git ALL_PROXY fallback from defeating an explicit direct choice.
 if(!proxy){child.all_proxy='';child.ALL_PROXY=''}
 // Git can override environment proxies from gitconfig. Use process-only URL
 // configuration for this public upstream, preserving inherited config pairs.
 const inherited=Number(env.GIT_CONFIG_COUNT??0)
 if(!Number.isSafeInteger(inherited)||inherited<0||inherited>1024)throw new Error('Invalid inherited Git runtime configuration')
 child.GIT_CONFIG_COUNT=String(inherited+1)
 child[`GIT_CONFIG_KEY_${inherited}`]='http.https://github.com/.proxy'
 child[`GIT_CONFIG_VALUE_${inherited}`]=proxy
 return child
}
export function createPluginUpdater({version,profile,entry=process.argv[1],isRunning=()=>false,developerMode=()=>false,restart=()=>{},fetcher=githubRequest,now=Date.now,run=exec,installerProxy=createProxyResolver(),home=process.env.DSH_HOME??join(homedir(),'.dsh')}={}){
 let checkedChannel=null,checkedAt=-Infinity,checking=null,applying=null,release=null,disposed=false,state={phase:'idle',available:false,version:null,error:null}
 const controller=new AbortController()
 const request=async(url,limit)=>readBounded(await fetcher(url,{headers:{accept:'application/vnd.github+json','user-agent':'dsh-progress'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),limit)
 const api={
  view(){const channel=developerMode()?'preview':'rc';return{...state,...(channel!==checkedChannel?{available:false,version:null}:{}),channel,restartRequired:true,busy:!!applying,checkedAt:Number.isFinite(checkedAt)?checkedAt:null}},
  check(force=false){
   if(disposed)return Promise.resolve(api.view())
   const channel=developerMode()?'preview':'rc'
   if(checking)return channel===checkedChannel?checking:checking.then(()=>api.check(true))
   if(['installing','restarting'].includes(state.phase)||!force&&channel===checkedChannel&&now()-checkedAt<CACHE_MS)return Promise.resolve(api.view())
   if(channel!==checkedChannel){release=null;state={phase:'idle',available:false,version:null,error:null}}
   checkedAt=now();checkedChannel=channel
   checking=(async()=>{
    try{const rows=JSON.parse((await request(`https://api.github.com/repos/${REPO}/releases?per_page=100`,1024*1024)).toString('utf8'))
     if(channel!==(developerMode()?'preview':'rc'))return api.view()
     release=selectRelease(rows,version,{includeAlpha:channel==='preview'});state={phase:release?'available':'idle',available:!!release,version:release?.tag_name.slice(1)??null,error:null}
    }catch(error){state={...state,error:String(error.message)}}finally{checking=null}
    return api.view()
   })();return checking
  },
  apply(){
   if(applying)return applying
   applying=(async()=>{
   if(disposed)throw new Error('The updater has been stopped')
   if(['installing','restarting'].includes(state.phase))return api.view()
   if(isRunning())throw new Error('Finish running tasks before updating the plugin')
   await api.check(true)
   if(!release||!state.available)throw new Error('No newer RC release is available')
   if(!profile?.name||!profile?.dir||!entry)throw new Error('The running host profile cannot be identified')
   const profileHome=profile.home??home
   if(resolve(profileHome,'profiles',profile.name)!==resolve(profile.dir))throw new Error('The running host profile directory does not match its name')
   const manifest=JSON.parse(await readFile(resolve(dirname(entry),'../package.json'),'utf8'))
   if(manifest.name!=='@deepseek-ai/dsh')throw new Error('The official DSH launcher could not be identified')
   const selected=release,target=selected.tag_name.slice(1),filename=`dsh-progress-${target}.tgz`
   const folder=join(profileHome,'dsh-progress','updates',target),archive=join(folder,filename)
   state={phase:'installing',available:false,version:target,error:null}
   try{
    const sums=(await request(assetUrl(selected,'SHA256SUMS'),16384)).toString('utf8')
    const checksum=sums.split(/\r?\n/u).map(line=>/^([a-fA-F0-9]{64})\s+\*?([^\s]+)$/u.exec(line)).find(match=>match?.[2]===filename)?.[1].toLowerCase()
    if(!checksum)throw new Error('No SHA-256 checksum was published for this archive')
    const bytes=await request(assetUrl(selected,filename),MAX_ARCHIVE)
    if(createHash('sha256').update(bytes).digest('hex')!==checksum)throw new Error('Release archive checksum does not match')
    // A small compressed asset must not expand into an unbounded tar bomb.
    gunzipSync(bytes,{maxOutputLength:16*1024*1024})
    await mkdir(folder,{recursive:true,mode:0o700});await writeFile(archive,bytes,{mode:0o600})
    // Reject links, escapes and unexpected top-level paths before extraction.
    const listing=await run('tar',['-tvzf',archive],{maxBuffer:1024*1024,timeout:15000})
    const names=await run('tar',['-tzf',archive],{maxBuffer:1024*1024,timeout:15000})
    if(listing.stdout.split('\n').some(line=>line&&!['-','d'].includes(line[0]))||names.stdout.split('\n').some(name=>name&&(!name.startsWith('package/')||name.split('/').some(part=>part==='..'||part.includes('\\')))))throw new Error('Release archive contains unsafe paths or links')
    await rm(join(folder,'package'),{recursive:true,force:true})
    await run('tar',['-xzf',archive,'-C',folder],{maxBuffer:1024*1024,timeout:15000})
    const pkg=JSON.parse(await readFile(join(folder,'package','package.json'),'utf8'))
    if(pkg.dependencies&&Object.keys(pkg.dependencies).length||pkg.optionalDependencies&&Object.keys(pkg.optionalDependencies).length)throw new Error('Release must not introduce runtime dependencies')
    if(pkg.name!=='@himleoing/dsh-progress'||pkg.version!==target||!supportsHost(pkg.engines?.dsh,manifest.version)||pkg.scripts&&Object.keys(pkg.scripts).some(key=>/^(?:preinstall|install|postinstall|preprepare|prepare|postprepare|prepublish|prepublishOnly)$/u.test(key)))throw new Error('Release manifest is incompatible with this host')
    if(!selectRelease([selected],version,{includeAlpha:developerMode()}))throw new Error('Update channel changed; check again')
    if(disposed||isRunning())throw new Error('A task started while the update was being prepared; try again after it finishes')
    // Keep the official GitHub source so the host can expose native version checks.
    // Asset validation runs first; the CLI owns source fetching, locks and rollback.
    const env=installerEnvironment(profileHome,await installerProxy())
    if(disposed||isRunning())throw new Error('A task started while the update was being prepared; try again after it finishes')
    await run(process.execPath,[entry,'plugin','--profile',profile.name,'add',`github:${REPO}#${selected.tag_name}`],{timeout:120000,maxBuffer:128*1024,windowsHide:true,env})
    if(disposed)return api.view()
    state={phase:'restarting',available:false,version:target,error:null}
    await restart()
   }catch(error){state={phase:'failed',available:true,version:target,error:String(error.message).slice(0,500)};throw error}
   return api.view()
   })().catch(error=>{if(state.phase!=='failed')state={...state,phase:'failed',error:String(error.message).slice(0,500)};throw error}).finally(()=>{applying=null})
   return applying
  },
  dispose(){disposed=true;controller.abort()},
 }
 return api
}
