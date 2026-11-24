/* eslint-disable react-refresh/only-export-components -- a test suite module: the generated row tables beside the suite */
// G1 / G2 (LIVE production, routing v2): two silent wrong-chart paths (AUDIT 11-23, the pl-g12 scope report).
//   G1   "Change SPY to the 1-hour timeframe, add a 20 EMA to it, and do the same on this one." with NO click: the NLM-1 split
//        committed step 1, fell back (the step was taken back), and the subject that taken-back step left in memory switched
//        every target rail off — the plan ran on SPY and "this one" was dropped.
//   G2   "Change SPY to the 1-hour timeframe, add a 20 EMA to it." with the NVDA chart CLICKED: the NLM-1 instant writes (a
//        follow-up aimed at a set, the split steps) never ran the click-vs-words rule — both ops on SPY, or op 1 on SPY and op 2
//        on the click.
// THE RULE: the target of a write comes from the typed words, the click, or a live prior-turn subject — never a guess. A
// deictic with no grounded referent, or one that conflicts with an explicit click, is ASKED and nothing changes.
// Every row is GENERATED and runs on BOTH routings, set explicitly (the config answered, the browser key set, routingV2Active()
// asserted before every turn). Through the REAL panel (panelHarness: AgentPanel + useAgent + the board writer + Undo); the model
// plan scripted as the p0fix suite scripts it (every op on SPY). No paid call. Evidence: LOCAL / SIMULATED (jsdom, scripted plans).
//
// SLICED (the tickerCompoundExclusionSuite pattern): every it.each table goes through `mine(...)`, the single tests run in slice 0
// only, and the describe / test names never vary by slice — agentTargetGateG1G2.<k>.test.jsx call this with k = 0..SLICES-1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { setupPanel, bareSettings } from './panelHarness'
import { loadAgentConfig, _resetAgentConfig } from '../agentClient'
import { routingV2Active } from '../nlm1/flag'
import { _resetTurns } from '../trace'
import { rewriteClauses } from '../nlm1/followups'

export const SLICES = 3

// the suite's op pairs (testing/tickerCompoundExclusionSuite PAIRS): the first clause names the ticker, the second refers back
const PAIRS = [
  ['timeframe+ema', ['timeframe', 'ema'], (S, a) => `Change ${S} to the 1-hour timeframe, add a 20 EMA${a.to}`],
  ['ema+timeframe', ['ema', 'timeframe'], (S, a) => `Add a 20 EMA to ${S} and switch${a.obj} to the 1-hour timeframe`],
  ['bars+timeframe', ['bars', 'timeframe'], (S, a) => `Switch ${S} to bars and put${a.obj} on the 1-hour timeframe`],
  ['log+timeframe', ['log', 'timeframe'], (S, a) => `Put ${S} on a log scale and make${a.obj} 1-hour`],
]
const SINGLES = [
  [['timeframe'], (S) => `Change ${S} to the 1-hour timeframe`],
  [['ema'], (S) => `Add a 20 EMA to ${S}`],
  [['bars'], (S) => `Switch ${S} to bars`],
]
const ANA = {
  it: { to: ' to it', obj: ' it' },
  'that chart': { to: ' to that chart', obj: ' that chart' },
  'this one': { to: ' to this one', obj: ' this one' },
  'this chart': { to: ' to this chart', obj: ' this chart' },
  here: { to: ' here', obj: ' here' },
  none: { to: '', obj: '' },
}
// G2: 4 pairs × 6 anaphors (one of them none: the "missing object" rows), the NVDA chart clicked
export const G2 = PAIRS.flatMap(pair => ['it', 'that chart', 'this one', 'this chart', 'here', 'none'].map(a => [`${pair[2]('SPY', ANA[a])}.`, pair[1], a]))
// F2: messages NLM-1 reads as two steps on the chart the words name (the gate takes them) whose LAST step does not go through
// (a ticker UCT does not have: refused), × a bare-pronoun follow-up
export const F2 = ['Switch SPY to bars and change it to XYZQ', 'Put SPY on a log scale and then switch it to XYZQ',
  'Change SPY to the 1-hour timeframe and then change it to QQQZ'].flatMap(first => ['add RSI to it', 'make it weekly', 'add a 50 SMA to it'].map(next => [first, next]))
// G1: a second clause that points at ANOTHER chart (no click: nothing grounds it) — 15 bases × 8 tails; G1b: the first 40 of them
const TAILS = ['and do the same on this one', 'and do the same here', 'and the same on this chart', 'then do that on this one too',
  'and do it on this chart too', 'and that chart too', 'and the selected chart too', 'and this one as well']
const G1_BASES = [
  ...PAIRS.flatMap(pair => ['it', 'that chart', 'none'].map(a => [pair[2]('SPY', ANA[a]), pair[1]])),
  ...SINGLES.map(([ops, f]) => [f('SPY'), ops]),
]
export const G1 = G1_BASES.flatMap(([base, ops]) => TAILS.map(tail => [`${base}, ${tail}.`, ops]))
export const G1B = G1.slice(0, 40)

