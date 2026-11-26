// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.candleBody.test.js
//
// ─── ⭐ e98 P3 (phase B) — A CANDLE'S BODY COLOUR, END TO END ON COMMITTED CAPTURES ─────────────────────────────────
//
// 1. A candle the HOST door withholds by name (institutional-smc "Heatmap Candles": its colour picks among more than
//    two colours) is recorded on the door's answer (`candlesNotDrawn`, the runtime door's shape since e97 U5), carried
//    to the harness part by part (`candleWithheld`), and its CLOSE is INCONCLUSIVE by the door's own reason: TradingView
//    draws a coloured candle and we draw none. ⚰️ Phase A graded it MATCH on prices alone (coordinator ruling (b),
//    2026-11-25: the correction of that over-claim). Its open / high / low stay graded on prices.
// 2. A candle the door DRAWS carries its body colour to the grade: kernel-channel's candle, drawn when the member turns
//    "Color Bars By Regime" on (runtime lane), reads its body colour off the bound candle's points
//    (`binder.computedOhlcPayload`, `plots[].ohlcColors.body`) and is compared bar for bar against the capture's
//    `ohlc_colorer`. TradingView recorded the colorer at the default (the candle hidden there); the setting moves the
//    candle's display, not its colour.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import {
  compareCapture, CANDLE_WITHHELD_OURS, CANDLE_WITHHELD_COLOUR, CANDLE_BODY_COMPARED,
} from '../../../../../../../tools/vendor_harness/compare.mjs'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'

const H = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness')
const SMC = path.join(H, 'institutional-smc-order-flow-matrix-pro-rddt-1d-2026-09-28.json')
const KERNEL = path.join(H, 'kernel-channel-backquant-rddt-1d-2026-11-14.json')
const parts = (r) => r.plots.filter((p) => /^C1-candle-order/.test(p.rule || ''))

describe('e98 P3 — a candle the host door withholds by name', () => {
  it('the door records it on its answer, by the four host output indexes and its reason', () => {
    const { capture } = loadCapture(SMC)
    const d = memberPaneDefinition({ source: capture.source.text })
    expect(d.ok, d.reason).toBe(true)
    expect(d.candlesNotDrawn).toHaveLength(1)
    const c = d.candlesNotDrawn[0]
    expect(c).toMatchObject({ by: 'withheld', label: 'Heatmap Candles' })
    expect(c.why).toMatch(/could not carry its `color =`|picks among more than two colours/)
    const outs = d.translation.outputs
    expect(c.outputs.map((i) => outs[i].title)).toEqual(['open', 'high', 'low', 'close'].map((r) => `Heatmap Candles ${r}`))
  }, 120000)

  it('CONTROL: a host answer with no withheld candle carries no `candlesNotDrawn` at all', () => {
    const d = memberPaneDefinition({ source: '//@version=6\nindicator("c")\nplot(close)' })
    expect(d.ok, d.reason).toBe(true)
    expect('candlesNotDrawn' in d).toBe(false)
  }, 60000)

  it('its close is INCONCLUSIVE by the door\'s reason; its open, high and low stay MATCH on prices', () => {
    const { capture } = loadCapture(SMC)
    const ours = runOurSide(capture)
    expect(ours.ok, ours.refusal).toBe(true)
    const close = ours.plots.find((p) => p.kind === 'plotcandle' && p.role === 'close')
    expect(close.candleWithheld).toMatch(/^withheld by name on our side \(`Heatmap Candles`\): /)
    const r = compareCapture(capture, ours)
    const rows = parts(r)
    expect(rows.map((p) => p.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH', 'INCONCLUSIVE'])
    const c = rows[3]
    expect(c.reason).toContain(close.candleWithheld)
    expect(c.reason).toContain(CANDLE_WITHHELD_OURS)
    expect(c.color).toBe(CANDLE_WITHHELD_COLOUR)
    expect(r.verdict).toBe('INCONCLUSIVE')
  }, 120000)
})

describe('e98 P3 — a candle the door draws is graded on its body colour', () => {
  it('kernel-channel RDDT, runtime lane, "Color Bars By Regime" on: the body colour is compared bar for bar', () => {
    const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
    vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
    vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const { capture } = loadCapture(KERNEL)
    const moved = { ...capture, study: { ...capture.study,
      inputs: capture.study.inputs.map((i) => (i.id === 'in_7' ? { ...i, value: true } : i)) } }
    expect(capture.study.inputs.find((i) => i.id === 'in_7').name).toBe('Color Bars By Regime')
    const ours = runOurSide(moved)
    expect(ours.ok, ours.refusal).toBe(true)
    const close = ours.plots.find((p) => p.kind === 'plotcandle' && p.role === 'close')
    expect(close.drawnHidden).toBe(false)
    expect(Array.isArray(close.colors), close.colorsReason).toBe(true)
    expect(close.colors.filter((c) => typeof c === 'string' && /^#[0-9a-f]{8}$/.test(c)).length).toBeGreaterThan(600)
    const r = compareCapture(moved, ours)
    const c = parts(r).find((p) => /\.close\)$/.test(p.rule))
    expect(c.color).toBe(CANDLE_BODY_COMPARED)
    expect(c.stats.colorCompared).toBeGreaterThan(600)
    console.log(`[candle-body] kernel-channel RDDT close: ${c.verdict} — ${c.reason}; colour compared ${c.stats.colorCompared}, mismatches ${c.stats.colorMismatches}`)
    vi.unstubAllEnvs()
  }, 180000)
})
