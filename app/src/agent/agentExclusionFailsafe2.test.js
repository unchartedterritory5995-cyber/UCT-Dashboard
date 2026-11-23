// EXCLUSION FAIL-SAFE 2 (pl-exclhole2, AUDIT 11-23 T2 residual holes). The invariant: an exclusion cue whose object the board
// cannot place is UNPLACED (asked, no chart it may mean offered) — NEVER "exclude nothing". Three residual classes after
// pl-exclhole (agent/pl/exclusion-reader-holes):
//   (1) UNKNOWN ATTRIBUTE: "except the ETFs" (symbol type), "the tech stocks" (sector), "the large caps" (market cap) … the board
//       carries no such data, so the reader read NOTHING and an all-charts plan ran on the charts the member excluded;
//   (2) STATED KEEP: "X stays as it is / is fine" with X fitting no chart or a position the board cannot place excluded nothing
//       (the old G5 "statement" rule);
//   (3) NEW CUES: "instead of", "rather than", "bar", "barring" were no exclusion cues at all.
// …plus the GENERIC FALLBACK (PL priority 11-23): an exclusion object NO reader resolves, that is no known non-chart thing (an
// indicator, a drawing, a value, a time), is UNPLACED ("except Apple and Microsoft", "except the blah thing").
// Class-generated: cues × unknown attributes × boards × plans × the chart-backed families; the strip test (each class reader
// switched off → UNPLACED, never a silent run); controls proving the non-exclusion readings are unchanged ("instead of daily, use
// weekly" is a swap; "weekly, not daily", "except volume", "remove all indicators except RSI", "a bar chart"). LOCAL (vitest).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { excludedCharts, checkSpatialConstraints, withoutExcludedCharts, UNPLACED } from './spatialCheck'

registerBuiltins()

function boardOf(name, cells) {
  const fb = makeBoard(cells.map(([id, x, y, w, h, , tf, type]) => ({
    id, type: 'chart', x, y, w, h, color: 'N',
    opts: { settings: mergeChartSettings(type ? { chartType: type } : null), ...(tf ? { tf } : {}) },
  })), Object.fromEntries(cells.map(([id, , , , , sym]) => [`N:${id}`, sym])))
  const host = { ...fb.host, charts: { ...fb.host.charts, selected: () => null, canManageIndicators: () => true, canCreateIndicator: () => true } }
  const meta = cells.map(([id, x, y, w, h, sym, tf, type]) => ({ ref: id, x, y, w, h, area: w * h, sym, tf: tf || 'D', type: type || 'candles' }))
  const order = [...meta].sort((a, b) => a.y - b.y || a.x - b.x).map(m => m.ref)
  return { name, host, meta, order, live: () => host.charts.list() }
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
  return { ex: [...e].filter(x => x !== UNPLACED).sort(), unplaced: e.has(UNPLACED), unoffered: [...(e.unoffered || [])] }
}
const opsOn = (refs) => refs.map(r => ({ action: 'chart.setTimeframe', target: r, args: { timeframe: 'M' } }))
const deps = (b) => ({ host: b.host, getCapability, getTargetKind })
const ALL = (b) => b.meta.map(m => m.ref)

