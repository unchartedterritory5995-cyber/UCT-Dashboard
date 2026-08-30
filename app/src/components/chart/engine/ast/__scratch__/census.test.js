import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../pine.js'
import { translateThinkScript } from '../thinkscript.js'

const dir = (p) => path.resolve(process.cwd(), p)
const CORPORA = [
  { d: '../tests/fixtures/pine', ext: '.pine', t: translatePine },
  { d: '../tests/fixtures/pine_community', ext: '.pine', t: translatePine },
  { d: '../tests/fixtures/thinkscript', ext: '.ts', t: translateThinkScript },
]
describe('scratch', () => {
  it('per-script', () => {
    const out = []
    for (const { d, ext, t } of CORPORA) {
      for (const f of fs.readdirSync(dir(d)).filter((x) => x.endsWith(ext)).sort()) {
        const src = fs.readFileSync(path.join(dir(d), f), 'utf8')
        const usesColl = /\barray\.|\bmatrix\.|\bmap\.|\bfold\s+\w+\s*=/.test(src)
        if (!usesColl) continue
        let r
        try { r = t(src) } catch (e) { r = { ok: false, refusal: { guard: 'THREW', message: String(e) } } }
        const g = r.ok ? 'OK' : (r.refusal && r.refusal.guard)
        const m = r.ok ? `${(r.outputs || []).length} outputs` : (r.refusal && (r.refusal.message || '')).slice(0, 90)
        const line = (r.refusal && r.refusal.line) || ''
        out.push(`${f.padEnd(46)} ${String(g).padEnd(24)} L${String(line).padEnd(5)} ${m}`)
      }
    }
    console.log('\n' + out.join('\n') + '\n')
  })
})
