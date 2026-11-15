/** Public project statistics only. Missing days stay missing; no synthetic history. */
import fs from 'node:fs/promises'
import https from 'node:https'
import {createProxyResolver} from '../lib/github-transport.js'
import {cumulativeDownloads} from './download-series.mjs'
const repo='HimLeoing/dsh-progress',pkg='@himleoing/dsh-progress'
// Rebuild download artwork from previously verified daily counts without
// changing Star observations or claiming a new network observation.
const renderOnly=process.argv.includes('--render-only')
const proxyEnv=await createProxyResolver()()
const agent=new https.Agent({proxyEnv})
async function readJson(url,headers={}) {
 // npm is often directly reachable while GitHub needs the system proxy.
 // A failed direct connection may still use the existing proxy transport.
 if(new URL(url).hostname!=='api.github.com'){
  let response
  try{response=await fetch(url,{headers:{'user-agent':'dsh-progress-readme',...headers},signal:AbortSignal.timeout(5000)})}catch{}
  if(response){
   if(response.status===404)return null
   if(!response.ok)throw new Error(`Statistics request failed: HTTP ${response.status}`)
   return response.json()
  }
 }
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{agent,headers:{'user-agent':'dsh-progress-readme',...headers},signal:AbortSignal.timeout(20000)},res=>{
   const chunks=[];let size=0
   res.on('data',b=>{size+=b.length;if(size>2e6){res.destroy(new Error('Statistics response too large'));return}chunks.push(b)})
   res.on('error',reject);res.on('end',()=>{
    if(res.statusCode===404)return resolve(null)
    if(res.statusCode!==200)return reject(new Error(`Statistics request failed: HTTP ${res.statusCode}`))
    try{resolve(JSON.parse(Buffer.concat(chunks).toString()))}catch(e){reject(e)}
   })
  });req.on('error',reject)
 })
}
const now=new Date(),date=now.toISOString().slice(0,10),yesterday=new Date(now-86400000).toISOString().slice(0,10)
const file=new URL('../docs/stats.json',import.meta.url)
let previous={stars:[],downloads:[]}
try{previous=JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
const [github,npmDay,metadata]=renderOnly?[null,null,null]:await Promise.all([
 readJson(`https://api.github.com/repos/${repo}`,process.env.GITHUB_TOKEN?{authorization:`Bearer ${process.env.GITHUB_TOKEN}`} : {}),
 readJson(`https://api.npmjs.org/downloads/point/last-day/${encodeURIComponent(pkg)}`),
 readJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`)
])
if(!renderOnly&&!Number.isInteger(github?.stargazers_count))throw new Error('Missing GitHub star count')
const stars=renderOnly?previous.stars:[...previous.stars.filter(row=>row.date!==date),{date,count:github.stargazers_count}].slice(-366)
let downloads=previous.downloads??[],npmDataThrough=previous.npmDataThrough??downloads.at(-1)?.date??null
// Use npm's last AVAILABLE day, not yesterday's date with an unpublished zero.
// Fetch all published history in API-sized windows so an outage or rolling
// chart window cannot silently drop older downloads from a lifetime total.
if(npmDay!==null){
 const first=metadata?.time?.created?.slice(0,10),last=npmDay.end
 if(!/^\d{4}-\d{2}-\d{2}$/.test(first??'')||!/^\d{4}-\d{2}-\d{2}$/.test(last??'')||last>yesterday)throw new Error('Missing or invalid npm history bounds')
 // Keep just the day before publication as the zero baseline.
 const start=Date.parse(`${first}T00:00:00Z`)-86400000,end=Date.parse(`${last}T00:00:00Z`),rows=[]
 for(let from=start;from<=end;from+=365*86400000){
  const to=Math.min(end,from+364*86400000),a=new Date(from).toISOString().slice(0,10),b=new Date(to).toISOString().slice(0,10)
  const range=await readJson(`https://api.npmjs.org/downloads/range/${a}:${b}/${encodeURIComponent(pkg)}`)
  if(!Array.isArray(range?.downloads)||range.downloads.length!==(to-from)/86400000+1||range.downloads[0]?.day!==a||range.downloads.at(-1)?.day!==b)throw new Error('Incomplete npm download history response')
  rows.push(...range.downloads.map(row=>({date:row.day,count:row.downloads})))
 }
 cumulativeDownloads(rows) // Validate the full series before publishing any files.
 downloads=rows;npmDataThrough=rows.at(-1)?.date??null
}
const totals=cumulativeDownloads(downloads),total=totals.at(-1)?.count??0
const npmAvailable=renderOnly?previous.npmAvailable:npmDay!==null
const data={repository:repo,package:pkg,updatedAt:renderOnly?previous.updatedAt:now.toISOString(),chartsUpdatedAt:now.toISOString(),stars,downloads,npmAvailable,npmDataThrough,npmTotalDownloads:total}
const esc=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
function chart(title,subtitle,rows,empty,source,{zh=false,cumulative=false}={}){
 const width=580,height=270,left=48,right=542,top=88,bottom=190,max=Math.max(1,...rows.map(r=>r.count)),n=rows.length
 const points=rows.map((r,i)=>({x:n===1?(left+right)/2:left+i*(right-left)/(n-1),y:bottom-r.count/max*(bottom-top),...r}))
 const indices=n<=7?Array.from({length:n},(_,i)=>i):[0,Math.floor((n-1)/2),n-1]
 const labels=[...new Set(indices)].map(i=>`<text x="${points[i].x}" y="211" text-anchor="middle" fill="#acada6" font-size="11">${esc(points[i].date.slice(5))}</text>`).join('')
 const dots=points.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="${i===n-1?4:2}" fill="#d7b65c"><title>${esc(p.date)} · ${p.count}</title></circle>`).join('')
 const extra=cumulative?`<text x="542" y="38" text-anchor="end" fill="#d7b65c" font-size="25" font-weight="600">${total.toLocaleString('en-US')}</text><text x="48" y="78" fill="#acada6" font-size="10">${zh?'累计下载次数':'Cumulative downloads'}</text><text x="542" y="228" text-anchor="end" fill="#acada6" font-size="10">${zh?'日期（UTC）':'Date (UTC)'}</text>`:''
 const footer=cumulative?`npm API · ${zh?'数据截至':'Data through'} ${npmDataThrough??'—'} UTC · ${zh?'刷新于':'Refreshed'} ${date} UTC`:`${source} · ${date} UTC`
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><rect x=".5" y=".5" width="579" height="269" rx="16" fill="#181d22" stroke="#393d40"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><text x="26" y="35" fill="#f0eee7" font-size="21" font-weight="600">${esc(title)}</text><text x="26" y="59" fill="#acada6" font-size="12">${esc(subtitle)}</text>${extra}<path d="M${left} ${top}V${bottom}H${right}" fill="none" stroke="#4d504e"/>${points.length?`<text x="${left-9}" y="${top+4}" text-anchor="end" fill="#acada6" font-size="11">${max}</text><text x="${left-9}" y="${bottom+4}" text-anchor="end" fill="#acada6" font-size="11">0</text><polyline points="${points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#c8a84f" stroke-width="2.5"/>${dots}${labels}`:`<text x="290" y="145" text-anchor="middle" fill="#acada6" font-size="16">${esc(empty)}</text>`}<text x="26" y="249" fill="#969b95" font-size="11">${esc(footer)}</text></g></svg>\n`
}
await fs.writeFile(file,JSON.stringify(data,null,2)+'\n')
for(const zh of [false,true]){
 await fs.writeFile(new URL(`../docs/assets/npm-downloads${zh?'-zh':''}.svg`,import.meta.url),chart(zh?'npm 累计下载量':'npm cumulative downloads',pkg,totals.slice(-366),zh?'等待 npm 下载统计同步':'Waiting for npm download statistics','Source: npm Downloads API',{zh,cumulative:true}))
 if(!renderOnly)await fs.writeFile(new URL(`../docs/assets/stars${zh?'-zh':''}.svg`,import.meta.url),chart(zh?'GitHub Star 记录':'GitHub Star observations',zh?'按日采样；不补造此前历史':'Daily samples; no reconstructed past values',stars,'','Source: GitHub API'))
}
console.log(JSON.stringify({date,renderOnly,stars:stars.at(-1)?.count,starSamples:stars.length,downloadDays:downloads.length,npmAvailable,npmDataThrough,totalDownloads:total}))
