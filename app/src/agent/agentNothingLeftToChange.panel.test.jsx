// NOTHING LEFT TO CHANGE through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board writer). AUDIT
// 11-23: "set all to weekly but leave the daily ones alone" with every chart on daily was asked "Which chart do you mean? Pick
// one:" — every choice a chart the member had excluded. Per family (chart.setTimeframe, indicator.add), on a 2×2, with a scripted
// plan on all four charts (apply and propose):
//   COVER       an exclusion that is every chart (a timeframe every chart is on, a ticker every chart shows, both rows, two
//               timeframe descriptions together): ONE plain sentence ("…that leaves nothing to change. Nothing has changed."), no
//               question, no choice, no proposal card, every chart byte-for-byte as it was.
//   UNCHANGED   a partial timeframe cover is still asked (nothing applied); a placed partial exclusion still runs on exactly the
//               other charts; an exclusion the board cannot place is still not applied. None of them says "nothing to change".
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const W = 12, H = 10
const IDS = ['TL', 'TR', 'BL', 'BR']
const SYMS = ['SPY', 'QQQ', 'NVDA', 'AAPL']
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const mount = ({ syms = SYMS, tfs = [] } = {}) => {
  const widgets = IDS.map((id, i) => ({ id, x: (i % 2) * W, y: Math.floor(i / 2) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings(), ...(tfs[i] ? { tf: tfs[i] } : {}) } }))
  return p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, syms[i]])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
}
const stored = (b, id) => JSON.stringify(b.state.widgets.find(x => x.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const buttons = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].map(b => b.textContent).filter(t => /Chart \(/.test(t))
const asked = () => /Which chart|Did you mean|Which charts|Pick one|You said not|wasn't sure/i.test(transcript())
const NOTHING = /so that leaves nothing to change\. Nothing has changed\./

const FAMILIES = {
  'chart.setTimeframe (monthly)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'M' } }))),
    changed: (b) => b.state.widgets.filter(x => x.opts?.tf === 'M').map(x => x.id),
    verbs: ['set all to monthly', 'set every chart to monthly', 'make each monthly', 'set everything to monthly'],
  },
  'indicator.add (RSI)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'indicator.add', target: body.context.indicatorEdits.find(c => c.chart === `Chart (${id})`).ref, args: { defId: 'rsi', inputs: null } }))),
    changed: (b) => IDS.filter(id => p.instancesOn(b, id).some(i => i.defId === 'rsi')),
    verbs: ['add RSI to all', 'add RSI to every chart', 'put RSI on each', 'add RSI to everything'],
  },
}
// [the exclusion, the board, the reason the sentence gives]
const COVERS = [
  ['but leave the daily ones alone', {}, /Every chart here is on daily/],                       // the AUDIT sentence
  ['except the daily charts', {}, /Every chart here is on daily/],
  ['but not the daily ones', {}, /Every chart here is on daily/],
  [", but don't touch the dailies", {}, /Every chart here is on daily/],
  [', skip the weekly ones', { tfs: ['W', 'W', 'W', 'W'] }, /Every chart here is on weekly/],
  ['but leave SPY alone', { syms: ['SPY', 'SPY', 'SPY', 'SPY'] }, /Every chart here shows SPY/],
  ['except the SPY charts', { syms: ['SPY', 'SPY', 'SPY', 'SPY'] }, /Every chart here shows SPY/],
  ['except the top row and the bottom row', {}, /all 4 charts here/],
  ['but leave the daily ones and the weekly one alone', { tfs: ['W'] }, /all 4 charts here/],
]
const CASES = Object.entries(FAMILIES).flatMap(([fam, f]) => COVERS.map(([x, board, why], i) => [fam, `${f.verbs[i % f.verbs.length]}${x.startsWith(',') ? '' : ' '}${x}`, board, why, f]))

describe('cover: one plain sentence, nothing applied, nothing asked or carded', () => {
  it.each(CASES)('%s · "%s"', async (_fam, t, board, why, f) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount(board)
      const before = IDS.map(id => stored(m.board, id))
      p.st.envelopes.push(f.plan(disp, IDS))
      await m.say(t)
      expect(transcript(), disp).toMatch(NOTHING)
      expect(transcript(), disp).toMatch(why)
      expect(asked(), transcript()).toBe(false)
      expect(cardText(), transcript()).toBe('')
      expect(buttons(), transcript()).toEqual([])
      expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
      expect(f.changed(m.board), transcript()).toEqual([])
    }
  }, 60000)
})

describe('unchanged: a partial cover or an unplaceable exclusion decides as before (never "nothing to change")', () => {
  it.each(Object.entries(FAMILIES))('%s · a PARTIAL timeframe cover (one chart weekly) is still asked; nothing applied', async (_fam, f) => {
    const m = mount({ tfs: ['W'] })
    const before = IDS.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', IDS))
    await m.say(`${f.verbs[0]} but leave the daily ones alone`)
    expect(transcript()).not.toMatch(NOTHING)
    expect(asked(), transcript()).toBe(true)
    expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
  }, 60000)
  it.each(Object.entries(FAMILIES))('%s · a placed PARTIAL exclusion still runs on exactly the other charts', async (_fam, f) => {
    const m = mount()
    p.st.envelopes.push(f.plan('apply', ['TL', 'TR', 'BL']))
    await m.say(`${f.verbs[0]} but leave AAPL alone`)
    expect(transcript()).not.toMatch(NOTHING)
    expect(asked(), transcript()).toBe(false)
    expect(f.changed(m.board).sort(), transcript()).toEqual(['BL', 'TL', 'TR'])
  }, 60000)
  it.each(Object.entries(FAMILIES))('%s · a ticker on SOME charts (SPY twice) is still not applied, its charts never offered', async (_fam, f) => {
    const m = mount({ syms: ['SPY', 'QQQ', 'NVDA', 'SPY'] })
    const before = IDS.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', IDS))
    await m.say(`${f.verbs[0]} but leave SPY alone`)
    expect(transcript()).not.toMatch(NOTHING)
    expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
    expect(buttons().join(' '), transcript()).not.toMatch(/Chart \((TL|BR)\)/)
  }, 60000)
  it.each(Object.entries(FAMILIES))('%s · an exclusion the board cannot place ("the big chart") is still not applied', async (_fam, f) => {
    const m = mount()
    const before = IDS.map(id => stored(m.board, id))
    p.st.envelopes.push(f.plan('apply', IDS))
    await m.say(`${f.verbs[0]} but leave the big chart alone`)
    expect(transcript()).not.toMatch(NOTHING)
    expect(IDS.map(id => stored(m.board, id)), transcript()).toEqual(before)
  }, 60000)
})