// ── (1) unknown attributes: symbol type, sector, market cap, and the like ──
const UNKNOWN = [
  // symbol type
  'the ETFs', 'ETFs', 'the ETF charts', 'the ETF ones', 'the stocks', 'the individual stocks', 'the indexes', 'the index charts',
  'the crypto charts', 'crypto', 'the futures', 'the futures charts', 'the funds', 'the leveraged ETFs', 'the inverse ones',
  // sector
  'the tech stocks', 'tech', 'the tech ones', 'the semis', 'the semiconductor names', 'the financials', 'energy', 'the energy names',
  'anything in tech', 'the tech sector', 'the healthcare charts', 'the bank stocks',
  // market cap
  'the large caps', 'the small-cap ones', 'the mega cap charts', 'anything under 10B market cap', 'the small caps',
  // other attributes the board does not carry (generic fallback / described sets)
  'the red ones', 'the leveraged ones', 'my holdings', 'Apple', 'Apple and Microsoft', 'the one my wife likes', 'the ones up today',
]
// the cue forms (X = the object); a weak cue ("not", "but", "instead of") reads every object above too
const FORMS = {
  'except X': (x) => ` except ${x}`,
  'except for X': (x) => ` except for ${x}`,
  'but not X': (x) => ` but not ${x}`,
  'other than X': (x) => ` other than ${x}`,
  'apart from X': (x) => ` apart from ${x}`,
  'excluding X': (x) => ` excluding ${x}`,
  'besides X': (x) => ` besides ${x}`,
  'without X': (x) => ` without ${x}`,
  'but leave X alone': (x) => ` but leave ${x} alone`,
  'leave X as is': (x) => `, leave ${x} as is`,
  'skip X': (x) => `, skip ${x}`,
  'ignore X': (x) => `, ignore ${x}`,
  "don't touch X": (x) => `, but don't touch ${x}`,
  'keep X the same': (x) => ` but keep ${x} the same`,
  'not X': (x) => `, not ${x}`,
  'barring X': (x) => ` barring ${x}`,
  ', bar X': (x) => `, bar ${x}`,
  'instead of X': (x) => ` instead of ${x}`,
  'rather than X': (x) => ` rather than ${x}`,
  'X stay as they are': (x) => `, ${x} stay as they are`,
  'X are fine': (x) => `; ${x} are fine`,
}
// "instead of / rather than" after a TIMEFRAME value is a possible replacement: the unknown objects are read under a change
// that carries no value of a board class
const CHANGES = ['add RSI to every chart', 'add RSI to all of them', 'show volume on every chart', 'hide the grid on all charts', 'add RSI to all']
const STAY_FORM = (f) => /stay|fine/.test(f)
const UNK_ROWS = []
for (const b of BOARDS) {
  UNKNOWN.forEach((x, i) => {
    for (const f of Object.keys(FORMS)) {
      // a stated keep reads a subject the readers own: skip the bare/proper-name subjects under a plural verb ("Apple stay")
      if (STAY_FORM(f) && /^(?:Apple|crypto|tech|energy|anything|ETFs$)/.test(x)) continue
      UNK_ROWS.push({ b, f, x, t: `${CHANGES[(i + f.length) % CHANGES.length]}${FORMS[f](x)}` })
    }
  })
}

describe('(1) an UNKNOWN attribute after an exclusion cue is UNPLACED — every chart may be meant, none offered', () => {
  it('the class covers every board, cue form and attribute family', () => {
    expect(UNK_ROWS.length).toBeGreaterThan(3000)
    for (const f of Object.keys(FORMS)) expect(UNK_ROWS.some(r => r.f === f), f).toBe(true)
  })
  it('the READER: UNPLACED, every chart unoffered (no exact chart claimed from an attribute it cannot see)', () => {
    const miss = []
    for (const { b, t, x } of UNK_ROWS) {
      const r = read(b, t)
      if (!r.unplaced) { miss.push(`${b.name} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`); continue }
      // a board ticker in the object is that ticker's chart, exactly; every other chart may be meant
      for (const c of ALL(b)) if (!r.unoffered.includes(c) && !r.ex.includes(c) && !/Apple/.test(x)) miss.push(`${b.name} · "${t}" → ${c} offered`)
    }
    expect(miss.slice(0, 40).join(String.fromCharCode(10)), `${miss.length} misses of ${UNK_ROWS.length}`).toBe("")
  })
  it('the NET: a plan on every chart, or on any one chart, is asked — never run — and the question offers no chart', () => {
    const miss = []
    for (const { b, t } of UNK_ROWS) {
      for (const refs of [ALL(b), [ALL(b)[0]], [ALL(b)[ALL(b).length - 1]]]) {
        const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(refs), text: t })
        if (!k?.ask) { miss.push(`${b.name} · ${refs} · "${t}": RAN`); continue }
        if (k.ask.choices.length) miss.push(`${b.name} · "${t}": OFFERED ${k.ask.choices.map(c => c.ref)}`)
      }
    }
    expect(miss.slice(0, 40).join(String.fromCharCode(10)), `${miss.length} misses`).toBe("")
  })
  it('a list mixing a board ticker and an unknown attribute: the ticker is excluded exactly AND the exclusion is asked', () => {
    for (const t of ['add RSI to every chart except SPY and the ETFs', 'add RSI to all, but leave the ETFs and SPY alone', 'add RSI to every chart barring SPY or the tech stocks']) {
      const r = read(AUDIT, t)
      expect(r.unplaced, t).toBe(true)
      expect([...r.ex, ...r.unoffered], t).toEqual(expect.arrayContaining(['TL', 'TR', 'BL', 'BR']))
    }
  })
  it('a negated imperative with an unknown attribute ("never add RSI to the ETFs") is UNPLACED', () => {
    for (const t of ['add RSI to every chart, but never add RSI to the ETFs', "add RSI to every chart, don't add it to the tech stocks"]) expect(read(AUDIT, t).unplaced, t).toBe(true)
  })
  it('a board ticker that is also an attribute word is still that chart ("COIN" on the board)', () => {
    const b = boardOf('COIN board', [['x', 0, 0, 12, 10, 'COIN', 'D'], ['y', 12, 0, 12, 10, 'SPY', 'D']])
    expect(read(b, 'add RSI to every chart except COIN')).toEqual({ ex: ['x'], unplaced: false, unoffered: [] })
  })
})

