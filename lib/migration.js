/** One-way migration from the former combined plugin. Existing new files win. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
export function migrateLegacyProgress({home=process.env.DSH_HOME??path.join(os.homedir(),'.dsh')}={}){
 const target=path.join(home,'dsh-task-progress'),legacy=path.join(home,'dsh-base'),marker=path.join(target,'.legacy-migrated-v1')
 if(fs.existsSync(marker)||!fs.existsSync(path.join(legacy,'progress.json')))return{migrated:false}
 const copied=[]
 try{
  fs.mkdirSync(target,{recursive:true,mode:0o700})
  for(const file of ['preferences.json','progress.json','learning.json','probes.jsonl','probes.jsonl.1']){
   const source=path.join(legacy,file),destination=path.join(target,file)
   if(fs.existsSync(destination)||!fs.existsSync(source))continue
   const stat=fs.lstatSync(source);if(!stat.isFile()||stat.size>8*1024*1024)continue
   // COPYFILE_EXCL protects files created concurrently. The source is untouched.
   fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,0o600);copied.push(file)
  }
  fs.writeFileSync(marker,'1\n',{mode:0o600,flag:'wx'})
  return{migrated:true,copied}
 }catch{return{migrated:false,copied}}
}
