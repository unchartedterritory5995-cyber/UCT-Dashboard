// Multi Chart HELD-OUT phrasings: written after the capability, its routing words and its descriptions were frozen, and never
// used to change them. Evidence class: SIMULATED. Routing and the no-model readers are real; which action a real model picks from
// the descriptions is NOT measured here (no paid call). `direct` = the group reaches the model on the first call; the others
// reach it through the group's title and one need_groups reroute, or do not reach it (listed in the report as gaps).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
import { routeManifest } from './routing'
import { routeManifestV2 } from './nlm1/routingV2'
import { fastParse } from './fastPath'
import { multiChartPlan } from './multiChart'
import { planCompound } from './compound'

registerBuiltins()
const full = manifestFor({ surface: 'charts', createIndicator: true, manageIndicators: true })
const opts = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
const has = (r) => r.manifest.some(c => c.name.startsWith('multiChart.'))
const host = { charts: { list: () => [], read: () => null, selected: () => null } }
const claimed = (t) => {
  for (const f of [() => multiChartPlan(t, { host }), () => fastParse(t, { host }), () => planCompound(t, { host })]) {
    let r = null
    try { r = f() } catch { r = null }
    if (r) return r
  }
  return null
}

export const HELD_OUT = [
  'put the workspace into the 3 by 2 multi chart',
  'can we do the multichart thing with four across',
  'multichart off',
  'quit multi charts',
  'get rid of the multi chart view',
  'crosshairs should follow each other across cells',
  'unlink the crosshair sync please',
  'sync up the time range on the grid',
  'tie the crosshair together',
  'is time range sync on',
  'blow the NVDA cell up to fullscreen',
  'unmaximize',
  'open the grid I saved called Leaders',
  'save this grid under the name Swing Names',
  'trash my saved grid Swing Names',
  'next group please',
  'groups mode on',
  // words the member might use with no product word at all
  'flip over to the tile view',
  'kick me back to the regular charts',
  'I want everything scrolling in lockstep',
  'shrink it back down to the other cells',
]

describe('held-out phrasings', () => {
  it('no no-model reader claims one of them: each reaches the model, nothing runs on a guess', () => {
    expect(HELD_OUT.filter(t => { const r = claimed(t); return r && r.kind !== 'say' })).toEqual([])
  })
  it('the measured reach is what the report says', () => {
    const v1 = HELD_OUT.filter(t => has(routeManifest(full, t, opts)))
    const v2 = HELD_OUT.filter(t => has(routeManifestV2(full, t, opts)))
    expect(v1.length).toBe(16)
    expect(v2.length).toBe(17)
  })
})
