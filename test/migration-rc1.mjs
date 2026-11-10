import assert from'node:assert/strict'
import fs from'node:fs';import os from'node:os';import path from'node:path'
import {migrateLegacyProgress}from'../lib/migration.js'
const home=fs.mkdtempSync(path.join(os.tmpdir(),'progress-migration-'))
try{
 assert.equal(migrateLegacyProgress({home}).migrated,false)
 const legacy=path.join(home,'dsh-base'),target=path.join(home,'dsh-task-progress');fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'progress.json'),'{"sessions":{"sample":{"percent":1}}}');fs.writeFileSync(path.join(legacy,'preferences.json'),'{"version":3,"aiEnabled":true,"cadence":"balanced"}');fs.writeFileSync(path.join(legacy,'probes.jsonl'),'fixture\n');const source=fs.readFileSync(path.join(legacy,'progress.json'))
 const result=migrateLegacyProgress({home});assert.equal(result.migrated,true);assert.equal(fs.readFileSync(path.join(target,'progress.json'),'utf8'),source.toString());assert.ok(fs.readFileSync(path.join(legacy,'progress.json')).equals(source));assert.equal(JSON.parse(fs.readFileSync(path.join(target,'preferences.json'))).aiEnabled,true)
 fs.writeFileSync(path.join(target,'preferences.json'),'new preferences');assert.equal(migrateLegacyProgress({home}).migrated,false);assert.equal(fs.readFileSync(path.join(target,'preferences.json'),'utf8'),'new preferences')
 console.log('migration passed: independent data directory, one-way copy, original unchanged and existing new values retained')
}finally{fs.rmSync(home,{recursive:true,force:true})}
