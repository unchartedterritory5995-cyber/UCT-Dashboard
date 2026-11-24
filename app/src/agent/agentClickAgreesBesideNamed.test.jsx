// e2-t05 (AUDIT 11-24, pre-existing on both routings): the CLICK AGREES and ANOTHER clause names its own chart — "linear here, and
// log on MSFT", "make this one linear and put MSFT on log" with META clicked — asked "Did you mean Chart (META)?" (deixis.
// screenDeicticOps: the click's word made every op deictic, and the op on MSFT "disagreed" with the click). The clause with the click
// word names no other chart, and MSFT is named by a clause of its own: a plan writing exactly the click and MSFT does what the words
// say (deixis.clickAgreesBesideNamed). GENERATED, both routings (routing set explicitly, routingV2Active() asserted every turn);
// through the REAL panel; the model plan scripted as the ideal plan. Guards: a pronoun that could mean the named chart, a plan that
// writes only the named chart, and a keep clause still ask / never write the chart left alone. No paid call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { routingV2Active } from './nlm1/flag'
import { _resetTurns } from './trace'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

// the click's word, said where a place goes ("here") or as the chart ("this one", "this chart", "the selected chart")
const DEIXIS = [['here', 'here'], ['this one', 'on this one'], ['this chart', 'on this chart'], ['the selected chart', 'on the selected chart']]
// [wording, the click clause, the named clause, the ideal plan]
const WORDINGS = [
  ['scale', (on) => `switch to linear ${on}`, 'put MSFT on log', [['scale', 'META', 'linear'], ['scale', 'MSFT', 'log']]],
  ['add', (on) => `add RSI ${on}`, 'add a 20 EMA to MSFT', [['rsi', 'META'], ['ema', 'MSFT']]],
  ['correction', (on) => `actually, back to linear ${on}`, 'log goes on MSFT', [['scale', 'META', 'linear'], ['scale', 'MSFT', 'log']]],
]
export const AGREE = DEIXIS.flatMap(([d, on]) => WORDINGS.flatMap(([w, click, named, plan]) => [
  [`${click(on)} and ${named}`, d, w, 'click first', plan],
  [`${named} and ${click(on)}`, d, w, 'named first', plan]]))
// KEEP: the named clause leaves its chart alone — the click's change only, and a plan that also writes the kept chart never does
export const KEEP = DEIXIS.flatMap(([d, on]) => [`switch to weekly ${on}, but leave MSFT alone`, `leave MSFT alone and switch to weekly ${on}`]
  .flatMap(t => [[t, d, 'plan: META only'], [t, d, 'plan: META and MSFT']]))
// GUARDS: a pronoun that could mean the named chart (G1b / G2 class) — asked, nothing changed
export const GUARD = [['it', (n) => `add RSI to it and ${n}`, (n) => `${n} and add RSI to it`], ['that chart', (n) => `add RSI to that chart and ${n}`, (n) => `${n} and add RSI to that chart`],
  ['that one', (n) => `add RSI to that one and ${n}`, (n) => `${n} and add RSI to that one`]].flatMap(([a, f, g]) => [[f('put MSFT on log'), a], [g('put MSFT on log'), a]])

let p
const transcript = () => screen.getByTestId('agent-transcript').textContent
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const asked = () => /Which chart|Did you mean|nothing has changed yet/i.test(transcript())
const ID = { MSFT: 'w0', META: 'w1' }
const ref = (body, s) => body.context.charts.find(c => c.label === `Chart (${s})`).ref
const ixe = (body, s) => body.context.indicatorEdits.find(x => x.symbol === s).ref
const OP = {
  scale: (b, s, v) => ({ action: 'chart.setScale', target: ref(b, s), args: { scale: v } }),
  rsi: (b, s) => ({ action: 'indicator.add', target: ixe(b, s), args: { defId: 'rsi' } }),
  ema: (b, s) => ({ action: 'indicator.add', target: ixe(b, s), args: { defId: 'ema', inputs: [{ key: 'period', value: 20 }] } }),
  weekly: (b, s) => ({ action: 'chart.setTimeframe', target: ref(b, s), args: { timeframe: 'W' } }),
}
const did = {
  scale: (b, s, v) => (v === 'log' ? /"logScale":true/.test(stored(b, ID[s])) : !/"logScale":true/.test(stored(b, ID[s]))),
  rsi: (b, s) => p.brief(b, ID[s]).some(x => x.startsWith('rsi')),
  ema: (b, s) => p.brief(b, ID[s]).includes('movingAverage(20 ema)'),
}

