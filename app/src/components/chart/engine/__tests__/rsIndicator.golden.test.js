// app/src/components/chart/engine/__tests__/rsIndicator.golden.test.js
//
// ─── UCT Relative Strength, Phase 1 (unit 6) — the SHARED fixture, read as a
//     CONTRACT ───────────────────────────────────────────────────────────────
//
// `tests/fixtures/indicators/rs_events_default.json` is the one oracle both
// lanes read for the RS EVENT columns (plan §12.3). The Python lane
// (`tests/test_indicator_golden.py::test_rs_events_*`) RECOMPUTES it through
// `relative_strength.compute_phase1_columns` at rel-tol 1e-9. This lane cannot:
// the chart has NO RS compute — `rsLine` is `compute.kind: 'server'` (decision
// A3), so the columns arrive on the wire and the binder draws them. What this
// lane CAN assert is the contract between the DEFINITION and the FIXTURE:
//
//   1. every `markers` plot of `getDefinition('rsLine')` names a column the
//      fixture carries, and every `line` plot does too — a marker plot the
//      fixture does not cover fails BY NAME, so a new dot cannot ship without
//      an oracle;
//   2. on the fixture itself, a dot column is finite EXACTLY where its event
//      column is 1 and EQUALS `rsLine` there — a dot sits ON the line, whether
//      it is a glyph (`position: 'inBar'`) or the series' own point marker
//      (`relative_strength.py` module header; unit 6 of the review fix plan);
//   3. the wire path this lane actually runs — `columnsFromWire` then
//      `alignColumns` — reproduces every fixture column on the chart's bars,
//      `null` → NaN, joined BY TIME and not by index;
//   4. the single-symbol claim `rs_line_spy` names, on these bars: the one RS
//      compute this lane does have (`computeRSLine`) is a flat 1.0 against
//      itself, and agrees with the fixture's `rsLine` against the benchmark;
//   5. (Phase 2a, unit 2a-14) the MANSFIELD plots read `rs_mansfield.json` the
//      same way: the `mansfield` line names its column, the zero-cross dot is
//      finite exactly where either cross fired and EQUALS the Mansfield value
//      there — which may be at or BELOW zero, the reason it is a point-marker
//      plot and not a glyph (`markerPrimitive.marks` is `> 0`).
//
// ⚠️ THE FIXTURE'S `expected` IS THE PYTHON LANE'S OUTPUT, HAND-VERIFIED IN ITS
// `note` — asserting it HERE is what makes the two lanes meet on one file.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDefinition, SERVER_DEFS } from '../nativeRegistry'
import { columnsFromWire, alignColumns } from '../serverCompute'
import { computeRSLine } from '../../indicators'

// Same resolution as `goldenFixtures.test.js`: vitest normally runs from `app/`,
// but the suite must resolve from the repo root too. Fail LOUDLY if neither hits.
const FIX = [
  join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'),
  join(process.cwd(), 'tests', 'fixtures', 'indicators'),
].find(p => existsSync(join(p, 'rs_events_default.json')))
if (!FIX) {
  throw new Error(
    `indicator fixtures not found from cwd ${process.cwd()} — expected `
    + 'tests/fixtures/indicators/rs_events_default.json at the repo root',
  )
}
const loadCase = (n) => JSON.parse(readFileSync(join(FIX, `${n}.json`), 'utf8'))

/** The dot → event pairing the module header declares, per FIXTURE. A marker
 *  plot whose key is in neither map fails by name below. */
const DOT_TO_EVENT = Object.freeze({
  dotNH: 'rsNH',
  dotNHbeforePx: 'rsNHbeforePx',
  dotNHpartial: 'rsNHpartial',
  dotNHred: 'rsNHred',
  dotNL: 'rsNL',
})
/** The Mansfield cross dot fires on a cross UP only, at 0 (visual round 2026-11-07, spec A2). */
const MANSFIELD_DOT_TO_EVENTS = Object.freeze({
  dotMansfieldCross: ['mansfieldCrossUp'],
})
/** Which fixture each LINE plot's column lives in. */
const LINE_FIXTURE = Object.freeze({ rsLine: 'rs_events_default', rsAbove: 'rs_events_default', rsMa: 'rs_events_default', mansfield: 'rs_mansfield' })

const isEvent = (v) => v === null || v === 0 || v === 1

