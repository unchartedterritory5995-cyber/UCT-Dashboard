// #988 (AUDIT item 3; LOCAL / SIMULATED): the instant path never CLAIMS "every chart except <a relation to the click>".
// Such a sentence names a SET whose edge is placed relative to the chart the member clicked; only the gated model path
// (agentEveryExceptSet) asks it as one choice. The instant path must fall through to the model or ask, never apply, and
// never put up a card of its own. Here the model is queued NOTHING: any change to the board, or a card, can only have come
// from the instant path claiming the sentence.
//   (a) every change verb the instant path knows, each with a relation to the click and a different exclusion word
//   (b) the same, read straight off fastParse with the mounted board as host: never an `ops` result
// Phrasings are pl-exec's own.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const { registerBuiltins } = await import('./builtins')
const { setupPanel, bareSettings, MODEL_SENTINEL } = await import('./testing/panelHarness')
const { fastParse } = await import('./fastPath')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w = 8) => ({ id, type: 'chart', x, y, w, h: 10, color: 'N', opts: { settings: bareSettings() } })
// 3×3: c0 c1 c2 / c3 c4 c5 / c6 c7 c8
const B33 = { w: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => cell(`c${i}`, (i % 3) * 8, Math.floor(i / 3) * 10)), s: Object.fromEntries(['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'META', 'AAPL', 'GOOG'].map((t, i) => [`N:c${i}`, t])) }
const L = (id) => `Chart (${id})`
const mount = (clicked) => {
  const m = p.mount(B33.w, B33.s, { decorate: (s) => ({ ...s, label: L(s.ref) }) })
  p.select(clicked)
  return m
}
const snapshot = (m) => JSON.stringify(m.board.state.widgets.map(w => ({ id: w.id, opts: w.opts })))

// [words, clicked] — the clicked chart is the middle one unless the relation needs an edge
const CASES = [
  ['set every chart to daily except the one under this one', 'c4'],
  ['put all the charts on the 5 minute apart from the one beside this one', 'c4'],
  ['hide volume on every chart but not the chart to the left of this one', 'c4'],
  ['add the 20 EMA to all charts other than the one diagonal from this one', 'c0'],
  ['make every chart weekly excluding the one right above the chart I clicked', 'c4'],
  ['switch all of them to monthly besides the one opposite this one', 'c0'],
  ['show volume on every chart aside from the one to the right of this', 'c3'],
  ['remove the 50 SMA from every chart except the one below the selected chart', 'c1'],
  ['turn every chart to the hourly except for the one next to the one I picked', 'c4'],
  ['change all charts to weekly save the one kitty corner from this one', 'c8'],
  ['every chart daily except the one over this one', 'c7'],
  ['all charts weekly except the ones beside this one', 'c4'],
]

describe('(a) "every chart except <relation to the click>" never applies or cards on the instant path', () => {
  it.each(CASES)('"%s" (%#)', async (words, clicked) => {
    const m = mount(clicked)
    const before = snapshot(m)
    const t = await m.say(words)
    expect(snapshot(m), 'nothing changed before the model or a question').toBe(before)
    expect(screen.queryAllByTestId('agent-proposal'), 'no instant card').toEqual([])
    // it reached the model (the queued-nothing reply is shown) or it asked
    expect(p.turns() >= 1 || /\?/.test(t), `neither the model nor a question: ${t}`).toBe(true)
    if (p.turns() >= 1) expect(t).toContain(MODEL_SENTINEL)
  }, 30000)
})

describe('(b) fastParse never returns ops for it', () => {
  it.each(CASES)('"%s" (%#)', (words, clicked) => {
    const m = mount(clicked)
    const r = fastParse(words, { host: m.h })
    expect(r?.kind, JSON.stringify(r)).not.toBe('ops')
  })
})

// (c) control: the detector sees an instant claim — the same verbs on the clicked chart alone ARE applied with no model call
describe('(c) control: the instant path does claim the plain one-chart change', () => {
  it.each([['set this chart to weekly', 'c4'], ['hide volume on this chart', 'c4']])('"%s" (%#)', async (words, clicked) => {
    const m = mount(clicked)
    const before = snapshot(m)
    await m.say(words)
    expect(p.turns(), 'no model call').toBe(0)
    expect(snapshot(m), 'the instant path applied it').not.toBe(before)
  }, 30000)
  // the instant path DOES claim "every chart <change>" with no exception (target all) — so it is the exception clause, not the
  // quantifier, that sends the sentences above to the model
  it.each(['set every chart to weekly', 'hide volume on all charts'])('fastParse claims "%s" for every chart', (words) => {
    const m = mount('c4')
    const r = fastParse(words, { host: m.h })
    expect(r?.kind).toBe('ops')
    expect(r?.target).toEqual({ all: true })
  })
})
