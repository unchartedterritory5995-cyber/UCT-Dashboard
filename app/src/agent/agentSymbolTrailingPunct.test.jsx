// fix-symbol-trailing-punct: trailing sentence punctuation and closing quotes/brackets are never part of a ticker.
// "switch to AMD." was refused by the instant symbol path as “AMD.” ("Did you mean AMD?"), nothing written.
// Generated: symbols × trailing punctuation × verb shapes × { one chart, a clicked chart on a two-chart board } through the
// REAL panel (panelHarness, no model call: the instant path answers). Dotted symbols keep their inner dot; an unknown symbol
// still gets the honest "no symbol" reply.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { stripTrailingPunct } from './capabilities/chart'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel({ tickers: ['BRK.B', 'BF.B'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const turns = () => p.st.calls.filter(c => String(c[1]).includes('/api/agent/turn')).length

const PUNCT = ['.', ',', '!', '?', ';', ':', ')', '."', ".'", '!!', ' .', '”', ']']
const VERBS = [(T) => `switch to ${T}`, (T) => `show ${T}`, (T) => `pull up ${T}`, (T) => `change this chart to ${T}`, (T) => `Switch to ${T}`]
const SYMS = ['AMD', 'TSLA', 'BRK.B']
const BOARDS = [['one chart', ['SPY'], null], ['clicked chart', ['SPY', 'NVDA'], 'w0']]

describe('the instant reader: a trailing mark is stripped, an inner dot is kept', () => {
  const fast = (raw) => getCapability('chart.setSymbol').fast({ raw, host: null })
  const CASES = SYMS.flatMap(T => VERBS.flatMap(v => PUNCT.map(q => [`${v(T)}${q}`, T])))
  it('generated: 3 symbols × 5 verbs × 13 marks', () => expect(CASES).toHaveLength(195))
  it.each(CASES)('"%s" → %s', (t, T) => expect(fast(t)).toEqual({ symbol: T }))
  it('the bare forms are unchanged', () => {
    expect(fast('switch to AMD')).toEqual({ symbol: 'AMD' })
    expect(fast('$BRK.B')).toEqual({ symbol: 'BRK.B' })
    expect(fast('$BRK.B.')).toEqual({ symbol: 'BRK.B' })
    expect(fast('show volume.')).toBe(null)
  })
  it('stripTrailingPunct keeps inner symbol characters', () => {
    for (const [a, b] of [['BRK.B.', 'BRK.B'], ['BF.B!', 'BF.B'], ['RDS-A.', 'RDS-A'], ['^GSPC?', '^GSPC'], ['$SPX.', '$SPX'], ['AMD."', 'AMD'], ['BRK.B', 'BRK.B']]) expect(stripTrailingPunct(a)).toBe(b)
  })
})

describe('through the panel: the symbol change happens', () => {
  const CASES = ['AMD', 'BRK.B'].flatMap(T => [(x) => `switch to ${x}`, (x) => `pull up ${x}`].flatMap(v => ['.', '!', '."', '?'].flatMap(q => BOARDS.map(([ctx, syms, sel]) => [`${v(T)}${q}`, ctx, syms, sel, T]))))
  it('generated: 2 symbols × 2 verbs × 4 marks × 2 boards', () => expect(CASES).toHaveLength(32))
  it.each(CASES)('"%s" (%s)', async (t, ctx, syms, sel, T) => {
    const m = mount(syms, sel)
    const before = syms.length > 1 ? symOf(m.board, 'w1') : null
    await m.say(t)
    expect(transcript()).not.toMatch(/has no symbol|Did you mean/)
    expect(symOf(m.board, 'w0'), transcript()).toBe(T)
    if (syms.length > 1) expect(symOf(m.board, 'w1')).toBe(before)
    expect(turns()).toBe(0)
  }, 60000)
})

describe('an unknown symbol still gets the honest reply', () => {
  it.each(['switch to ZZQX.', 'switch to ZZQX', 'pull up ZZQX!'])('"%s" → "UCT has no symbol “ZZQX”", nothing written', async (t) => {
    const m = mount(['SPY'], null)
    await m.say(t)
    expect(transcript()).toMatch(/UCT has no symbol “ZZQX”/)
    expect(symOf(m.board, 'w0')).toBe('SPY')
  }, 60000)
})
