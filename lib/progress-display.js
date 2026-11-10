/** One presentation contract. Concrete operations and changed scope qualify old forecasts. */
import {activePhase} from './progress-evidence.js'
export function progressDisplay(view,{modelOnly=true,probeEnabled=true,observer={},learning,now=Date.now()}={}) {
  const bar=view.projectBar ?? {}, model=view.model
  const commands=view.commands?.length?view.commands:view.command?.active?[view.command]:[]
  const observed=activePhase([...commands,...(view.preparing?[{...view.preparing,active:true}]:[])],model?.phase)
  const unsupportedWait=(commands.length>0||!!view.preparing)&&model?.phase==='wait'
  const phase=observed ?? (unsupportedWait?'unknown':model?.phase ?? view.phase ?? 'unknown')
  const base={phase,estimated:true,rangeMs:null,calibrationSamples:0,updatedAt:view.activityAt ?? 0}
  if(view.turnStatus==='completed')return{...base,percent:1,remainingMs:0,known:true,estimated:false,source:'completed',state:'completed',phase:'completed'}
  if(!view.running)return{...base,percent:bar.percent ?? 0,remainingMs:0,known:false,source:view.turnStatus ?? 'idle',state:view.turnStatus ?? 'idle'}
  const issue=['unavailable','retrying','budget'].includes(observer.state)?observer.state:null
  if(probeEnabled&&model?.turn===view.turn&&Number.isFinite(model.percent)) {
    const age=Math.max(0,now-model.at)
    const common={...base,percent:Math.max(0,Math.min(.99,model.percent)),remainingMs:null,known:false,source:'model',updatedAt:model.at,ageMs:age,confidence:model.confidence}
    const revised=Number.isFinite(model.evidenceRevision)&&Number.isFinite(view.evidenceRevision)&&model.evidenceRevision!==view.evidenceRevision
    if(revised)return{...common,state:issue ?? 'recalculating',phase:observed ?? view.lastTool?.phase ?? 'unknown',reason:'work-changed'}
    if(model.remainingMs===null||model.confidence===0)return{...common,state:issue ?? (model.phase==='wait'&&!unsupportedWait?'waiting':'estimating'),phase,reason:unsupportedWait?'active-operation':'insufficient-evidence'}
    const calibration=learning?.calibration(model.route,bar.mode) ?? {factor:1,samples:0,range:null}
    const remaining=model.remainingMs*calibration.factor-age
    const fresh=age<300000&&remaining>0
    const range=calibration.range?.map(ratio=>Math.max(0,model.remainingMs*ratio-age)) ?? null
    return{...common,remainingMs:fresh?remaining:null,known:fresh,source:calibration.applied?'calibrated':'model',state:issue ?? (age>=300000?'stale':fresh?'running':'recalculating'),rangeMs:fresh&&range?.[1]>0?range:null,calibrationSamples:calibration.samples,slow:observer.budgetLimited===true}
  }
  const historyAllowed=!modelOnly||!probeEnabled||issue&&(bar.known===true||(bar.total>0&&bar.done>0))
  if(historyAllowed) {
    const structural=!bar.known&&bar.total>0
    return{...base,percent:Math.min(.99,structural?bar.done/bar.total:bar.percent ?? 0),remainingMs:bar.known?bar.remainingMs:null,known:bar.known===true,source:structural?'plan':'history',state:issue ?? 'running',etaMs:bar.etaMs}
  }
  return{...base,percent:0,remainingMs:null,known:false,source:'calculating',state:issue ?? (observer.state==='updating'?'updating':'calculating')}
}
