/** Vendored pure pricing subset: dsh-cost-meter 1.9.58 (MIT). See THIRD_PARTY_NOTICES.md. */
/** Original unit rates stay untouched; multipliers are applied only when selecting a billing tier. */
export const multiplierPath = /^(base|offPeak|peak|legacyBase|longContext|cny)\.(cacheHit|cacheMiss|cacheWrite|output|reasoning)$/
export function priceMultiplierSettings(entry) {
  return Object.fromEntries(['multiplier', 'separateMultipliers', 'multipliers'].filter(key => entry?.[key] !== undefined).map(key => [key, entry[key]]))
}
export function priceFactor(entry, path) {
  return (entry.separateMultipliers ? entry.multipliers?.[path] : undefined) ?? entry.multiplier ?? 1
}
export function multipliedTier(price, entry, path = 'base') {
  const tier = {}
  for (const field of ['cacheHit', 'cacheMiss', 'cacheWrite', 'output', 'reasoning']) {
    if (price[field] !== undefined) tier[field] = price[field] * priceFactor(entry, path + '.' + field)
  }
  if (price.longContext) tier.longContext = { ...multipliedTier(price.longContext, entry, 'longContext'), aboveInputTokens: price.longContext.aboveInputTokens }
  return tier
}
export function cnyPrice(entry) {
  const settings = priceMultiplierSettings(entry)
  if (settings.multipliers) settings.multipliers = Object.fromEntries(Object.entries(settings.multipliers).filter(([path]) => path.startsWith('cny.')).map(([path, value]) => [path.replace('cny.', 'base.'), value]))
  return { ...entry.cny, ...settings }
}
export function validPriceMultipliers(entry) {
  if (entry.multiplier === undefined && entry.separateMultipliers === undefined && entry.multipliers === undefined) return true
  const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (entry.multiplier !== undefined && !valid(entry.multiplier)) return false
  if (entry.separateMultipliers !== undefined && typeof entry.separateMultipliers !== 'boolean') return false
  if (entry.multipliers !== undefined && (!entry.multipliers || typeof entry.multipliers !== 'object' || Array.isArray(entry.multipliers)
    || Object.entries(entry.multipliers).some(([path, value]) => !multiplierPath.test(path) || !valid(value)))) return false
  // Reject overflow before a configuration is saved, including scheduled/historical tiers.
  for (const record of [entry, ...(entry.rateHistory ?? [])]) {
    for (const path of ['base', 'offPeak', 'peak', 'legacyBase', 'longContext', 'cny']) {
      const tier = path === 'base' ? record : record[path]
      if (!tier) continue
      for (const field of ['cacheHit', 'cacheMiss', 'cacheWrite', 'output', 'reasoning']) {
        if (tier[field] !== undefined && !Number.isFinite(tier[field] * priceFactor(entry, path + '.' + field))) return false
      }
    }
  }
  return true
}
