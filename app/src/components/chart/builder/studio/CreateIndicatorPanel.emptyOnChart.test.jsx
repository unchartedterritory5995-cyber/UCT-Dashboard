// THE DOCK SAYS WHAT A BUILT LINE DOES NOT SHOW ON THIS CHART (2026-11-21; `authoring/emptyOnChart.js`).
//
// After an answer is applied the dock reads what the chart DREW for the preview (`engineChart.bindings()`), at a few
// fixed delays, and stops at the first read that finds it drawn. If the newest bar has no value, UCT says so under
// that answer. It computes nothing, it never refuses, and no timer outlives the preview it was started for.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { parseFormula } from '../../engine/ast/parse'
import { _resetSessions, createKey } from '../authoring/conversationSessions'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { EMPTY_READ_DELAYS_MS } from '../authoring/emptyOnChart'

vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async () => ({ ok: true, row: { def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } })),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const C = 'uct.authoring.patch/1'
const P = (s) => parseFormula(s).ast
const N = 300
const TIMES = (() => {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 20))
  while (out.length < N) { if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1) }
  return out.reverse()
})()
const BARS = TIMES.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1000 }))
const points = (valueAt) => TIMES.map((time, i) => { const v = valueAt(i); return Number.isFinite(v) ? { time, value: v } : { time } })
const binding = (plotKey, pts) => ({ instanceId: 'p', defId: STUDIO_PREVIEW_DEF_ID, plotKey, series: { data: () => pts },
  lastValue: Number.isFinite(pts[pts.length - 1].value) ? pts[pts.length - 1].value : undefined, runSeries: [] })
const BLANK_SINCE = points((i) => (i < N - 40 ? 1 : NaN))          // no value on the newest 40 bars
const WHOLE = points(() => 1)

/** The chart beside the dock. `drawn` is what its binder holds right now; a test sets it when the chart "draws". */
function chart() {
  const c = { bars: BARS, ctx: { sym: 'AAPL', symbol: { ticker: 'AAPL' }, tf: 'D', newestBarIsForming: false, historyFromListing: true }, drawn: [], reads: 0 }
  c.bindings = () => { c.reads += 1; return c.drawn }
  return c
}
const CREATE = (key = 'v') => [{ op: 'create', name: 'x', outputs: [{ key, tree: P('sma(close, 20)') }] }]
function converse(turns) {
  let n = 0
  return vi.fn(async ({ state }) => {
    const ops = turns[Math.min(n++, turns.length - 1)]
    return { ok: true, disposition: 'change', reply: '', turn: 'patch', notUnderstood: [], unavailable: [],
      envelope: { contract: C, baseRevision: state.revision, ops, assumptions: [] } }
  })
}
function mount(engineChart, turns = [CREATE()]) {
  return render(
    <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D" engineChart={engineChart}
      onPreview={() => {}} onClose={vi.fn()} converse={converse(turns)} sessionKey={createKey('s_empty')} />,
  )
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const tick = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms) }) }
const block = () => document.querySelector('[data-testid="create-indicator-empty-on-chart"]')
const entries = () => [...document.querySelectorAll('[data-role="uct"]')]
const LAST_DELAY = EMPTY_READ_DELAYS_MS[EMPTY_READ_DELAYS_MS.length - 1]

