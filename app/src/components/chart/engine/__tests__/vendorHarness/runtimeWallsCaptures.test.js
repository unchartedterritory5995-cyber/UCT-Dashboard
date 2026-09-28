// app/src/components/chart/engine/__tests__/vendorHarness/runtimeWallsCaptures.test.js
//
// ─── THE FIVE CAPTURE-QUEUE QUESTIONS, ANSWERED BY TRADINGVIEW (2026-09-27) ───
//
// `docs/pine/capture-queue-runtime-walls-2026-09-27.md` queued five semantics this engine had
// been refusing or guessing. Each was captured live, its probe source byte-identical
// to the probe committed at 0543ef03e, and the runtime lane now follows the answers
// that apply to it:
//
//   Q2  `x[na]` reads `x[0]` — 158 of 158 `na` bars (`dyn-history-na`)
//   Q3  a NEGATIVE offset STOPS the study with a runtime error (no capture: the
//       vendor draws nothing; its exact error text was NOT recorded — see the
//       queue doc — so no assertion here quotes it)
//   Q4  run-time offsets over a mutable variable, with and without
//       `max_bars_back` — the control matches on every bar (`dyn-history`,
//       `dyn-history-nomaxbars`)
//   Q5  array statistics SKIP `na` (`[1, na, 3]` → max 3, min 1, sum 4, avg 2) and
//       `max`/`avg` of an EMPTY array are `na` (`array-stats-na`)
//
// ⭐ Every rail here compares the runtime lane's column to the vendor's value on
// EVERY bar, read straight off the capture (a bar with no study-store row is `na`).
//
// Q1 (pivot ties) is the one answer the runtime lane does NOT follow yet: it moves
// the host lane, the Python twin and frozen digests, so it is ruling R1 and is
// railed below as VENDOR EVIDENCE only — the facts the ruling must match.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { runOurSide } from './ourSide'
import { HARNESS_DIR } from './harness'

afterEach(() => { vi.unstubAllEnvs() })

const load = (name) => JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, name), 'utf8'))

function vendorValues(capture, title) {
  const plot = capture.study.plots.filter((p) => (p.title || p.name) === title)
  expect(plot.length, `vendor title ${title}`).toBe(1)
  const col = capture.plotValues.fields.indexOf(plot[0].id)
  const byTime = new Map(capture.plotValues.rows.map((r) => [r[0], r[col]]))
  return capture.bars.rows.map((b) => {
    const v = byTime.get(b[0])
    return v === null || v === undefined ? NaN : v
  })
}

const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9

function disagreements(ours, theirs) {
  const bad = []
  for (let i = 0; i < theirs.length; i += 1) {
    if (!same(ours[i], theirs[i])) bad.push({ bar: i, ours: ours[i], theirs: theirs[i] })
    if (bad.length >= 5) break
  }
  return bad
}

function runtimeRun(file) {
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
  const capture = load(file)
  expect(validateCapture(capture).ok, `${file} failed validation`).toBe(true)
  const ours = runOurSide(capture, { lane: 'runtime' })
  expect(ours.ok, ours.refusal).toBe(true)
  return { capture, ours }
}

describe('⭐ Q2/Q4/Q5 — the runtime lane agrees with TradingView on every bar', () => {
  for (const file of [
    'rtwalls-dyn-history-rddt-1d-2026-09-27.json',
    'rtwalls-dyn-history-nomaxbars-rddt-1d-2026-09-27.json',
    'rtwalls-dyn-history-na-rddt-1d-2026-09-27.json',
    'rtwalls-array-stats-na-rddt-1d-2026-09-27.json',
  ]) {
    it(file, () => {
      const { capture, ours } = runtimeRun(file)
      const titles = capture.study.plots.map((p) => p.title)
      // non-vacuity: every probe title is graded, and the capture covers listing day
      expect(titles.length).toBeGreaterThan(1)
      expect(capture.history.startsAtBar0).toBe(true)
      for (const title of titles) {
        const mine = ours.plots.find((p) => p.title === title)
        expect(mine && mine.column, `${title}: no column`).toBeTruthy()
        const theirs = vendorValues(capture, title)
        const bad = disagreements(Array.from(mine.column), theirs)
        expect(bad, `${title} disagrees`).toEqual([])
        // ⛔ a plot the vendor left na everywhere would pass against anything —
        // EXCEPT where `na` IS the answer the probe asks for. Those titles say so
        // (`…EXPECT_na`), and for them the check is the stronger one: the vendor
        // is na on EVERY bar, so an engine that drew anything at all disagrees.
        if (/EXPECT_na/.test(title)) {
          expect(theirs.every(Number.isNaN), `${title}: vendor drew a value`).toBe(true)
        } else {
          expect(theirs.some(Number.isFinite), `${title}: vendor drew nothing`).toBe(true)
        }
      }
      // ⛔ AND A FILE OF NOTHING BUT `na` PROBES WOULD PROVE NOTHING
      expect(titles.some((t) => !/EXPECT_na/.test(t)), `${file}: no finite probe`).toBe(true)
    })
  }
})

