// H-RDR-1 (AUDIT T2 round 1): the SCOPE of a negation / exclusion. Three classes that still executed on the protected chart:
//   a3  an ASIDE between the cue and what it governs: "don't, if you can help it, change the top-left one to weekly"
//   a4  a SERIAL verb under the negation: "don't go and change the second chart", "don't try and …", "don't bother to …"
//   b9  an ADDITIVE second exclusion after the first one's tail: "…, leave the top-left one alone, and the bottom-right one too"
// plus the formal cues (refrain from, under no circumstances, on no account, by no means). Class-generated (own phrasings):
// the reader places exactly the charts excluded; through the model-path screen chain (useAgent's order) a plan doing the
// forbidden op on them is never executed in ANY chart-backed family the registry has; F5 (indicator "all charts") accepts only
// the exact complement of ALL recognized exclusions, and asks when one is unplaced. Controls: real positive commands after a
// negation still run there; no over-capture. LOCAL (vitest, unit, the real registry, the fixture board; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf, screenDeicticOps, screenUnnamedTargets } from './deixis'
import { checkSpatialConstraints, withoutExcludedCharts, excludedCharts, spatialConstraints, everyExceptSet, UNPLACED } from './spatialCheck'
import { multiChartAmbiguity, setExceptSetReader } from './capabilities/indicatorAuthoring'
import { fastParse } from './fastPath'

registerBuiltins()
setExceptSetReader(everyExceptSet)                     // as useAgent hands it in
const s = () => ({ settings: mergeChartSettings(null) })
const board = makeBoard([0, 1, 2, 3].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: s() })),
  { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'AMD' })
const hostWith = (sel) => ({ ...board.host, charts: { ...board.host.charts, selected: () => sel, canManageIndicators: () => true, canCreateIndicator: () => true } })
const IDS = ['c0', 'c1', 'c2', 'c3']
const H0 = hostWith(null)
const B = H0.charts.list()
const read = (t, sel = null) => [...new Set([...excludedCharts(t, B, sel), ...spatialConstraints(t, B, sel).excluded])].map(x => (x === UNPLACED ? 'UNPLACED' : x)).sort()
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
function chain(host, ops, text, f, named) {
  const deps = { host, getCapability, getTargetKind }
  const d = screenDeicticOps({ ...deps, ops, text, parse: fastParse })
  if (d?.refuse) return 'refuse'
  if (d?.ask) return 'ask'
  const o2 = d?.aim || ops
  if (screenUnnamedTargets({ ...deps, ops: o2, text })?.ask) return 'ask'
  if (checkSpatialConstraints({ ...deps, ops: o2, text })?.ask) return 'ask'
  const g = withoutExcludedCharts(o2, [text], deps)
  return g.ops.some(o => named.includes(chartRefOf(f.kind, f.kind.list(host).find(x => x.ref === o.target)))) ? 'EXECUTE' : 'dropped'
}

// references → the chart each names on the 2×2 (c0 TL SPY · c1 TR QQQ / c2 BL NVDA · c3 BR AMD)
const REFS = [['the top-left one', 'c0'], ['the second chart', 'c1'], ['chart 3', 'c2'], ['the AMD chart', 'c3'], ['NVDA', 'c2'], ['the bottom right chart', 'c3']]
const VERBS = [(r) => `change ${r} to weekly`, (r) => `add RSI to ${r}`, (r) => `hide volume on ${r}`, (r) => `touch ${r}`, (r) => `close ${r}`]
const CUES = ["don't", 'do not', 'never', 'please do not', 'dont']
const ASIDES = ['if you can help it', 'please', 'whatever happens', 'for now', 'I mean it', 'under any circumstances']
const SERIALS = ['go and', 'go ahead and', 'try and', 'try to', 'come and', 'bother to', 'go', 'ever']
const FORMAL = ['refrain from', 'under no circumstances', 'Under no circumstances should you', 'on no account', 'by no means']
const gerund = (v) => v.replace(/^change/, 'changing').replace(/^add/, 'adding').replace(/^hide/, 'hiding').replace(/^touch/, 'touching').replace(/^close/, 'closing')

const A3 = [], A4 = [], FO = []
let k = 0
for (const [ref, id] of REFS) for (const v of VERBS) {
  const cue = CUES[k % CUES.length], aside = ASIDES[k % ASIDES.length], serial = SERIALS[k % SERIALS.length], formal = FORMAL[k % FORMAL.length]
  A3.push([`${cue}, ${aside}, ${v(ref)}`, id])
  // the aside after the verb ("never change, for now, the top-left one to weekly")
  const [verb, ...rest] = v(ref).split(' ')
  A3.push([`${cue} ${verb}, ${aside}, ${rest.join(' ')}`, id])
  A4.push([`${cue} ${serial} ${v(ref)}`, id])
  FO.push([/refrain/.test(formal) ? `please ${formal} ${gerund(v(ref))}` : `${formal} ${v(ref)}`, id])
  k++
}
describe('the reader: an aside, a serial verb or a formal cue keeps the chart under the negation', () => {
  it.each([...A3.map(c => ['a3', ...c]), ...A4.map(c => ['a4', ...c]), ...FO.map(c => ['formal', ...c])])('%s · "%s" → %s', (_c, t, id) => {
    expect(read(t)).toEqual([id])
  })
})

