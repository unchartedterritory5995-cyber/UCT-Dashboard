// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.paintCurtain.test.js
//
// ─── ⭐ NUMBER PENDING (harness, fix/kill-spy-runtime-diverges) — A PAINT THE RUN WITHHOLDS IS NOT A WRONG COLOUR ────
//
// Off the listing the runtime lane withholds its warm-up BY NAME (`runtimeColumns.js::computeOffListing`): on those bars
// it draws no plot value and no colour. The plot grade has always excused those bars (they are its `lookback`); the
// paint grade used only its fixed cold-replay floor (`PAINT_WARMUP_FLOOR` = 200). fvg-trend-spy-1d-2026-11-17 (AMEX:SPY
// 1D, not from the listing, `var fvgCounter`) had its run withhold bars 0-254, so the paint grade counted bars 200-254 as
// "differ" (TradingView green, ours nothing) while every bar from 255 on agrees, and the plots MATCH. Now `gradePaints`
// excuses a bar inside the run's own curtain (`paintSupply.curtainBars`) ONLY when our side drew nothing there; a colour
// drawn there is compared like any other bar, and the floor is unchanged.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'
import { gradePaints, PAINT_WARMUP_FLOOR } from './paintColours'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'

vi.setConfig({ testTimeout: 300000 })

const ROOT = path.resolve(process.cwd(), '..')
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const SPY = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/fvg-trend-spy-1d-2026-11-17.json')).capture
const RDDT = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/fvg-trend-rddt-1d-2026-11-17.json')).capture

let spy
let rddt
beforeAll(() => {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  spy = runOurSide(SPY)
  rddt = runOurSide(RDDT)
})
afterAll(() => { vi.unstubAllEnvs(); __resetRuntimeAllowList() })

const bg = (ours) => (ours.paints || []).find((p) => p.kind === 'bgcolor')
const rowOf = (g) => g.rows.find((r) => r.kind === 'bgcolor')

describe('the paint grade excuses the bars the runtime run withholds, and only those', () => {
  it('fvg-trend SPY (off the listing): the run withholds bars 0-254 by name, and the paint agrees bar for bar after them', () => {
    expect(SPY.history.startsAtBar0).not.toBe(true)
    expect(spy.paintSupply.curtainBars).toBe(255)
    expect(PAINT_WARMUP_FLOOR).toBe(200)
    const colours = bg(spy).colors
    expect(colours.slice(0, 255).every((c) => c === null || c === undefined)).toBe(true)
    expect(colours[255]).toBeTruthy()
    expect(rowOf(gradePaints(SPY, spy))).toMatchObject({ state: 'agree', differ: 0 })
  })

  it('⛔ a colour our side DRAWS inside the curtain is compared: a wrong one there differs', () => {
    const wrong = { ...spy, paints: spy.paints.map((p) => (p.kind === 'bgcolor'
      ? { ...p, colors: p.colors.map((c, j) => (j === 210 ? '#123456ff' : c)) } : p)) }
    const r = rowOf(gradePaints(SPY, wrong))
    expect(r).toMatchObject({ state: 'differ', differ: 1 })
    expect(r.first.bar).toBe(210)
  })

  it('⛔ CONTROL: with no curtain the fixed floor stands, and the withheld bars 200-254 count as before', () => {
    const r = rowOf(gradePaints(SPY, { ...spy, paintSupply: { ...spy.paintSupply, curtainBars: 0 } }))
    expect(r).toMatchObject({ state: 'differ', differ: 55 })
    expect(r.first.bar).toBe(PAINT_WARMUP_FLOOR)
  })

  it('CONTROL: from the listing there is no curtain, and the grade is bar for bar from bar 0', () => {
    expect(RDDT.history.startsAtBar0).toBe(true)
    expect(rddt.paintSupply.curtainBars).toBe(0)
    expect(rowOf(gradePaints(RDDT, rddt))).toMatchObject({ state: 'agree', differ: 0 })
  })
})
