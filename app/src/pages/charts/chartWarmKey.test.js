// The key a chart widget will show (chartWarmKey.js): ChartWidget's own rules, so the board's warm admission asks the
// store about the key the chart actually reads (review of the warm admission, finding 4).
//   K1 the main chart tab: the widget's colour, its tf, extended hours from the tab's settings over the account's
//   K2 an extra chart tab is active: ITS tf and colour, its own settings
//   K3 unlinked ('N'), a suspended extra group, a group with no symbol, a non-chart: null (cold)
//   K4 extended hours: stored false wins over the account; the account decides when the tab says nothing; default on
//   K5 a bailed-out switch never turns the lane on (boardSwitchMark.userSwitchRenders)
//   K6 (red first, review H2) a switch made in replay mode keeps the paced admission: the charts show a WINDOWED key (the
//      replay cutoff, a session state no saved layout carries) that the warm check does not name
import { describe, it, expect } from 'vitest'
import { chartWarmKey, warmAdmissionOn } from './chartWarmKey'
import { userSwitchRenders } from './boardSwitchMark'

const syms = { A: 'AAPL', B: 'MSFT', E: 'NVDA' }
const chart = (opts, color = 'A') => ({ type: 'chart', color, opts })

describe('chartWarmKey', () => {
  it('K1 the main tab: colour, tf, extended hours', () => {
    expect(chartWarmKey(chart({ tf: '5' }), syms)).toEqual({ sym: 'AAPL', tf: '5', showExtended: true })
    expect(chartWarmKey(chart({}), syms)).toEqual({ sym: 'AAPL', tf: 'D', showExtended: true })
  })

  it('K2 an extra chart tab is active: its tf and colour', () => {
    const opts = { tf: 'D', chartTabs: [{ id: 'ct1', tf: '15', color: 'B', settings: { extendedHoursShading: false } }], activeChartTab: 1 }
    expect(chartWarmKey(chart(opts), syms)).toEqual({ sym: 'MSFT', tf: '15', showExtended: false })
  })

  it('K3 unlinked, a suspended extra group, no symbol, a non-chart: cold', () => {
    expect(chartWarmKey(chart({ tf: '5' }, 'N'), syms)).toBeNull()
    expect(chartWarmKey(chart({ tf: '5' }, 'E'), syms, null, false)).toBeNull()
    expect(chartWarmKey(chart({ tf: '5' }, 'E'), syms, null, true)).toEqual({ sym: 'NVDA', tf: '5', showExtended: true })
    expect(chartWarmKey(chart({ tf: '5' }, 'C'), syms)).toBeNull()
    expect(chartWarmKey({ type: 'watchlist', color: 'A', opts: {} }, syms)).toBeNull()
    const susp = { tf: 'D', chartTabs: [{ id: 'ct1', tf: '5', color: 'F' }], activeChartTab: 1 }
    expect(chartWarmKey(chart(susp), syms, null, false)).toBeNull()
  })

  it('K4 extended hours: the tab first, then the account, else on', () => {
    expect(chartWarmKey(chart({ tf: '5', settings: { extendedHoursShading: false } }), syms, { extendedHoursShading: true }).showExtended).toBe(false)
    expect(chartWarmKey(chart({ tf: '5' }), syms, { extendedHoursShading: false }).showExtended).toBe(false)
    expect(chartWarmKey(chart({ tf: '5' }), syms, {}).showExtended).toBe(true)
  })

  it('K6 (red first) replay mode: the warm lane stays off; a member switch outside it turns it on', () => {
    expect(warmAdmissionOn({ userSwitch: true, replayCutoff: null })).toBe(true)
    expect(warmAdmissionOn({ userSwitch: true, replayCutoff: '2026-03-02' }), 'warm lane on in replay mode').toBe(false)
    expect(warmAdmissionOn({ userSwitch: false, replayCutoff: null })).toBe(false)
  })

  it('K5 the lane is on only while the rendered layout IS the switch target', () => {
    const X = { widgets: [] }
    const R = { widgets: [] }
    expect(userSwitchRenders(X, X)).toBe(true)
    expect(userSwitchRenders(X, R), 'a bailed-out switch (target X, the board still R) turned the lane on').toBe(false)
    expect(userSwitchRenders(null, R)).toBe(false)
  })
})
