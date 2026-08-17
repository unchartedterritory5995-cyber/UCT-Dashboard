// app/src/components/chart/engine/__tests__/legendProbe.js
//
// ─── READING THE CROSSHAIR LEGEND, POLLED TO STABILITY, NEVER SLEPT ─────────
//
// ⛔ A FLAKY TEST IS A DEFECT, AND ON THIS BRANCH IT IS A LOAD-BEARING ONE.
// Every legend case is a gate the pixel harness CANNOT replace — a headless
// capture has no cursor, so no chip is drawn on either side and the diff is 0
// whichever way the readout behaves. An intermittently passing gate is worse
// than a missing one: it reads as evidence.
//
// ⚠️ THIS FILE EXISTS BECAUSE B4 TASK 10 NEEDED THE SAME READ IN A SECOND SUITE.
// It was `stockChartWiring.test.jsx`'s private helper, under seventeen
// assertions and carrying four measured lessons; a second copy in
// `legendFromDefinitions.test.jsx` would have been exactly the twin this phase
// retires, in the middle of the task that retires the legend's own. One
// implementation, two suites — and `stockChartWiring.test.jsx` keeps the four
// cases that drive THIS code against a view whose text is still moving, which is
// the only place its stability rule is falsifiable at all.
//
// The four lessons, all measured on this branch and all still encoded here:
//
//   1. NEVER `setTimeout(40)` AND COMPARE. The legend coalesces through rAF and
//      jsdom gives no guarantee about how many frames a 40 ms real timer
//      outlives on a loaded box. B3 Task 8 watched a case pass alone, pass in
//      the chart selection, then fail once in a full 400-file run.
//   2. "IT RENDERED AT ALL" IS NOT ENOUGH TO POLL ON. The container also carries
//      the live-price header and a "⟳ RECONNECTING" banner, so two reads can
//      both hold the OHLC row while holding different amounts of unrelated
//      chrome.
//   3. READ THE LEGEND ELEMENT, NOT THE CONTAINER. With every read polled to
//      stability the VWAP case still failed roughly one full-suite run in two,
//      on a WALL CLOCK in the export footer — `…EXT01:4[2]` vs `…EXT01:4[1]`.
//      `chart_parity.py` freezes that same stamp for exactly this reason.
//   4. DELIVER TO EVERY SUBSCRIBER. StockChart registers TWO crosshair handlers
//      on one chart — the legend's and the hovered-bar recorder's — so
//      `crosshairHandlers.at(-1)` delivers to the one that never touches the
//      legend, and every assertion then reads a legend nothing asked to update.

import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { act } from '@testing-library/react'
import { expect } from 'vitest'

// `__tests__` → engine → chart → components → src → app → the repo root.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..')

/**
 * Force `legendMode: 'always'` onto a settings blob.
 *
 * ⭐ WHY EVERY LEGEND SUITE NOW CALLS THIS. The shipped DEFAULT is `'click'`
 * (`legendMode.js::DEFAULT_LEGEND_MODE`, owner call 2026-08-16): a chart draws no
 * legend until a candle is clicked. The suites below are about what the legend
 * CONTAINS — nine chips, their order, their formatting — not about when the box
 * appears, so they have to say out loud that they want it on. Sixty cases went
 * red the moment the default moved, and that is the correct signal: a test that
 * hovers and reads a legend depends on the visibility policy whether or not it
 * mentions it.
 *
 * ⛔ NOT A MOCK OF `legendModeOf`. Stubbing the resolver would make these suites
 * blind to a real regression in it; this writes an ordinary settings value that
 * the real resolver then reads, exactly as a user choosing "Always" would.
 * Visibility itself is gated by `legendModes.test.jsx`, which owns that question.
 *
 * A `null`/absent blob becomes a partial override carrying only the mode —
 * `header` is in `_OVERRIDE_SECTION_KEYS`, so it merges rather than replacing.
 */
export function legendAlways(cs) {
  return { ...(cs || {}), header: { ...((cs && cs.header) || {}), legendMode: 'always' } }
}

/** The OHLC row — i.e. the legend exists at all. */
export const LEGEND_RENDERED = /O\s*1/
const SETTLE_TRIES = 60
const SETTLE_MS = 20

/**
 * The LEGEND's text — deliberately NOT the container's (lesson 3).
 *
 * The `O 1.00` span's PARENT is the legend row, and the indicator chips are its
 * siblings in all three legend variants (flat, stacked and default), so every
 * chip a case asserts on is inside it and the header, the feed banner and the
 * footer clock are not. No fallback to the container: a missing legend must fail
 * the `ready` predicate and throw, not quietly widen the read back to the clock.
 */
export function legendTextOf(view) {
  const o = [...view.container.querySelectorAll('span')]
    .find(s => /^O\s/.test(s.textContent || ''))
  return o && o.parentElement ? o.parentElement.textContent : ''
}

/**
 * Deliver one crosshair event to EVERY subscriber, repeatedly, until the
 * rendered text stops changing; return that settled text.
 *
 * @param view      anything with a `container`
 * @param param     the crosshair event to deliver
 * @param handlers  the captured `subscribeCrosshairMove` callbacks — ALL of them
 * @param ready     predicate the settled text must ALSO satisfy, so a stable
 *                  EMPTY string is never mistaken for a settled legend
 */
