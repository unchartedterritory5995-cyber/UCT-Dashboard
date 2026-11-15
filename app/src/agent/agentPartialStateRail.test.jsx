// ⛔ THE HONEST PARTIAL RECEIPT × THE STATE RAIL (#1289 × #1247, 2026-11-14) — through the REAL panel, the model scripted.
// Step 1 of a request lands (its receipt above); step 2 is HELD by the state rail at its own turn — here the save-over CARD
// (D19: an irreversible save over the open layout is confirmed on its card). What the member reads must stay true: step 1 went
// through, step 2 is WAITING — never "I didn't change anything", never "the rest was done", never a save claimed.
// Control: when the state rail stops the request BEFORE anything runs (a later step it reads up front), "I didn't change
// anything" is the truth and stays.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { FOLLOWUP_WAITS_CARD } from './useAgent'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const NEVER = /I didn['’]t change anything|The rest of your request was done|Saved/
const pendingCards = () => screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')
const openLayout = () => {
  const widgets = [{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: bareSettings() } }]
  return p.mount(widgets, { 'N:c': 'SPY' }, { layouts: { entries: [{ id: 1, name: 'Main', kind: 'yours', scope: 'user' }], active: 1, boards: { 1: widgets } } })
}
const tfOf = (board) => board.state.widgets.find(w => w.id === 'c').opts?.tf || 'D'
const saved = (board) => board.state.layouts.calls.some(c => c[0] === 'saveCurrent')

// phrased so no instant reader takes them: the MODEL plans both steps
const WORDS = ['weekly would be better here, and then keep it like that in what my layout has saved',
  'a weekly view suits me, and afterwards store that over the layout I have open', 'go to weekly please, then write that into my current layout']

describe('step 1 lands; step 2 is CARDED by the state rail (a save over the open layout)', () => {
  it.each(WORDS)('"%s" → weekly now; the save waits on its card; the message says the change went through and the save waits', async (said) => {
    const m = openLayout()
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setTimeframe', target: 'c', args: { timeframe: 'W' } }, { action: 'layout.saveCurrent', target: 'layouts', args: {} }]))
    const out = await m.say(said)
    expect(p.turns(), 'the model planned it').toBe(1)
    expect(tfOf(m.board), out).toBe('W')                                  // step 1 landed
    expect(saved(m.board), out).toBe(false)                               // step 2 held: nothing saved
    expect(pendingCards(), out).toHaveLength(1)
    expect(out).toContain(FOLLOWUP_WAITS_CARD)
    expect(out).not.toMatch(NEVER)
    await m.click('Apply')
    expect(saved(m.board)).toBe(true)                                     // and the card still does what it says
  }, 40000)
})

describe('control: the state rail stops the request before anything runs → "I didn\'t change anything" is true', () => {
  it('additive words, a later step that overwrites an indicator: nothing runs, said as nothing changed', async () => {
    const m = p.mount([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'SPY' })
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'indicator.add', target: b.context.indicatorEdits[0].ref, args: { defId: 'rsi', inputs: null } },
      { action: 'indicatorStyle.set', target: b.context.indicatorEdits[0].ref, args: { instance: 'ovl:1', property: 'color', value: 'blue', output: null } },
    ]))
    const out = await m.say('could you add an RSI for me and get the 20 EMA going in blue as well, thanks')
    expect(p.instancesOn(m.board, 'c').some(i => i.defId === 'rsi'), out).toBe(false)
    expect(out).toMatch(/I didn['’]t change anything: you asked to add/)
    expect(out).not.toContain(FOLLOWUP_WAITS_CARD)
  }, 40000)
})