export function targetGateG1G2Suite(SLICE) {
if (!(Number.isInteger(SLICE) && SLICE >= 0 && SLICE < SLICES)) throw new Error(`slice must be 0..${SLICES - 1} (got ${SLICE})`)
const mine = (rows) => rows.filter((_, i) => i % SLICES === SLICE)

let p
const transcript = () => screen.getByTestId('agent-transcript').textContent
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const tfOf = (b, id) => b.state.widgets.find(w => w.id === id).opts?.tf || 'D'
const snapshot = (b, n) => Array.from({ length: n }, (_, i) => stored(b, `w${i}`))
const asked = () => /Which chart|Did you mean|nothing has changed yet/i.test(transcript())

// the routing, set explicitly: the config answers routing_v2, the browser key agrees, and the flag is asserted
async function routing(v2) {
  const inner = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => (url === '/api/agent/config'
    ? new Response(JSON.stringify({ conversations: [], routing_v2: v2 }), { status: 200, headers: { 'content-type': 'application/json' } })
    : inner(url, init)))
  try { localStorage.setItem('uct.agent.routingV2', v2 ? '1' : '0') } catch { /* */ }
  _resetAgentConfig()
  await loadAgentConfig()
  expect(routingV2Active()).toBe(v2)
}
const mount = (syms, sel = null) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const chartRef = (body, sym) => body.context.charts.find(c => c.label === `Chart (${sym})`).ref
const ixeRef = (body, sym) => body.context.indicatorEdits.find(x => x.symbol === sym).ref
const OPS = {
  timeframe: (b, s) => ({ action: 'chart.setTimeframe', target: chartRef(b, s), args: { timeframe: '60' } }),
  ema: (b, s) => ({ action: 'indicator.add', target: ixeRef(b, s), args: { defId: 'ema', inputs: [{ key: 'period', value: 20 }] } }),
  bars: (b, s) => ({ action: 'chart.setType', target: chartRef(b, s), args: { type: 'bars' } }),
  log: (b, s) => ({ action: 'chart.setScale', target: chartRef(b, s), args: { scale: 'log' } }),
}
const plan = (names, sym) => (body) => p.env('apply', names.map(k => OPS[k](body, sym)))
const effect = {
  timeframe: (b, id) => tfOf(b, id) === '60',
  ema: (b, id) => p.brief(b, id).includes('movingAverage(20 ema)'),
  bars: (b, id) => /"chartType":"bars"/.test(stored(b, id)),
  log: (b, id) => /"logScale":true/.test(stored(b, id)),
}