describe('rs_events_default — the shared RS event fixture, read by the JS lane as a contract', () => {
  const c = loadCase('rs_events_default')
  const m = loadCase('rs_mansfield')
  const def = getDefinition('rsLine')
  const bars = c.bars
  const exp = c.expected

  it('is the two-series shape: own bars, a benchmarkBars sibling, 18 aligned columns', () => {
    expect(c.case).toBe('rs_events_default')
    expect(c.kind).toBe('rs_events')
    expect(Array.isArray(bars) && bars.length).toBeGreaterThan(40)
    expect(Array.isArray(c.benchmarkBars)).toBe(true)
    expect(c.barsFrom).toBeUndefined()
    expect(Object.keys(exp).length).toBe(18)
    for (const [key, col] of Object.entries(exp)) {
      expect(Array.isArray(col), key).toBe(true)
      expect(col.length, `${key} not aligned to bars`).toBe(bars.length)
    }
    // Every column the definition's dot pairing names is present, both sides.
    for (const [dot, ev] of Object.entries(DOT_TO_EVENT)) {
      expect(exp, `fixture lacks ${dot}`).toHaveProperty(dot)
      expect(exp, `fixture lacks ${ev}`).toHaveProperty(ev)
    }
  })

  it('every MARKER plot of the rsLine definition names a dot column the fixture covers — by name', () => {
    expect(def && def.id).toBe('rsLine')
    expect(def.compute.kind).toBe('server')
    expect(SERVER_DEFS.map(d => d.id)).toContain('rsLine')
    const markers = def.plots.filter(p => p.style === 'markers')
    expect(markers.length, 'the definition draws no dots at all').toBeGreaterThan(0)
    for (const p of markers) {
      // 🔴 A new marker plot without a fixture column is a dot with no oracle.
      const inMansfield = Object.prototype.hasOwnProperty.call(MANSFIELD_DOT_TO_EVENTS, p.key)
      expect(DOT_TO_EVENT[p.key] || inMansfield,
        `marker plot "${p.key}" has no dot → event pairing in rsIndicator.golden.test.js — `
        + 'add the pairing AND the fixture columns before shipping the dot').toBeTruthy()
      if (inMansfield) {
        expect(m.expected, `marker plot "${p.key}" names a column rs_mansfield.json does not carry`).toHaveProperty(p.key)
        for (const ev of MANSFIELD_DOT_TO_EVENTS[p.key]) expect(m.expected, `event "${ev}" is not in rs_mansfield.json`).toHaveProperty(ev)
      } else {
        expect(exp, `marker plot "${p.key}" names a column rs_events_default.json does not carry`)
          .toHaveProperty(p.key)
        expect(exp, `marker plot "${p.key}"'s event column "${DOT_TO_EVENT[p.key]}" is not in the fixture`)
          .toHaveProperty(DOT_TO_EVENT[p.key])
      }
      // …and a dot rides the line. TWO renderers draw a `markers` plot (review fix
      // unit 6): a GLYPH (`plots[].marker`) sits at the plotted value only as
      // `inBar`; a plot WITHOUT a marker block draws the series' own point markers,
      // which sit at the plotted value by construction — the column IS the series
      // data (`pool.seriesOptionsForPlot`: `pointMarkersVisible`, radius = `width`).
      if (p.marker) {
        expect(p.marker.position, `glyph plot "${p.key}" must sit ON the line`).toBe('inBar')
      } else {
        expect(Number.isFinite(p.width) && p.width > 0,
          `plain dot plot "${p.key}" needs a positive width — it is the point radius`).toBe(true)
      }
    }
    // The shape unit 6 landed, grown by 2a-14: the small dots are plain, the two
    // large ones glyphs, and the Mansfield cross dot is PLAIN because its value
    // may be ≤ 0. Visual round A3: the red-day glyph carries NO text (platform §7)
    // and is declared before the before-price glyph, so gold paints on top.
    expect(markers.map(p => [p.key, p.marker ? 'glyph' : 'point'])).toEqual([
      ['dotNH', 'point'], ['dotNHred', 'glyph'], ['dotNHbeforePx', 'glyph'],
      ['dotNHpartial', 'point'], ['dotNL', 'point'], ['dotMansfieldCross', 'point'],
    ])
    // L1 (2026-11-07): both large glyphs are size 1.6 (13 px at the floor), was 2.0
    expect(def.plots.find(p => p.key === 'dotNHred').marker).toEqual({ shape: 'circle', position: 'inBar', size: 1.6 })
  })

  it('every LINE plot of the definition names an expected column', () => {
    const lines = def.plots.filter(p => p.style === 'line')
    // `rsAbove` is the HIDDEN 0/1 condition that colours the line (unit 5); it is
    // a line plot by declaration and a column in the fixture like the others.
    // `mansfield` (2a-14) is the Trend preset's line and lives in rs_mansfield.json.
    expect(lines.map(p => p.key)).toEqual(['rsLine', 'rsAbove', 'rsMa', 'mansfield'])
    for (const p of lines) {
      const fx = LINE_FIXTURE[p.key]
      expect(fx, `line plot "${p.key}" has no fixture in LINE_FIXTURE`).toBeDefined()
      const e = fx === 'rs_mansfield' ? m.expected : exp
      expect(e, `line plot "${p.key}" is not in ${fx}.json`).toHaveProperty(p.key)
      expect(e[p.key].some(Number.isFinite), `${p.key} is entirely null`).toBe(true)
    }
    // No plot style this test does not know how to pair. The one `hlines` plot is
    // the Mansfield zero guide (visual round A2): static, so it returns no column.
    for (const p of def.plots) expect(['line', 'markers', 'hlines'], `plot "${p.key}" style ${p.style}`).toContain(p.style)
    expect(def.plots.filter(p => p.style === 'hlines').map(p => [p.key, p.levels])).toEqual([['mansfieldZero', [0]]])
  })

  it('events are {0, 1, null} and each one FIRES; dots are finite EXACTLY where their event is 1 and equal rsLine there', () => {
    const eventKeys = ['rsAbove', 'rsNH', 'rsNHpartial', 'pxNH', 'rsNHbeforePx', 'rsNHred',
      'rsNL', 'gor', 'rog', 'crossUp', 'crossDown']
    for (const key of eventKeys) {
      exp[key].forEach((v, i) => expect(isEvent(v), `${key}[${i}] = ${v}`).toBe(true))
      expect(exp[key].includes(1), `${key} never fires — it pins nothing`).toBe(true)
      expect(exp[key].includes(0), `${key} is never 0`).toBe(true)
    }
    for (const [dot, ev] of Object.entries(DOT_TO_EVENT)) {
      let fired = 0
      exp[dot].forEach((d, i) => {
        if (exp[ev][i] === 1) {
          expect(d, `${dot}[${i}] must be the RS value`).toBe(exp.rsLine[i])
          expect(Number.isFinite(d) && d > 0, `${dot}[${i}] = ${d} is not a drawable dot`).toBe(true)
          fired += 1
        } else {
          expect(d, `${dot}[${i}] = ${d} where ${ev} is ${exp[ev][i]}`).toBeNull()
        }
      })
      expect(fired, `${dot} never draws`).toBeGreaterThan(0)
    }
    // The three "new high" dots are THREE different columns on this fixture.
    expect(exp.dotNH).not.toEqual(exp.dotNHbeforePx)
    expect(exp.dotNHbeforePx).not.toEqual(exp.dotNHpartial)
    expect(exp.dotNH).not.toEqual(exp.dotNHpartial)
    // And the tie row the fixture pins: bar 25's rs equals the prior max and is a dot.
    expect(exp.rsLine[25]).toBe(Math.max(...exp.rsLine.slice(0, 25).filter(Number.isFinite)))
    expect(exp.rsNH[25]).toBe(1)
    expect(exp.dotNH[25]).toBe(exp.rsLine[25])
  })

  it('the gap bar is null in every rs-derived column — and pxNH, price-only, is not', () => {
    const benchT = new Set(c.benchmarkBars.map(b => b.t))
    const gaps = bars.map((b, i) => (benchT.has(b.t) ? -1 : i)).filter(i => i >= 0)
    expect(gaps.length).toBe(1)
    const gap = gaps[0]
    expect(gap).toBeGreaterThan(0)
    for (const key of Object.keys(exp)) {
      if (key === 'pxNH') expect(exp[key][gap], 'pxNH reads price alone').not.toBeNull()
      else expect(exp[key][gap], `${key}[${gap}] invented a value across the gap`).toBeNull()
    }
    // the hole in rsLine is EXACTLY the gap — in the middle, not a head pad
    expect(exp.rsLine.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0)).toEqual([gap])
    // the windowed events stay null for `lookback` bars and then RESUME
    const lb = c.params.lookback
    for (let i = gap + 1; i <= gap + lb; i++) {
      for (const key of ['rsNH', 'rsNL', 'rsNHbeforePx', 'rsNHred']) {
        expect(exp[key][i], `${key}[${i}] answered with the gap in its window`).toBeNull()
      }
    }
    for (const key of ['rsNH', 'rsNL', 'rsNHbeforePx', 'rsNHred']) {
      expect(exp[key][gap + lb + 1], `${key} did not resume`).not.toBeNull()
    }
  })

  it('columnsFromWire + alignColumns reproduce every fixture column on the chart\'s bars (null → NaN), BY TIME', () => {
    // The envelope the server lane sends: positional arrays beside `times`.
    const wire = { times: bars.map(b => b.t), columns: exp, rev: def.compute.rev }
    const parsed = columnsFromWire(wire)
    expect(parsed.rev).toBe(def.compute.rev)
    expect(Object.keys(parsed.columns).sort()).toEqual(Object.keys(exp).sort())
    const aligned = alignColumns(parsed, bars)
    expect(Object.keys(aligned).sort()).toEqual(Object.keys(exp).sort())
    for (const key of Object.keys(exp)) {
      const col = aligned[key]
      expect(col).toBeInstanceOf(Float64Array)
      expect(col.length, `${key} not aligned to bars`).toBe(bars.length)
      exp[key].forEach((e, i) => {
        if (e === null) expect(Number.isNaN(col[i]), `${key}[${i}]: expected the NaN pad, got ${col[i]}`).toBe(true)
        else expect(col[i], `${key}[${i}]`).toBe(e)
      })
    }

    // 🔴 BY TIME, NOT BY INDEX. Drop the chart's first bar and reverse the rest:
    // every value must follow its bar, so the same `(t → value)` map holds.
    const shuffled = bars.slice(1).reverse()
    const realigned = alignColumns(parsed, shuffled)
    const byT = new Map(bars.map((b, i) => [b.t, i]))
    for (const key of Object.keys(exp)) {
      shuffled.forEach((b, j) => {
        const e = exp[key][byT.get(b.t)]
        if (e === null) expect(Number.isNaN(realigned[key][j]), `${key}@${b.t}`).toBe(true)
        else expect(realigned[key][j], `${key}@${b.t}`).toBe(e)
      })
    }
    // A chart bar the server never saw is NaN, never a neighbour's value.
    const stranger = [...bars, { ...bars[bars.length - 1], t: bars[bars.length - 1].t + 86400 }]
    const withStranger = alignColumns(parsed, stranger)
    expect(Number.isNaN(withStranger.rsLine[stranger.length - 1])).toBe(true)
  })

  it('single symbol: computeRSLine(bars, bars) is 1.0 everywhere, and against the benchmark it IS the fixture\'s rsLine', () => {
    // The failure mode `rs_line_spy` names (a native could only divide the
    // chart's closes by themselves), restated on this fixture's bars.
    const flat = computeRSLine(bars, bars).map(p => p.value)
    expect(flat).toEqual(bars.map(() => 1))
    // …and the one RS compute this lane has agrees with the Python lane's
    // `rsLine` column at the fixture's tolerance, hole included.
    const got = computeRSLine(bars, c.benchmarkBars).map(p => p.value)
    expect(got.length).toBe(exp.rsLine.length)
    exp.rsLine.forEach((e, i) => {
      if (e === null) { expect(Number.isNaN(got[i]), `rsLine[${i}]`).toBe(true); return }
      expect(Math.abs(got[i] - e) <= c.relTol * Math.max(1, Math.abs(e)), `rsLine[${i}]: ${got[i]} != ${e}`).toBe(true)
    })
    const real = exp.rsLine.filter(Number.isFinite)
    expect(new Set(real.map(v => v.toFixed(12))).size, 'the fixture\'s RS line is constant').toBeGreaterThan(10)
    // No benchmark at all is the NaN pad, never a 1.0 stand-in.
    expect(computeRSLine(bars, []).map(p => p.value).every(Number.isNaN)).toBe(true)
  })

  it('the fixture\'s params are the definition\'s own input vocabulary, inside its declared ranges', () => {
    // snake_case in the file (per _schema.md); the keys map onto the definition's
    // inputs, and the values sit inside the ranges the definition declares, so
    // the server could not have clamped them (a clamped fixture pins the clamp).
    const map = {
      lookback: 'lookback', ma_length: 'maLength', ma_type: 'maType',
      price_tolerance_pct: 'priceTolerance', red_day_pct: 'redDayThreshold',
    }
    expect(Object.keys(c.params).sort()).toEqual(Object.keys(map).sort())
    const input = (k) => def.inputs.find(i => i.key === k)
    for (const [snake, camel] of Object.entries(map)) {
      const inp = input(camel)
      if (!inp) {
        // The ONE input the Phase 1 definition does not expose as a control: the
        // red-day threshold is server-side (`serverInputs` names it; no dialog
        // row yet). Anything else missing is a drifted vocabulary.
        expect(camel, `definition has no input ${camel}`).toBe('redDayThreshold')
        expect(def.meta.serverInputs).toContain('redDayThreshold')
        continue
      }
      if (inp.type === 'enum') expect(inp.options.map(o => o[0])).toContain(c.params[snake])
      else {
        expect(c.params[snake]).toBeGreaterThanOrEqual(inp.min)
        expect(c.params[snake]).toBeLessThanOrEqual(inp.max)
      }
    }
    expect(c.params.lookback).toBe(25)
    expect(c.params.red_day_pct).toBe(-0.5)
  })
})