describe('⭐ Q2 — an `na` offset reads the current bar (not `na`)', () => {
  it('N02/N03 carry a real value on the `na`-offset bars', () => {
    const { capture } = runtimeRun('rtwalls-dyn-history-na-rddt-1d-2026-09-27.json')
    const theirs = vendorValues(capture, 'N03_close_at_na_on_every_4th_bar_na_or_ERROR')
    const closes = capture.bars.rows.map((r) => r[capture.bars.fields.indexOf('close')])
    const naBars = theirs.map((_, i) => i).filter((i) => i % 4 === 0)
    expect(naBars.length).toBe(158)
    for (const i of naBars) expect(theirs[i], `bar ${i}`).toBeCloseTo(closes[i], 9)
  })
})

// ─── Q1 — pivot ties: VENDOR EVIDENCE for ruling R1 ───────────────────────────
//
// Each probe plot is 1/0 per bar. "Native fires on a tie" is only meaningful where
// the POP (population) plot says a tie of that side exists at the candidate bar.
describe('⛔ Q1 — pivot ties (ruling R1): left side INCLUSIVE, right side STRICT', () => {
  const count = (capture, popTitle, fireTitle) => {
    const pop = vendorValues(capture, popTitle)
    const fire = vendorValues(capture, fireTitle)
    let n = 0; let fired = 0
    for (let i = 0; i < pop.length; i += 1) {
      if (pop[i] === 1) { n += 1; if (fire[i] === 1) fired += 1 }
    }
    return { n, fired }
  }
  it('NYSE:F — a RIGHT-side tie never fires, a LEFT-side tie always does', () => {
    const capture = load('rtwalls-pivot-ties-f-1d-2026-09-27.json')
    expect(validateCapture(capture).ok).toBe(true)
    const right = count(capture, 'N04_POP_right_tie_hi_MUST_sometimes_be_1', 'N05_native_fires_on_right_tie_hi_1_means_INCLUSIVE')
    const left = count(capture, 'N06_POP_left_tie_hi', 'N07_native_fires_on_left_tie_hi_EXPECT_1')
    // non-vacuity: both populations are non-empty on this symbol
    expect(right.n).toBeGreaterThan(0)
    expect(left.n).toBeGreaterThan(0)
    expect(right.fired, `right-tie highs fired ${right.fired} of ${right.n}`).toBe(0)
    expect(left.fired, `left-tie highs fired ${left.fired} of ${left.n}`).toBe(left.n)
    // lows carry no POP column: -2 is the "not evidence" sentinel, 0/1 is evidence
    const evidence = (title) => {
      const xs = vendorValues(capture, title).filter((v) => v === 0 || v === 1)
      return { n: xs.length, fired: xs.filter((v) => v === 1).length }
    }
    const rightLo = evidence('N08_native_fires_on_right_tie_lo_1_means_INCLUSIVE')
    const leftLo = evidence('N09_native_fires_on_left_tie_lo_EXPECT_1')
    expect(rightLo.n).toBeGreaterThan(0)
    expect(leftLo.n).toBeGreaterThan(0)
    expect(rightLo.fired, `right-tie lows fired ${rightLo.fired} of ${rightLo.n}`).toBe(0)
    expect(leftLo.fired, `left-tie lows fired ${leftLo.fired} of ${leftLo.n}`).toBe(leftLo.n)
  })
})
