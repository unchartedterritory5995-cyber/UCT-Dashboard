// P1 GAPS: HELD-OUT phrasings (pl-exec, branch agent/pl/exec-p1-gaps). Written and committed BEFORE any change and never used to
// tune it. Evidence class: SIMULATED (scripted model).
// C1-025: auto-scale the price axis of ONE chart (the chart's own "A" / auto button; a dragged price scale back to auto)
export const AUTOSCALE_HELD_OUT = [
  { row: 'C1-025', text: 'auto scale this chart' },
  { row: 'C1-025', text: 'put the price axis back on auto' },
  { row: 'C1-025', text: 'fit the price scale to the candles again' },
  { row: 'C1-025', text: 'turn auto-scaling back on for this one' },
]
// C1-036 / C1-038: take comparison overlays off ONE chart (one symbol / all of them), through the Compare Symbols panel's writers
export const COMPARE_REMOVE_HELD_OUT = [
  { row: 'C1-036', text: 'take QQQ off this chart', remove: ['QQQ'] },
  { row: 'C1-036', text: 'stop comparing this one to SPY', remove: ['SPY'] },
  { row: 'C1-038', text: 'remove all the comparison overlays', clear: true },
  { row: 'C1-038', text: 'clear the compare symbols on this chart', clear: true },
]
// C1-080: one of UCT's chart themes on EVERY chart of the board at once (the theme gallery's "all charts")
export const THEME_ALL_HELD_OUT = [
  { row: 'C1-080', text: 'put every chart on the Nord theme', theme: 'nord' },
  { row: 'C1-080', text: 'make all my charts use the Midnight theme', theme: 'midnight' },
  { row: 'C1-080', text: 'switch the whole board to the Graphite chart theme', theme: 'graphite' },
]
// C1-035: a WHOLE GROUP (a theme / sector / industry from the Compare panel's own group lists) overlaid on ONE chart
export const GROUP_HELD_OUT = [
  { row: 'C1-035', text: 'compare this chart against the semiconductors industry', type: 'industry', name: 'Semiconductors' },
  { row: 'C1-035', text: 'overlay the whole Energy sector on this one', type: 'sector', name: 'Energy' },
  { row: 'C1-035', text: 'add the AI infrastructure theme to the compare', type: 'theme', name: 'AI Infrastructure' },
]
// C1-051 / C1-064 / C1-070 / C1-072: a chart's own on/off or mode SETTINGS (Chart Settings → Canvas crosshair, Header legend,
// Markers events, Markers prev-day levels) on ONE chart, in words that never name the dialog. tf = the chart's timeframe;
// the prev-day lines only draw intraday, so on a daily chart the change is saved AND the receipt says it will not show.
// start = the setting's value before the turn is the opposite of `value` (so the change is a real one).
export const SETTINGS_HELD_OUT = [
  { row: 'C1-051', text: 'only show the crosshair while I hold the mouse down', setting: 'crosshair.mode', value: 'hold', tf: 'D' },
  { row: 'C1-051', text: 'get rid of the crosshair on this chart', setting: 'crosshair.mode', value: 'off', tf: 'D' },
  { row: 'C1-064', text: 'make the OHLC readout at the top appear only when I press and hold', setting: 'header.legendMode', value: 'hold', tf: 'D' },
  { row: 'C1-064', text: 'remove the price legend from the top of this chart', setting: 'header.legendMode', value: 'off', tf: 'D' },
  { row: 'C1-070', text: 'show me where the dividends were paid on this chart', setting: 'markers.dividends', value: true, tf: 'D' },
  { row: 'C1-070', text: 'stop marking the stock splits', setting: 'markers.splits', value: false, tf: 'D' },
  { row: 'C1-070', text: 'put the earnings dates on this one', setting: 'markers.earnings', value: true, tf: 'D' },
  { row: 'C1-072', text: "mark yesterday's high on this 5 minute chart", setting: 'prevDayLevels.high.enabled', value: true, tf: '5' },
  { row: 'C1-072', text: 'drop the prior session low line', setting: 'prevDayLevels.low.enabled', value: false, tf: '15' },
  { row: 'C1-072', text: "show the previous day's close level", setting: 'prevDayLevels.close.enabled', value: true, tf: 'D', hiddenOnTf: true },
]
// C1-007: switch ONE chart to a timeframe the member already saved in its menu (a custom interval), never adding a duplicate
export const SAVED_TF_HELD_OUT = [
  { row: 'C1-007', text: 'go to my 45 minute timeframe', unit: 'minutes', count: 45 },
  { row: 'C1-007', text: 'flip this chart onto the 2 hour interval I saved', unit: 'hours', count: 2 },
]
// C1-076: restore ONE chart's look to the defaults (a proposal first; indicators kept; Undo puts the member's look back)
export const RESTORE_HELD_OUT = [
  { row: 'C1-076', text: 'put this chart back to how it looked out of the box' },
  { row: 'C1-076', text: 'undo all my customising of the colours and markers on this chart' },
]
// C1-094: resize ONE indicator pane on ONE chart (what dragging its divider does). size = pane.resize's own size word or
// percent; refuse = the change the chart cannot make (nothing is written, the reason is said).
export const PANE_RESIZE_HELD_OUT = [
  { row: 'C1-094', text: 'give the RSI pane more room', pane: 'rsi', size: 'bigger' },
  { row: 'C1-094', text: 'shrink the macd panel down to 15 percent of the chart', pane: 'macd', size: 15 },
  { row: 'C1-094', text: 'let the rsi pane size itself again', pane: 'rsi', size: 'auto' },
  { row: 'C1-094', text: 'make the rsi pane take up 95% of the chart', pane: 'rsi', size: 95, refuse: true },
  { row: 'C1-094', text: 'make the 50 sma pane taller', pane: '#50', size: 'bigger', refuse: true },
]
// C1-104: an indicator TOGGLED, as the chart's chords do it (Ctrl+I / Ctrl+O / Ctrl+B / Alt+U) — and as a family, any
// indicator: shown → hidden (kept), hidden → shown, absent → added. start = the indicator's state before the turn;
// end = the state after (an explicit "on" / "off" that already holds changes nothing).
export const TOGGLE_HELD_OUT = [
  { row: 'C1-104', text: 'toggle RSI', defId: 'rsi', start: 'absent', end: 'shown' },
  { row: 'C1-104', text: 'toggle the MACD', defId: 'macd', start: 'shown', end: 'hidden' },
  { row: 'C1-104', text: 'toggle bollinger bands', defId: 'bb', start: 'hidden', end: 'shown' },
  { row: 'C1-104', text: 'flip vwap on', defId: 'vwap', start: 'absent', end: 'shown' },
  { row: 'C1-104', text: 'toggle the macd off', defId: 'macd', start: 'hidden', end: 'hidden' },
  { row: 'C1-104', text: 'toggle atr', defId: 'atr', start: 'shown', end: 'hidden' },
]

import { describe, it, expect } from 'vitest'
describe('P1-gap held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...AUTOSCALE_HELD_OUT, ...COMPARE_REMOVE_HELD_OUT, ...THEME_ALL_HELD_OUT, ...GROUP_HELD_OUT, ...SETTINGS_HELD_OUT, ...SAVED_TF_HELD_OUT, ...RESTORE_HELD_OUT, ...PANE_RESIZE_HELD_OUT, ...TOGGLE_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