// ── (2) the stated keep: exact when placed, UNPLACED otherwise ──
const STAY_VERBS = ['stays as it is', 'stays the same', 'is fine', 'can stay', 'remains unchanged', 'is fine as it is', 'stays put']
const STAY_PL = ['stay as they are', 'are fine', 'can stay', 'stay the same']
function staySubjects(b) {
  const out = []
  const tfs = new Set(b.meta.map(m => m.tf))
  // a description that fits NO chart here → UNPLACED (it was "a statement": nothing)
  for (const [w, c] of [['monthly', 'M'], ['weekly', 'W'], ['hourly', '60'], ['daily', 'D']]) {
    if (!tfs.has(c)) out.push({ s: `the ${w} ones`, pl: true, unplaced: true })
    else out.push({ s: `the ${w} ones`, pl: true, exact: b.meta.filter(m => m.tf === c).map(m => m.ref) })
  }
  // a position the board cannot place → UNPLACED (old G5: nothing)
  out.push({ s: `chart ${b.meta.length + 2}`, pl: false, unplaced: true })
  out.push({ s: 'the sixth chart', pl: false, unplaced: b.meta.length < 6, exact: b.meta.length >= 6 ? [b.order[5]] : null })
  // placed positions stay exact
  out.push({ s: 'chart 1', pl: false, exact: [b.order[0]] })
  // an attribute the board does not carry, a proper name, a described set → UNPLACED
  for (const s of ['the ETFs', 'the tech stocks', 'the large caps', 'the green ones']) out.push({ s, pl: true, unplaced: true })
  out.push({ s: 'Apple', pl: false, unplaced: true })
  return out.filter(x => x.unplaced || x.exact)
}
const STAY_ROWS = []
for (const b of BOARDS) {
  staySubjects(b).forEach((d, i) => {
    for (const v of d.pl ? STAY_PL : STAY_VERBS) STAY_ROWS.push({ b, d, t: `${['set every chart to monthly', 'add RSI to every chart', 'make everything weekly'][i % 3]}, ${d.s} ${v}` })
  })
}
describe('(2) a STATED keep ("X stays / is fine / as it is") is exact when placed, UNPLACED otherwise — never a statement', () => {
  it(`${STAY_ROWS.length} sentences`, () => {
    expect(STAY_ROWS.length).toBeGreaterThan(150)
    const miss = []
    for (const { b, d, t } of STAY_ROWS) {
      const r = read(b, t)
      if (d.unplaced) {
        if (!r.unplaced) miss.push(`${b.name} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`)
        const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(ALL(b)), text: t })
        if (!k?.ask) miss.push(`${b.name} · "${t}": RAN`)
      } else {
        const want = [...d.exact].sort()
        if (r.unplaced || JSON.stringify(r.ex) !== JSON.stringify(want)) miss.push(`${b.name} · "${t}" → ${JSON.stringify(r)} (want ${want})`)
        const rest = ALL(b).filter(x => !want.includes(x))
        if (rest.length && checkSpatialConstraints({ ...deps(b), ops: opsOn(rest), text: t })) miss.push(`${b.name} · "${t}": the exact plan was asked`)
      }
    }
    expect(miss.slice(0, 40).join(String.fromCharCode(10)), `${miss.length} misses`).toBe("")
  })
  it('a stated "stays" that is no keep ("the price stays the same", "everything else stays") excludes nothing', () => {
    for (const t of ['set all to weekly, the price stays the same', 'set SPY to weekly, everything else stays', 'set all to weekly, the timeframe stays the same']) {
      expect(read(AUDIT, t).unplaced, t).toBe(false)
    }
  })
})

