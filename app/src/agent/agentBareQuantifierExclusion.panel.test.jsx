// BARE quantifier + exclusion through the REAL panel (AgentPanel + useAgent + planner + policy + runtime + the board writer).
// "set all to weekly but leave AAPL alone" was only PROPOSED ("I wasn't sure you meant …") for any AAPL, even a plain ticker.
// Per family (indicator.add, chart.setTimeframe), on a 2×2 SPY QQQ / NVDA AAPL:
//   HONOURED EXACTLY the plan on the other three charts runs at once: no question, no proposal card.
//   NEVER ACTED ON   the scripted plan ALSO names the excluded chart (apply and propose): it stays byte-for-byte as it was, is
//                    never carded and never offered.
//   FAIL-SAFE        the exclusion cannot place one chart (SPY on two charts, the one next to QQQ on a row of three): nothing
//                    applied, no candidate offered or carded.
//   OTHER MEANINGS   "remove all but RSI" style words form no chart set (unit class 3); here "the rest" with an earlier-turn
//                    chart is still only proposed.
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
const mount = (sel, syms = SYMS, ids = IDS, cols = 2) => {
  const widgets = ids.map((id, i) => ({ id, x: (i % cols) * W, y: Math.floor(i / cols) * H, w: W, h: H, type: 'chart', color: 'N', opts: { settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((x, i) => [`N:${x.id}`, syms[i]])), { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
  if (sel) p.select(sel)
  return m
}
const stored = (b, id) => JSON.stringify(b.state.widgets.find(x => x.id === id))
const transcript = () => screen.getByTestId('agent-transcript').textContent
const cardText = () => [...document.querySelectorAll('[data-testid="agent-proposal"]')].map(e => e.textContent).join(' ')
const offered = () => [...document.querySelectorAll('[data-testid="agent-transcript"] button')].flatMap(b => b.textContent.match(/Chart \((\w+)\)/g) || []).map(t => t.slice(7, -1))
const asked = () => /Which chart|Did you mean|Which charts|Pick one|You said not|wasn't sure/i.test(transcript())

const FAMILIES = {
  'indicator.add (RSI)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'indicator.add', target: body.context.indicatorEdits.find(c => c.chart === `Chart (${id})`).ref, args: { defId: 'rsi', inputs: null } }))),
    changed: (b, ids = IDS) => ids.filter(id => p.instancesOn(b, id).some(i => i.defId === 'rsi')),
    verbs: ['add RSI to all', 'put RSI on each', 'add RSI to the lot', 'add RSI to every one', 'add RSI to the rest'],
  },
  'chart.setTimeframe (weekly)': {
    plan: (disp, ids) => (body) => p.env(disp, ids.map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }))),
    changed: (b) => b.state.widgets.filter(x => (x.opts?.tf || 'D') === 'W').map(x => x.id),
    verbs: ['set all to weekly', 'make each weekly', 'set the lot to weekly', 'set every one to weekly', 'set the rest to weekly'],
  },
}
// [the exclusion, clicked chart, the chart it excludes] — the 2×2 is SPY QQQ / NVDA AAPL
const EXCL = [
  ['but leave AAPL alone', null, 'BR'],                                    // the reported sentence
  ['except QQQ', null, 'TR'],
  [', not the bottom-left one', null, 'BL'],
  ['apart from chart 1', null, 'TL'],
  [', skip the NVDA chart', null, 'BL'],
  [', keep AAPL as is', null, 'BR'],
  ['except the one diagonal from SPY', null, 'BR'],                        // the #2532 reader, under a bare quantifier
  ['but leave AAPL alone', 'TR', 'BR'],                                    // a click elsewhere: "all" still covers it
]
const CASES = Object.entries(FAMILIES).flatMap(([fam, f]) => EXCL.map(([x, sel, ex], i) => {
  let v = f.verbs[i % f.verbs.length]
  if (sel && /the rest/.test(v)) v = f.verbs[0]                            // "the rest" with a click is unit class (4)
  return [fam, `${v}${x.startsWith(',') ? '' : ' '}${x}`, sel, ex, f]
}))

describe('honoured exactly: the plan on every other chart runs at once (no question, no proposal)', () => {
  it.each(CASES)('%s · "%s" (clicked %s, excludes %s)', async (_fam, t, sel, ex, f) => {
    const m = mount(sel)
    const others = IDS.filter(id => id !== ex)
    p.st.envelopes.push(f.plan('apply', others))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(cardText(), transcript()).toBe('')
    expect(f.changed(m.board).sort(), transcript()).toEqual([...others].sort())
  }, 60000)
})

describe('never acted on: a plan that also names the excluded chart', () => {
  it.each(CASES)('%s · "%s" (clicked %s, excludes %s)', async (_fam, t, sel, ex, f) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount(sel)
      const before = stored(m.board, ex)
      p.st.envelopes.push(f.plan(disp, IDS))
      await m.say(t)
      expect(stored(m.board, ex), transcript()).toBe(before)
      expect(f.changed(m.board), transcript()).not.toContain(ex)
      expect(cardText(), transcript()).not.toContain(`Chart (${ex})`)
      expect(offered(), transcript()).not.toContain(ex)
    }
  }, 60000)
})

describe('fail-safe: an exclusion that does not place one chart — nothing applied, no candidate offered', () => {
  it.each(Object.entries(FAMILIES).flatMap(([fam, f]) => [
    [fam, `${f.verbs[0]} but leave SPY alone`, ['SPY', 'QQQ', 'NVDA', 'SPY'], IDS, 2, ['TL', 'BR'], f],         // SPY on two charts
    [fam, `${f.verbs[1]} except SPY`, ['SPY', 'QQQ', 'NVDA', 'SPY'], IDS, 2, ['TL', 'BR'], f],
    [fam, `${f.verbs[0]}, skip the one next to QQQ`, ['SPY', 'QQQ', 'NVDA'], ['L', 'M', 'R'], 3, ['L', 'R'], f],   // two neighbours
  ]))('%s · "%s"', async (_fam, t, syms, ids, cols, never, f) => {
    for (const disp of ['apply', 'propose']) {
      cleanup(); p = setupPanel()
      const m = mount(null, syms, ids, cols)
      const before = ids.map(id => stored(m.board, id))
      p.st.envelopes.push(f.plan(disp, ids))
      await m.say(t)
      expect(ids.map(id => stored(m.board, id)), transcript()).toEqual(before)
      for (const id of never) {
        expect(offered(), transcript()).not.toContain(id)
        expect(cardText(), transcript()).not.toContain(`Chart (${id})`)
      }
    }
  }, 60000)
})

describe('"the rest" after an earlier turn is not read as every chart: still only proposed', () => {
  it.each(Object.entries(FAMILIES))('%s', async (_fam, f) => {
    const m = mount(null)
    // turn 1: change SPY (the earlier-turn chart)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === 'Chart (TL)').ref, args: { timeframe: 'M' } }]))
    await m.say('set SPY to monthly')
    const tl = stored(m.board, 'TL')
    // turn 2: "the rest" may be the rest of SPY — a plan that rewrites SPY is never applied at once
    p.st.envelopes.push(f.plan('apply', ['TL', 'TR', 'BL']))
    await m.say(`${f.verbs[4]} but leave AAPL alone`)
    expect(stored(m.board, 'TL'), transcript()).toBe(tl)
    expect(stored(m.board, 'BR'), transcript()).not.toContain('"tf":"W"')
  }, 60000)
})
