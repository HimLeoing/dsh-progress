/** A lower-bound work estimate: dependency path and available worker load. */
export function taskGraphRemaining(items, durationMs, workers = 1) {
  const known=new Set(items.map(item=>String(item.id)))
  const tasks = new Map(items.filter(item=>item.status!=='completed').map(item=>[String(item.id),item]))
  const cache=new Map(), visiting=new Set()
  const remaining = (id) => {
    if (!known.has(id)) return null
    if (!tasks.has(id)) return 0
    if (visiting.has(id)) return null
    if (cache.has(id)) return cache.get(id)
    visiting.add(id)
    let dependency=0
    for (const parent of tasks.get(id).blockedBy ?? []) {
      const cost=remaining(String(parent)); if(cost===null)return null
      dependency=Math.max(dependency,cost)
    }
    visiting.delete(id)
    const cost=Math.max(0,durationMs(id))+dependency
    cache.set(id,cost);return cost
  }
  let path=0,total=0
  for(const id of tasks.keys()){
    const cost=remaining(id);if(cost===null)return null
    path=Math.max(path,cost);total+=Math.max(0,durationMs(id))
  }
  return Math.max(path,total/Math.max(1,workers))
}