// ── (3) the new cues: bar / barring (strong), instead of / rather than (chart sets only) ──
const TFS = [['daily', 'D'], ['weekly', 'W'], ['monthly', 'M']]
function descSets(b) {
  const out = []
  for (const [w, c] of TFS) {
    const hits = b.meta.filter(m => m.tf === c).map(m => m.ref)
    for (const x of [`the ${w} ones`, `the ${w} charts`]) out.push({ x, exact: hits, unplaced: !hits.length })
  }
  const bySym = {}
  for (const m of b.meta) (bySym[m.sym] = bySym[m.sym] || []).push(m.ref)
  for (const [sym, refs] of Object.entries(bySym)) if (refs.length === 1) out.push({ x: sym, exact: refs, unplaced: false })
  const lineHits = b.meta.filter(m => m.type === 'line').map(m => m.ref)
  out.push({ x: 'the line charts', exact: lineHits, unplaced: !lineHits.length })
  out.push({ x: 'chart 1', exact: [b.order[0]], unplaced: false })
  return out
}
const NEW_CUES = {
  'barring X': (c, x) => `${c} barring ${x}`,
  ', bar X': (c, x) => `${c}, bar ${x}`,
  'every chart bar X': (c, x) => `${c.replace(/every chart|all of them|all charts|all/, 'every chart')} bar ${x}`,
  'instead of X': (c, x) => `${c} instead of ${x}`,
  'rather than X': (c, x) => `${c} rather than ${x}`,
  'instead of X, …': (c, x) => `instead of ${x}, ${c}`,
}
const NC_CHANGES = ['add RSI to every chart', 'show volume on all of them', 'hide the grid on all charts']
const NC_ROWS = []
for (const b of BOARDS) for (const d of descSets(b)) for (const [f, mk] of Object.entries(NEW_CUES)) NC_ROWS.push({ b, d, f, t: mk(NC_CHANGES[(f.length + d.x.length) % NC_CHANGES.length], d.x) })
// lists under the new cues
for (const b of BOARDS) {
  const ds = descSets(b).filter(d => !d.unplaced)
  for (let i = 0; i + 1 < ds.length; i += 2) {
    const a = ds[i], z = ds[i + 1]
    for (const [f, mk] of Object.entries(NEW_CUES)) NC_ROWS.push({ b, d: { x: `${a.x} and ${z.x}`, exact: [...new Set([...a.exact, ...z.exact])], unplaced: false }, f, t: mk(NC_CHANGES[i % NC_CHANGES.length], `${a.x} and ${z.x}`) })
  }
}
describe('(3) the new cues read as exclusions — exact, or UNPLACED', () => {
  it(`${NC_ROWS.length} sentences: the reader, the net, and the exact plan`, () => {
    expect(NC_ROWS.length).toBeGreaterThan(300)
    const miss = []
    for (const { b, d, t } of NC_ROWS) {
      const r = read(b, t)
      if (d.unplaced) {
        if (!r.unplaced) miss.push(`${b.name} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`)
        continue
      }
      const want = [...d.exact].sort()
      if (r.unplaced || JSON.stringify(r.ex) !== JSON.stringify(want)) { miss.push(`${b.name} · "${t}" → ${JSON.stringify(r)} (want ${want})`); continue }
      const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(ALL(b)), text: t })
      if (!k?.ask) miss.push(`${b.name} · "${t}": a plan on every chart RAN`)
      else for (const c of k.ask.choices) if (want.includes(c.ref)) miss.push(`${b.name} · "${t}": OFFERED ${c.ref}`)
      const g = withoutExcludedCharts(opsOn(ALL(b)), [t], deps(b))
      for (const o of g.ops) if (want.includes(o.target)) miss.push(`${b.name} · "${t}": KEPT op on ${o.target}`)
      const rest = ALL(b).filter(x => !want.includes(x))
      if (rest.length && checkSpatialConstraints({ ...deps(b), ops: opsOn(rest), text: t })) miss.push(`${b.name} · "${t}": the exact plan was asked`)
    }
    expect(miss.slice(0, 40).join(String.fromCharCode(10)), `${miss.length} misses`).toBe("")
  })
  it('"instead of" after a VALUE of the same class may be a replacement: UNPLACED, the described charts never offered', () => {
    for (const t of ['set all to monthly instead of the daily ones', 'switch every chart to line charts instead of the candle ones', 'make them all weekly rather than the daily charts']) {
      const r = read(AUDIT, t)
      expect(r.unplaced, t).toBe(true)
    }
  })
})

