// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f1Captures.test.js
//
// ─── F1 (step 73) — the CAP round-4 divergences, graded after the fixes ────────
//
// Each case grades a committed TradingView capture through the member door
// (`gradeCapture`, objects pane on), never a hand-built expectation:
//   1. integer division           `vw-int-div-assign-spy-1d`        D01..D05 values
//   4. `not` / `or` over an `na`   `rt3-na-logic{,-v4}-rddt-1d`       B02 / B04 / B05 / B07
//   2. a `var` list off the listing `sonarlab-order-blocks-*-1d`      withheld by name;
//      and its control             `rsi-horizontal-resistance-levels` still MATCH
//   6. a helper called once        `vw-once-ta-helper-{rddt,spy}-1d`  MATCH, 14 labels
//   7. daily `ta.vwap`             `vw-clock-vwap-spy-1d`, `h3-vwap-source-spy-1d`
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { gradeCapture, loadCapture, HARNESS_DIR, VENDOR_DIR } from './harness'
import { runOurSide, HARNESS_DEF_ID } from './ourSide'

const load = (id, dir = HARNESS_DIR) => loadCapture(path.join(dir, `${id}.json`)).capture
afterEach(() => { vi.unstubAllEnvs() })
const grade = (cap) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  return gradeCapture(cap).verdict
}
const item = (v, title) => v.plots.find((p) => p.title === title)
const col = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[at])
}
/** Our column for `title` against the capture's, bar for bar (null = na). */
function disagreements(cap, ours, title) {
  const p = ours.plots.find((x) => x.title === title)
  expect(p && p.column, title).toBeTruthy()
  const tv = col(cap, title)
  const out = []
  Array.from(p.column).forEach((a, i) => {
    const an = a !== a
    const bn = tv[i] === null
    if (an && bn) return
    if (an !== bn || Math.abs(a - tv[i]) > 1e-6) out.push(i)
  })
  return out
}

describe('F1 item 1 — integer division (vw-int-div-assign, AMEX:SPY 1D, v5)', () => {
  const cap = load('vw-int-div-assign-spy-1d-2026-10-02')
  it.each(['D01_input_int_div_assign', 'D02_int_literal_div_assign', 'D03_int_literal_over_int',
    'D04_input_int_over_int', 'D05_int_reassigned_quotient'])('%s: our column is TradingView\'s on every bar', (title) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const ours = runOurSide(cap)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(disagreements(cap, ours, title)).toEqual([])
  })

  it('control: the vendor answers both readings (0.28 and 0), so the rows can tell them apart', () => {
    expect(col(cap, 'D01_input_int_div_assign')[0]).toBe(0.28)
    expect(col(cap, 'D03_int_literal_over_int')[0]).toBe(0)
  })
})

describe('F1 item 4 — `not` / `or` read an na operand as false, from the listing (Q-NL-a/b)', () => {
  for (const id of ['rt3-na-logic-rddt-1d-2026-10-02', 'rt3-na-logic-v4-rddt-1d-2026-10-02']) {
    it.each(['B02_not_naBool', 'B03_naBool_and_true_CONTROL', 'B04_na_of_naBool_or_false',
      'B05_na_of_not_naBool', 'B07_not_naLiteral'])(`${id}: %s agrees on every bar`, (title) => {
      const p = item(grade(load(id)), title)
      // B07 is the constant 1. ⚰️ F8 graded it NOT DRAWN (the pane drew no series for a
      // `hidden (constant)` row); ⭐ H8 — the pane draws it as TradingView does, so every
      // row here MATCHES, B07 included, on value and colour.
      expect(p.stats.valueMismatches + p.stats.naMismatches, p.reason).toBe(0)
      expect(p.verdict, p.reason).toBe('MATCH')
      expect(p.stats.steady.divergent, p.reason).toBe(0)
    })
  }
})

describe('F1 item 2 — a `var` list of drawings off the listing is withheld by name', () => {
  it.each(['spy', 'aapl', 'brk-a'])('sonarlab %s 1D: withheld by name, `objects:off-listing`', (s) => {
    const v = grade(load(`sonarlab-order-blocks-${s}-1d-2026-10-02`))
    expect(v.objects.verdict).toBe('DIVERGE') // a withheld drawing is a gap (F3's rule)
    expect(v.objects.reason).toMatch(/withheld by name \(objects:off-listing\)/)
  })

  it('control: from the listing (RDDT) the same script MATCHes, 5 boxes', () => {
    const v = grade(load('sonarlab-order-blocks-rddt-1d-2026-10-02'))
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  })

  it('⭐ control: a FIFO-capped `var` list that evicted on its own length converges, so it is still drawn (rsi-horizontal SPY 1D MATCH)', () => {
    const v = grade(load('rsi-horizontal-resistance-levels-spy-1d-2026-10-02'))
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  })
})

describe('F1 item 6 — a one-expression helper called from a `barstate.islast` block', () => {
  it.each(['rddt', 'spy'])('vw-once-ta-helper %s: MATCH, 14 labels (T01..T06 and B01..B06 read the same)', (s) => {
    const v = grade(load(`vw-once-ta-helper-${s}-1d-2026-10-02`))
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
    expect(v.objects.counts.find((x) => x.family === 'labels').ours).toBe(14)
  })
})

describe('F1 item 7 — ta.vwap on a daily chart: every daily bar is its own session', () => {
  it('vw-clock-vwap-spy-1d: MATCH on all 16 rows (V07..V10 were blank)', () => {
    const v = grade(load('vw-clock-vwap-spy-1d-2026-09-27', VENDOR_DIR))
    expect(v.verdict, v.reason).toBe('MATCH')
  })

  it('h3-vwap-source-spy-1d (Q-H3a): S01..S08 are TradingView\'s on every bar (S09, a computed source, removed — it refuses by name)', () => {
    const cap = load('h3-vwap-source-spy-1d-2026-10-02')
    const text = cap.source.text.split('\n').filter((l) => !l.includes('S09_')).join('\n')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text } })
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    expect(ours.ok, ours.refusal).toBe(true)
    for (const t of ['S01_vwap_bare_RAW', 'S02_vwap_close_RAW', 'S03_vwap_open_RAW', 'S04_vwap_high_RAW',
      'S05_vwap_low_RAW', 'S06_vwap_hl2_RAW', 'S07_vwap_ohlc4_RAW', 'S08_vwap_hlcc4_RAW']) {
      expect(disagreements(cap, ours, t), t).toEqual([])
    }
  })

  it('⛔ control: off a daily chart the rule is not applied — the 5-minute capture is still the session accumulator', () => {
    const v = grade(load('vw-clock-vwap-spy-5-ext-2026-09-28'))
    for (const t of ['V09_vwap_bare_RAW', 'V10_vwap_hlc3_RAW']) {
      const p = item(v, t)
      if (p) expect(p.verdict, p.reason).not.toBe('DIVERGE')
    }
  })
})
