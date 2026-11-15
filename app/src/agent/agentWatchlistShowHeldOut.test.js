// WATCHLIST EXECUTION, group A — what the Watchlist widget SHOWS (C3-064 prebuilt / community, C3-065 Flagged, C3-067 back to the
// picker; C3-066 colour-tag lists, which the widget offers no door for, are refused). HELD-OUT phrasings, written as FAMILIES
// (templates × the fixture's list names) and committed BEFORE any change; never used to tune it. pl-exec, agent/pl/exec-watchlist.
// args = what a correct plan carries (watchlist.showList { widget, source, name }); refuse = the change UCT must not make.
const OWN = ['Momentum', 'Swing Ideas']
const PREBUILT = ['Leaders', 'Semis Watch']
const COMMUNITY = ['Breakout Club', 'Value Hunters']
const fill = (tpls, names, make) => tpls.flatMap((t, i) => names.map((n, j) => make(t.replace('{name}', n), n, (i + j) % 2)))

export const SHOW_HELD_OUT = [
  ...fill(['show my {name} list in the watchlist', 'switch the watchlist widget to {name}', 'put {name} up in my watchlist'], OWN,
    (text, name) => ({ row: 'C3-063', text, args: { source: 'mine', name } })),
  ...fill(["show the {name} list", "open UCT's {name} list in the watchlist widget", 'switch the watchlist to the prebuilt {name}'], PREBUILT,
    (text, name) => ({ row: 'C3-064', text, args: { source: 'prebuilt', name } })),
  ...fill(['open the community list {name}', 'show the {name} community watchlist', 'put the public {name} list in my watchlist'], COMMUNITY,
    (text, name) => ({ row: 'C3-064', text, args: { source: 'community', name } })),
  ...['show my flagged list', 'put my flagged tickers in the watchlist', 'switch the watchlist to Flagged'].map(text => ({ row: 'C3-065', text, args: { source: 'flagged', name: null } })),
  ...['go back to the list picker', 'take the watchlist back to its picker', 'let me pick a different list in the watchlist'].map(text => ({ row: 'C3-067', text, args: { source: 'picker', name: null } })),
]
export const SHOW_REFUSE_HELD_OUT = [
  ...['show my red tags in the watchlist', 'open the blue tag list in the widget'].map(text => ({ row: 'C3-066', text, args: { source: 'tag', name: text.includes('red') ? 'red' : 'blue' }, refuse: /Watchlists page/ })),
  { row: 'C3-064', text: 'show the Leadrs list', args: { source: 'prebuilt', name: 'Leadrs' }, refuse: /Leaders/ },
  { row: 'C3-064', text: 'open the community list Breakout', args: { source: 'community', name: 'Breakout' }, refuse: /Breakout Club/ },
  { row: 'C3-063', text: 'show my Momo list in the watchlist', args: { source: 'mine', name: 'Momo' }, refuse: /Momentum/ },
]
// two Watchlist widgets: no referent → asked; a referent → that one
export const SHOW_TWO_WIDGETS_HELD_OUT = [
  { text: 'show the Leaders list in the watchlist', which: null },
  { text: 'show the Leaders list in the left watchlist', which: 'left' },
  { text: 'put my flagged list in the right watchlist widget', which: 'right', args: { source: 'flagged', name: null } },
]

import { describe, it, expect } from 'vitest'
describe('watchlist group A held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...SHOW_HELD_OUT, ...SHOW_REFUSE_HELD_OUT, ...SHOW_TWO_WIDGETS_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