// ── the controls: the non-exclusion readings are unchanged ──
describe('controls: a replacement, a contrast, a value or a non-chart set excludes nothing (as before)', () => {
  it.each([
    'instead of daily, use weekly', 'use weekly instead of daily', 'set all to weekly instead of daily', 'make it a line instead of candles',
    'use the weekly timeframe instead of the daily one', 'show the 50 instead of the 200', 'put AAPL instead of SPY',
    'set the top-left chart to AAPL instead of SPY', 'add RSI to every chart rather than just the daily ones',
    'add RSI to all charts instead of only the weekly one', 'make everything weekly, not daily', 'set all to monthly except volume',
    'remove all indicators except RSI', 'remove all indicators except the 21 EMA and volume', 'remove all indicators except the money flow index',
    'delete every line except the trendline', 'add RSI to every chart except on Fridays', 'set all to weekly excluding after-hours',
    'set all to monthly except the 50 day', 'set every chart to anything other than daily', 'set all to weekly, not the chart I meant',
    'switch every chart to bar', 'set all to bar charts', 'make every chart bar style', 'set all charts to bars', 'keep the daily ones',
    'set all to weekly except TSLA', 'set the timeframe to something other than weekly', 'everything bar none goes weekly',
  ])('"%s" excludes nothing', (t) => {
    expect(read(AUDIT, t)).toEqual({ ex: [], unplaced: false, unoffered: [] })
  })
  it('"make everything a bar chart except the daily ones": the bar CHART is the value, the dailies the exclusion', () => {
    expect(read(AUDIT, 'make everything a bar chart except the daily ones')).toEqual({ ex: ['BL', 'BR', 'TR'], unplaced: false, unoffered: [] })
  })
})

// ── the STRIP test: every class reader switched off → UNPLACED, never a silent run (and on → exact) ──
describe('STRIP: each class reader switched off → UNPLACED (the generic fallback catches what no reader handles)', () => {
  const CLASS = [
    ['timeframe', AUDIT, 'the daily ones'], ['timeframe', MIXED, 'the ones on weekly'], ['type', MIXED, 'the line charts'],
    ['size', SIZED, 'the big chart'], ['ticker', AUDIT, 'QQQ'], ['ticker', DUP, 'the SPY charts'], ['position', AUDIT, 'the top row'],
    ['position', MIXED, 'chart 4'], ['list', AUDIT, 'SPY, QQQ and NVDA'],
  ]
  const forms = ['except X', 'barring X', ', bar X', 'instead of X', 'rather than X', 'but leave X alone', 'skip X', 'excluding X']
  const mk = (f, x) => (FORMS[f] ? `add RSI to every chart${FORMS[f](x)}` : `add RSI to every chart${NEW_CUES[f] ? NEW_CUES[f]('', x) : ''}`)
  const rows = []
  for (const [cls, b, x] of CLASS) for (const f of forms) rows.push([cls, b, mk(f, x)])
  it(`${rows.length} sentences × the reader on / off`, () => {
    const miss = []
    for (const [cls, b, t] of rows) {
      const on = read(b, t)
      const off = read(b, t, { xoDisable: [cls] })
      if (on.unplaced || !on.ex.length) miss.push(`ON ${cls} "${t}" → ${JSON.stringify(on)}`)
      if (!off.unplaced) miss.push(`OFF ${cls} "${t}" → ${JSON.stringify(off)} (a silent run)`)
      if (!checkSpatialConstraints({ ...deps(b), ops: opsOn(ALL(b)), text: t })?.ask) miss.push(`NET ${cls} "${t}": RAN`)
    }
    expect(miss.join(String.fromCharCode(10)), `${miss.length} misses`).toBe("")
  })
  it('EVERY class reader off at once: every described / unknown exclusion is still UNPLACED (the generic fallback)', () => {
    const offAll = { xoDisable: ['timeframe', 'type', 'size', 'ticker', 'position', 'unknown'] }
    const miss = []
    for (const t of [...UNKNOWN.filter(x => !/under/.test(x)).map(x => `add RSI to every chart except ${x}`), 'add RSI to every chart barring the daily ones', 'add RSI to every chart, bar the line charts',
      'add RSI to every chart except the big chart', 'add RSI to every chart instead of the weekly ones', 'set every chart to monthly, the ETFs stay as they are']) {
      if (!read(MIXED, t, offAll).unplaced) miss.push(t)
    }
    expect(miss.join(String.fromCharCode(10))).toBe("")
  })
  it('non-vacuity of THIS fix: with the unknown / generic readers, the new cues or the stay change off, the holes come back', () => {
    // (unknown + generic off) "except the ETFs" reads nothing — the fix is what decides
    expect(read(AUDIT, 'add RSI to every chart except the ETFs', { xoDisable: ['unknown', 'generic'] }).unplaced).toBe(false)
    expect(read(AUDIT, 'add RSI to every chart except the ETFs').unplaced).toBe(true)
    // (new cues off) "bar / barring / instead of" read nothing for a description
    for (const t of ['add RSI to every chart, bar the daily ones', 'add RSI to every chart barring the daily ones', 'add RSI to every chart instead of the daily ones']) {
      expect(read(AUDIT, t, { xoDisable: ['newCues'] }).ex, t).toEqual([])
      expect(read(AUDIT, t).ex, t).toEqual(['BL', 'BR', 'TR'])
    }
  })
})