describe('rs_mansfield — the Mansfield fixture, read by the JS lane as the contract for the Trend plots (2a-14)', () => {
  const m = loadCase('rs_mansfield')
  const def = getDefinition('rsLine')
  const exp = m.expected

  it('carries the three wire columns the definition draws beside the three it does not', () => {
    expect(m.kind).toBe('rs_mansfield')
    for (const key of ['mansfield', 'mansfieldCrossUp', 'mansfieldCrossDown', 'dotMansfieldCross']) {
      expect(exp, `fixture lacks ${key}`).toHaveProperty(key)
      expect(exp[key].length, `${key} not aligned to bars`).toBe(m.bars.length)
    }
    // the two the chart does not draw stay in the file for the screener's rails
    expect(exp).toHaveProperty('mansfieldState')
    expect(exp).toHaveProperty('mansfieldCrossBarsAgo')
  })

  it('the cross dot sits at 0 EXACTLY where a cross UP is 1 and nowhere else (crosses down draw no dot)', () => {
    let fired = 0
    exp.dotMansfieldCross.forEach((d, i) => {
      if (exp.mansfieldCrossUp[i] === 1) {
        expect(d, `dotMansfieldCross[${i}] must sit on the zero line`).toBe(0)
        fired += 1
      } else {
        expect(d, `dotMansfieldCross[${i}] = ${d} where no cross up fired`).toBeNull()
      }
    })
    expect(fired).toBe(1)                       // bar 43 (the Python lane's pin)
    expect(exp.mansfieldCrossDown.includes(1), 'the fixture still carries crosses down').toBe(true)
    // …and the dot plot is a PLAIN markers plot (a glyph refuses values <= 0).
    const plot = def.plots.find(p => p.key === 'dotMansfieldCross')
    expect(plot.marker).toBeUndefined()
    expect(plot.style).toBe('markers')
    expect(plot.width).toBe(2)
  })

  it('columnsFromWire + alignColumns reproduce the Mansfield columns on the chart\'s bars, null → NaN', () => {
    const cols = { mansfield: exp.mansfield, mansfieldCrossUp: exp.mansfieldCrossUp,
      mansfieldCrossDown: exp.mansfieldCrossDown, dotMansfieldCross: exp.dotMansfieldCross }
    const parsed = columnsFromWire({ times: m.bars.map(b => b.t), columns: cols, rev: def.compute.rev })
    expect(parsed.rev).toBe(3)
    const aligned = alignColumns(parsed, m.bars)
    for (const key of Object.keys(cols)) {
      exp[key].forEach((e, i) => {
        if (e === null) expect(Number.isNaN(aligned[key][i]), `${key}[${i}]`).toBe(true)
        else expect(aligned[key][i], `${key}[${i}]`).toBe(e)
      })
    }
  })

  it('the fixture\'s length sits inside the definition\'s declared Mansfield range', () => {
    const inp = def.inputs.find(i => i.key === 'mansfieldLength')
    expect(m.params.length).toBeGreaterThanOrEqual(inp.min)
    expect(m.params.length).toBeLessThanOrEqual(inp.max)
    expect(def.meta.serverInputs).toContain('mansfieldLength')
    expect(def.meta.serverInputs).toContain('showMansfield')
  })
})
