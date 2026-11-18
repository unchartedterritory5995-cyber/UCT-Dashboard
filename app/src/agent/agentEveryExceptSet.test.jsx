// #988 (AUDIT ruling, option 2; LOCAL / SIMULATED): "EVERY CHART EXCEPT <a chart, a line, or a relation to the click>" names a
// SET: the board minus what the exclusion places. On 41546eab65 a correct plan for it was asked about with one-chart choices that
// left the click out (the click was treated as the relation's anchor), so the right set could not be picked at all.
// The ruling: ask, offering the WHOLE resolved set as ONE choice that names every chart; the click is in it when, and only when, a
// quantifier ("every", "all", "everything") covers it; picking it applies exactly that set; nothing is applied before the pick;
// no per-chart choices on that question.
//   (a) the family (paraphrases of AUDIT probe 11 case 10 and probe 19 case 5, plus other relations, lines, tickers, boards)
//   (b) anchor-only phrasings never offer, propose or apply the click ("the chart above this one", "every chart below this one")
// Phrasings here are pl-exec's own (not AUDIT's held-out ones).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w = 12) => ({ id, type: 'chart', x, y, w, h: 10, color: 'N', opts: { settings: bareSettings() } })
// 2×2: c0 TL · c1 TR / c2 BL · c3 BR
const B22 = { w: [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)], s: { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' } }
// 2×3: c0 c1 c2 / c3 c4 c5
const B23 = { w: [0, 1, 2, 3, 4, 5].map(i => cell(`c${i}`, (i % 3) * 8, Math.floor(i / 3) * 10, 8)), s: { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA', 'N:c4': 'AMD', 'N:c5': 'MSFT' } }
// 3×3: c0 c1 c2 / c3 c4 c5 / c6 c7 c8
const B33 = { w: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => cell(`c${i}`, (i % 3) * 8, Math.floor(i / 3) * 10, 8)), s: Object.fromEntries(['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'META', 'AAPL', 'GOOG'].map((t, i) => [`N:c${i}`, t])) }
// 1×3: c0 c1 c2
const B13 = { w: [0, 1, 2].map(i => cell(`c${i}`, i * 8, 0, 8)), s: { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA' } }

const L = (id) => `Chart (${id})`
const ref = (body, id) => body.context.charts.find(c => c.label === L(id)).ref
const weeklyOn = (ids) => (body) => p.env('apply', ids.map(id => ({ action: 'chart.setTimeframe', target: ref(body, id), args: { timeframe: 'W' } })))
const weekly = (b, board) => board.w.map(w => w.id).filter(id => b.state.widgets.find(x => x.id === id).opts?.tf === 'W').sort()
const names = (ids) => { const l = ids.map(L); return l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` }
const buttons = () => screen.queryAllByRole('button').map(b => (b.textContent || '').trim())
const choiceButtons = (board) => buttons().filter(t => board.w.some(w => t.includes(L(w.id))))
const mount = (board, clicked) => {
  const m = p.mount(board.w, board.s, { decorate: (s) => ({ ...s, label: L(s.ref) }) })
  if (clicked) p.select(clicked)
  return m
}

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))
const RELATION = /\b(?:diagonal\w*|above|below|left\s+of|right\s+of|across|opposite)\b/i
// [words, board, clicked, plan, the right set]
const SET = [
  ['set every chart to weekly except the one diagonally across from this one', B22, 'c0', ['c0', 'c1', 'c2'], ['c0', 'c1', 'c2']],
  ['make all the charts weekly apart from the two on the left', B23, 'c2', ['c1', 'c2', 'c4', 'c5'], ['c1', 'c2', 'c4', 'c5']],
  ['make every chart weekly except the one above this one', B22, 'c3', ['c0', 'c2', 'c3'], ['c0', 'c2', 'c3']],
  ['put every chart on weekly except the one to the right of this', B22, 'c0', ['c0', 'c2', 'c3'], ['c0', 'c2', 'c3']],
  ['make every chart weekly except the top row', B33, 'c4', ['c3', 'c4', 'c5', 'c6', 'c7', 'c8'], ['c3', 'c4', 'c5', 'c6', 'c7', 'c8']],
  ['make every chart weekly except the left column', B33, 'c0', ['c1', 'c2', 'c4', 'c5', 'c7', 'c8'], ['c1', 'c2', 'c4', 'c5', 'c7', 'c8']],
  ['make all of them weekly except the one to the left of this one', B13, 'c1', ['c1', 'c2'], ['c1', 'c2']],
  ['everything weekly except TSLA', B22, 'c0', ['c0', 'c1', 'c2'], ['c0', 'c1', 'c2']],
  ['switch all the charts to weekly except the chart kitty-corner from this one', B33, 'c0', ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']],
  // a WRONG plan (it includes the excluded chart): the same one-set question, the excluded chart never in it
  ['set every chart to weekly except the one diagonally across from this one', B22, 'c0', ['c0', 'c1', 'c2', 'c3'], ['c0', 'c1', 'c2']],
  ['make all the charts weekly apart from the two on the left', B23, 'c2', ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], ['c1', 'c2', 'c4', 'c5']],
  // the click excluded by the words themselves: never in the set
  ['make every chart weekly except this one', B22, 'c0', ['c1', 'c2', 'c3'], ['c1', 'c2', 'c3']],
]

describe('(a) every chart except …: one choice, the whole set, the click in it only when the quantifier covers it', () => {
  it.each(SET)('"%s" (%#)', async (words, board, clicked, plan, right) => {
    const m = mount(board, clicked)
    p.st.envelopes.push(weeklyOn(plan))
    const t = await m.say(words)
    // a correct plan the gates already let through (a line, a ticker, "except this one": no relation anchored on the click) may
    // still apply at once — exactly the right set; the option-2 question is only ever put where a gate was about to ask
    if (!/\?/.test(t) && sameSet(plan, right) && !RELATION.test(words)) { expect(weekly(m.board, board)).toEqual([...right].sort()); return }
    expect(weekly(m.board, board), 'nothing is applied before the pick').toEqual([])
    expect(t).toMatch(/\?/)
    expect(t).not.toMatch(/You said not/)
    const choices = choiceButtons(board)
    expect(choices, 'one choice, naming the whole set').toEqual([names(right)])
    expect(right.includes(clicked)).toBe(!/\bexcept\s+this\s+one\b/.test(words))
    await m.click(names(right))
    expect(weekly(m.board, board), 'the pick applies exactly the set').toEqual([...right].sort())
  }, 30000)
})

// [words, board, clicked, plan] — the click is ONLY a reference point: never offered, proposed or applied
const ANCHOR = [
  ['make the chart above this one weekly', B22, 'c2', ['c2']],
  ['make the chart above this one weekly', B22, 'c2', ['c0', 'c2']],
  ['make the one next to the one I clicked weekly', B13, 'c0', ['c0']],
  ['make everything below this one weekly', B33, 'c1', ['c1', 'c4', 'c7']],
  ['make every chart below this one weekly', B33, 'c1', ['c1', 'c4', 'c7']],
  ['make every chart below this one weekly except the bottom row', B33, 'c1', ['c1', 'c4']],
  ['make every chart to the right of this one weekly except the top row', B33, 'c3', ['c3', 'c4', 'c5']],
  ['make all the charts below this one weekly but not the bottom left', B33, 'c1', ['c1', 'c4', 'c7']],
]
describe('(b) the anchor of a relation is never offered, proposed or applied, even with "every" / "all"', () => {
  it.each(ANCHOR)('"%s" (%#)', async (words, board, clicked, plan) => {
    const m = mount(board, clicked)
    p.st.envelopes.push(weeklyOn(plan))
    await m.say(words)
    expect(weekly(m.board, board), 'the click is never applied').not.toContain(clicked)
    for (const b of buttons()) expect(b.includes(L(clicked)), `offered: ${b}`).toBe(false)
    expect(screen.queryAllByTestId('agent-proposal').map(e => e.textContent).join(' ')).not.toContain(L(clicked))
  }, 30000)
})
