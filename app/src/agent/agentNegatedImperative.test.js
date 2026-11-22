// H-RDR-1 (AUDIT follow-up): a NEGATED IMPERATIVE WITH A DESTINATION — "don't change the top-left one to weekly", "do not add
// RSI to the second chart", "never remove the left chart", "leave the bottom row as is but switch it to 5m". Measured on master
// (cdfa65c1b1): a model plan doing exactly the forbidden op on the named chart was EXECUTED in every chart-backed family (53).
// Required: asked or refused, NEVER executed. Class-generated: negation form × verb / destination × reference kind, through the
// model-path screen chain in useAgent's order (screenDeicticOps → screenUnnamedTargets → checkSpatialConstraints → the
// execute gate withoutExcludedCharts), for EVERY chart-backed mutation family the registry has (never a hand list).
// Each case fails if the chain would execute the op on the named chart. Controls: no over-capture. LOCAL (vitest, unit).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf, screenDeicticOps, screenUnnamedTargets } from './deixis'
import { checkSpatialConstraints, withoutExcludedCharts, excludedCharts, spatialConstraints, UNPLACED } from './spatialCheck'
import { fastParse } from './fastPath'

registerBuiltins()
const s = () => ({ settings: mergeChartSettings(null) })
const board = makeBoard([0, 1, 2, 3].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: s() })),
  { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'AMD' })
const hostWith = (sel) => ({ ...board.host, charts: { ...board.host.charts, selected: () => sel, canManageIndicators: () => true, canCreateIndicator: () => true } })
const IDS = ['c0', 'c1', 'c2', 'c3']
const H0 = hostWith(null)
const FAMILIES = allCapabilityNames().map(name => {
  const c = getCapability(name)
  if (!c || c.query) return null
  const kind = getTargetKind(c.target)
  if (!kind) return null
  let list = []
  try { list = kind.list(H0) || [] } catch { return null }
  const byChart = Object.fromEntries(IDS.map(id => [id, list.find(x => chartRefOf(kind, x) === id)]))
  return IDS.every(id => byChart[id]) ? { name, kind, byChart } : null
}).filter(Boolean)

/** 'refuse' | 'ask' | 'dropped' | 'EXECUTE' — what the model-path chain does with `ops` (useAgent's order). */
function chain(host, ops, text, f, named) {
  const deps = { host, getCapability, getTargetKind }
  const d = screenDeicticOps({ ...deps, ops, text, parse: fastParse })
  if (d?.refuse) return 'refuse'
  if (d?.ask) return 'ask'
  const o2 = d?.aim || ops
  const u = screenUnnamedTargets({ ...deps, ops: o2, text })
  if (u?.ask) return 'ask'
  if (checkSpatialConstraints({ ...deps, ops: o2, text })?.ask) return 'ask'
  const g = withoutExcludedCharts(o2, [text], deps)
  const left = g.ops.filter(o => named.includes(chartRefOf(f.kind, f.kind.list(host).find(x => x.ref === o.target))))
  return left.length ? 'EXECUTE' : 'dropped'
}

// the class: negation forms × (verb, destination) × reference kind
const NEG = ["don't", 'do not', 'never', 'please do not', 'dont', 'I don’t want you to']
const ACTS = [
  (r) => `change ${r} to weekly`, (r) => `add RSI to ${r}`, (r) => `put an RSI on ${r}`, (r) => `hide volume on ${r}`,
  (r) => `switch ${r} to log scale`, (r) => `make ${r} red`, (r) => `apply that template to ${r}`, (r) => `remove the 50 SMA from ${r}`,
  (r) => `close ${r}`, (r) => `reset ${r}`,
]
// [reference, the chart(s) it names, clicked]
const REFS = [
  ['the top-left one', ['c0'], null], ['the second chart', ['c1'], null], ['chart 3', ['c2'], null], ['chart four', ['c3'], null],
  ['the SPY chart', ['c0'], null], ['NVDA', ['c2'], null], ['the bottom right chart', ['c3'], null], ['the left chart', ['c0', 'c2'], null],
  ['this one', ['c1'], 'c1'], ['the bottom row', ['c2', 'c3'], null],
]
const CASES = []
let k = 0
for (const [ref, named, sel] of REFS) for (const act of ACTS) {
  const neg = NEG[k % NEG.length]
  CASES.push([`${neg} ${act(ref)}`, named, sel])
  k++
}
// the forms AUDIT named, verbatim, plus a contrast clause after a positive one
CASES.push(["don't change the top one to weekly", ['c0', 'c1'], null], ['do not add RSI to the second chart', ['c1'], null],
  ['never remove the left chart', ['c0', 'c2'], null], ['leave the bottom row as is but switch it to 5m', ['c2', 'c3'], null],
  ["make the top-right chart weekly, but don't change the top-left one to weekly", ['c0'], null],
  ['add RSI to the first chart and do not add it to chart 3', ['c2'], null])

describe('a negated imperative with a destination is never executed on the chart it names (every mutation family)', () => {
  it('the registry yields the chart-backed families', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(40)
  })
  it.each(FAMILIES.map(f => [f.name, f]))('%s: every negated form × verb × reference is asked / refused / dropped, never executed', (_n, f) => {
    const bad = []
    for (const [t, named, sel] of CASES) {
      const host = hostWith(sel)
      const ops = named.map(id => ({ action: f.name, target: f.byChart[id].ref, args: {} }))
      const v = chain(host, ops, t, f, named)
      if (v === 'EXECUTE') bad.push(t)
    }
    expect(bad).toEqual([])
  })
})

describe('the reader: the charts a negated imperative names are excluded (or unplaced), exactly', () => {
  const B = board.host.charts.list()
  const read = (t, sel = null) => [...new Set([...excludedCharts(t, B, sel), ...spatialConstraints(t, B, sel).excluded])].map(x => (x === UNPLACED ? 'UNPLACED' : x)).sort()
  it.each([
    ["don't change the top-left one to weekly", ['c0']], ['do not add RSI to the second chart', ['c1']], ['never hide volume on the NVDA chart', ['c2']],
    ['never set chart 4 to weekly', ['c3']], ["don't add RSI to SPY", ['c0']], ["don't change SPY to AAPL", ['c0']],
    ["make the top-right chart weekly, but don't change the top-left one to weekly", ['c0']],
    ['do not close the second chart and add RSI to the first chart', ['c1']],
  ])('"%s" → %j', (t, refs) => {
    expect(read(t)).toEqual(refs)
  })
  it.each([
    ["don't change the big chart to weekly"], ['do not add RSI to the one beside NVDA'], ["don't change it to weekly"],
  ])('unplaceable: "%s" → UNPLACED (asked)', (t) => {
    expect(read(t)).toContain('UNPLACED')
  })
  it.each([
    ["don't forget to add RSI to the second chart"], ["don't hesitate to put the top-left one on weekly"], ['never mind, make the second chart weekly'],
    ['make the top-left one weekly, and don’t change its scale'], ["don't touch the other charts, make this one weekly"], ["don't add RSI"],
  ])('control: "%s" → nothing excluded', (t) => {
    expect(read(t)).toEqual([])
  })
})