// (b9) every-except sentences with a second exclusion after the first one's tail
const FIRSTS = [
  (r) => `but leave ${r} alone`, (r) => `except ${r}`, (r) => `but skip ${r}`, (r) => `but don't touch ${r}`, (r) => `and keep ${r} as it is`,
  (r) => `but don't change ${r} to weekly`, (r) => `apart from ${r}`,
]
const SECONDS = [(r) => `and ${r} too`, (r) => `and ${r} as well`, (r) => `and also ${r}`, (r) => `${r} too`, (r) => `plus ${r} as well`, (r) => `or ${r} either`]
const CHANGES = ['add RSI to every chart', 'set every chart to weekly', 'hide volume on all of them', 'switch all charts to log scale']
const PAIRS = [['the top-left one', 'c0', 'the bottom-right one', 'c3'], ['the SPY chart', 'c0', 'the NVDA chart', 'c2'], ['chart 2', 'c1', 'chart 3', 'c2'],
  ['the first chart', 'c0', 'the last chart', 'c3'], ['the top right one', 'c1', 'AMD', 'c3']]
// (round 3, class A) the tail after a comma, a semicolon, a dash — or with NO punctuation at all ("…alone and the bottom one too")
const JOINS = [', ', '; ', ' — ', ' ']
const B9 = []
let j = 0
for (const [r1, id1, r2, id2] of PAIRS) for (const f of FIRSTS) for (const join of JOINS) {
  const sec = SECONDS[j % SECONDS.length], ch = CHANGES[j % CHANGES.length]
  j++
  if (/either/.test(sec(r2)) && !/don't|never/.test(f(r1))) continue
  if (join === ' ' && !/^(?:and|plus|or)\b/.test(sec(r2))) continue      // a bare "<ref> too" needs its clause break
  B9.push([`${ch} ${f(r1)}${join}${sec(r2)}`, [id1, id2].sort()])
}
describe('(b9) an additive second exclusion is excluded too — reader, every-except set, F5', () => {
  it.each(B9)('"%s" → %j', (t, refs) => {
    expect(read(t)).toEqual(refs)
    const set = everyExceptSet(t, B, null)
    const rest = IDS.filter(id => !refs.includes(id))
    expect(set?.refs?.slice().sort()).toEqual(rest)
    // F5: the exact complement of ALL the exclusions is accepted; any plan that adds an excluded chart is asked
    const adds = (ids) => ids.map(id => ({ action: 'indicator.add', target: `ixe:${id}`, args: { defId: 'rsi' } }))
    expect(multiChartAmbiguity(H0, adds(rest), t)).toBeNull()
    for (const ex of refs) expect(multiChartAmbiguity(H0, adds([...rest, ex]), t)).toMatch(/Which charts/)
  })
  it.each([
    // a second exclusion the board cannot place (no middle on a 2×2, a sixth chart, nothing clicked): never a set; F5 asks
    ['add RSI to every chart but leave the top-left one alone, and the middle one too'],
    ['add RSI to every chart except chart 2, and chart 6 as well'],
    ['add RSI to all charts, but skip the SPY chart, and this one too'],
    ['add RSI to every chart but leave the middle one alone'],
  ])('unplaced / partially placed: "%s" → UNPLACED, no set, F5 asks', (t) => {
    expect(read(t)).toContain('UNPLACED')
    expect(everyExceptSet(t, B, null)).toBeNull()
    const adds = (ids) => ids.map(id => ({ action: 'indicator.add', target: `ixe:${id}`, args: { defId: 'rsi' } }))
    expect(multiChartAmbiguity(H0, adds(['c1', 'c2', 'c3']), t)).toMatch(/Which charts/)
    expect(multiChartAmbiguity(H0, adds(['c2', 'c3']), t)).toMatch(/Which charts/)
  })
})

// (round 3, class B) an aside too long to be blanked: the negation's scope ends at its comma before it governs anything — FAIL SAFE:
// every chart the rest of the sentence names is UNPLACED (asked), never run, and never offered by the question
const LONG_ASIDES = ['and I really mean this because the last time it went badly wrong', 'whatever the market does today and whatever anyone else tells you',
  'even if it looks like the obvious thing to do right now', 'not now and not later this week either unless I say so explicitly']
const LONG = []
let q = 0
for (const [ref, id] of REFS) for (const v of VERBS) {
  const cue = CUES[q % CUES.length], aside = LONG_ASIDES[q % LONG_ASIDES.length]
  LONG.push([`${cue}, ${aside.replace(/^and /, 'honestly ')}, ${v(ref)}`, id])
  const [verb, ...rest] = v(ref).split(' ')
  if (q % 2 === 0) LONG.push([`${cue} ${verb}, ${aside.replace(/^and /, 'honestly ')}, ${rest.join(' ')}`, id])
  q++
}
// (round 3, class C) a courtesy / intensifier run before the cue
const COURTESY = ['kindly', 'really', 'absolutely', 'seriously', 'definitely', 'just', 'please just', 'really really']
const COURT = []
let w = 0
for (const [ref, id] of REFS) for (const v of VERBS) {
  const c = COURTESY[w % COURTESY.length], cue = [...FORMAL, ...CUES][w % (FORMAL.length + CUES.length)]
  COURT.push([/refrain/.test(cue) ? `${c} ${cue} ${gerund(v(ref))}` : `${c} ${cue} ${v(ref)}`, id])
  w++
}
COURT.push(["I really don't want you to change the top-left one to weekly", 'c0'], ['absolutely under no circumstances should you close chart 2', 'c1'])
describe('(round 3) long asides fail safe; courtesy runs keep the cue', () => {
  it.each(LONG)('B · "%s" → UNPLACED, and the chart it names is never offered (%s)', (t, id) => {
    expect(read(t)).toContain('UNPLACED')
    expect([...excludedCharts(t, B, null).unoffered]).toContain(id)
  })
  it.each(COURT)('C · "%s" → %s', (t, id) => {
    expect(read(t)).toEqual([id])
  })
})

describe('never executed on a protected chart, in every chart-backed family (registry-enumerated)', () => {
  const CASES = [...A3, ...A4, ...FO, ...LONG, ...COURT].map(([t, id]) => [t, [id]]).concat(B9)
  it('the registry yields the chart-backed families', () => { expect(FAMILIES.length).toBeGreaterThanOrEqual(40) })
  it.each(FAMILIES.map(f => [f.name, f]))('%s: no aside / serial / formal / additive form executes the op on the protected chart', (_n, f) => {
    const bad = []
    for (const [t, named] of CASES) {
      const ops = named.map(id => ({ action: f.name, target: f.byChart[id].ref, args: {} }))
      if (chain(H0, ops, t, f, named) === 'EXECUTE') bad.push(t)
    }
    expect(bad).toEqual([])
  })
})

describe('controls: the scope ends where the negation ends', () => {
  it.each([
    // a real positive command after the negation runs on its own chart
    ["don't change the top-left one, and switch the bottom-right one to weekly", ['c0'], 'c3'],
    ['do not touch chart 1; set chart 4 to weekly', ['c0'], 'c3'],
    ["don't add RSI to the SPY chart, but add it to the AMD chart", ['c0'], 'c3'],
    ["never mind the top-left one, and set the bottom-right one to weekly", [], 'c3'],
    ["don't worry about the SPY chart, make the AMD chart weekly", [], 'c3'],
    ["don't forget to make the AMD chart weekly", [], 'c3'],
    // (round 3) a positive command after a bare "and" runs; a long harmless aside with no negation changes nothing
    ['leave the top-left one alone and set the bottom-right one to weekly', ['c0'], 'c3'],
    ["don't touch the SPY chart and switch the AMD chart to weekly", ['c0'], 'c3'],
    ['skip chart 1 and also set chart 4 to weekly', ['c0'], 'c3'],
    ['make, if it is not too much trouble and you have a spare moment right now, the AMD chart weekly', [], 'c3'],
    ['honestly, after everything that happened in the market this week and all the noise, set chart 4 to weekly', [], 'c3'],
    ["kindly don't worry about the SPY chart, make the AMD chart weekly", [], 'c3'],
    ['just make the AMD chart weekly, really', [], 'c3'],
  ])('"%s" → excludes %j; a plan on %s runs', (t, refs, runs) => {
    expect(read(t)).toEqual(refs)
    const f = FAMILIES.find(x => x.name === 'chart.setTimeframe')
    expect(chain(H0, [{ action: f.name, target: f.byChart[runs].ref, args: {} }], t, f, [runs])).toBe('EXECUTE')
  })
  it.each([
    ['make the top-left one weekly, and the bottom-right one too'], ['add RSI to the first chart, and the RSI too'], ["don't, if you can help it, change anything"],
    ["don't touch anything else"], ['make every chart weekly, and keep it that way too'], ['set every chart to weekly, and MSFT too'],
    ['add RSI to every chart except volume and the 50 SMA'], ['make the top-left one weekly and the bottom-right one too'],
    ['set every chart to weekly, not daily and not monthly either'],
  ])('"%s" → nothing excluded', (t) => {
    expect(read(t)).toEqual([])
  })
})