export async function settledLegend(view, param, handlers, ready = LEGEND_RENDERED) {
  expect(handlers.length,
    'nothing subscribed to crosshairMove — this test is vacuous').toBeGreaterThan(0)
  let text = legendTextOf(view)
  for (let i = 0; i < SETTLE_TRIES; i++) {
    // Sequential on purpose: each read must observe the DOM the PREVIOUS
    // dispatch settled into, so these cannot be awaited in parallel.
    await act(async () => {
      for (const fn of [...handlers]) fn(param)
      await new Promise(r => setTimeout(r, SETTLE_MS))
    })
    const prev = text
    text = legendTextOf(view)
    if (prev === text && ready.test(text)) return text
  }
  throw new Error(
    'the legend never settled to two identical reads — the comparison would be a race',
  )
}

/**
 * The text between two literal markers, or a NAMED throw.
 *
 * A source-reading gate that silently matches nothing is worse than no gate, so
 * a marker that has moved fails LOUDLY and says which one — never "0 slots
 * unread, all good".
 */
export function between(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker)
  if (a < 0) throw new Error(`marker moved: ${JSON.stringify(startMarker)} is no longer in the source read`)
  const b = src.indexOf(endMarker, a + startMarker.length)
  if (b < 0) throw new Error(`marker moved: ${JSON.stringify(endMarker)} does not follow ${JSON.stringify(startMarker)}`)
  return src.slice(a + startMarker.length, b)
}

// ─── THE SHIPPED NINE, PARSED — NEVER HAND-COPIED ───────────────────────────
//
// ⛔ A HAND-TYPED EXPECTATION IS THE DEFECT THIS FILE ALREADY SHIPPED ONCE. The
// slot rail these cases replace compared one hand-written map against a second
// hand-written list; deleting the ATR row from the legend left 956 chart tests
// green. So the pre-B4 `legChips` array is read out of the artifact — `git show
// d2733adc:…/StockChart.jsx` — and every expectation below is derived from it.
//
// ⚠️ IT THROWS BY NAME rather than degrading. A parse that finds no rows, or a
// row it cannot read, is a BROKEN GATE and says so; nine is asserted at the call
// site. `d2733adc` is B3's tip: `legChips` is byte-identical from there to the
// commit this task starts from, and pinning a REVISION rather than the working
// file is what stops the pin moving with the thing it pins.
const PRE_B4_REV = 'd2733adc'
/** `'<defId>::<plotKey>'` → the row's LABEL, PRECISION and default COLOUR.
 *
 *  The `crosshairData` field names are the retired bridge (`LEGACY_SLOTS`); they
 *  survive HERE, in a test, purely to align a parsed row with the definition plot
 *  that replaced it. They are not a production table any more. */
const SHIPPED_FIELD_TO_PLOT = {
  rsi: 'rsi::rsi',
  macd: 'macd::macd',
  macdSig: 'macd::signal',
  stochK: 'stoch::k',
  stochD: 'stoch::d',
  atr: 'atr::atr',
  sar: 'sar::sar',
  ichimokuTenkan: 'ichimoku::tenkan',
  ichimokuKijun: 'ichimoku::kijun',
}

let _shippedCache = null
export function shippedLegendChips() {
  if (_shippedCache) return _shippedCache
  let src
  try {
    src = execFileSync('git', ['show', `${PRE_B4_REV}:app/src/components/StockChart.jsx`],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    throw new Error(
      `shippedLegendChips: could not read ${PRE_B4_REV}:app/src/components/StockChart.jsx via git — ` +
      'this gate derives the nine shipped chips from that revision and must not fall back to a ' +
      `hand-typed list. (${err && err.message})`)
  }
  const region = between(src, 'const legChips = [', '].filter(Boolean)')
  const out = {}
  for (const line of region.split('\n')) {
    const m = line.match(
      /crosshairData\.(\w+) != null && chip\('[^']+', '\w+', [^,]*\|\| '(#[0-9a-fA-F]{3,8})',\s*`(.*)`\),?\s*$/)
    if (!m) continue
    const [, field, color, template] = m
    const plot = SHIPPED_FIELD_TO_PLOT[field]
    if (!plot) throw new Error(`shippedLegendChips: row for crosshairData.${field} names no known plot`)
    const dec = template.match(/\.toFixed\((\d+)\)/)
    if (!dec) throw new Error(`shippedLegendChips: the ${field} row declares no toFixed() precision`)
    // The label is everything before the value interpolation, with any
    // `${… || N}` default (RSI's and ATR's period) resolved to N.
    const label = template
      .replace(/\s*\$\{crosshairData\.\w+\.toFixed\(\d+\)\}\s*$/, '')
      .replace(/\$\{[^}]*\|\|\s*(\d+)\s*\}/g, '$1')
    if (!label || /[$`{}]/.test(label)) {
      throw new Error(`shippedLegendChips: could not resolve a literal label for ${field} (got ${JSON.stringify(label)})`)
    }
    out[plot] = { field, label, decimals: Number(dec[1]), color }
  }
  const n = Object.keys(out).length
  if (n !== 9) {
    throw new Error(
      `shippedLegendChips: parsed ${n} rows out of ${PRE_B4_REV}'s legChips, expected 9. ` +
      'The parser has rotted against the revision it pins — fix it, do not lower the number.')
  }
  _shippedCache = out
  return out
}
