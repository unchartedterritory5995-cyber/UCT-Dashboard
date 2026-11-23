// EXCLUSION — NEGATED RELATIVE CLAUSES (pl-exclneg, AUDIT T2 b9). "except the ones that are NOT on daily", "apart from whatever
// isn't weekly": the relative-clause reader dropped the negation and read the POSITIVE set, so the exclusion was INVERTED —
// nothing changed, but the question offered exactly the charts the member excluded.
// The invariant: no exclusion may change or OFFER a chart the member excluded. The class rule:
//   - ONE plain negation (not, n't, isn't, aren't, never, no longer, non-, "anything but X", "other than X" inside the clause)
//     over a class the board carries for every chart (timeframe, chart type, ticker) whose positive set the class readers place:
//     the exclusion is the exact COMPLEMENT (a singular head needs exactly one chart);
//   - everything else — a double negative ("aren't not daily"), an odd form ("nothing but daily", "unless they're not daily"), an
//     empty complement, a negated item in a list, a negated value no reader places — is UNPLACED, every chart unoffered;
//   - GUARD (strip): with the negation reader off, a negated object never reaches a negation-blind reader: UNPLACED, none offered.
// Class-generated: cues × heads / relative pronouns × negation forms × contractions × descriptions × boards × plans (all charts,
// the exact remaining set, a subset including an excluded chart). LOCAL (vitest).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { getCapability, getTargetKind } from './capabilities'
import { excludedCharts, checkSpatialConstraints, withoutExcludedCharts, UNPLACED } from './spatialCheck'

registerBuiltins()

function boardOf(name, cells) {
  const fb = makeBoard(cells.map(([id, x, y, w, h, , tf, type]) => ({
    id, type: 'chart', x, y, w, h, color: 'N',
    opts: { settings: mergeChartSettings(type ? { chartType: type } : null), ...(tf ? { tf } : {}) },
  })), Object.fromEntries(cells.map(([id, , , , , sym]) => [`N:${id}`, sym])))
  const host = { ...fb.host, charts: { ...fb.host.charts, selected: () => null, canManageIndicators: () => true, canCreateIndicator: () => true } }
  const meta = cells.map(([id, , , , , sym, tf, type]) => ({ ref: id, sym, tf: tf || 'D', type: type || 'candles' }))
  return { name, host, meta, live: () => host.charts.list() }
}
const AUDIT = boardOf('2x2 audit (W D / D D)', [['TL', 0, 0, 12, 10, 'SPY', 'W'], ['TR', 12, 0, 12, 10, 'QQQ', 'D'], ['BL', 0, 10, 12, 10, 'NVDA', 'D'], ['BR', 12, 10, 12, 10, 'AAPL', 'D']])
const MIXED = boardOf('2x3 mixed', [
  ['c0', 0, 0, 8, 10, 'SPY', 'D'], ['c1', 8, 0, 8, 10, 'QQQ', 'W', 'line'], ['c2', 16, 0, 8, 10, 'NVDA', 'D'],
  ['c3', 0, 10, 8, 10, 'AMD', '60'], ['c4', 8, 10, 8, 10, 'MSFT', 'M', 'line'], ['c5', 16, 10, 8, 10, 'META', 'W', 'bars'],
])
const ROW = boardOf('1x3 (5m D D)', [['a', 0, 0, 8, 10, 'SPY', '5'], ['b', 8, 0, 8, 10, 'QQQ', 'D'], ['c', 16, 0, 8, 10, 'NVDA', 'D']])
const SIZED = boardOf('big top + 2 small', [['big', 0, 0, 24, 10, 'SPY', 'D'], ['s1', 0, 10, 12, 10, 'QQQ', 'W'], ['s2', 12, 10, 12, 10, 'NVDA', 'D', 'line']])
const DUP = boardOf('2x2 SPY twice', [['p', 0, 0, 12, 10, 'SPY', 'D'], ['q', 12, 0, 12, 10, 'QQQ', 'D'], ['r', 0, 10, 12, 10, 'SPY', 'W'], ['s', 12, 10, 12, 10, 'NVDA', 'W']])
const BOARDS = [AUDIT, MIXED, ROW, SIZED, DUP]

