import assert from 'node:assert/strict'
import {supportsHost} from '../lib/host-range.js'
for(const version of ['0.2.2-rc.1','0.2.2-rc.2','0.2.2-rc.10','0.2.2','0.2.3','0.3.0-rc.1','1.0.0'])assert.equal(supportsHost('>=0.2.2-rc.1',version),true)
for(const version of ['0.2.1','0.2.2-alpha.1','0.2.2-rc.0','garbage',''])assert.equal(supportsHost('>=0.2.2-rc.1',version),false)
assert.equal(supportsHost('>=0.2.2-rc.1 <0.3.0','0.2.2-rc.2'),true)
assert.equal(supportsHost('0.2.2-rc.1','0.2.2-rc.2'),false)
for(const range of ['', '*', '>=nonsense','^0.2.2'])assert.equal(supportsHost(range,'0.2.2-rc.2'),false,'unsupported preflight declarations fail closed')
console.log('Host range rc1 passed: prereleases, future minimums, older rejection and fail-closed preflight')
