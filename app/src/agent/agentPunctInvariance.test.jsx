// AUDIT condition on #1259: a trailing punctuation mark may change only WHETHER a phrase is read, never WHAT it is read as.
// Invariance rail: fastParse(text + p) must equal fastParse(text) for p in . , ! ? ; : — same ops, refusals and asks — and the
// real panel (scripted, no model call) must end in the same board and the same reply. Includes single letters that are also
// timeframe / scale codes ("switch to W.", "flip it to D.", "make it M.", "go to H.", "set it to 1h.").
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

export const MARKS = ['.', ',', '!', '?', ';', ':']
const CODES = ['W', 'D', 'M', 'H', '1h', '5m', '1D', 'weekly', 'daily', 'log', 'linear']
const LEADS = ['switch to', 'flip it to', 'make it', 'go to', 'set it to', 'change to', 'change this chart to', 'show', 'pull up', 'Switch to', 'Show', 'Open', 'chart', 'load']
const SYMS = ['AMD', 'TSLA', 'BRK.B', 'nvda', '$AMD', '$BRK.B', 'IT', 'ALL', 'NOW', 'ON', 'V', 'ZZQX']
const OTHER = ['undo', 'show volume', 'hide volume', 'switch to candles', 'switch to log scale', 'show my alerts', 'switch to weekly', 'go to the 1h', 'change the ticker to amd', '$AMD', 'AMD']
const BASES = [...new Set([...LEADS.flatMap(l => [...CODES, ...SYMS].map(x => `${l} ${x}`)), ...OTHER])]

const host = () => ({ surface: 'charts' })
const read = (t) => { try { return JSON.stringify(fastParse(t, { host: host() })) } catch (e) { return `throw:${e.message}` } }

describe('fast reader: a trailing mark never changes what is read', () => {
  const CASES = BASES.flatMap(b => MARKS.map(p => [b, p]))
  it('generated', () => expect(CASES.length).toBeGreaterThan(1000))
  it.each(CASES)('"%s" + "%s"', (b, p) => expect(read(`${b}${p}`)).toBe(read(b)))
})

let pp
beforeEach(() => { pp = setupPanel({ tickers: ['BRK.B'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = pp.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) pp.select(sel)
  return m
}
const transcript = () => screen.getByTestId('agent-transcript').textContent.replace(/\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM)?/gi, '')
const outcome = async (t, syms, sel) => {
  const m = mount(syms, sel)
  pp.st.envelopes.push(pp.env('answer', [], 'scripted'))
  await m.say(t)
  const r = { board: JSON.stringify(m.board.state.widgets), syms: JSON.stringify(m.board.state.groupSyms), said: transcript().replace(t, '<T>'), turns: pp.st.calls.filter(c => String(c[1]).includes('/api/agent/turn')).length }
  cleanup()
  return r
}
const PANEL = ['switch to AMD', 'switch to W', 'flip it to D', 'make it M', 'go to H', 'set it to 1h', 'pull up BRK.B', 'switch to ZZQX', 'switch to nvda', 'show volume']
const BOARDS = [['one chart', ['SPY'], null], ['clicked chart', ['SPY', 'NVDA'], 'w0']]
describe('real panel: a trailing mark never changes the outcome', () => {
  const CASES = PANEL.flatMap(b => BOARDS.flatMap(([ctx, syms, sel]) => MARKS.map(p => [b, p, ctx, syms, sel])))
  it.each(CASES)('"%s" + "%s" (%s)', async (b, p, ctx, syms, sel) => {
    const base = await outcome(b, syms, sel)
    pp = setupPanel({ tickers: ['BRK.B'] })
    const marked = await outcome(`${b}${p}`, syms, sel)
    expect(marked).toEqual(base)
  }, 60000)
})