const read = (b, t, opts = {}) => {
  const e = excludedCharts(t, b.live(), null, opts)
  return { ex: [...e].filter(x => x !== UNPLACED).sort(), unplaced: e.has(UNPLACED), unoffered: [...(e.unoffered || [])].sort() }
}
const opsOn = (refs) => refs.map(r => ({ action: 'chart.setTimeframe', target: r, args: { timeframe: 'M' } }))
const deps = (b) => ({ host: b.host, getCapability, getTargetKind })
const ALL = (b) => b.meta.map(m => m.ref)
const NL = String.fromCharCode(10)

// ── the class: cues × heads / pronouns × negation forms × contractions ──
const CUES = {
  'except X': (x) => ` except ${x}`, 'except for X': (x) => ` except for ${x}`, 'apart from X': (x) => ` apart from ${x}`,
  'other than X': (x) => ` other than ${x}`, 'excluding X': (x) => ` excluding ${x}`, 'besides X': (x) => ` besides ${x}`,
  'but not X': (x) => ` but not ${x}`, 'barring X': (x) => ` barring ${x}`, 'skip X': (x) => `, skip ${x}`,
  'but leave X alone': (x) => ` but leave ${x} alone`, "but don't touch X": (x) => `, but don't touch ${x}`,
  'X stay as they are': (x) => `; ${x} stay as they are`,
}
// [template (D = the description), plural]
const NEG_PLURAL = [
  'the ones that are not D', "the ones that aren't D", 'the ones which are not D', "the charts that aren't D", "those which aren't D",
  'those that are never D', 'the ones that are no longer D', "anything that's not D", "anything that isn't D", "whatever isn't D",
  "whatever's not D", "everything that isn't D", "the ones who aren't D", "the ones that're not D", 'the ones not D', 'anything not D',
  'the ones that are anything but D', "whatever's other than D", 'the charts that are anything other than D', 'the charts which arent D',
]
const NEG_SINGULAR = ["the one that isn't D", 'the chart which is not D', "the one that's not D"]
const CHANGES = ['add RSI to every chart', 'set every chart to monthly', 'show volume on all of them']
// the descriptions of one board: [the D phrases (plural, singular), the positive set]
function descs(b) {
  const out = []
  for (const [w, c] of [['daily', 'D'], ['weekly', 'W'], ['monthly', 'M'], ['hourly', '60']]) {
    const pos = b.meta.filter(m => m.tf === c).map(m => m.ref)
    out.push({ cls: 'timeframe', pl: [`on ${w}`, w, `set to ${w}`], sg: [`on ${w}`, w], adj: [`the non-${w} ones`, `the non ${w} charts`], adjSg: [`the non-${w} one`], pos })
  }
  for (const [w, t] of [['line', 'line'], ['bar', 'bars']]) {
    const pos = b.meta.filter(m => m.type === t).map(m => m.ref)
    out.push({ cls: 'type', pl: [`${w} charts`], sg: [`a ${w} chart`], adj: [`the non-${w} charts`], adjSg: [], pos })
  }
  const bySym = {}
  for (const m of b.meta) (bySym[m.sym] = bySym[m.sym] || []).push(m.ref)
  for (const [sym, pos] of Object.entries(bySym)) out.push({ cls: 'ticker', pl: [sym], sg: [sym], adj: [`the non-${sym} charts`], adjSg: [], pos })
  return out
}
const expectOf = (b, pos, plural) => {
  const C = ALL(b).filter(r => !pos.includes(r)).sort()
  // a positive set the board does not hold ("the ones that aren't monthly" with no monthly chart = every chart): UNPLACED (asked)
  return pos.length && C.length && (plural || C.length === 1) ? { exact: C } : { unplaced: true }
}
const ROWS = []
for (const b of BOARDS) {
  let i = 0
  for (const d of descs(b)) {
    const phrases = [
      ...NEG_PLURAL.flatMap(tpl => d.pl.map(x => ({ x: tpl.replace('D', x), plural: true }))),
      ...NEG_SINGULAR.flatMap(tpl => d.sg.map(x => ({ x: tpl.replace('D', x), plural: false }))),
      ...d.adj.map(x => ({ x, plural: true })), ...d.adjSg.map(x => ({ x, plural: false })),
    ]
    for (const ph of phrases) {
      const cueNames = Object.keys(CUES)
      // three cues per phrase, rotating (every cue × every form is covered across the descriptions)
      for (const f of [cueNames[i % cueNames.length], cueNames[(i + 5) % cueNames.length], cueNames[(i + 9) % cueNames.length]]) {
        // a stated keep reads a subject with a determiner, in the plural
        if (f === 'X stay as they are' && (!/^(?:the|those)\b/i.test(ph.x) || !ph.plural)) continue
        ROWS.push({ b, f, cls: d.cls, x: ph.x, pos: d.pos, want: expectOf(b, d.pos, ph.plural), t: `${CHANGES[i % CHANGES.length]}${CUES[f](ph.x)}` })
      }
      i++
    }
  }
}

