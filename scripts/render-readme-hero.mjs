/** Compose the README cover from the four supplied, unaltered product captures. */
import fs from 'node:fs/promises'
import sharp from 'sharp'
const root=new URL('../',import.meta.url)
const {version}=JSON.parse(await fs.readFile(new URL('package.json',root),'utf8'))
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const images=['hero-local-overview.png','hero-local-details.png','hero-ai-overview.png','hero-ai-details.png']
const data=await Promise.all(images.map(async name=>`data:image/png;base64,${(await fs.readFile(new URL(`docs/assets/${name}`,root))).toString('base64')}`))
const copies={
 zh:{descriptor:'DeepSeek Harness 进度条',headline:['代码可以 Vibe，','进度必须 Visible'],font:100,
 features:['本地估算 · AI 辅助 · 任务清单 ·','子代理追踪 · 进度可视化'],
 description:['查看总体进度、子代理进展、','当前执行操作与预估剩余时间'],
 labels:['无 AI 辅助 · 主页面','无 AI 辅助 · 任务详情','有 AI 辅助 · 主页面','有 AI 辅助 · 任务详情']},
 en:{descriptor:'DeepSeek Harness Progress',headline:['No guess, less stress.','See progress you can assess.'],font:62,
 features:['Local Estimates · AI Assistance · Task Checklists ·','Subagent Tracking · Progress Visualization'],
 description:['Track overall progress, subagent activity,','current operations, and estimated time remaining.'],
 labels:['AI off · Overview','AI off · Task details','AI on · Overview','AI on · Task details']}
}
for(const [lang,c]of Object.entries(copies)){
 const cards=data.map((src,i)=>{
  const x=i<2?1000:1672,y=i%2===0?80:736
  return `<g><rect x="${x}" y="${y}" width="644" height="624" rx="22" fill="#151a1d" stroke="#4b4a40" stroke-width="2"/><circle cx="${x+29}" cy="${y+30}" r="6" fill="${i<2?'#a7aca9':'#d5b15a'}"/><text x="${x+48}" y="${y+40}" fill="${i<2?'#e2e4df':'#e2c26d'}" font-size="27" font-weight="600">${esc(c.labels[i])}</text><image x="${x+22}" y="${y+64}" width="600" height="538" preserveAspectRatio="xMidYMid meet" href="${src}"/></g>`
 }).join('')
 const text=(line,y,size,fill,weight=400)=>`<text x="80" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(line)}</text>`
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1440" viewBox="0 0 2400 1440"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#12171a"/><stop offset="1" stop-color="#2c2921"/></linearGradient><radialGradient id="glow"><stop stop-color="#c3a251" stop-opacity=".13"/><stop offset="1" stop-color="#c3a251" stop-opacity="0"/></radialGradient></defs><rect width="2400" height="1440" rx="40" fill="url(#bg)"/><ellipse cx="1850" cy="700" rx="800" ry="800" fill="url(#glow)"/><g font-family="-apple-system,BlinkMacSystemFont,PingFang SC,Helvetica Neue,Arial,sans-serif"><text x="80" y="157" fill="#d7b75e" font-size="26" letter-spacing="3">DEEPSEEK HARNESS</text><g><rect x="660" y="120" width="220" height="52" rx="26" fill="#29281f" stroke="#7d6c3e" stroke-width="2"/><text x="770" y="154" text-anchor="middle" fill="#e3c36c" font-size="28" font-weight="600">v${esc(version)}</text></g>${text('dsh-progress',350,lang==='zh'?112:74,'#f5f2e9',700)}<text x="80" y="410" font-size="36" fill="#d7b75e">${esc(c.descriptor)}<tspan dx="30" fill="#d4c9a8">By HimLeoing</tspan></text>${c.headline.map((s,i)=>text(s,640+i*136,c.font,'#f5f2e9',700)).join('')}<path d="M80 990H880" stroke="#5a5543" stroke-width="2"/>${c.features.map((s,i)=>text(s,1070+i*48,lang==='zh'?32:28,'#d4c9a8',600)).join('')}${c.description.map((s,i)=>text(s,1220+i*44,lang==='zh'?30:27,'#b6bbb4')).join('')}${cards}</g></svg>`
 await fs.writeFile(new URL(`docs/assets/hero-${lang}.svg`,root),svg+'\n')
 await sharp(Buffer.from(svg)).png().toFile(new URL(`docs/assets/hero-${lang}.png`,root).pathname)
 console.log(`Rendered ${lang}: 2400x1440, 40% copy / 60% screenshot grid`)
}
