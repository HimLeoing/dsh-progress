import assert from 'node:assert/strict'
import fs from 'node:fs';import os from 'node:os';import path from 'node:path'
import {migrateLegacyProgress} from '../lib/migration.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'progress-migration-'))
const write=(dir,file,value)=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,file),value)}
try{
 assert.equal(migrateLegacyProgress({home}).migrated,false)
 const base=path.join(home,'dsh-base'),legacy=path.join(home,'dsh-task-progress'),target=path.join(home,'dsh-progress')
 write(base,'progress.json','base progress');write(base,'learning.json','base learning');write(base,'preferences.json','base preferences')
 write(legacy,'progress.json','standalone progress');write(legacy,'preferences.json','standalone preferences')
 write(legacy,'pricing.json','{"provider":"custom","cachedInput":0.01}')
 write(legacy,'probe-debug.jsonl','private fixture\n');write(legacy,'probe-debug.jsonl.1','older fixture\n')
 write(legacy,'probes.jsonl','usage fixture\n');write(legacy,'probes.jsonl.1','older usage fixture\n')
 write(target,'preferences.json','new preferences')
 fs.symlinkSync(path.join(base,'learning.json'),path.join(legacy,'learning.json'))
 const result=migrateLegacyProgress({home});assert.equal(result.migrated,true)
 assert.equal(fs.readFileSync(path.join(target,'progress.json'),'utf8'),'standalone progress','standalone source wins over former combined plugin')
 assert.equal(fs.readFileSync(path.join(target,'learning.json'),'utf8'),'base learning','symlink is skipped, safe fallback source fills missing file')
 assert.equal(fs.readFileSync(path.join(target,'preferences.json'),'utf8'),'new preferences','existing destination wins')
 for(const file of ['pricing.json','probe-debug.jsonl','probe-debug.jsonl.1','probes.jsonl','probes.jsonl.1'])assert.equal(fs.readFileSync(path.join(target,file),'utf8'),fs.readFileSync(path.join(legacy,file),'utf8'))
 assert.equal(fs.readFileSync(path.join(legacy,'progress.json'),'utf8'),'standalone progress','standalone original preserved')
 assert.equal(fs.readFileSync(path.join(base,'progress.json'),'utf8'),'base progress','combined original preserved')
 assert.equal(fs.statSync(path.join(target,'pricing.json')).mode&0o777,0o600)
 assert.equal(migrateLegacyProgress({home}).migrated,false,'migration is idempotent')
 const prefsOnly=path.join(home,'prefs-only');write(path.join(prefsOnly,'dsh-task-progress'),'preferences.json','prefs only')
 assert.equal(migrateLegacyProgress({home:prefsOnly}).migrated,true,'preferences migrate even without a progress snapshot')
 assert.equal(fs.readFileSync(path.join(prefsOnly,'dsh-progress','preferences.json'),'utf8'),'prefs only')
 const oversized=path.join(home,'oversized');write(path.join(oversized,'dsh-task-progress'),'probe-debug.jsonl',Buffer.alloc(8*1024*1024+1));migrateLegacyProgress({home:oversized})
 assert.equal(fs.existsSync(path.join(oversized,'dsh-progress','probe-debug.jsonl')),false,'oversized files are skipped')
 console.log('RC2 migration passed: standalone priority, base fallback, preferences-only, debug/pricing/logs, destination wins, original untouched, safe bounded copying and idempotence')
}finally{fs.rmSync(home,{recursive:true,force:true})}
