/** One-way migration. Existing new files win; legacy data is never removed. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FILES=['preferences.json','progress.json','learning.json','pricing.json','probes.jsonl','probes.jsonl.1','probe-debug.jsonl','probe-debug.jsonl.1']
export function migrateLegacyProgress({home=process.env.DSH_HOME??path.join(os.homedir(),'.dsh')}={}){
 const target=path.join(home,'dsh-progress'),marker=path.join(target,'.legacy-migrated-rc2')
 if(fs.existsSync(marker))return{migrated:false}
 const copied=[]
 try{
  const sources=['dsh-task-progress','dsh-base'].map(name=>path.join(home,name)).filter(source=>{
   try{return fs.lstatSync(source).isDirectory()}catch{return false}
  })
  if(!sources.length)return{migrated:false}
  fs.mkdirSync(target,{recursive:true,mode:0o700})
  if(!fs.lstatSync(target).isDirectory())return{migrated:false,copied}
  for(const source of sources)for(const file of FILES){
   const from=path.join(source,file),to=path.join(target,file)
   try{
    const stat=fs.lstatSync(from)
    if(!stat.isFile()||stat.size>8*1024*1024)continue
    // COPYFILE_EXCL protects files created concurrently and dangling links.
    fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,0o600);copied.push(file)
   }catch(error){if(!['ENOENT','EEXIST'].includes(error.code))throw error}
  }
  fs.writeFileSync(marker,'1\n',{mode:0o600,flag:'wx'})
  return{migrated:true,copied}
 }catch{return{migrated:false,copied}}
}
