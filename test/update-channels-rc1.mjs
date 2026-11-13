import assert from 'node:assert/strict'
import {selectRelease,createPluginUpdater} from '../lib/plugin-update.js'
const row=v=>({tag_name:'v'+v,draft:false})
const rows=[row('0.1.1-rc2'),row('0.1.2-alpha2'),row('0.1.2-alpha10'),row('0.1.1-alpha99')]
assert.equal(selectRelease(rows,'0.1.1-rc1').tag_name,'v0.1.1-rc2')
assert.equal(selectRelease(rows,'0.1.1-rc1',{includeAlpha:true}).tag_name,'v0.1.2-alpha10')
assert.equal(selectRelease([row('0.1.1-alpha99')],'0.1.1-rc1',{includeAlpha:true}),null,'developer mode does not downgrade an installed RC')
let mode=true,offline=false,requests=0
const updater=createPluginUpdater({version:'0.1.1-rc1',developerMode:()=>mode,fetcher:async()=>{requests++;if(offline)throw Error('offline');return new Response(JSON.stringify(rows))}})
await updater.check();assert.equal(updater.view().version,'0.1.2-alpha10')
mode=false;assert.equal(updater.view().available,false,'old preview offer disappears immediately when developer mode is disabled')
offline=true;await updater.check();assert.equal(updater.view().available,false,'an offline channel switch cannot leak an old Alpha offer')
offline=false;await updater.check(true);assert.equal(updater.view().version,'0.1.1-rc2')
mode=true;await updater.check();assert.equal(updater.view().version,'0.1.2-alpha10','changing channel bypasses the other channel cache')
assert.equal(requests,4);updater.dispose()
console.log('Update channels passed: RC, Alpha opt-in, numeric ordering, no downgrades, mode transitions, offline isolation')