for (const v2 of [false, true]) describe(`G1/G2 target gate [routing ${v2 ? 'v2' : 'v1'}]`, () => {
  beforeEach(async () => { p = setupPanel(); _resetTurns(); await routing(v2) })
  afterEach(() => { vi.restoreAllMocks(); cleanup() })
  const say = async (m, t) => { expect(routingV2Active()).toBe(v2); return m.say(t) }
  const only0 = SLICE === 0 ? it : it.skip
  // CONTROL rows are about routing v2 (production): v1 has no NLM-1 instant reading of them
  const controlV2 = SLICE === 0 && v2 ? it : it.skip

  only0('the families are generated: G2 24 (4 pairs × 6 anaphors), F2 9, G1 120 (15 bases × 8 tails), G1b 40', () => {
    expect(G2).toHaveLength(24); expect(F2).toHaveLength(9); expect(G1).toHaveLength(120); expect(G1B).toHaveLength(40)
  })

  // ── F1 · G2: the NVDA chart clicked. A second clause with its own reference: the click is never silently overruled, and a split
  // never writes the click the words did not name → asked, nothing changed. No reference at all ("missing object"): every op on
  // SPY (the chart the words name), the click untouched — or asked, nothing changed.
  it.each(mine(G2))('G2 NVDA clicked: "%s" (%j, anaphor %s)', async (t, ops, ana) => {
    const m = mount(['SPY', 'NVDA'], 'w1')
    const before = snapshot(m.board, 2)
    p.st.envelopes.push(plan(ops, 'SPY'))
    await say(m, t)
    expect(stored(m.board, 'w1'), transcript()).toBe(before[1])
    if (ana === 'none') {
      const ran = ops.every(k => effect[k](m.board, 'w0'))
      expect(ran || (asked() && snapshot(m.board, 2).every((s, i) => s === before[i])), transcript()).toBe(true)
    } else {
      expect(snapshot(m.board, 2), transcript()).toEqual(before)
      expect(asked(), transcript()).toBe(true)
    }
  }, 60000)

  // ── F1 · the gate reads the member's TYPED words: NLM-1's reading of this message ("give this one a 20 EMA" → "put a 20 EMA on
  // it") drops the pointer "this one", and nothing is clicked — asked, nothing changed
  only0('RAW WORDS: "Change SPY to the 1-hour timeframe and give this one a 20 EMA." (no click) → asked, nothing changed', async () => {
    const rw = rewriteClauses('Change SPY to the 1-hour timeframe and give this one a 20 EMA.')
    expect(rw?.steps?.length).toBe(2)
    expect(rw.steps[1]).not.toMatch(/\bthis\b/i)
    expect(rw.steps[1]).toMatch(/\bit\b/i)
    const m = mount(['SPY', 'NVDA'])
    const before = snapshot(m.board, 2)
    p.st.envelopes.push(plan(['timeframe', 'ema'], 'SPY'))
    await say(m, 'Change SPY to the 1-hour timeframe and give this one a 20 EMA.')
    expect(snapshot(m.board, 2), transcript()).toEqual(before)
    expect(asked(), transcript()).toBe(true)
  }, 60000)

  // ── F1 · CONTROL: unambiguous compounds stay instant — 0 model calls, every op on the chart the words or the click name
  controlV2('CONTROL: "make SPY weekly and add RSI to it" → SPY weekly + RSI, NVDA untouched, 0 model calls', async () => {
    const m = mount(['SPY', 'NVDA'])
    const nvda0 = stored(m.board, 'w1')
    await say(m, 'make SPY weekly and add RSI to it')
    expect(tfOf(m.board, 'w0'), transcript()).toBe('W')
    expect(p.brief(m.board, 'w0').some(x => x.startsWith('rsi')), transcript()).toBe(true)
    expect(stored(m.board, 'w1')).toBe(nvda0)
    expect(p.turns()).toBe(0)
  }, 60000)
  controlV2('CONTROL: NVDA clicked + "make this one weekly" → NVDA weekly, SPY untouched, 0 model calls', async () => {
    const m = mount(['SPY', 'NVDA'], 'w1')
    const spy0 = stored(m.board, 'w0')
    await say(m, 'make this one weekly')
    expect(tfOf(m.board, 'w1'), transcript()).toBe('W')
    expect(stored(m.board, 'w0')).toBe(spy0)
    expect(p.turns()).toBe(0)
  }, 60000)
  controlV2('CONTROL: "change SPY to 1h and add a 20 EMA to SPY" → both on SPY, NVDA untouched, 0 model calls', async () => {
    const m = mount(['SPY', 'NVDA'])
    const nvda0 = stored(m.board, 'w1')
    await say(m, 'change SPY to 1h and add a 20 EMA to SPY')
    expect(tfOf(m.board, 'w0'), transcript()).toBe('60')
    expect(p.brief(m.board, 'w0'), transcript()).toContain('movingAverage(20 ema)')
    expect(stored(m.board, 'w1')).toBe(nvda0)
    expect(p.turns()).toBe(0)
  }, 60000)
  controlV2('CONTROL: NVDA clicked + "change SPY to 1h and add a 20 EMA to SPY" → both on SPY (the words outrank the click), 0 model calls', async () => {
    const m = mount(['SPY', 'NVDA'], 'w1')
    const nvda0 = stored(m.board, 'w1')
    await say(m, 'change SPY to 1h and add a 20 EMA to SPY')
    expect(tfOf(m.board, 'w0'), transcript()).toBe('60')
    expect(p.brief(m.board, 'w0'), transcript()).toContain('movingAverage(20 ema)')
    expect(stored(m.board, 'w1')).toBe(nvda0)
    expect(p.turns()).toBe(0)
  }, 60000)
  controlV2('CONTROL: "make the left chart weekly" then "add RSI to it" → RSI on SPY (a live prior-turn subject), 0 model calls', async () => {
    const m = mount(['SPY', 'NVDA'])
    const nvda0 = stored(m.board, 'w1')
    await say(m, 'make the left chart weekly')
    await say(m, 'add RSI to it')
    expect(p.brief(m.board, 'w0').some(x => x.startsWith('rsi')), transcript()).toBe(true)
    expect(stored(m.board, 'w1')).toBe(nvda0)
    expect(p.turns()).toBe(0)
  }, 60000)
  // ── F2 · A TAKEN-BACK STEP LEAVES NO REFERENT. A message read as steps commits step 1, the last step does not go through
  // (refused), and the whole reading is taken back — the message then goes to the model, which only answers. The chart step 1
  // touched is no "it" afterwards: nothing the conversation did is still on the board, so a bare pronoun is asked (or read by the
  // model), never written there instantly.
  it.each(mine(F2))('F2: "%s" taken back, then "%s" → nothing written', async (first, next) => {
    const m = mount(['SPY', 'NVDA'])
    const before = snapshot(m.board, 2)
    await say(m, first)
    expect(snapshot(m.board, 2), transcript()).toEqual(before)
    p.st.envelopes.length = 0
    const calls = p.turns()
    await say(m, next)
    // never written on the taken-back chart: asked here, or read by the model (which answers in words here) — nothing changed
    expect(snapshot(m.board, 2), transcript()).toEqual(before)
    expect(asked() || p.turns() > calls, transcript()).toBe(true)
  }, 60000)
})
}
