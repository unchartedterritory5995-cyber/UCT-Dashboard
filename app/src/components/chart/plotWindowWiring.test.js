// app/src/components/chart/plotWindowWiring.test.js
//
// ─── THE INDICATOR WINDOW IS WIRED THROUGH THE CHART, IN CODE ───────────────────
//
// `engine/plotWindow.test.js` pins the arithmetic and `engine/binder.plotWindow.test.js`
// the calls the binder makes. What neither can see is `StockChart.jsx`, where three lines
// have to exist together or the window is wrong in a way no unit test of its parts shows:
//
//   1. the window's first row is in the paint signature. Without it a change of window
//      (the view came near its start) is planned as `noop`: identical bars, identical
//      configuration, nothing written, and the indicator lines stay cut where a member
//      can now see the cut;
//   2. the window start reaches the binder (`plotWindowFrom`), or nothing is windowed;
//   3. the chart watches its own visible range and names the chart whole when the view
//      comes too close (`plotWindowTooNarrow` -> the full-key state), and `updateChart`
//      re-runs when that state changes.
//
// ⛔ CODE, NEVER PROSE: the source is read with comments stripped (`sourceScan`), so a
// line that was commented out does not count and a comment that names a thing does not
// stand in for it. The needles are built from parts, so this file cannot match itself.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments } from './engine/__tests__/sourceScan'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const code = stripComments(readFileSync(path.join(HERE, '..', 'StockChart.jsx'), 'utf8'))
const binder = stripComments(readFileSync(path.join(HERE, 'engine', 'binder.js'), 'utf8'))
const squash = (s) => s.replace(/\s+/g, ' ')
const CODE = squash(code)

const START = ['_plot', 'Start'].join('')
const FROM = ['_plot', 'From'].join('')
const FULL = ['_plot', 'Window', 'Full', 'Key'].join('')

describe('the stripper sees code and not prose (the control)', () => {
  it('drops a commented-out line and keeps a live one', () => {
    const src = ['// plotWin: gone', 'const a = { plotWin: 1 }', '/* plotWindowFrom: x */'].join('\n')
    const out = squash(stripComments(src))
    expect(out).toContain('plotWin: 1')
    expect(out).not.toContain('gone')
    expect(out).not.toContain('plotWindowFrom')
  })
})

describe('StockChart wires the indicator window', () => {
  it('the first row of the window is part of the paint signature', () => {
    const at = CODE.indexOf('_cfgSig = JSON.stringify({')
    expect(at, 'the paint signature was not found: the rest is vacuous').toBeGreaterThan(0)
    const sig = CODE.slice(at, CODE.indexOf('} catch', at))
    expect(sig).toContain(`plotWin: ${START}`)
  })
  it('the window reaches the view the chart already has (the geometry of the outgoing frame)', () => {
    expect(CODE).toContain('const _geom = paintedGeomRef.current')
    expect(CODE).toMatch(/const _left = _geom && Number\.isFinite\(_geom\.width\) && Number\.isFinite\(_geom\.ro\) \? _geom\.width - _geom\.ro : 0/)
    expect(CODE).toContain('_pw.rows = plotWindowRows(_span, _left)')
  })
  it('the window is decided before the signature is built', () => {
    const decided = CODE.indexOf(`${START} = _whole ? 0 : plotWindowStart(`)
    expect(decided).toBeGreaterThan(0)
    expect(decided).toBeLessThan(CODE.indexOf('_cfgSig = JSON.stringify({'))
  })
  it('the window start reaches the binder', () => {
    const at = CODE.indexOf('.binder.sync({')
    expect(at).toBeGreaterThan(0)
    const ctx = CODE.slice(at, CODE.indexOf('priceSeries: () =>', at))
    expect(ctx).toContain(`plotWindowFrom: ${FROM},`)
  })
  it('a pinned, replay, override or overlay chart, and a browser with the switch set, is drawn whole', () => {
    const at = CODE.indexOf('const _whole =')
    expect(at).toBeGreaterThan(0)
    const rule = CODE.slice(at, CODE.indexOf(`${START} = _whole`, at))
    for (const part of [`${FULL} === _pwKey`, '_pinnedFull', '_overlayActive', '_hasOverride', 'replayMode', 'plotWindowDisabled()']) {
      expect(rule, part).toContain(part)
    }
  })
  it('the chart watches its visible range and names itself whole when the view is too close', () => {
    // THIS effect, not any of the chart's other range subscriptions: from its own guard to its own deps.
    const at = CODE.indexOf(`if (${FULL} === key) return undefined`)
    const end = CODE.indexOf(`[sym, resolvedTf, ${FULL}, chartReady])`, at)
    expect(at, 'the effect was not found: the rest is vacuous').toBeGreaterThan(0)
    expect(end).toBeGreaterThan(at)
    const effect = CODE.slice(at, end)
    const setter = `_set${FULL[1].toUpperCase()}${FULL.slice(2)}`               // _setPlotWindowFullKey
    expect(effect).toMatch(new RegExp(`if \\(plotWindowTooNarrow\\(\\{[^}]*\\}\\)\\) ${setter}\\(key\\)`))
    expect(effect).toContain('ts.subscribeVisibleLogicalRangeChange(onRange)')
    expect(effect).toContain('ts.unsubscribeVisibleLogicalRangeChange(onRange)')
    expect(effect).toContain('cancelAnimationFrame(raf)')
    // asked once without waiting for a range change: a chart that opens wider than its window
    expect(effect).toMatch(/subscribeVisibleLogicalRangeChange\(onRange\) \} catch \{ ts = null \} onRange\(\)/)
  })
  it('updateChart runs again when the chart is named whole', () => {
    const at = CODE.indexOf('const updateChart = useCallback(')
    const end = CODE.indexOf('useEffect(() => { updateChart() }', at) > 0
      ? CODE.indexOf('useEffect(() => { updateChart() }', at) : CODE.indexOf('[updateChart])', at)
    expect(at).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(at)
    const body = CODE.slice(at, end)
    const deps = body.slice(body.lastIndexOf('}, ['))
    for (const dep of [FULL, '_pinnedFull', '_overlayActive', '_hasOverride', 'replayMode', 'filteredBars', 'adjustTime']) {
      expect(deps, dep).toContain(dep)
    }
  })
})

describe('the binder hands the renderer the window, and only the primary series', () => {
  it('the points written are the windowed ones', () => {
    const b = squash(binder)
    expect(b).toContain('const drawn = windowedPoints(split ? split.primary : points, ctx.plotWindowFrom)')
    const at = b.indexOf('const drawn = windowedPoints(')
    const write = b.slice(at, at + 420)
    expect(write).toContain('attempt(() => series.setData(drawn))')
    expect(write).toContain('attempt(() => ctx.applyData(series, drawn))')
  })
  it('what the legend reads is still the whole series', () => {
    const b = squash(binder)
    expect(b).toContain('lastPointValue(points)')
    expect(b).not.toContain('lastPointValue(drawn)')
  })
})
