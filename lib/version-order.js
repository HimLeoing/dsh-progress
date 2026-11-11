/** Split `major.minor.patch[-pre]` into comparable pieces. */
function parseVersion(value) {
  const text = String(value ?? '').trim()
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(text)
  if (match === null) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] === undefined ? [] : match[4].split('.') }
}

/**
 * Semver precedence, pre-release aware.
 * @returns -1 | 0 | 1; unparsable inputs compare equal so a bad tag never
 *   hides or invents an update.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  const length = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < length; i += 1) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numericX = /^\d+$/u.test(x)
    const numericY = /^\d+$/u.test(y)
    if (numericX && numericY) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta < 0 ? -1 : 1
      continue
    }
    if (numericX !== numericY) return numericX ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