// ── every chart-backed mutation family (registry-enumerated) ──
const IDS = ['TL', 'TR', 'BL', 'BR']
const FAMILIES = allCapabilityNames().map(name => {
  const c = getCapability(name)
  if (!c || c.query) return null
  const kind = getTargetKind(c.target)
  if (!kind) return null
  let list = []
  try { list = kind.list(AUDIT.host) || [] } catch { return null }
  const byChart = Object.fromEntries(IDS.map(id => [id, list.find(s => chartRefOf(kind, s) === id)]))
  return IDS.every(id => byChart[id]) ? { name, kind, byChart } : null
}).filter(Boolean)
const famOps = (f, ids) => ids.map(id => ({ action: f.name, target: f.byChart[id].ref, args: {} }))
const WORDS = [
  ['do it on every chart except the ETFs', IDS, false],
  ['do it on all of them, but leave the tech stocks alone', IDS, false],
  ['do it on every chart, the large caps stay as they are', IDS, false],
  ['do it on every chart, chart 6 stays as it is', [], false],
  ['do it on every chart, bar the daily ones', ['TR', 'BL', 'BR'], true],
  ['do it on every chart barring SPY and QQQ', ['TL', 'TR'], true],
  ['do it on every chart instead of the weekly one', ['TL'], true],
  ['do it on every chart except Apple and Microsoft', IDS, false],
]
describe('every mutation family the targeting layer serves (registry-enumerated)', () => {
  it('the registry yields the chart-backed families', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(20)
    for (const n of ['indicator.add', 'chart.setTimeframe']) expect(FAMILIES.map(f => f.name)).toContain(n)
  })
  it.each(FAMILIES.flatMap(f => WORDS.map(([t, ex, exact]) => [f.name, t, ex, exact, f])))('%s — "%s": asked, never acted on / offered an excluded chart', (_n, t, ex, exact, f) => {
    const d = deps(AUDIT)
    const k = checkSpatialConstraints({ ...d, ops: famOps(f, IDS), text: t })
    expect(k?.ask).toBeTruthy()
    for (const c of k.ask.choices) expect(ex).not.toContain(chartRefOf(f.kind, f.kind.list(AUDIT.host).find(s => s.ref === c.ref)))
    // the apply gate drops every op on an EXACTLY excluded chart (an UNPLACED one is held by the question above)
    const g = withoutExcludedCharts(famOps(f, IDS), [t], d)
    if (exact) for (const o of g.ops) expect(ex).not.toContain(chartRefOf(f.kind, f.kind.list(AUDIT.host).find(s => s.ref === o.target)))
    const rest = IDS.filter(id => !ex.includes(id))
    if (exact && rest.length) expect(checkSpatialConstraints({ ...d, ops: famOps(f, rest), text: t })).toBeNull()
    // an UNPLACED exclusion asks even a plan on ONE chart
    if (!exact) expect(checkSpatialConstraints({ ...d, ops: famOps(f, ['BR']), text: t })?.ask).toBeTruthy()
  })
})