beforeEach(() => { _resetSessions(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.useRealTimers() })

describe('the dock says what a built line does not show on this chart', () => {
  it('THE SENTENCE APPEARS ONCE THE CHART HAS DRAWN THE PREVIEW, under that answer, as UCT\'s own', async () => {
    const c = chart()
    mount(c)
    await say('a line')
    await tick(0)
    expect(block()).toBeNull()                                   // the chart has not drawn it yet: nothing is said
    c.drawn = [binding('v', BLANK_SINCE)]                        // the chart draws
    await tick(150)
    const b = block()
    expect(b).not.toBeNull()
    expect(b.textContent).toContain('On this chart')
    expect(b.textContent.split('On this chart').length - 1).toBe(1)          // the heading says it; the sentence does not say it again
    expect(b.textContent).toMatch(/It has no value on the newest 40 bars; its last value is on \d{1,2} [A-Z][a-z]{2} 2026\./)
    expect(entries().at(-1).contains(b)).toBe(true)              // inside the applied answer's own entry
    // and the reads stop at the first hit: no timer is pending and the chart is not read again
    const reads = c.reads
    await tick(60_000)
    expect(c.reads).toBe(reads)
  })

  it('CONTROL: a line with a value on the newest bar gets nothing', async () => {
    const c = chart()
    c.drawn = [binding('v', WHOLE)]
    mount(c)
    await say('a line')
    await tick(LAST_DELAY)
    expect(block()).toBeNull()
  })

  it('SILENCE when the chart never draws it: every read runs, nothing is said, nothing is left running', async () => {
    const c = chart()
    mount(c)
    await say('a line')
    await tick(LAST_DELAY)
    expect(c.reads).toBe(EMPTY_READ_DELAYS_MS.length)
    expect(block()).toBeNull()
    await tick(60_000)
    expect(c.reads).toBe(EMPTY_READ_DELAYS_MS.length)
  })

  it('⛔ NO TIMER SURVIVES THE NEXT TURN: the first answer\'s reads are cancelled, and the statement is the new build\'s', async () => {
    const c = chart()
    mount(c, [CREATE(), [{ op: 'set_slot', slot: 'v#1', value: 50 }]])
    await say('a line')
    await tick(0)
    const afterFirst = c.reads                                   // one read so far; four still pending for revision 1
    expect(afterFirst).toBe(1)
    await say('please make that average slower than it is now')
    // the new preview starts its own five reads; the old four are gone: at most five more reads ever happen
    await tick(60_000)
    expect(c.reads - afterFirst).toBe(EMPTY_READ_DELAYS_MS.length)
    expect(block()).toBeNull()
    // and when the chart has drawn the new build, the sentence sits under the NEW answer only
  })

  it('the statement moves to the newest answer and leaves the older one', async () => {
    const c = chart()
    c.drawn = [binding('v', BLANK_SINCE)]
    mount(c, [CREATE(), [{ op: 'set_slot', slot: 'v#1', value: 50 }]])
    await say('a line')
    await tick(0)
    expect(entries().at(-1).contains(block())).toBe(true)
    await say('please make that average slower than it is now')
    await tick(0)
    const all = entries()
    expect(all.length).toBe(2)
    expect(document.querySelectorAll('[data-testid="create-indicator-empty-on-chart"]').length).toBe(1)
    expect(all[1].contains(block())).toBe(true)
    expect(all[0].contains(block())).toBe(false)
  })

  it('⛔ A STATEMENT IS NEVER SHOWN FOR A BUILD IT WAS NOT READ FOR: the next build, not yet drawn, says nothing', async () => {
    const c = chart()
    c.drawn = [binding('v', BLANK_SINCE)]
    mount(c, [CREATE(), [{ op: 'set_slot', slot: 'v#1', value: 50 }]])
    await say('a line')
    await tick(0)
    expect(block()).not.toBeNull()                               // read for the first build
    c.drawn = []                                                 // the chart has not drawn the next one
    await say('please make that average slower than it is now')
    expect(entries().length).toBe(2)
    expect(block()).toBeNull()                                   // at once, before any read
    await tick(LAST_DELAY)
    expect(block()).toBeNull()                                   // and after every read found nothing drawn
  })

  it('⛔ NO TIMER SURVIVES UNDO: the undone build\'s reads are cancelled and its sentence is gone', async () => {
    const c = chart()
    mount(c, [CREATE(), [{ op: 'set_slot', slot: 'v#1', value: 50 }]])
    await say('a line')
    await tick(LAST_DELAY)                                       // the first build's reads are all spent (never drawn)
    await say('please make that average slower than it is now')
    await tick(0)
    const before = c.reads
    c.drawn = [binding('v', BLANK_SINCE)]
    await tick(150)
    expect(block()).not.toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-undo')) })
    await act(async () => {})
    // the undone revision's statement is not shown for the restored one
    c.drawn = []
    await tick(60_000)
    expect(block()).toBeNull()
    // the restored preview ran its own reads and no more than those
    expect(c.reads - before).toBeLessThanOrEqual(1 + EMPTY_READ_DELAYS_MS.length)
  })

  it('⛔ NO TIMER SURVIVES UNMOUNT', async () => {
    const c = chart()
    const view = mount(c)
    await say('a line')
    await tick(0)
    expect(c.reads).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(c.reads).toBe(1)
  })

  it('a chart that hands down no bindings (an older shape) says nothing and breaks nothing', async () => {
    const c = chart()
    delete c.bindings
    mount(c)
    await say('a line')
    await tick(LAST_DELAY)
    expect(block()).toBeNull()
    expect(entries().at(-1).textContent).toContain('Built 1 ')
  })

  it('A CHART SHORTER THAN THE FORMULA READS gets the note, and a chart with history to spare gets nothing', async () => {
    const DAYS_ABOVE = [{ op: 'create', name: 'Days above', outputs: [{ key: 'v', tree: P('sum(close > sma(close, 200) ? 1 : 0, 20)') }] }]
    const young = chart()
    young.bars = BARS.slice(-150)
    young.drawn = [binding('v', WHOLE)]                           // a value on the newest bar
    mount(young, [DAYS_ABOVE])
    await say('how many of the last 20 days closed above the 200 day average')
    await tick(0)
    expect(block()).not.toBeNull()
    expect(block().textContent).toMatch(/This chart has 150 bars and the formula reads \d+; values here come from less history than it asks for\./)
    cleanup()
    _resetSessions()
    const long = chart()                                         // 300 bars: more than the formula reads
    long.drawn = [binding('v', WHOLE)]
    mount(long, [DAYS_ABOVE])
    await say('how many of the last 20 days closed above the 200 day average')
    await tick(LAST_DELAY)
    expect(block()).toBeNull()
  })

  it('with several outputs, the one that is empty is named', async () => {
    const c = chart()
    const two = [{ op: 'create', name: 'Two', outputs: [{ key: 'fast', tree: P('ema(close, 10)') }, { key: 'slow', tree: P('ema(close, 21)') }] }]
    c.drawn = [binding('fast', WHOLE), binding('slow', BLANK_SINCE)]
    mount(c, [two])
    await say('two lines')
    await tick(0)
    const text = block().textContent
    expect(text).toMatch(/: it has no value on the newest 40 bars/)
    expect(text.split('it has no value').length - 1).toBe(1)                      // only the empty one
  })
})
