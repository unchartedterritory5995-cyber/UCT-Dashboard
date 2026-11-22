// EXECUTION FAMILIES — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any routing word, description,
// hint or table row of these families was changed, and never used to change them: the phrasings the work was tuned on are in
// agentExecFamilies.test.jsx (TUNE), and none of these is there. Evidence class: SIMULATED (LOCAL native Windows Node,
// scripted/no model). Routing, the context sections and the no-model readers are real; which action a real model picks from
// the descriptions is NOT measured here (no paid call; the sealed held-out key is absent on this PC, so sealed scoring is owed).
//
// Each case names the inventory row it stands for, the widget type (or chart) on the board, and the op a correct plan is.
// The measured numbers live in the last describe; they are what the report quotes, before and after.

// ── Family W: ONE control of ONE widget on the board (widget.setOption over widgets/widgetControls.js) ──
export const WIDGET_HELD_OUT = [
  { row: 'C3-169', type: 'themes', text: 'sort the theme tracker by the weekly performance', key: 'period', value: '1w' },
  { row: 'C3-170', type: 'themes', text: 'flip the themes list so the worst ones are on top', key: 'sortDir', value: 'asc' },
  { row: 'C3-171', type: 'themes', text: 'theme tracker should measure from the open today', key: 'todayBasis', value: 'open' },
  { row: 'C3-172', type: 'themes', text: 'open the semiconductors theme in the tracker', key: 'openTheme', value: 'Semis' },
  { row: 'C3-166', type: 'optionsflow', text: 'only show sweeps in the options flow', key: 'printType', value: 'SWEEP' },
  { row: 'C3-166', type: 'optionsflow', text: 'options flow: puts only', key: 'callPut', value: 'P' },
  { row: 'C3-183', type: 'indexes', text: 'hide the russell from the indexes widget', key: 'index', value: '-IWM' },
  { row: 'C3-188', type: 'nhnl', text: 'switch the new highs lows widget to the nasdaq tab', key: 'universe', value: 'nasdaq' },
  { row: 'C3-159', type: 'breadth', text: 'show the ratio view on breadth', key: 'view', value: 'ratio' },
  { row: 'C3-158', type: 'breadth', text: 'take the advance decline reading off the breadth widget', key: 'reading', value: '-A/D' },
  { row: 'C3-193', type: 'scatter', text: 'market map x axis should be relative volume', key: 'xKey', value: 'rvol' },
  { row: 'C3-195', type: 'scatter', text: 'turn off labels on the market map', key: 'labelMode', value: 'off' },
  { row: 'C3-194', type: 'scatter', text: 'have the market map follow my watchlist', key: 'followList', value: true },
  { row: 'C3-148', type: 'calendar', text: 'terminal: jump to next friday', key: 'day', value: 'next friday' },
  { row: 'C3-151', type: 'calendar', text: 'show only 3 star economic events', key: 'econStars', value: 3 },
  { row: 'C3-152', type: 'calendar', text: 'expand the tbd earnings section', key: 'tbdOpen', value: true },
  { row: 'C3-133', type: 'news', text: 'news widget: only bullish catalysts', key: 'filter', value: 'up' },
  { row: 'C3-139', type: 'tradeExchangeNews', text: 'trade exchange news only macro headlines', key: 'category', value: '+Macro' },
  { row: 'C3-164', type: 'optionsflow', text: 'switch options flow to just this symbol', key: 'scope', value: 'symbol' },
  { row: 'C3-165', type: 'optionsflow', text: 'lead with the biggest trades in options flow', key: 'lead', value: 'biggest' },
  { row: 'C3-121', type: 'volumescan', text: 'volume surge: watch my core list', key: 'list', value: 'Core' },
  { row: 'C3-125', type: 'volumescan', text: 'show logos in the volume surge', key: 'showLogos', value: true },
  { row: 'C3-206', type: 'periodsort', text: 'group period sort by industry', key: 'group', value: 'industry' },
  { row: 'C3-178', type: 'fundamentals', text: 'fundamentals widget to analyst estimates', key: 'view', value: 'analyst' },
]

// ── Family L: a chart's LIST settings (which fields a strip prints), one member at a time ──
export const LIST_HELD_OUT = [
  { row: 'C1-066', text: 'put the dollar volume in the info row', setting: 'header.fields', value: '+dolvol' },
  { row: 'C1-066', text: 'take market cap off the header stats', setting: 'header.fields', value: '-mcap' },
  { row: 'C1-066', text: 'remove the UCT rating from the info row', setting: 'header.fields', value: '-rating' },
  { row: 'C1-066', text: 'info row: add 30 day change', setting: 'header.fields', value: '+perf30d' },
  { row: 'C1-066', text: 'add RVOL to the stat strip above the chart', setting: 'header.fields', value: '+rvol' },
  { row: 'C1-065', text: "I don't need the open price in the bar readout", setting: 'header.barInfo', value: '-open' },
  { row: 'C1-065', text: 'show the percent change in the OHLC strip', setting: 'header.barInfo', value: '+changePct' },
  { row: 'C1-065', text: 'drop the date from the bar info', setting: 'header.barInfo', value: '-date' },
]

import { describe, it, expect } from 'vitest'
describe('held-out sets are frozen data', () => {
  it('every case names a row, and no phrasing appears twice', () => {
    const all = [...WIDGET_HELD_OUT, ...LIST_HELD_OUT]
    expect(all.every(c => /^C[123]-\d{3}$/.test(c.row))).toBe(true)
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
