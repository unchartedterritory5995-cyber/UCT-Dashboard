// CONVERSATIONAL TARGETING (pl-exec, owner product decision 2026-11-07; convTarget.js). The chart the last committed change acted
// on stays the target across bare follow-ups until the member redirects: words naming another chart, or a click AFTER that
// change. "this" against only an OLD click on another chart is asked. Held-out phrasings (agentConvTargetHeldOut, committed
// first) and own tuning phrasings, paired: the plan on the meant chart lands; a plan on the other candidate never does.
// Evidence: LOCAL native Windows Node v24, jsdom, BROWSER-MOCK-MODEL / SIMULATED (scripted plans).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { CONV_HELD_OUT } from './agentConvTargetHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel({ tickers: ['QQQ'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'NVDA', 'N:c2': 'AMD', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const w = (b, id) => b.state.widgets.find(x => x.id === id)
const cs = (b, id) => mergeChartSettings(w(b, id).opts?.settings || null)
const hasInd = (b, id, defId) => (w(b, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted && i.defId === defId)
// what each line asks for, as a person could see it on that chart afterwards
const KINDS = [
  { re: /weekly/i, op: () => ['chart.setTimeframe', { timeframe: 'W' }], on: (b, id) => (w(b, id).opts?.tf || 'D') === 'W' },
  { re: /hourly/i, op: () => ['chart.setTimeframe', { timeframe: '60' }], on: (b, id) => w(b, id).opts?.tf === '60' },
  { re: /\blog\b/i, op: () => ['chart.setScale', { scale: 'log' }], on: (b, id) => !!cs(b, id).logScale },
  { re: /\brsi\b/i, op: () => ['indicator.add', { defId: 'rsi' }], ind: true, on: (b, id) => hasInd(b, id, 'rsi') },
  { re: /\bmacd\b/i, op: () => ['indicator.add', { defId: 'macd' }], ind: true, on: (b, id) => hasInd(b, id, 'macd') },
  { re: /overlay qqq/i, op: () => ['chart.compare', { add: ['QQQ'], remove: [], clear: false }], on: (b, id) => JSON.stringify(w(b, id).opts?.settings || {}).includes('QQQ') },
]
const kindOf = (t) => KINDS.find(k => k.re.test(t))
const NAMES = [[/\bnvda\b|top-right/i, 'c1'], [/\btsla\b/i, 'c3'], [/bottom-left/i, 'c2'], [/\bspy\b|top-left/i, 'c0'], [/\bamd\b/i, 'c2']]
const namedIn = (t) => NAMES.find(([re]) => re.test(t))?.[1] || null
// an honest planner: the chart the words name, else the chart the request's context marks selected (this harness marks it
// only for a turn-scoped target; the member's own click otherwise, as the real board marks it); `force` = a fixed chart
const plan = (t, force = null) => (body) => {
  const k = kindOf(t)
  const marked = (body.context.charts || []).find(c => c.selected)
  const sel = marked ? marked.label.match(/\((c\d)\)/)?.[1] : (body.context.charts || []).some(c => 'selected' in c) ? null : p.st.selected
  const id = force || namedIn(t) || sel
  if (!id) return p.env('clarify', [], { question: 'Which chart do you mean?' })
  const [action, args] = k.op()
  const target = k.ind ? (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`)?.ref : body.context.charts.find(c => c.label === `Chart (${id})`).ref
  return p.env('apply', [{ action, target, args }])
}
async function run({ click, turns, then = null }, force = null) {
  const m = p.mount(FOUR, SYMS, { decorate: label })
  if (click) p.select(click)
  let out = ''
  for (let i = 0; i < turns.length; i++) {
    const last = i === turns.length - 1
    if (then && last) p.select(then)
    p.st.envelopes.length = 0                     // a line the fast path takes uses no plan: never let one carry over
    p.st.envelopes.push(plan(turns[i], last ? force : null))
    out = await m.say(turns[i])
  }
  return { b: m.board, out }
}
const landed = (b, t) => ['c0', 'c1', 'c2', 'c3'].filter(id => kindOf(t).on(b, id))

describe('held-out: the conversational target', () => {
  const sure = CONV_HELD_OUT.filter(c => c.want !== 'ask')
  it.each(sure.map(c => [c.id, c]))('%s: the last line acts on the meant chart, and only there', async (_id, c) => {
    const { b, out } = await run(c)
    expect(landed(b, c.turns.at(-1)), out).toEqual([c.want])
  }, 60000)
  it.each(sure.map(c => [c.id, c]))('%s NEGATIVE: a plan on another chart than the meant one never lands', async (_id, c) => {
    const wrong = c.want === 'c0' ? 'c3' : 'c0'
    const { b, out } = await run(c, wrong)
    expect(landed(b, c.turns.at(-1)), out).not.toContain(wrong)
  }, 60000)
  // h7 was written (first) as 'ask': "this one" with only an old click elsewhere. The Program Lead's rule clarification of
  // 2026-11-07 (to match pl-auto's pre-written unseen6) is that explicit words win: "this one" is the click, old or fresh. The
  // frozen file keeps its expectation; the case is graded on the clarified rule here, and reported as a changed expectation.
  it.each(CONV_HELD_OUT.filter(c => c.want === 'ask').map(c => [c.id, c]))('%s (clarified): "this one" is the click; a plan on the named chart does not land', async (_id, c) => {
    const { b, out } = await run(c, 'c1')
    expect(landed(b, c.turns.at(-1)), out).not.toContain('c1')
    cleanup(); p = setupPanel({ tickers: ['QQQ'] })
    const r = await run(c)
    expect(landed(r.b, c.turns.at(-1)), r.out).toEqual([c.click])
  }, 60000)
})

// tuning phrasings (own): the owner's own example, across chart actions, indicators, drawings
describe('tuning: the named chart carries through a conversation', () => {
  it('"Change NVDA to weekly." then "Add RSI." then "Log scale." all on NVDA, with the click on SPY; each receipt names the chart', async () => {
    const m = p.mount(FOUR, SYMS, { decorate: label })
    p.select('c0')
    for (const t of ['Change NVDA to weekly.', 'Add RSI.', 'Log scale.']) {
      p.st.envelopes.length = 0
      p.st.envelopes.push(plan(t))
      const out = await m.say(t)
      expect(out, t).toMatch(/c1|NVDA/)
    }
    expect([KINDS[0], KINDS[2], KINDS[3]].map(k => k.on(m.board, 'c1'))).toEqual([true, true, true])
    expect([KINDS[0], KINDS[2], KINDS[3]].some(k => k.on(m.board, 'c0'))).toBe(false)
  }, 60000)
  it('a click after the change, then a bare "add a MACD": the click', async () => {
    const { b } = await run({ click: 'c0', turns: ['NVDA weekly', 'add a MACD'], then: 'c3' })
    expect(landed(b, 'macd')).toEqual(['c3'])
  }, 60000)
  it('a re-click on the same old chart is a click too: a bare follow-up goes to it', async () => {
    const { b } = await run({ click: 'c0', turns: ['NVDA weekly', 'add a MACD'], then: 'c0' })
    expect(landed(b, 'macd')).toEqual(['c0'])
  }, 60000)
  it('a change on several charts, then a bare follow-up with only an old click: asked; no plan lands', async () => {
    for (const force of ['c0', 'c1']) {
      cleanup(); p = setupPanel({ tickers: ['QQQ'] })
      const m = p.mount(FOUR, SYMS, { decorate: label })
      p.select('c0')
      p.st.envelopes.push((body) => p.env('apply', ['c1', 'c2'].map(id => ({ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { timeframe: 'W' } }))))
      await m.say('make the NVDA and AMD charts weekly')
      p.st.envelopes.length = 0
      p.st.envelopes.push(plan('log scale', force))
      const out = await m.say('log scale')
      expect(landed(m.board, 'log'), out).toEqual([])
      expect(out).toMatch(/Which chart|check this first/)
    }
  }, 60000)
  it('a chart named in a QUESTION is the target too: "what is the AMD chart showing?" then "make it weekly" lands on AMD', async () => {
    const m = p.mount(FOUR, SYMS, { decorate: label })
    p.select('c0')
    p.st.envelopes.push(p.env('answer', [], { reply: 'It shows AMD on the daily.' }))
    await m.say('what is the AMD chart showing?')
    p.st.envelopes.length = 0
    p.st.envelopes.push(plan('make it weekly'))
    const out = await m.say('make it weekly')
    expect(landed(m.board, 'weekly'), out).toEqual(['c2'])
  }, 60000)
  it('"it" beside a newly named chart: both the conversation chart and the named one', async () => {
    const m = p.mount(FOUR, SYMS, { decorate: label })
    p.select('c0')
    p.st.envelopes.push(plan('NVDA weekly'))
    await m.say('NVDA weekly')
    p.st.envelopes.length = 0
    p.st.envelopes.push((body) => p.env('apply', ['c1', 'c3'].map(id => ({ action: 'chart.setScale', target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args: { scale: 'log' } }))))
    const out = await m.say('log scale on it and on the TSLA chart')
    expect(landed(m.board, 'log').sort(), out).toEqual(['c1', 'c3'])
  }, 60000)
  it('"the other one" on TWO after a named change is the chart that was NOT named', async () => {
    const TWO = [cell('a', 0, 0), cell('b', 12, 0)]
    const m = p.mount(TWO, { 'N:a': 'SPY', 'N:b': 'NVDA' }, { decorate: label })
    p.select('a')
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts.find(c => c.label === 'Chart (b)').ref, args: { timeframe: 'W' } }]))
    await m.say('make NVDA weekly')
    p.st.envelopes.length = 0
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setScale', target: body.context.charts.find(c => c.label === 'Chart (a)').ref, args: { scale: 'log' } }]))
    const out = await m.say('log scale on the other one')
    expect(!!cs(m.board, 'a').logScale, out).toBe(true)
    expect(!!cs(m.board, 'b').logScale).toBe(false)
  }, 60000)
})