// ── (AUDIT T2 r2) RELATIVE-CLAUSE exclusion objects: "except whatever's on daily", "apart from the ones that are on daily" ──
const REL_CUES = {
  'except X': (x) => ` except ${x}`, 'apart from X': (x) => ` apart from ${x}`, 'other than X': (x) => ` other than ${x}`,
  'excluding X': (x) => ` excluding ${x}`, 'but not X': (x) => ` but not ${x}`, 'barring X': (x) => ` barring ${x}`,
  'besides X': (x) => ` besides ${x}`, 'but leave X alone': (x) => ` but leave ${x} alone`, 'skip X': (x) => `, skip ${x}`,
}
// [template, plural] — relative pronouns (that / which / what / whatever / who) × contractions × copulas
const REL_TF = [
  ["whatever's on V", true], ['whatever is on V', true], ["what's on the V", true], ['what is on V', true], ["anything that's V", true],
  ['anything that is on V', true], ['the ones that are on V', true], ["the ones that're on V", true], ['the ones which are V', true],
  ['those which are V', true], ["those that're V", true], ['those that sit on V', true], ['the charts that are set to V', true],
  ['the ones who are on V', true], ["everything that's on V", true], ['the charts which are currently on V', true],
  ["the one that's on V", false], ['the chart which is set to V', false],
]
const REL_TYPE = [["whatever's a V chart", true], ['the ones that are V charts', true], ['those which are V charts', true], ['anything shown as V', true], ["the one that's a V chart", false]]
const REL_TK = [["the one that's V", false], ['the chart that is V', false], ["whatever's V", true]]
const relPick = (hits, plural) => (hits.length && (plural || new Set(hits).size === 1) ? { exact: hits } : { unplaced: true })
const REL_ROWS = []
for (const b of BOARDS) {
  const ds = []
  for (const [w, c] of [['daily', 'D'], ['weekly', 'W'], ['monthly', 'M'], ['hourly', '60']]) {
    const hits = b.meta.filter(m => m.tf === c).map(m => m.ref)
    for (const [tpl, pl] of REL_TF) ds.push({ x: tpl.replace('V', w), ...relPick(hits, pl), cls: 'timeframe' })
  }
  for (const [w, t] of [['line', 'line'], ['bar', 'bars']]) {
    const hits = b.meta.filter(m => m.type === t).map(m => m.ref)
    for (const [tpl, pl] of REL_TYPE) ds.push({ x: tpl.replace('V', w), ...relPick(hits, pl), cls: 'type' })
  }
  const bySym = {}
  for (const m of b.meta) (bySym[m.sym] = bySym[m.sym] || []).push(m.ref)
  for (const [sym, refs] of Object.entries(bySym)) for (const [tpl, pl] of REL_TK) ds.push({ x: tpl.replace('V', sym), ...relPick(refs, pl || refs.length === 1), cls: 'ticker' })
  ds.forEach((d, i) => { for (const [f, mk] of Object.entries(REL_CUES)) REL_ROWS.push({ b, d, f, t: `${['add RSI to every chart', 'set every chart to monthly', 'show volume on all of them'][(i + f.length) % 3]}${mk(d.x)}` }) })
}
describe('(AUDIT T2 r2) a RELATIVE-CLAUSE exclusion object is the described set — exact, or UNPLACED; never nothing', () => {
  it(`${REL_ROWS.length} sentences: cues × relative pronouns × contractions × copulas × timeframe / type / ticker descriptions × boards`, () => {
    expect(REL_ROWS.length).toBeGreaterThan(2000)
    const miss = []
    for (const { b, d, t } of REL_ROWS) {
      const r = read(b, t)
      if (d.unplaced) {
        if (!r.unplaced) miss.push(`${b.name} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`)
        if (!checkSpatialConstraints({ ...deps(b), ops: opsOn(ALL(b)), text: t })?.ask) miss.push(`${b.name} · "${t}": RAN`)
        continue
      }
      const want = [...d.exact].sort()
      if (r.unplaced || JSON.stringify(r.ex) !== JSON.stringify(want)) { miss.push(`${b.name} · "${t}" → ${JSON.stringify(r)} (want ${want})`); continue }
      const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(ALL(b)), text: t })
      if (!k?.ask) miss.push(`${b.name} · "${t}": a plan on every chart RAN`)
      else for (const c of k.ask.choices) if (want.includes(c.ref)) miss.push(`${b.name} · "${t}": OFFERED ${c.ref}`)
      const g = withoutExcludedCharts(opsOn(ALL(b)), [t], deps(b))
      for (const o of g.ops) if (want.includes(o.target)) miss.push(`${b.name} · "${t}": KEPT op on ${o.target}`)
      const rest = ALL(b).filter(x => !want.includes(x))
      if (rest.length && checkSpatialConstraints({ ...deps(b), ops: opsOn(rest), text: t })) miss.push(`${b.name} · "${t}": the exact plan was asked`)
    }
    expect(miss.slice(0, 40).join(String.fromCharCode(10)), `${miss.length} misses`).toBe('')
  })
  it('a relative description the readers cannot evaluate is UNPLACED ("whatever is red", "the ones that are up today")', () => {
    for (const t of ['add RSI to every chart except whatever is red', 'add RSI to every chart except the ones that are up today', "add RSI to every chart except anything that's leveraged"]) expect(read(AUDIT, t).unplaced, t).toBe(true)
  })
  it('controls: a clause about a person, or a relation, keeps its own reading', () => {
    expect(read(AUDIT, 'set all to weekly other than what I said')).toEqual({ ex: [], unplaced: false, unoffered: [] })
    expect(read(AUDIT, 'set every chart to weekly, not the chart I meant')).toEqual({ ex: [], unplaced: false, unoffered: [] })
  })
  it('STRIP: each class reader (and the relative reader) switched off → UNPLACED, never a silent run', () => {
    const miss = []
    for (const [cls, x] of [['timeframe', "whatever's on daily"], ['timeframe', 'the ones that are on daily'], ['type', 'those which are line charts'], ['ticker', "the one that's QQQ"], ['relative', "whatever's on daily"], ['relative', "anything that's daily"], ['relative', 'those which are on weekly']]) {
      for (const mk of Object.values(REL_CUES)) {
        const t = `add RSI to every chart${mk(x)}`
        const on = read(MIXED, t)
        const off = read(MIXED, t, { xoDisable: [cls] })
        if (on.unplaced || !on.ex.length) miss.push(`ON ${cls} "${t}" → ${JSON.stringify(on)}`)
        if (!off.unplaced) miss.push(`OFF ${cls} "${t}" → ${JSON.stringify(off)} (a silent run)`)
      }
    }
    expect(miss.join(String.fromCharCode(10))).toBe('')
  })
})

