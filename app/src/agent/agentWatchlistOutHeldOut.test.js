// WATCHLIST EXECUTION, group D — a list OUT of the Watchlist widget (C3-094 copy to the clipboard, C3-095 export CSV / Excel) and
// colour tags (C3-090: not on /charts — refused). HELD-OUT phrasings, written as FAMILIES (templates × list names / formats) and
// committed BEFORE any change; never used to tune it. pl-exec, agent/pl/exec-watchlist. args = a correct plan's
// watchlist.exportList { widget, format }; propose = the Excel export (a quota) is shown first; refuse = never done.
const LISTS = ['Momentum', 'Swing Ideas']
const fill = (tpls, make) => tpls.flatMap((t, i) => LISTS.map((n, j) => make(t.replace('{name}', n), n, (i + j) % 2)))

export const OUT_HELD_OUT = [
  ...fill(['copy the {name} list to my clipboard', 'put the tickers in {name} on the clipboard', 'copy my {name} watchlist so I can paste it'],
    (text, name) => ({ row: 'C3-094', text, list: name, args: { format: 'clipboard' } })),
  ...fill(['export {name} as a CSV', 'download the {name} list as csv', 'save my {name} watchlist to a csv file'],
    (text, name) => ({ row: 'C3-095', text, list: name, args: { format: 'csv' } })),
  ...fill(['export {name} to Excel', 'download the {name} watchlist as an excel file', 'give me {name} as an xlsx'],
    (text, name) => ({ row: 'C3-095', text, list: name, args: { format: 'xlsx' }, propose: true })),
]
export const OUT_REFUSE_HELD_OUT = [
  // the widget shows a list that is not the member's own: copy is the menu's for any list, export is not
  { row: 'C3-095', text: 'export this watchlist as a csv', shows: 'community', args: { format: 'csv' }, refuse: /your own lists/ },
  { row: 'C3-095', text: 'download the flagged list to excel', shows: 'flagged', args: { format: 'xlsx' }, refuse: /your own lists/ },
]
export const TAG_HELD_OUT = [
  ...['tag NVDA red', 'colour tag AMD blue', 'mark TSLA with a green tag', 'give META a purple tag'].map(text => ({ row: 'C3-090', text })),
]

import { describe, it, expect } from 'vitest'
describe('watchlist group D held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...OUT_HELD_OUT, ...OUT_REFUSE_HELD_OUT, ...TAG_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
