// EXECUTION FAMILIES — what the FIRST model call carries for a request of the family, through the REAL panel (panelHarness),
// routing v1 and v2. Evidence class: SIMULATED (LOCAL native Windows Node, scripted model: the model is never called for real;
// a sentinel answer stands in). It measures the deterministic layers only: nothing claimed the request locally, the action is
// in the manifest, and the widget's control list (or the chart's list setting) is in the context. Which plan a real model
// picks from that is NOT measured (no paid call). Numbers are printed so the report can quote them, and pinned below.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setupPanel, ONE } from './testing/panelHarness'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { WIDGET_HELD_OUT, LIST_HELD_OUT } from './agentExecHeldOut.test.js'
import { WIDGET_TUNE, LIST_TUNE, WIDGET_TUNE2, JOURNAL_TUNE } from './agentExecTune.js'
import { NAME_HELD_OUT, DOOR_HELD_OUT, JOURNAL_HELD_OUT } from './agentExecHeldOut2.test.js'
import { SEARCH_HELD_OUT, SEARCH_CLEAR_HELD_OUT } from './agentExecHeldOut7.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const w = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 2, h: 4, color: 'N', opts })
const TYPES = ['themes', 'optionsflow', 'indexes', 'nhnl', 'breadth', 'scatter', 'calendar', 'news', 'tradeExchangeNews', 'volumescan', 'periodsort', 'fundamentals']
const BOARD = () => {
  const [[chart], syms] = ONE('NVDA')
  return [[{ ...chart, w: 12 }, ...TYPES.map((t, i) => w(`w${i}`, t, 12 + (i % 6) * 2, Math.floor(i / 6) * 4, t === 'calendar' ? { date: '2026-11-06' } : t === 'periodsort' ? { start: 20260101, end: 20260201 } : {}))], syms]
}

async function measure(cases, { v2, want }) {
  const out = []
  for (const c of cases) {
    const p = setupPanel()
    const base = globalThis.fetch
    globalThis.fetch = async (url, init) => (url === '/api/agent/config'
      ? new Response(JSON.stringify({ conversations: [], routing_v2: v2 }), { status: 200, headers: { 'content-type': 'application/json' } }) : base(url, init))
    localStorage.setItem('uct.agent.routingV2', v2 ? '1' : '0')
    _resetAgentConfig()
    await loadAgentConfig()
    const { say } = p.mount(...BOARD())
    await say(c.text)
    const first = p.st.calls.find(x => x[1] === '/api/agent/turn')?.[2] || null
    out.push({ text: c.text, row: c.row, ...want(c, first) })
    cleanup()
    localStorage.clear()
  }
  return out
}
const widgetWant = (c, b) => ({
  model: !!b,
  action: !!b && b.capabilities.some(x => x.name === 'widget.setOption'),
  list: !!b && !!b.context?.widgetControls?.[0]?.controls?.[c.type],
})
const listWant = (c, b) => ({
  model: !!b,
  action: !!b && b.capabilities.some(x => x.name === 'chart.setSetting' && (x.args?.properties?.setting?.enum || []).includes(c.setting)),
})
const journalWant = (c, b) => ({
  model: !!b,
  action: !!b && b.capabilities.some(x => x.name === 'widget.sendToJournal'),
})
const tally = (rs, k) => rs.filter(r => r[k]).length

