// EXECUTION FAMILIES, ROUND 2 — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any change of round 2
// (label matching, door rows, the Journal family), and never used to change them. The tune phrasings are agentExecTune.js
// (WIDGET_TUNE2, JOURNAL_TUNE). Evidence class: SIMULATED (LOCAL native Windows Node, scripted/no model).

// ── Widget names said with other punctuation and connectors than the registry's label ──
export const NAME_HELD_OUT = [
  { row: 'C3-188', type: 'nhnl', text: 'switch new highs and new lows to the nasdaq tab', key: 'universe', value: 'nasdaq' },
  { row: 'C3-187', type: 'nhnl', text: 'on the new-highs/new-lows widget add the S&P 500', key: 'universes', value: '+S&P 500' },
  { row: 'C3-166', type: 'optionsflow', text: 'options-flow: calls only', key: 'callPut', value: 'C' },
  { row: 'C3-195', type: 'scatter', text: 'set the market-map labels off', key: 'labelMode', value: 'off' },
  { row: 'C3-169', type: 'themes', text: 'theme-tracker by the week', key: 'period', value: '1w' },
  { row: 'C3-125', type: 'volumescan', text: 'volume-surge logos on', key: 'showLogos', value: true },
]

// ── Door rows (the choices are the mounted widget's own) ──
export const DOOR_HELD_OUT = [
  { row: 'C3-121', type: 'volumescan', text: 'point the volume surge at my Semis list', key: 'list', value: 'Semis' },
  { row: 'C3-158', type: 'breadth', text: 'drop the stage 2 reading from the breadth heatmap', key: 'reading', value: '-stage' },
  { row: 'C3-192', type: 'scatter', text: 'add the nasdaq 100 to the market map universes', key: 'universes', value: '+Nasdaq 100' },
  { row: 'C3-193', type: 'scatter', text: 'market map: put day change on the y axis', key: 'yKey', value: 'chg_today' },
]

// ── Send a widget to the Journal (widget.sendToJournal over the widget's own capture door) ──
export const JOURNAL_HELD_OUT = [
  { row: 'C3-184', type: 'indexes', text: 'save the index levels to my journal', where: 'note' },
  { row: 'C3-156', type: 'calendar', text: 'jot the terminal day into a new journal entry', where: 'newNote' },
  { row: 'C3-163', type: 'breadth', text: 'drop this breadth snapshot in my notebook inbox', where: 'inbox' },
  { row: 'C3-177', type: 'themes', text: 'log the theme tracker ranking in my journal', where: 'note' },
]

import { describe, it, expect } from 'vitest'
describe('round 2 held-out sets are frozen data', () => {
  it('every case names a row, and no phrasing appears twice', () => {
    const all = [...NAME_HELD_OUT, ...DOOR_HELD_OUT, ...JOURNAL_HELD_OUT]
    expect(all.every(c => /^C[123]-\d{3}$/.test(c.row))).toBe(true)
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