describe('(b9) a NEGATED relative-clause exclusion is the exact COMPLEMENT, or UNPLACED — never the positive set', () => {
  it('the class covers every board, cue, negation form and description class', () => {
    expect(ROWS.length).toBeGreaterThan(4000)
    for (const f of Object.keys(CUES)) expect(ROWS.some(r => r.f === f), f).toBe(true)
    for (const tpl of [...NEG_PLURAL, ...NEG_SINGULAR]) expect(ROWS.some(r => r.x.startsWith(tpl.split(' D')[0].replace(/ D$/, ''))), tpl).toBe(true)
    for (const cls of ['timeframe', 'type', 'ticker']) expect(ROWS.some(r => r.cls === cls), cls).toBe(true)
    expect(ROWS.some(r => r.want.exact) && ROWS.some(r => r.want.unplaced)).toBe(true)
  })
  it(`${ROWS.length} sentences — the READER: exact complement, or UNPLACED with every chart unoffered`, () => {
    const miss = []
    for (const { b, t, want } of ROWS) {
      const r = read(b, t)
      if (want.unplaced) {
        if (!r.unplaced) miss.push(`${b.name} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`)
        else if (JSON.stringify([...new Set([...r.ex, ...r.unoffered])].sort()) !== JSON.stringify([...ALL(b)].sort())) miss.push(`${b.name} · "${t}" → a chart is offerable ${JSON.stringify(r)}`)
        continue
      }
      if (r.unplaced || JSON.stringify(r.ex) !== JSON.stringify(want.exact)) miss.push(`${b.name} · "${t}" → ${JSON.stringify(r)} (want ${want.exact})`)
    }
    expect(miss.slice(0, 40).join(NL), `${miss.length} misses of ${ROWS.length}`).toBe('')
  })
  it('the NET and the APPLY gate: a plan on every chart, or a subset holding an excluded chart, is asked and never offers an excluded chart; the exact plan runs', () => {
    const miss = []
    for (const { b, t, want, pos } of ROWS) {
      const excluded = want.exact || ALL(b)
      const plans = [ALL(b)]
      const one = want.exact ? want.exact[0] : ALL(b)[0]
      plans.push(pos.length ? [pos[0], one] : [one])
      for (const refs of plans) {
        const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(refs), text: t })
        if (!k?.ask) { miss.push(`${b.name} · ${refs} · "${t}": RAN`); continue }
        for (const c of k.ask.choices) if (excluded.includes(c.ref)) miss.push(`${b.name} · ${refs} · "${t}": OFFERED excluded ${c.ref}`)
      }
      if (want.exact) {
        const g = withoutExcludedCharts(opsOn(ALL(b)), [t], deps(b))
        for (const o of g.ops) if (want.exact.includes(o.target)) miss.push(`${b.name} · "${t}": KEPT op on excluded ${o.target}`)
        if (pos.length && checkSpatialConstraints({ ...deps(b), ops: opsOn(pos), text: t })) miss.push(`${b.name} · "${t}": the exact plan (${pos}) was asked`)
      }
    }
    expect(miss.slice(0, 40).join(NL), `${miss.length} misses`).toBe('')
  })
})

