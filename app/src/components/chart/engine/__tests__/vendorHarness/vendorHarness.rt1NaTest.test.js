// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt1NaTest.test.js
//
// ─── CAP round 4 — Q-NA: what `?:` answers when its TEST is `na` ────────────────
//
// Probes `tools/visual_conformance/probes/rt1-na-test.pine` (v5, as queued),
// `rt1-na-test-v4.pine` (v4: `study(`, `sma` / `cross` without `ta.`) and
// `rt1-na-test-v6.pine` (v6: A05 removed — TradingView refuses `bool b = na` at
// compile time, 27:1), each captured on NYSE:RDDT 1D from the listing (636 bars,
// 2024-03-21 → 2026-10-02) through `tv_capture.js` + the hash-verified clipboard.
//
// ⭐ WHAT TRADINGVIEW ANSWERS (pinned below, all three versions identical):
//   every test shape takes the ELSE branch when the test is `na` — never `na`:
//     A01 `warm > close` (warm = sma 20, na on bars 0..18)  → 2 on bars 0..18
//     A02 `cross(close, warm)` (na operand on bars 0..19)   → 2 on bars 0..19
//     A04 `x[1] > 0` before bar 0                            → 2 on bar 0
//     A05 `bool b = na; b ? 1 : 2` (v4 / v5)                 → 2 on every bar
//
// ⭐ WHAT THE MEMBER DOOR ANSWERS (measured 2026-10-02 on `integrate/wave15` 7008853902,
// objects pane on; runtime pane flag on and off give the same columns):
//   A00 / A01 / A03 / A04  MATCH on all 636 bars, all three versions;
//   A02  DIVERGE bars 0..19 (ours `na`, TradingView 2) — a crossing over an `na`
//        operand is not Pine's `false` on this path;
//   A05  DIVERGE all 636 bars (ours `na`, TradingView 2) on v4 and v5.
// The two DIVERGE rows are `it.fails`: they turn RED the moment the door is fixed, so
// whoever fixes it flips them to `it` in the same commit.
//
// ⭐⭐ F1 (2026-10-02) — FIXED, and flipped. From the listing, a v4+ document reads a
// `?:` whose test is `na` as Pine does (`interpret.js::PINE_TERNARY`, gated by
// `pineTernaryFor`: the listing fact AND `meta.naConditionFalse`, which the member
// door writes from `naConditionIsFalse(version)`). A02 now agrees on all 636 bars of
// all three versions, A05 on all 636 of v4 and v5 (its column; the pane draws no
// series for it because the row is the constant 2 — `hidden (constant)`, the
// pre-existing pane rule for a column that reads no bar). Off the listing the rule
// does not apply (a `NaN` there may be a value behind the curtain): the control
// below grades the same capture with `startsAtBar0` false and still reads `na`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAPS = Object.fromEntries(['v5', 'v4', 'v6'].map((v) => [
  v, loadCapture(path.join(H, `rt1-na-test-${v}-rddt-1d-2026-10-02.json`)).capture,
]))
const SHA = {
  v5: 'e2e0620881a564a27c9218ca9f7a111da953a0a4ddef13306e2cb09de4c62bf7',
  v4: 'b57a832405e975a930129acba75d7d702c6965db113613b0f65b9b1afc3a4202',
  v6: '7152fd8d4498a6fecd0540b7eaa2cd6156259060f71f7965135b241347e76813',
}

afterEach(() => { vi.unstubAllEnvs() })

function tv(cap, title) {
  const plot = cap.study.plots.find((p) => p.title === title)
  const at = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[at])
}

function diffs(v, title) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const cap = CAPS[v]
  const ours = runOurSide(cap)
  expect(ours.ok, ours.refusal).toBe(true)
  const p = ours.plots.find((x) => x.title === title)
  expect(p && p.column, title).toBeTruthy()
  const b = tv(cap, title)
  const out = []
  Array.from(p.column).forEach((a, i) => {
    const an = a !== a
    const bn = b[i] === null
    if (an && bn) return
    if (an !== bn || Math.abs(a - b[i]) > 1e-9) out.push(`#${i} ours ${an ? 'na' : a} tv ${bn ? 'na' : b[i]}`)
  })
  return out
}

describe('CAP round 4 — Q-NA, the captures', () => {
  it.each(['v5', 'v4', 'v6'])('⭐ %s: from the listing, 636 bars, the committed probe', (v) => {
    const cap = CAPS[v]
    expect(cap.history.startsAtBar0).toBe(true)
    expect(cap.bars.count).toBe(636)
    expect(cap.source.sha256).toBe(SHA[v])
    expect(tv(cap, 'A00_bar_index_CONTROL').slice(0, 3)).toEqual([0, 1, 2])
  })

  it.each(['v5', 'v4', 'v6'])('⭐ %s: TradingView takes the ELSE branch on every na test, never na', (v) => {
    const cap = CAPS[v]
    expect(tv(cap, 'A01_cmp_na_test').slice(0, 19)).toEqual(Array(19).fill(2))
    expect(tv(cap, 'A02_cross_na_test').slice(0, 20)).toEqual(Array(20).fill(2))
    expect(tv(cap, 'A04_history_na_test')[0]).toBe(2)
    for (const p of cap.study.plots) expect(tv(cap, p.title).every((x) => x !== null), p.title).toBe(true)
    if (v !== 'v6') expect(new Set(tv(cap, 'A05_na_bool_test'))).toEqual(new Set([2]))
  })

  it('⭐ v6 has no A05: TradingView refuses `bool b = na` at compile time', () => {
    expect(CAPS.v6.study.plots.some((p) => p.title === 'A05_na_bool_test')).toBe(false)
  })
})

describe('CAP round 4 — Q-NA, the member door against it', () => {
  for (const v of ['v5', 'v4', 'v6']) {
    it.each(['A00_bar_index_CONTROL', 'A01_cmp_na_test', 'A03_float_nonzero_control', 'A04_history_na_test'])(
      `⭐ ${v}: %s MATCH on every bar`, (title) => {
        expect(diffs(v, title)).toEqual([])
      })

    it(`⭐ ${v}: A02_cross_na_test MATCH on every bar (F1 — an na test takes the else branch)`, () => {
      expect(diffs(v, 'A02_cross_na_test')).toEqual([])
    })
  }

  for (const v of ['v5', 'v4']) {
    it(`⭐ ${v}: A05_na_bool_test agrees on all 636 bars (F1)`, () => {
      expect(diffs(v, 'A05_na_bool_test')).toEqual([])
    })
  }

  it('⛔ control: OFF the listing the rule does not apply — A02 reads na on exactly bars 0..19', () => {
    // The same capture, its listing fact withdrawn: a `NaN` test there may be a
    // value TradingView holds behind the curtain, so `TERNARY`'s `na` stands.
    const cap = CAPS.v5
    const off = { ...cap, history: { ...cap.history, startsAtBar0: false } }
    const saved = CAPS.v5
    CAPS.v5 = off
    try {
      const d = diffs('v5', 'A02_cross_na_test')
      expect(d.length).toBe(20)
      expect(d[0]).toBe('#0 ours na tv 2')
      expect(d[19]).toBe('#19 ours na tv 2')
    } finally {
      CAPS.v5 = saved
    }
  })
})
