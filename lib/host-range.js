/** Small declared comparator ranges for our preflight; the official installer
 * remains authoritative. Prereleases participate, matching the DSH host gate. */
import {compareVersions} from './version-order.js'
const version=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u
export function supportsHost(range,current){
 if(typeof range!=='string'||typeof current!=='string'||!version.test(current))return false
 return range.split('||').some(branch=>{
  const tokens=branch.trim().split(/\s+/u)
  return tokens.length>0&&tokens.every(token=>{
   const match=/^(>=|<=|>|<|=)?(.+)$/u.exec(token)
   if(!match||!version.test(match[2]))return false
   const n=compareVersions(current,match[2])
   return match[1]==='>='?n>=0:match[1]==='<='?n<=0:match[1]==='>'?n>0:match[1]==='<'?n<0:n===0
  })
 })
}
