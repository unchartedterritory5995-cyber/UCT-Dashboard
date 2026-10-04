// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h5MulticatorValues.test.js
//
// ─── H5 (step 84) — multicator-table's VALUES, on the vendor's own bars ─────────
//
// multicator-table's drawings stay withheld by name (`pine:object-removal-lost`,
// F3): its HUD loses list pushes, and nothing smaller than the whole program
// would MATCH. But 43 of its 60 table cells were also unreadable as VALUES — they
// print `str.tostring(math.round_to_mintick(x))` or `str.tostring(x,
// format.volume)`. H5 makes the host lane read both. This rail grades them
// against the capture without waiting on the HUD: a probe that prints the SAME
// expressions into its own table is run through the member door on the
// capture's own bars (the receipt re-sealed over the probe's text), and each
// cell must be the text TradingView printed in multicator's table.
//
// ⭐ What is compared is the vendor's text for the vendor's expression on the
// vendor's bars — `open`, `close`, `ta.sma(close, 50|100|200)`, `ta.ema(close,
// 50)`, `ta.rsi(close, 14)`, `ta.atr(14)` (multicator's defaults, preset Manual),
// each a top-level series printed in a cell on the last bar, multicator's own shape.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, HARNESS_DIR } from './harness'
import { runOurSide } from './ourSide'
import { sha256Hex, sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'

afterEach(() => { vi.unstubAllEnvs() })
const cap = (sym) => loadCapture(path.join(HARNESS_DIR, `multicator-table-${sym}-1d-2026-10-02.json`)).capture

/** [the series, how the cell prints it, RDDT's text, SPY's text] — each text read
 *  off the capture's own `objects.texts.tableCells` (asserted present below). */
const MINTICK = (v, r, s) => [v, 'str.tostring(math.round_to_mintick(V))', r, s]
const MINTICK_CELLS = [
  MINTICK('open', '149.78', '770.58'),
  MINTICK('close', '147.86', '769.64'),
  MINTICK('ta.sma(close, 50)', '156.32', '763.7'),
  MINTICK('ta.sma(close, 100)', '164.9', '754.38'),
  MINTICK('ta.sma(close, 200)', '168.55', '720.47'),
  MINTICK('ta.ema(close, 50)', '156.69', '761.61'),
  MINTICK('ta.rsi(close, 14)', '45.61', '54.54'),
  MINTICK('ta.atr(14)', '7.61', '6.77'),
]

function multicatorProbe(cells) {
  return [
    '//@version=6',
    "indicator('Multicator Table', overlay = true)",
    ...cells.map(([value], i) => `v${i} = ${value}`),
    `var table t = table.new(position.top_right, 1, ${cells.length})`,
    'if barstate.islast',
    ...cells.map(([, text], i) => `    table.cell(t, 0, ${i}, ${text.replace('V', `v${i}`)})`),
    '',
  ].join('\n')
}
function cellsThroughTheDoor(capture, cells) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const text = multicatorProbe(cells)
  const ours = runOurSide(sealCapture({ ...capture, source: { ...capture.source, text, sha256: sha256Hex(text) } }))
  expect(ours.ok, ours.refusal).toBe(true)
  expect(ours.objects && ours.objects.ok, JSON.stringify(ours.objects)).toBe(true)
  return ours.objects.texts.tableCells
}

describe('⭐ H5 — `math.round_to_mintick` in multicator-table\'s cells', () => {
  it.each([['rddt', 2], ['spy', 3]])('vendor: %s — every expected text is one of the capture\'s own table cells', (sym, col) => {
    const texts = cap(sym).objects.texts.tableCells
    for (const row of MINTICK_CELLS) expect(texts, row[0]).toContain(row[col])
  })

  it.each([['rddt', 2], ['spy', 3]])('⭐ door: %s — the probe\'s cells are TradingView\'s text, cell for cell', (sym, col) => {
    expect(cellsThroughTheDoor(cap(sym), MINTICK_CELLS)).toEqual(MINTICK_CELLS.map((r) => r[col]))
  })

  it('⛔ CONTROL: without the tick (a plain `math.round`) the cells are NOT the vendor\'s', () => {
    const plain = MINTICK_CELLS.map(([v, t, r, s]) => [v, t.replace('math.round_to_mintick(', 'math.round('), r, s])
    const got = cellsThroughTheDoor(cap('rddt'), plain)
    expect(got.length).toBe(MINTICK_CELLS.length)
    expect(got).not.toEqual(MINTICK_CELLS.map((r) => r[2]))
  })
})

/** `str.tostring(x, format.volume)` — RDDT from the listing, SPY not. */
const VOLUME = (v, r, s) => [v, 'str.tostring(V, format.volume)', r, s]
const VOLUME_CELLS = [VOLUME('volume', '3.126M', '46.335M'), VOLUME('ta.obv', '-29.984M', '10.801B')]

describe('⭐ H5 — `format.volume` in multicator-table cells', () => {
  it.each([['rddt', 2], ['spy', 3]])('vendor: %s — the expected texts are the capture own cells', (sym, col) => {
    const texts = cap(sym).objects.texts.tableCells
    for (const row of VOLUME_CELLS) expect(texts, row[0]).toContain(row[col])
  })

  // ⭐ H6 (step 90) re-pinned: `ta.obv` is now served on the host lane
  // (`pine.js::obvLevelTree`), so RDDT — a series FROM THE LISTING — prints
  // TradingView's own OBV text. Was `['3.126M']` (the cell dropped, `ta.obv`
  // unserved). Graded in full by `vendorHarness.h6Obv`.
  it('⭐ door: RDDT (from the listing) — the volume and the OBV print TradingView text', () => {
    expect(cellsThroughTheDoor(cap('rddt'), VOLUME_CELLS)).toEqual(['3.126M', '-29.984M'])
  })

  // ⛔ SPY does not start at the listing: its OBV is TradingView's minus a constant,
  // so the cell is withheld by name (`cum:window`, `interpret.js::cumulativeLevelMask`)
  // — never printed as a different number in the vendor's format.
  it('⭐ door: SPY — the volume prints TradingView text; the OBV is withheld, not drawn wrong', () => {
    expect(cellsThroughTheDoor(cap('spy'), VOLUME_CELLS)).toEqual(['46.335M'])
  })
})

