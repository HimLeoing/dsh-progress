import { mkdir, appendFile, stat, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A small serial append queue, rotated at 5 MiB. No transcript is logged. */
export function createProbeLog(file) {
  let queue = Promise.resolve()
  let pending = 0
  return {
    write(record) {
      if (pending >= 64) return
      pending += 1
      queue = queue.then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const size = await stat(file).then(s => s.size, () => 0)
        if (size >= 5 * 1024 * 1024) await rename(file, `${file}.1`)
        await appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
      }).catch(() => {}).finally(() => { pending -= 1 })
    },
    flush() { return queue },
  }
}
