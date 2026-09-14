// app/src/pages/breadth/heatmapRegistry.golden.test.js
//
// R1 acceptance (audit "Registry unification"): HM_METRICS, TREEMAP_DEF, FFILL_KEYS and
// PCTILE_KEYS serialise identically before and after the registry moves under
// chartMetrics.js. Fields are serialised in a fixed order and functions by source, so an
// object built differently but equal in every field still compares equal — which is the
// whole point: R1 rebuilds these objects from a different place and must not change one
// label, one drill key, one tier function or one row of the treemap.
//
// ⛔ The golden is generated ONCE, on the tree before the move, with WRITE_HM_GOLDEN=1.
// Regenerating it to make a red run green would delete the only evidence R1 was invisible.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HM_METRICS, TREEMAP_DEF, FFILL_KEYS, PCTILE_KEYS } from './heatmapMetrics'

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'heatmapRegistry.golden.json')
const FIELDS = ['key', 'label', 'group', 'isHeader', 'drillKey', 'polarity', 'pair', 'getTier', 'getFmt']

export function serialiseRegistry() {
  return {
    HM_METRICS: HM_METRICS.map(m => Object.fromEntries(FIELDS
      .filter(f => m[f] !== undefined)
      .map(f => [f, typeof m[f] === 'function' ? m[f].toString() : m[f]]))),
    TREEMAP_DEF,
    FFILL_KEYS: [...FFILL_KEYS],
    PCTILE_KEYS: [...PCTILE_KEYS].sort(),
  }
}

const golden = () => JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))

describe('the heatmap registry is unchanged by R1', () => {
  it('serialises exactly as the golden recorded before the move', () => {
    if (process.env.WRITE_HM_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, JSON.stringify(serialiseRegistry(), null, 2) + '\n')
    }
    expect(serialiseRegistry()).toEqual(golden())
  })

  // CONTROLS: a comparison that cannot fail is not acceptance. One per kind of drift R1
  // could cause — a renamed label, a dropped drill key, a reordered list, a changed tier
  // function — because `toEqual` on a big object is exactly where a weak serialiser hides.
  it('would notice a changed label', () => {
    const s = serialiseRegistry()
    s.HM_METRICS[1].label += ' '
    expect(s).not.toEqual(golden())
  })

  it('would notice a dropped drill key', () => {
    const s = serialiseRegistry()
    const i = s.HM_METRICS.findIndex(m => m.drillKey)
    expect(i, 'no drill key in the registry to drop').toBeGreaterThan(-1)
    delete s.HM_METRICS[i].drillKey
    expect(s).not.toEqual(golden())
  })

  it('would notice a reordered registry', () => {
    const s = serialiseRegistry()
    const real = s.HM_METRICS.map((m, i) => [m, i]).filter(([m]) => !m.isHeader)
    ;[s.HM_METRICS[real[0][1]], s.HM_METRICS[real[1][1]]] = [s.HM_METRICS[real[1][1]], s.HM_METRICS[real[0][1]]]
    expect(s).not.toEqual(golden())
  })

  it('would notice a changed tier function, not just its presence', () => {
    const s = serialiseRegistry()
    const i = s.HM_METRICS.findIndex(m => m.getTier)
    s.HM_METRICS[i].getTier = s.HM_METRICS[i].getTier.replace('null', 'undefined')
    expect(s).not.toEqual(golden())
  })

  it('would notice a change to the treemap, the fill list or the percentile set', () => {
    for (const mutate of [
      s => { s.TREEMAP_DEF[0].items[0].weight += 1 },
      s => { s.FFILL_KEYS.pop() },
      s => { s.PCTILE_KEYS.push('zzz_not_a_metric') },
    ]) {
      const s = serialiseRegistry()
      mutate(s)
      expect(s).not.toEqual(golden())
    }
  })

  // A floor: an empty or truncated serialisation would satisfy `toEqual` against an
  // equally empty golden, so the golden itself has to be the size we think it is.
  it('the golden actually holds the registry', () => {
    const g = golden()
    expect(g.HM_METRICS.length).toBe(HM_METRICS.length)
    expect(g.HM_METRICS.filter(m => !m.isHeader).length).toBeGreaterThan(40)
    expect(g.HM_METRICS.filter(m => m.drillKey).length).toBeGreaterThan(10)
    expect(g.FFILL_KEYS.length).toBe(5)
    expect(g.PCTILE_KEYS.length).toBeGreaterThan(20)
    expect(g.TREEMAP_DEF[0].items.length).toBeGreaterThan(20)
  })
})
