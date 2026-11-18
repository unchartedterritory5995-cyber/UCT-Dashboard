// app/src/components/chart/builder/memberPane/fillAnchorDrawn.test.js
//
// ─── ⭐⭐ Engine 75 (#1788, fix/fill-anchor-display) — A FILL ANCHOR IS DRAWN UNLESS ITS OWN `display` HIDES IT ───
//
// Ruling 1.2 (owner, 2026-09-12) is about what the door OFFERS and SELECTS: an untitled plot of a bare price
// source that a `fill` names (`pine.js` `hiddenReason: 'fill-anchor'`) is never a column offered under the
// script's title. It was never a statement about what TradingView DRAWS, and the member pane read it as one:
// both lanes left the row undrawn (`memberPaneDefinition.js::paneHides`).
//
// TradingView's own records decide it (read off the captures, never from memory):
//   supertrend-strategy `mPlot = plot(ohlc4, title="", style=plot.style_circles, linewidth=0)`
//     -> `styleState.plot_6` `display: 15` (pane | data window | price scale | status line), `visible: true`,
//        `transparency: 0`, `color: #2962FF` (TradingView's default), `plottype: 6` (circles), `linewidth: 0`
//        (Q-SD1, Q-SD2 and the committed supertrend-strategy-{rddt,spy}-1d-2026-10-02);
//   pmax-explorer, the IDENTICAL line plus `display=display.none`
//     -> `styleState.plot_12` `display: 0`, `visible: false`.
// So the field that decides it is the anchor's own `display` argument: `hiddenReason: 'author'` (hidden, as
// before), else drawn.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from './memberPaneDefinition.js'
import { translatePine } from '../../engine/ast/pine.js'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../engine/runtimeKill'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../engine/runtimePaneGate'

const REPO = path.resolve(__dirname, '../../../../../..')
const HARNESS = path.join(REPO, 'tests/fixtures/vendor/harness')
const capture = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))

const HEAD = '//@version=5\nindicator("Band demo", overlay=true)\n'
const anchorSource = (display) => `${HEAD}edge = plot(ohlc4, "", style=plot.style_circles, linewidth=0${display})
band = plot(ta.sma(close, 20), "Band")
fill(edge, band, color=color.new(color.blue, 80))
`
const NONE = ', display=display.none'
/** the document's rows, drawn or not, as `[style, drawn]` in document order */
const drawnOf = (r) => (r.definition.plots || []).map((p) => [p.style, p.hidden !== true])

describe('the host lane: the pane draws a fill anchor unless its own `display` hides it', () => {
  it('⭐ the default-display anchor is a DRAWN row (circles: `markers`), and ruling 1.2 still never OFFERS it', () => {
    const r = memberPaneDefinition({ source: anchorSource(''), id: 'u_fillanchor_default', name: 'Band demo' })
    expect(r.ok, r.reason).toBe(true)
    // ruling 1.2 untouched: the translation names it a fill anchor and selects the real column
    const anchor = r.translation.outputs.find((o) => o.handle === 'edge')
    expect(anchor).toMatchObject({ hidden: true, hiddenReason: 'fill-anchor', title: null })
    expect(r.translation.outputs[r.translation.selected].title).toBe('Band')
    // ...and the pane DRAWS it, beside the band it anchors
    expect(drawnOf(r)).toEqual([['markers', true], ['line', true]])
    expect((r.definition.plots || []).some((p) => p.fill)).toBe(true)
  })

  it('⛔ the `display.none` anchor stays HIDDEN: the author\'s own statement (`hiddenReason: \'author\'`)', () => {
    const r = memberPaneDefinition({ source: anchorSource(NONE), id: 'u_fillanchor_none', name: 'Band demo' })
    expect(r.ok, r.reason).toBe(true)
    expect(r.translation.outputs.find((o) => o.handle === 'edge').hiddenReason).toBe('author')
    expect(drawnOf(r)).toEqual([['markers', false], ['line', true]])
  })

  it('the field-keyed case on TradingView\'s own record: two captures whose anchors differ ONLY in `display`', () => {
    const st = capture('supertrend-strategy-rddt-1d-2026-10-02')
    const pm = capture('pmax-explorer-rddt-1d-2026-10-02')
    // TradingView: displayed / not displayed, by the one argument
    expect(st.study.styleState.plot_6).toMatchObject({ display: 15, visible: true, plottype: 6, linewidth: 0, transparency: 0, color: '#2962FF' })
    expect(pm.study.styleState.plot_12).toMatchObject({ display: 0, visible: false, plottype: 6, linewidth: 0 })
    expect(st.source.text).toMatch(/^mPlot = plot\(ohlc4, title="", style=plot\.style_circles, linewidth=0\)\s*$/m)
    expect(pm.source.text).toMatch(/^mPlot = plot\(ohlc4, title="", style=plot\.style_circles, linewidth=0,display=display\.none\)\s*$/m)
    // the translation tells them apart by that argument alone
    expect(translatePine(st.source.text, { strict: true }).outputs.find((o) => o.handle === 'mPlot').hiddenReason).toBe('fill-anchor')
    expect(translatePine(pm.source.text, { strict: true }).outputs.find((o) => o.handle === 'mPlot').hiddenReason).toBe('author')
    // and the pane follows it: supertrend's seven drawn rows, `mPlot` (circles) the seventh, drawn
    const d = memberPaneDefinition({ source: st.source.text, id: 'u_fillanchor_st', name: 'SuperTrend STRATEGY' })
    expect(d.ok, d.reason).toBe(true)
    const drawn = (d.definition.plots || []).filter((p) => p.hidden !== true)
    expect(drawn.map((p) => p.style)).toEqual(['line', 'markers', 'markers', 'line', 'markers', 'markers', 'markers'])
  })
})

// a script the HOST lane cannot fold (a `var` running total), so the door mints a RUNTIME document
const runtimeSource = (display) => `${HEAD}var float m = na
m := nz(m) + close
edge = plot(ohlc4, "", style=plot.style_circles, linewidth=0${display})
top = plot(m, "Top")
fill(edge, top, color=color.new(color.blue, 80))
`
describe('the runtime lane: a runtime document carries the default-display anchor as a drawn row', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  })
  afterEach(() => { vi.unstubAllEnvs(); __resetRuntimeAllowList(); __resetRuntimePanePermission() })

  it('⭐ the anchor is a drawn row of the runtime document; the `display.none` one is not carried', () => {
    const mint = (display, id) => {
      const r = memberPaneDefinition({ source: runtimeSource(display), id, name: 'Band demo' })
      expect(r.ok, r.reason).toBe(true)
      expect(r.lane, 'the door did not mint a runtime document, so the runtime rows are not under test').toBe('runtime')
      return (r.definition.plots || []).filter((p) => p.hidden !== true).map((p) => [p.label, p.style])
    }
    expect(mint('', 'u_fillanchor_rt_d').map(([, s]) => s)).toEqual(['markers', 'line'])
    expect(mint(NONE, 'u_fillanchor_rt_n')).toEqual([['Top', 'line']])
  })
})
