// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.candleNotDrawn.test.js
//
// ─── ⭐ e97 U5 — A CANDLE OUR DOOR DID NOT DRAW IS GRADED BY THE DOOR'S OWN REASON ──────────────────────────────────
//
// `kernel-channel-backquant` writes `plotcandle(..., display = useBarColor ? display.all : display.none)` with
// `useBarColor = input.bool(false, ...)`. The runtime door does not draw that candle, and says why in its note
// ("`Bar Coloring` is not drawn: its `display = unread` is not a place this pane reads"): it withholds it BY NAME.
// Graded as "the member pane did not carry this output (hidden helper or beyond its row ceiling)" the harness named
// a cause that was not the cause. The door now lists each candle it does not draw (`candlesNotDrawn`: hidden by its
// author, or withheld with its reason), `ourSide.js::candleNotDrawnOf` carries the sentence, and `compare.mjs`
// grades the four parts INCONCLUSIVE with it. Run as the runtime-on lane runs (the corpus test's flags).

//
// ⭐ train e97 (U5 x U6, coordinator ruling 2026-11-25) — WITH U6 THAT CANDLE IS READ: `useBarColor ? display.all :
// display.none` is the member's setting, so the runtime door DRAWS the candle as the setting decides (`hiddenWhen`;
// hidden at the default). Its four parts are carried (`ourSide.js`: a runtime candle's open / high / low are matched to
// the candle plot's `ohlc` columns) and graded against TradingView's recorded values: MATCH 666/666 each. The drawing is
// named as ours hides it at these settings, and TradingView's side as NOT RECORDED (`compare.mjs::candleDrawingOf`: a
// capture's candle `styleState.display` is all bits whatever the script writes). Never "did not carry".
// U5's WITHHELD case stays alive on a display that is genuinely unread: the same capture with the candle's display
// chosen on a condition that is not one of the script's settings (`close > open`), withheld BY NAME.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { loadCapture } from './harness'
import { runOurSide, AUTHOR_HIDDEN_CANDLE, candleNotDrawnOf } from './ourSide'
import { compareCapture, CANDLE_DISPLAY_NOT_RECORDED } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const FILE = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness/kernel-channel-backquant-rddt-1d-2026-11-14.json')
const WITHHELD = "withheld by name on our side (`Bar Coloring`): its `display` chooses between places on a condition that is not one of the script's settings"
const SETTING_DISPLAY = 'useBarColor?display.all:display.none'

describe('e97 U5 — a candle our door did not draw is named by the door\'s reason', () => {
  it('candleNotDrawnOf reads the door\'s list and the host\'s own author mark, and nothing else', () => {
    const c = { kind: 'plotcandle', title: 'open' }
    const built = { candlesNotDrawn: [{ outputs: [7, 8, 9, 10], by: 'withheld', label: 'X', why: 'because' },
      { outputs: [11, 12, 13, 14], by: 'author' }] }
    expect(candleNotDrawnOf(c, 7, built)).toEqual({ by: 'withheld', sentence: 'withheld by name on our side (`X`): because' })
    expect(candleNotDrawnOf(c, 12, built)).toEqual({ by: 'author', sentence: AUTHOR_HIDDEN_CANDLE })
    expect(candleNotDrawnOf(c, 6, built)).toBe(null)
    expect(candleNotDrawnOf({ ...c, hiddenReason: 'author' }, 6, {})).toEqual({ by: 'author', sentence: AUTHOR_HIDDEN_CANDLE })
    // ⛔ the host's `passthrough` hiding is not a reason: such a candle recolours the chart's bars and is drawn
    expect(candleNotDrawnOf({ ...c, hiddenReason: 'passthrough' }, 6, {})).toBe(null)
    expect(candleNotDrawnOf({ kind: 'plot', hiddenReason: 'author' }, 6, built)).toBe(null)
  })

  it('kernel-channel RDDT, runtime lane: the candle hidden by its setting is CARRIED and graded MATCH; its lines still MATCH', () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const { capture } = loadCapture(FILE)
    expect(capture.source.text).toContain(SETTING_DISPLAY)
    const ours = runOurSide(capture)
    expect(ours.ok, ours.refusal).toBe(true)
    const candles = (ours.plots || []).filter((p) => p.kind === 'plotcandle')
    expect(candles).toHaveLength(4)
    for (const p of candles) {
      expect(p.candleNotDrawn, p.title).toBeUndefined()
      expect(p.missingReason, p.title).toBe(null)
      expect(p.column && p.column.length, p.title).toBeGreaterThan(0)
      expect(p.drawnHidden, p.title).toBe(true)
    }
    const r = compareCapture(capture, ours)
    const parts = r.plots.filter((p) => /^C1-candle-order/.test(p.rule || ''))
    expect(parts.map((p) => [p.title, p.verdict, p.reason])).toEqual(['open', 'high', 'low', 'close']
      .map((t) => [t, 'MATCH', '666 steady-state bars agree']))
    for (const p of parts) expect(p.drawing).toBe(`ours hides it at these settings; ${CANDLE_DISPLAY_NOT_RECORDED}`)
    expect(r.plots.filter((p) => /^M1-title/.test(p.rule || '')).map((p) => p.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH'])
  }, 120000)

  it("a candle whose display is genuinely unread is WITHHELD by name: the four parts INCONCLUSIVE by the door's reason", () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const { capture } = loadCapture(FILE)
    expect(capture.source.text).toContain(SETTING_DISPLAY)
    const unread = { ...capture, source: { ...capture.source,
      text: capture.source.text.replace(SETTING_DISPLAY, 'close > open ? display.all : display.none') } }
    const ours = runOurSide(unread)
    expect(ours.ok, ours.refusal).toBe(true)
    const candles = (ours.plots || []).filter((p) => p.kind === 'plotcandle')
    expect(candles).toHaveLength(4)
    for (const p of candles) expect(p).toMatchObject({ candleNotDrawn: 'withheld', missingReason: WITHHELD })
    const r = compareCapture(unread, ours)
    const parts = r.plots.filter((p) => /^C1-candle-order/.test(p.rule || ''))
    expect(parts.map((p) => [p.verdict, p.reason])).toEqual(Array(4).fill(['INCONCLUSIVE', WITHHELD]))
    expect(r.plots.filter((p) => /^M1-title/.test(p.rule || '')).map((p) => p.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH'])
  }, 120000)

  it('volatility-trend-score RDDT, runtime lane: a candle the door withholds for its PRESENTATION is INCONCLUSIVE by that reason', () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const { capture } = loadCapture(path.resolve(process.cwd(),
      '../tests/fixtures/vendor/harness/volatility-trend-score-backquant-rddt-1d-2026-11-14.json'))
    const ours = runOurSide(capture)
    expect(ours.ok, ours.refusal).toBe(true)
    const why = 'withheld by name on our side (`Trend Candles`): it asks for the price chart (`force_overlay = true`) '
      + 'from a script that is not an overlay'
    const candles = (ours.plots || []).filter((p) => p.kind === 'plotcandle')
    expect(candles).toHaveLength(4)
    for (const p of candles) expect(p).toMatchObject({ candleNotDrawn: 'withheld', missingReason: why })
    const parts = compareCapture(capture, ours).plots.filter((p) => /^C1-candle-order/.test(p.rule || ''))
    expect(parts.map((p) => [p.verdict, p.reason])).toEqual(Array(4).fill(['INCONCLUSIVE', why]))
  }, 120000)
})
