/** Convert complete UTC daily counts to lifetime totals; never invent a missing day. */
export function cumulativeDownloads(rows) {
 let total=0,previous=null
 return rows.map(({date,count})=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(count)||count<0)throw new Error('Invalid npm download day')
  const time=Date.parse(`${date}T00:00:00Z`)
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date)throw new Error('Invalid npm download date')
  if(previous!==null&&time-previous!==86400000)throw new Error('Incomplete or unordered npm download history')
  previous=time;total+=count
  if(!Number.isSafeInteger(total))throw new Error('npm download total exceeds safe integer range')
  return {date,count:total}
 })
}

/** Polling without changed source data must not create another commit. */
export function statisticsChanged(previous,next) {
 const values=x=>({stars:x.stars??[],downloads:x.downloads??[],npmAvailable:x.npmAvailable??false,npmDataThrough:x.npmDataThrough??null})
 return JSON.stringify(values(previous))!==JSON.stringify(values(next))
}