// ── double negatives and odd forms: UNPLACED, no chart offered ──
const ODD = [
  "except the ones that aren't not daily", 'except the ones that are not non-daily', "except the ones that aren't anything but daily",
  'except the ones that are nothing but daily', "except whatever isn't other than daily", "except anything that's never not on daily",
  "unless they're not daily", "unless it isn't daily", "unless they aren't on weekly", 'unless the charts are not line charts',
  "except the non-daily ones that aren't weekly", "apart from whatever's not not weekly", "but leave the ones that aren't not SPY alone",
  // a negated item in a list: the scope of the negation is not certain
  "except the ones that aren't daily or weekly", "except the ones that aren't daily and SPY", "other than SPY and whatever isn't daily",
  // a negated value no class reader places, or a negation the reader does not shape
  "except the ones that aren't ETFs", "except the ones that aren't red", "except the ones I'm not using", "except the charts I haven't touched",
  "except the ones that aren't big", 'except the ones that are not on monthly',
]
describe('double negatives, odd forms, negated lists and unreadable negations are UNPLACED — no chart offered', () => {
  it.each(BOARDS.flatMap(b => ODD.map(x => [b.name, x, b])))('%s · "%s"', (_n, x, b) => {
    for (const ch of CHANGES) {
      const t = `${ch} ${x}`
      const r = read(b, t)
      if (/monthly/.test(x) && b.meta.some(m => m.tf === 'M')) continue     // a board WITH a monthly chart: the complement is exact
      expect(r.unplaced, `${b.name} · "${t}" ${JSON.stringify(r)}`).toBe(true)
      for (const refs of [ALL(b), [ALL(b)[0]], [ALL(b)[ALL(b).length - 1]]]) {
        const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(refs), text: t })
        expect(k?.ask, `${b.name} · ${refs} · "${t}" RAN`).toBeTruthy()
        expect(k.ask.choices.map(c => c.ref), `${b.name} · "${t}" OFFERED`).toEqual([])
      }
    }
  })
  it('a negated imperative over a negated description ("never add RSI to the non-daily charts") is UNPLACED, none offered', () => {
    for (const t of ['never add RSI to the non-daily charts', "don't add RSI to the charts that aren't daily", 'never set the ones not on weekly to monthly', "never add RSI to the ones that aren't SPY"]) {
      const r = read(AUDIT, t)
      expect(r.unplaced, t).toBe(true)
      const k = checkSpatialConstraints({ ...deps(AUDIT), ops: opsOn(ALL(AUDIT)), text: t })
      expect(k?.ask?.choices?.map(c => c.ref), t).toEqual([])
    }
  })
  it(`a prefix cue over a negated object ("don't change the charts that aren't SPY"): the exact complement`, () => {
    expect(read(AUDIT, "set every chart to monthly but don't change the charts that aren't SPY")).toEqual({ ex: ['BL', 'BR', 'TR'], unplaced: false, unoffered: [] })
    expect(read(AUDIT, "add RSI to every chart, but don't touch the ones that aren't on daily")).toEqual({ ex: ['TL'], unplaced: false, unoffered: [] })
  })
})

describe('"unless" + a described set: the described charts, exactly (positive), or UNPLACED (negated)', () => {
  it('positive: "unless they\'re daily" excludes the daily charts; one that fits no chart is UNPLACED', () => {
    expect(read(AUDIT, "add RSI to every chart unless they're daily")).toEqual({ ex: ['BL', 'BR', 'TR'], unplaced: false, unoffered: [] })
    expect(read(AUDIT, "set every chart to monthly unless it's on weekly")).toEqual({ ex: ['TL'], unplaced: false, unoffered: [] })
    expect(read(MIXED, 'add RSI to every chart unless they are line charts')).toEqual({ ex: ['c1', 'c4'], unplaced: false, unoffered: [] })
    expect(read(AUDIT, "add RSI to every chart unless they're monthly").unplaced).toBe(true)
    expect(read(AUDIT, "add RSI to every chart unless they're ETFs").unplaced).toBe(true)
  })
  it.each(['add RSI to every chart unless I say otherwise', "add RSI to every chart unless it's already there", 'set every chart to weekly unless you can not'])(
    'control — "%s" excludes nothing', (t) => { expect(read(AUDIT, t)).toEqual({ ex: [], unplaced: false, unoffered: [] }) })
})

