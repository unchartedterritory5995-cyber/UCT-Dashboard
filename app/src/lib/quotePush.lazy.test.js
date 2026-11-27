// @vitest-environment node
// lib/quotePush.js stays OUT of every first-open graph (#2751 CI: the notebook first-open bytes budget went
// +1,943 B over, and the member door worker rail saw livePriceStore register quotePush sinks at load).
// Rails:
//   1. no non-test module imports lib/quotePush statically; the ONE door is lib/quotePushGate.js's import();
//   2. the stores import the gate, and register nothing with quotePush at module load (a top-level call);
//   3. the poll cadence the store uses while the push is healthy is the module's own number.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') files(p, out) } else if (/\.(js|jsx|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/')
const isTest = (p) => /\.test\.(js|jsx|mjs)$/.test(p) || /[\\/]__tests__[\\/]/.test(p) || /[\\/]testing[\\/]/.test(p)

describe('lib/quotePush is lazy', () => {
  const all = files(SRC).filter((p) => !isTest(p))

  it('1. nothing imports it statically; the gate is its only door (with a control)', () => {
    const STATIC = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g
    const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    const statics = []
    const dynamics = []
    for (const f of all) {
      const src = strip(fs.readFileSync(f, 'utf8'))
      for (const m of src.matchAll(STATIC)) {
        const spec = m[1] || m[2]
        if (/(^|\/)quotePush(\.js)?$/.test(spec)) statics.push(rel(f))
      }
      for (const m of src.matchAll(DYNAMIC)) if (/(^|\/)quotePush(\.js)?$/.test(m[1])) dynamics.push(rel(f))
    }
    expect(all.length, 'the control: the walk read the app').toBeGreaterThan(1000)
    expect(statics, 'a static import puts the push client in a first-open chunk').toEqual([])
    expect(dynamics).toEqual(['lib/quotePushGate.js'])
  })

  it('2. the stores take the gate and register nothing with quotePush when they load', () => {
    for (const store of ['hooks/livePriceStore.js', 'lib/priceStreamManager.js']) {
      const src = strip(fs.readFileSync(path.join(SRC, store), 'utf8'))
      expect(src, store).toMatch(/from '\.{1,2}\/(lib\/)?quotePushGate'/)
      const topLevel = src.split('\n').filter((l) => /^(quotePush|qp)\.\w+\s*\(/.test(l))
      expect(topLevel, `${store}: a load-time registration`).toEqual([])
    }
  })

  it('3. the healthy-push poll cadence the store restates is the module\'s own', async () => {
    const store = fs.readFileSync(path.join(SRC, 'hooks/livePriceStore.js'), 'utf8')
    const mod = fs.readFileSync(path.join(SRC, 'lib/quotePush.js'), 'utf8')
    const num = (s) => Number((s.match(/export const PUSH_HEALTHY_POLL_MS = (\d+)/) || [])[1])
    expect(num(store)).toBeGreaterThan(0)
    expect(num(store)).toBe(num(mod))
  })
})
