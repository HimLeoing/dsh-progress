/** Reduce tool arguments to bounded work facts before transcript bodies are discarded.
 * Neither file contents nor output text are persisted by this module. */
import {createHash} from 'node:crypto'
const hash=text=>createHash('sha256').update(text).digest('hex').slice(0,24)
const mutations=new Set(['write','write_file','edit','edit_file','apply_patch'])
function parse(raw){try{return typeof raw==='string'?JSON.parse(raw):raw??{}}catch{return{patch:String(raw??'')}}}
export function localWorkFacts(name,raw){
 const args=parse(raw),command=String(args.command??args.cmd??'').slice(0,8192)
 const body=String(args.content??args.contents??args.new_string??args.new_text??args.replacement??args.patch??args.input??'')
 const target=String(args.file_path??args.path??'')
 const selectors=['url','query','pattern','name','offset','start_line','end_line','limit'].map(key=>String(args[key]??'').slice(0,4096))
 const fingerprint=hash(JSON.stringify([name,target,selectors,command,body.length,hash(body),hash(String(args.old_string??args.old_text??''))]))
 const mutation=mutations.has(name)
 const lines=body?body.split('\n',4097).length:0
 const credit=mutation&&body?Math.min(3.5,.5+Math.log2(1+Math.max(body.length/160,lines/4))*.45):1
 const syntax=/\b(?:node(?:js)?\s+--check|(?:tsc|eslint|ruff|mypy)\b|(?:lint|typecheck|compileall)\b)/iu.test(command)
 const tests=/\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|verify)(?:\b|:)|node(?:js)?\s+--test|pytest|unittest|vitest|jest|cargo\s+test|go\s+test|dotnet\s+test)\b|\b(?:node|python3?)\s+[^\n]*\b[^\s]*[.-](?:test|spec|check)\.[cm]?[jt]s\b/iu.test(command)
 return{fingerprint,credit,mutates:mutation,targetKey:mutation&&target?hash(target):null,mutation:['write','write_file'].includes(name)&&body.length>0,verification:syntax?1:tests?2:0}
}
/** Exit success is required by the caller. Labels are never proof of acceptance. */
export function localVerificationGrade(facts,output=''){
 if(facts?.verification!==2)return facts?.verification??0
 const text=String(output).slice(-8192)
 const counts=[...text.matchAll(/(?:#\s*pass\s+(\d+)|\b(\d+)\s+(?:passed|tests? passed)\b)/giu)].map(m=>Number(m[1]??m[2]))
 return Math.max(0,...counts)>=5?3:2
}