describe('controls: the positive forms and the non-chart negations keep their readings', () => {
  it.each([
    ['add RSI to every chart except the daily ones', ['BL', 'BR', 'TR']],
    ["add RSI to every chart except whatever's on daily", ['BL', 'BR', 'TR']],
    ['add RSI to everything but the daily ones', ['BL', 'BR', 'TR']],
    ["don't add RSI to the daily charts", ['BL', 'BR', 'TR']],
    ['set every chart to weekly, not the chart I meant', []],
    ['set all to weekly other than what I said', []],
    ['remove all indicators except the ones that aren\'t RSI', []],
    ['weekly, not daily', []],
    ['add RSI to every chart except volume', []],
  ])('"%s" → %j', (t, ex) => {
    const r = read(AUDIT, t)
    expect(r.ex, t).toEqual(ex)
    expect(r.unplaced, t).toBe(false)
  })
})

// ── STRIP: a negation-blind reader can never silently invert ──
const STRIP = ["except the ones that aren't on daily", "apart from whatever isn't weekly", "except the non-daily ones", "except anything that's not a line chart",
  "but leave the ones that aren't QQQ alone", "except the ones that are anything but daily", "except whatever's other than daily", "excluding those not on weekly"]
describe('STRIP: the negation reader off → the GUARD makes it UNPLACED (none offered); both off → the old inversion comes back', () => {
  it('every generated sentence with the negation reader off: UNPLACED, every chart unoffered — never the positive set', () => {
    const miss = []
    for (const { b, t } of ROWS.filter((_, i) => i % 3 === 0)) {
      const r = read(b, t, { xoDisable: ['negation'] })
      if (!r.unplaced) { miss.push(`${b.name} · "${t}" → ${JSON.stringify(r)} (a silent run)`); continue }
      const offerable = ALL(b).filter(c => !r.ex.includes(c) && !r.unoffered.includes(c))
      if (offerable.length) miss.push(`${b.name} · "${t}": ${offerable} offerable`)
    }
    expect(miss.slice(0, 40).join(NL), `${miss.length} misses`).toBe('')
  })
  it('each class reader off → still UNPLACED or exact, never the positive set', () => {
    const miss = []
    for (const x of STRIP) {
      for (const cls of ['timeframe', 'type', 'ticker', 'relative', 'negation', 'list', 'unknown', 'generic']) {
        const t = `add RSI to every chart ${x}`
        const r = read(MIXED, t, { xoDisable: [cls] })
        const on = read(MIXED, t)
        if (on.unplaced || !on.ex.length) miss.push(`ON "${t}" → ${JSON.stringify(on)}`)
        if (!r.unplaced && JSON.stringify(r.ex) !== JSON.stringify(on.ex)) miss.push(`OFF ${cls} "${t}" → ${JSON.stringify(r)} (want ${on.ex} or UNPLACED)`)
      }
    }
    expect(miss.join(NL)).toBe('')
  })
  it('non-vacuity: the guard off alone keeps the exact reading; reader AND guard off → the negation-blind inversion returns', () => {
    const t = "add RSI to every chart except the ones that aren't on daily"
    expect(read(AUDIT, t, { xoDisable: ['negGuard'] })).toEqual({ ex: ['TL'], unplaced: false, unoffered: [] })
    expect(read(AUDIT, t)).toEqual({ ex: ['TL'], unplaced: false, unoffered: [] })
    const blind = read(AUDIT, t, { xoDisable: ['negation', 'negGuard'] })
    // the old b9 hole: the positive (daily) set is what the reader protects, so TL — the excluded chart — is offered
    const offerable = ALL(AUDIT).filter(c => !blind.ex.includes(c) && !blind.unoffered.includes(c))
    expect(offerable).toContain('TL')
  })
})
