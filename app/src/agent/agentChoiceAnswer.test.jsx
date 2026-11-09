// ANSWERS TO THE AGENT'S OWN CHOICE QUESTION (pl-exec round 8, family 4; pl-auto unseen8 class 2: "2" and "the bottom one" were
// not understood and it asked again). The answer is read against the OPTIONS IT OFFERED, never the board: a number or an ordinal
// is that place in the list, the words of one option (a position, a ticker) pick it, two that fit are asked again with just those.
// Tuning: pl-auto's own "2" and "the bottom one". Held-out: agentChoiceAnswerHeldOut. No model call is made (the question is
// UCT's own). Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { pickOffered } from './deixis'
import { CHOICE_HELD_OUT } from './agentChoiceAnswerHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const ORDER = ['c0', 'c1', 'c2', 'c3']                    // the order the question offers them (the board's reading order)
const weekly = (b) => ORDER.filter(id => (b.state.widgets.find(x => x.id === id).opts?.tf || 'D') === 'W')
async function asked() {
  // the labels the real board gives (host.js buildChartSource): "Top-left chart (SPY)"
  const m = p.mount(FOUR, SYMS, { decorate: (c) => ({ ...c, label: `${c.position[0].toUpperCase()}${c.position.slice(1)} chart (${c.symbol})` }) })
  const q = await m.say('make this chart weekly')
  expect(q).toMatch(/Which chart/)
  return m
}

describe('an answer to UCT\'s own choice question picks from what it offered', () => {
  it.each([['2', 'c1'], ['the bottom one then the left one', null]])('tuning "%s"', async (answer, want) => {
    const m = await asked()
    if (want) {
      const out = await m.say(answer)
      expect(weekly(m.board), out).toEqual([want])
      return
    }
    const out = await m.say('the bottom one')
    expect(out).toMatch(/Two of those fit: .*Bottom-left.* or .*Bottom-right.*\. Which one\?/)
    expect(weekly(m.board)).toEqual([])
    const out2 = await m.say('the left one')
    expect(weekly(m.board), out2).toEqual(['c2'])
    expect(p.turns()).toBe(0)
  }, 40000)
  it.each(CHOICE_HELD_OUT.map(c => [c.id, c.answer, c]))('held-out %s "%s"', async (_id, _a, c) => {
    const m = await asked()
    const out = await m.say(c.answer)
    if (c.want === 'ask') {
      // (the harness returns the text after the member's own words, which a one-word answer like "left" also ends in an option
      // label: the whole transcript is read)
      expect(p.transcript()).toMatch(/Two of those fit/)
      expect(weekly(m.board)).toEqual([])
    } else expect(weekly(m.board), out).toEqual([ORDER[c.want - 1]])
    expect(p.turns()).toBe(0)
  }, 40000)
  it('NEGATIVE a new request while the question is open is not taken for a pick: nothing lands on an offered chart by accident', async () => {
    const m = await asked()
    p.st.envelopes.push(p.env('answer', [], { reply: 'ok' }))
    await m.say('what is the market doing today')
    expect(weekly(m.board)).toEqual([])
  }, 40000)
  it('pickOffered reads the list only (no board): out of range, unknown words → not an answer', () => {
    const ch = [{ ref: 'a', label: 'Top-left chart (SPY)' }, { ref: 'b', label: 'Top-right chart (QQQ)' }]
    expect(pickOffered('3', ch)).toBe(null)
    expect(pickOffered('the purple one', ch)).toBe(null)
    expect(pickOffered('2', ch).ref).toBe('b')
    expect(pickOffered('spy', ch).ref).toBe('a')
    expect(pickOffered('top', ch).ask.map(c => c.ref)).toEqual(['a', 'b'])
  })
})
