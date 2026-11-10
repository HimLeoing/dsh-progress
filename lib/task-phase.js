/** Display phases from current work, not the age of a request or an old read operation. */
const phaseFor = {
 planning:'discover',searching:'discover',reading:'discover',writing:'implement',editing:'implement',
 installing:'implement',building:'implement',executing:'implement',fixing:'implement',
 testing:'verify',reviewing:'verify',previewing:'verify',documenting:'deliver',packaging:'deliver',
 delivering:'deliver',finishing:'deliver',coordinating:'implement',waiting:'wait',processing:'unknown',
}
const result=detailPhase=>({phase:phaseFor[detailPhase],detailPhase})
function namedWork(value) {
 const text=String(value??'')
 if(/修复|排错|调试|返工|\b(?:fix|debug|repair|regression)\b/iu.test(text))return 'fixing'
 if(/最终|收尾|验收|最终交付|\b(?:final|wrap.?up|acceptance)\b/iu.test(text))return 'finishing'
 if(/readme|说明|文档|使用指南|\b(?:document(?:ation)?|docs)\b/iu.test(text))return 'documenting'
 if(/交付|提交成果|汇总成果|\b(?:deliver|handoff)\b/iu.test(text))return 'delivering'
 if(/打包|整理产物|\b(?:package|packaging|archive)\b/iu.test(text))return 'packaging'
 if(/测试|回归|\b(?:test|testing|typecheck|lint)\b/iu.test(text))return 'testing'
 if(/预览|渲染|截图|效果|\b(?:preview|render|screenshot|visual)\b/iu.test(text))return 'previewing'
 if(/校验|验证|检查|审阅|核对|\b(?:verify|validate|review|inspect|check)\b/iu.test(text))return 'reviewing'
 if(/安装|依赖|\b(?:install|dependencies)\b/iu.test(text))return 'installing'
 if(/构建|编译|\b(?:build|compile|bundle)\b/iu.test(text))return 'building'
 if(/设计|规划|需求|\b(?:design|plan|requirements)\b/iu.test(text))return 'planning'
 return null
}
export function taskPhase(view,{now=Date.now(),useModel=false}={}) {
 const items=view.plan?.items??[],activeItem=items.find(item=>item.status==='in_progress')
 const planned=namedWork(activeItem?.content??view.task?.label)
 const model=useModel&&view.model?.turn===view.turn&&now-(view.model.evidenceAt??view.model.at)<600000&&view.model.evidenceRevision===view.evidenceRevision?view.model:null
 const context=planned?phaseFor[planned]:model?.phase??view.observedPhase
 const failed=view.lastTool?.status==='failed'
 const commands=(view.commands??[]).filter(row=>row.active!==false&&!row.infinite)
 const operation=commands.find(row=>row.phase==='verify')??commands.at(-1)??view.preparing
 if(operation) {
  const name=operation.name,label=operation.label??'',named=namedWork(label)
  if(name==='present')return result('delivering')
  if(['write','edit','apply_patch','write_file','edit_file'].includes(name)) {
   if(failed)return result('fixing')
   if(named==='documenting'||/\.(?:md|mdx|rst|txt)$/iu.test(label)&&context==='deliver')return result('documenting')
   return result(name.includes('edit')||name==='apply_patch'?'editing':'writing')
  }
  if(['bash','pwsh','exec_command'].includes(name))return result(operation.phase==='discover'?['verify','deliver'].includes(context)?context==='deliver'?'finishing':'reviewing':'reading':named??(operation.phase==='verify'?'testing':operation.phase==='implement'?'building':'executing'))
  if(['read','read_file','read_image','glob','grep','web_fetch','web_search'].includes(name)) {
   if(failed)return result('fixing')
   if(name==='read_image')return result('previewing')
   if(['verify','deliver'].includes(context))return result(planned??(context==='deliver'?'finishing':'reviewing'))
   return result(['glob','grep','web_search'].includes(name)?'searching':'reading')
  }
  if(/agent|team|delegate/iu.test(name))return result('coordinating')
  if(operation===view.preparing&&!planned&&!model)return result('processing')
 }
 if(failed)return result('fixing')
 if(planned)return result(planned)
 // Image inspection remains the context while the model evaluates that image.
 if(view.lastTool?.name==='read_image')return result('previewing')
 // Ordinary command descriptions are short-lived hints, not a permanent stage.
 if(view.lastTool&&now-view.lastTool.finishedAt<20000) {
  const last=view.lastTool,name=last.name
  if(name==='present')return result('delivering')
  if(name==='read_image')return result('previewing')
  const named=namedWork(last.label)
  if(['write','edit','apply_patch','write_file','edit_file'].includes(name))return result(named==='documenting'?'documenting':name.includes('edit')||name==='apply_patch'?'editing':'writing')
  if(['bash','pwsh','exec_command'].includes(name)&&last.phase==='discover')return result(['verify','deliver'].includes(context)?context==='deliver'?'finishing':'reviewing':'reading')
  if(['bash','pwsh','exec_command'].includes(name)&&named)return result(named)
  if(['read','read_file','glob','grep','web_fetch','web_search'].includes(name))return result(['verify','deliver'].includes(context)?context==='deliver'?'finishing':'reviewing':['glob','grep','web_search'].includes(name)?'searching':'reading')
 }
 const phase=model?.phase??view.observedPhase??view.lastTool?.phase??'unknown'
 // A late read does not establish that the whole task has returned to initial analysis.
 const detail=phase==='discover'?((view.plan?.done??0)>0||(model?.percent??0)>=.5?'reviewing':'reading'):phase==='implement'?'writing':phase==='verify'?'reviewing':phase==='deliver'?'finishing':phase==='wait'?'waiting':'processing'
 return result(detail)
}