for (const v2 of [false, true]) describe(`click agrees beside a named chart [routing ${v2 ? 'v2' : 'v1'}]`, () => {
  beforeEach(async () => {
    p = setupPanel(); _resetTurns()
    const inner = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init = {}) => (url === '/api/agent/config'
      ? new Response(JSON.stringify({ conversations: [], routing_v2: v2 }), { status: 200, headers: { 'content-type': 'application/json' } })
      : inner(url, init)))
    try { localStorage.setItem('uct.agent.routingV2', v2 ? '1' : '0') } catch { /* */ }
    _resetAgentConfig(); await loadAgentConfig()
    expect(routingV2Active()).toBe(v2)
  })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  // MSFT left, META right and CLICKED; a first turn put log on META (the case e2-t05), so a correction has something to correct
  const board = async () => {
    const widgets = ['MSFT', 'META'].map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
    const m = p.mount(widgets, { 'N:w0': 'MSFT', 'N:w1': 'META' })
    p.select('w1')
    p.st.envelopes.push((body) => p.env('apply', [OP.scale(body, 'META', 'log')]))
    await m.say('log scale on this')
    expect(did.scale(m.board, 'META', 'log'), transcript()).toBe(true)
    p.st.envelopes.length = 0
    expect(routingV2Active()).toBe(v2)
    return m
  }

  it('the families are generated: AGREE 24 (4 deixis × 3 wordings × 2 orders), KEEP 16, GUARD 6', () => {
    expect(AGREE).toHaveLength(24); expect(KEEP).toHaveLength(16); expect(GUARD).toHaveLength(6)
  })

  it.each(AGREE)('"%s" (%s · %s · %s): the click\'s change on META, the named one on MSFT — never asked', async (t, _d, _w, _o, plan) => {
    const m = await board()
    p.st.envelopes.push((body) => p.env('apply', plan.map(([k, s, v]) => OP[k](body, s, v))))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    for (const [k, s, v] of plan) expect(did[k](m.board, s, v), `${k} ${s}: ${transcript()}`).toBe(true)
  }, 60000)

  it.each(KEEP)('KEEP "%s" (%s, %s): MSFT never touched', async (t, _d, plan) => {
    const m = await board()
    const msft0 = stored(m.board, 'w0')
    const both = plan.includes('MSFT')
    p.st.envelopes.push((body) => p.env('apply', [OP.weekly(body, 'META'), ...(both ? [OP.weekly(body, 'MSFT')] : [])]))
    await m.say(t)
    expect(stored(m.board, 'w0'), transcript()).toBe(msft0)
    if (!both) expect(tfOf(m.board, 'w1'), transcript()).toBe('W')
  }, 60000)

  it.each(GUARD)('GUARD "%s" (a pronoun, %s, that could mean MSFT): asked, nothing changed', async (t) => {
    const m = await board()
    const before = [stored(m.board, 'w0'), stored(m.board, 'w1')]
    p.st.envelopes.push((body) => p.env('apply', [OP.rsi(body, 'META'), OP.scale(body, 'MSFT', 'log')]))
    await m.say(t)
    expect([stored(m.board, 'w0'), stored(m.board, 'w1')], transcript()).toEqual(before)
    expect(asked(), transcript()).toBe(true)
  }, 60000)

  it('the plan writes ONLY the named chart (the click\'s clause dropped): asked, nothing changed', async () => {
    const m = await board()
    const before = [stored(m.board, 'w0'), stored(m.board, 'w1')]
    p.st.envelopes.push((body) => p.env('apply', [OP.scale(body, 'MSFT', 'log'), OP.rsi(body, 'MSFT')]))
    await m.say('add RSI here and put MSFT on log')
    expect([stored(m.board, 'w0'), stored(m.board, 'w1')], transcript()).toEqual(before)
    expect(asked(), transcript()).toBe(true)
  }, 60000)
})