export const REACH = {}
const PINNED = {
  // round 1 (before: widget held-out action v1 1/24, v2 6/24; list held-out 0/8, 0/8)
  // #1029 (F-16 widened, owner 2026-11-10): the round-3 FLOW_WIDGET_REFUSAL fast path is gone, so C3-166 "only show sweeps in the
  // options flow" now reaches the model, widget.setOption and the Options Flow control list (master 0a0737665a: 23/20/20, misses
  // C3-170, C3-166, C3-151, C3-152; this head: 24/21/21, misses C3-170, C3-151, C3-152; no other row dropped)
  'widget held-out v1': { model: '24/24', action: '21/24', list: '21/24' }, 'widget held-out v2': { model: '24/24', action: '21/24', list: '21/24' },
  'widget tune v1': { model: '24/24', action: '20/24', list: '21/24' }, 'widget tune v2': { model: '24/24', action: '22/24', list: '22/24' },   // a RISE re-pinned (chartShare branch, 2026-11-13: 21 → 22; the same with its routing group removed — C3-170 / C3-171 now reach)
  'list held-out v1': { model: '8/8', action: '7/8' }, 'list held-out v2': { model: '8/8', action: '8/8' },
  // round 2 (before the word-based names: name held-out2 list 4/6 both; journal held-out2 action 3/4 both)
  // after the routing gate (a name routes only beside a word of its controls): "on the new-highs/new-lows widget add the S&P 500" says
  // no control word, so it reaches the action by a reroute only — the price of 0 corpus side-effect turns
  'name held-out2 v1': { model: '6/6', action: '5/6', list: '5/6' }, 'name held-out2 v2': { model: '6/6', action: '5/6', list: '5/6' },
  'door held-out2 v1': { model: '4/4', action: '4/4', list: '4/4' }, 'door held-out2 v2': { model: '4/4', action: '4/4', list: '4/4' },
  'journal held-out2 v1': { model: '4/4', action: '4/4' }, 'journal held-out2 v2': { model: '4/4', action: '4/4' },
  // round 7 (C3-138): measured once on the held-out set, after the change
  'search held-out7 v1': { model: '3/3', action: '3/3', list: '3/3' }, 'search held-out7 v2': { model: '3/3', action: '3/3', list: '3/3' },
}
describe('reach of the first model call', () => {
  beforeEach(() => {})
  afterEach(async () => { cleanup(); localStorage.clear(); _resetAgentConfig() })
  const SETS = [['widget held-out', WIDGET_HELD_OUT, widgetWant], ['widget tune', WIDGET_TUNE, widgetWant], ['list held-out', LIST_HELD_OUT, listWant], ['list tune', LIST_TUNE, listWant],
    ['name held-out2', NAME_HELD_OUT, widgetWant], ['door held-out2', DOOR_HELD_OUT, widgetWant], ['journal held-out2', JOURNAL_HELD_OUT, journalWant],
    ['widget tune2', WIDGET_TUNE2, widgetWant], ['journal tune2', JOURNAL_TUNE, journalWant],
    // round 7: C3-138, the News widget's search box (its rows carry their widget type)
    ['search held-out7', [...SEARCH_HELD_OUT, ...SEARCH_CLEAR_HELD_OUT].map(c => ({ ...c, type: 'tradeExchangeNews', key: 'search' })), widgetWant]]
  // EXEC_REACH_ONLY=tune while tuning: the held-out numbers are read once, at the end
  const only = globalThis.process?.env?.EXEC_REACH_ONLY || ''
  for (const [name, cases, want] of SETS.filter(([n]) => !only || n.includes(only))) {
    for (const v2 of [false, true]) {
      it(`${name}, routing ${v2 ? 'v2' : 'v1'}`, async () => {
        const rs = await measure(cases, { v2, want })
        const keys = Object.keys(rs[0]).filter(k => !['text', 'row'].includes(k))
        const line = Object.fromEntries(keys.map(k => [k, `${tally(rs, k)}/${rs.length}`]))
        REACH[`${name} ${v2 ? 'v2' : 'v1'}`] = line
        console.log(`[reach] ${name} ${v2 ? 'v2' : 'v1'} ${JSON.stringify(line)} misses: ${JSON.stringify(rs.filter(r => keys.some(k => !r[k])).map(r => `${r.row} ${r.text} ${keys.filter(k => !r[k]).join('+')}`))}`)
        expect(rs.length).toBe(cases.length)
        // pinned as measured (pl-exec, exec-gen-1). Before the change the held-out reach of the action was v1 1/24, v2 6/24
        // (widget) and 0/8, 0/8 (list). A drop is a regression; a rise is re-pinned on purpose.
        const pinned = PINNED[`${name} ${v2 ? 'v2' : 'v1'}`]
        if (pinned) expect(line).toEqual(pinned)
      }, 240000)
    }
  }
})