// ── (AUDIT T2 r2) MIXED LISTS: a non-chart item never silently ends a chart-exclusion list ──
const NONCHART_ITEMS = ['volume', 'RSI', 'the 50 day', 'MACD', 'the grid', 'the VWAP']
const MIX_CUES = { 'except X': (x) => ` except ${x}`, 'other than X': (x) => ` other than ${x}`, 'apart from X': (x) => ` apart from ${x}`, 'excluding X': (x) => ` excluding ${x}`, 'besides X': (x) => ` besides ${x}`, 'barring X': (x) => ` barring ${x}`, 'but leave X alone': (x) => ` but leave ${x} alone` }
const MIX_ROWS = []
for (const b of BOARDS) {
  const chartItems = [...descSets(b).filter(d => !d.unplaced).map(d => d.x), 'the ETFs', 'Apple']
  chartItems.forEach((c, i) => {
    const n = NONCHART_ITEMS[i % NONCHART_ITEMS.length]
    for (const [f, mk] of Object.entries(MIX_CUES)) {
      for (const x of [`${n} and ${c}`, `${c} and ${n}`, `${n}, ${c} and ${NONCHART_ITEMS[(i + 1) % NONCHART_ITEMS.length]}`, `${n} or ${c}`]) MIX_ROWS.push({ b, f, t: `${['add RSI to every chart', 'set every chart to monthly', 'show volume on all of them'][(i + f.length) % 3]}${mk(x)}` })
    }
  })
}
describe('(AUDIT T2 r2) a MIXED list (a non-chart item and a chart item) is UNPLACED — asked, no chart offered', () => {
  it(`${MIX_ROWS.length} sentences: cues × non-chart items × chart items × orders × boards`, () => {
    expect(MIX_ROWS.length).toBeGreaterThan(600)
    const miss = []
    for (const { b, t } of MIX_ROWS) {
      const r = read(b, t)
      if (!r.unplaced) { miss.push(`${b.name} · "${t}" → NOT UNPLACED ${JSON.stringify(r)}`); continue }
      for (const refs of [ALL(b), [ALL(b)[0]]]) {
        const k = checkSpatialConstraints({ ...deps(b), ops: opsOn(refs), text: t })
        if (!k?.ask) miss.push(`${b.name} · ${refs} · "${t}": RAN`)
        else if (k.ask.choices.length) miss.push(`${b.name} · "${t}": OFFERED ${k.ask.choices.map(c => c.ref)}`)
      }
    }
    expect(miss.slice(0, 40).join(String.fromCharCode(10)), `${miss.length} misses`).toBe('')
  })
  it.each([
    'remove all indicators except RSI and MACD', 'remove all indicators except volume and the 50 day', 'delete every line except the trendline and the 200',
    'add RSI to every chart except volume', 'add RSI to every chart except on Fridays and holidays', 'set all to monthly except volume',
  ])('control — no chart in the object: "%s" excludes nothing', (t) => {
    expect(read(AUDIT, t)).toEqual({ ex: [], unplaced: false, unoffered: [] })
  })
  it('a ticker the board does not show stays master policy beside a chart item ("except TSLA and the daily ones": exact)', () => {
    expect(read(AUDIT, 'add RSI to every chart except TSLA and the daily ones')).toEqual({ ex: ['BL', 'BR', 'TR'], unplaced: false, unoffered: [] })
  })
  it('STRIP / non-vacuity: class readers off → still UNPLACED; the mixed-list rule off → the old silent run comes back', () => {
    const t = 'add RSI to every chart except volume and the daily ones'
    for (const cls of ['timeframe', 'type', 'ticker', 'unknown', 'list']) expect(read(AUDIT, t, { xoDisable: [cls] }).unplaced, cls).toBe(true)
    expect(read(AUDIT, 'add RSI to every chart except volume and the ETFs', { xoDisable: ['mixedList'] }).unplaced).toBe(false)
    expect(read(AUDIT, 'add RSI to every chart except volume and the ETFs').unplaced).toBe(true)
  })
})
