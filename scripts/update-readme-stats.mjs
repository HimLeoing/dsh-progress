/** Public project statistics only. Missing days stay missing; no synthetic history. */
import fs from 'node:fs/promises'
import https from 'node:https'
import {createProxyResolver} from '../lib/github-transport.js'
const repo='HimLeoing/dsh-progress',pkg='@himleoing/dsh-progress'
const proxyEnv=await createProxyResolver()()
const agent=new https.Agent({proxyEnv})
async function readJson(url,headers={}) {
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
const [github,npm]=await Promise.all([
 readJson(`https://api.github.com/repos/${repo}`,process.env.GITHUB_TOKEN?{authorization:`Bearer ${process.env.GITHUB_TOKEN}`} : {}),
 readJson(`https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(pkg)}`)
])
if(!Number.isInteger(github?.stargazers_count))throw new Error('Missing GitHub star count')
const stars=[...previous.stars.filter(row=>row.date!==date),{date,count:github.stargazers_count}].slice(-366)
const map=new Map((previous.downloads??[]).map(row=>[row.date,row.count]))
for(const row of npm?.downloads??[])if(row.day<=yesterday&&Number.isInteger(row.downloads)&&row.downloads>=0)map.set(row.day,row.downloads)
const downloads=[...map].map(([date,count])=>({date,count})).sort((a,b)=>a.date.localeCompare(b.date)).slice(-366)
const data={repository:repo,package:pkg,updatedAt:now.toISOString(),stars,downloads,npmAvailable:npm!==null}
const esc=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
function chart(title,subtitle,rows,empty,source){
 const width=580,height=270,left=48,right=542,top=88,bottom=190,max=Math.max(1,...rows.map(r=>r.count)),n=rows.length
 const points=rows.map((r,i)=>({x:n===1?(left+right)/2:left+i*(right-left)/(n-1),y:bottom-r.count/max*(bottom-top),...r}))
 const labels=[...new Set(n?[0,Math.floor((n-1)/2),n-1]:[])].map(i=>`<text x="${points[i].x}" y="214" text-anchor="middle" fill="#acada6" font-size="11">${esc(points[i].date.slice(5))}</text>`).join('')
 const dots=points.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="${i===n-1?4:2}" fill="#d7b65c"><title>${esc(p.date)} · ${p.count}</title></circle>`).join('')
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><rect x=".5" y=".5" width="579" height="269" rx="16" fill="#181d22" stroke="#393d40"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><text x="26" y="35" fill="#f0eee7" font-size="21" font-weight="600">${esc(title)}</text><text x="26" y="59" fill="#acada6" font-size="12">${esc(subtitle)}</text><path d="M${left} ${top}V${bottom}H${right}" fill="none" stroke="#4d504e"/>${points.length?`<text x="${left-9}" y="${top+4}" text-anchor="end" fill="#acada6" font-size="11">${max}</text><text x="${left-9}" y="${bottom+4}" text-anchor="end" fill="#acada6" font-size="11">0</text><polyline points="${points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#c8a84f" stroke-width="2.5"/>${dots}${labels}`:`<text x="290" y="145" text-anchor="middle" fill="#acada6" font-size="16">${esc(empty)}</text>`}<text x="26" y="247" fill="#969b95" font-size="11">${esc(source)} · ${date} UTC</text></g></svg>\n`
}
await fs.writeFile(file,JSON.stringify(data,null,2)+'\n')
for(const zh of [false,true]){
 await fs.writeFile(new URL(`../docs/assets/npm-downloads${zh?'-zh':''}.svg`,import.meta.url),chart(zh?'npm 每日下载量':'npm daily downloads',pkg,downloads,zh?'等待 npm 下载统计同步':'Waiting for npm download statistics','Source: npm Downloads API'))
 await fs.writeFile(new URL(`../docs/assets/stars${zh?'-zh':''}.svg`,import.meta.url),chart(zh?'GitHub Star 记录':'GitHub Star observations',zh?'按日采样；不补造此前历史':'Daily samples; no reconstructed past values',stars,'','Source: GitHub API'))
}
console.log(JSON.stringify({date,stars:github.stargazers_count,starSamples:stars.length,downloadDays:downloads.length,npmAvailable:npm!==null}))
