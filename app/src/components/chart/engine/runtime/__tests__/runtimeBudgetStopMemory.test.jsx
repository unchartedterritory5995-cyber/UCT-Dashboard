// app/src/components/chart/engine/runtime/__tests__/runtimeBudgetStopMemory.test.jsx
//
// ⭐⭐ (engine 86) — A TIME-BUDGET STOP IS REMEMBERED FOR THE PAGE, AND RETRY RUNS IT AGAIN.
//
// A refusal is memoised per bars ARRAY, and a live chart hands a new array per update, so a run the time budget
// stopped was run cold again on every update, each burning the whole budget and drawing nothing. Now
// `runtimeColumnsFor` remembers it per document, symbol, timeframe, settings and history fact (the lane's key
// without the other-symbol supply) in `../../runtimeBudgetStops.js`: the next bars answer the same stop, by name,
// without a run. ⛔ Never persisted; another setting, symbol or timeframe runs; Retry on the strip forgets the
// document's stops (its run half's too) and the chart repaints and runs again; every other refusal keeps the
// old rule (re-run on the next bars).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { runtimeColumnsFor, setRuntimeRunner, onRuntimeColumnsLanded, resetRuntimeSessions } from '../runtimeColumns'
import { runtimeBudgetStoppedFor, retryRuntimeBudgetStops, rememberRuntimeBudgetStop, resetRuntimeBudgetStops } from '../../runtimeBudgetStops'
import { setRuntimeErrorNotice, resetRuntimeErrorNotices } from '../../runtimeErrorNotice'
import AttachedPineDisclosures from '../../../pane/AttachedPineDisclosures'

const def = (id = 'u_budget') => ({ id, compute: { kind: 'runtime', fn: `runtime:${id}`, source: 'plot(close)', outputs: { v: 0 } }, meta: { name: 'Heavy' } })
const rows = (n = 30) => Array.from({ length: n }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 10 }))
const ctx = (extra = {}) => ({ tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, ...extra })
const named = (guard, message) => Object.assign(new Error(message), { guard })

/** A runner that answers at once with what `answer()` says, and counts its runs. */
function runner(answer) {
  const calls = []
  setRuntimeRunner((d, r, c, done) => { calls.push({ d, r, c }); const a = answer(); done(a.err || null, a.cols || null) })
  return calls
}
const ask = (d, r, c) => { try { return { cols: runtimeColumnsFor(d, r, undefined, c) } } catch (err) { return { err } } }

afterEach(() => {
  cleanup()
  setRuntimeRunner(null)
  resetRuntimeSessions()
  resetRuntimeBudgetStops()
  resetRuntimeErrorNotices()
  vi.restoreAllMocks()
})

describe('the lane remembers a time-budget stop for the page', () => {
  it('⭐ the next bars of the same picture answer the same stop, by name, WITHOUT a run', () => {
    const calls = runner(() => ({ err: named('runtime:time-budget', 'this script took more than 1000 ms to draw bar by bar.') }))
    expect(ask(def(), rows(30), ctx()).cols).toEqual({})
    expect(calls.length).toBe(1)
    const first = ask(def(), rows(30), ctx()) // a new array: the live chart's next update
    expect(calls.length).toBe(1)
    expect(first.err.guard).toBe('runtime:time-budget')
    expect(first.err.retryable).toBe(true)
    expect(first.err.message).toMatch(/^this script took more than 1000 ms to draw bar by bar\. It is not run again on this chart's next bars/)
    expect(runtimeBudgetStoppedFor('u_budget')).toBe(true)
  })

  it('⭐ another timeframe, symbol, setting or document runs', () => {
    const calls = runner(() => ({ err: named('runtime:time-budget', 'slow') }))
    ask(def(), rows(), ctx())
    ask(def(), rows(), ctx({ tf: '60' }))
    ask(def(), rows(), ctx({ symbol: { ticker: 'QQQ', exchange: 'NASDAQ' } }))
    ask(def(), rows(), ctx({ runtimeInputs: { len: 5 } }))
    ask(def('u_other'), rows(), ctx())
    expect(calls.length).toBe(5)
  })

  it('⛔ every other refusal keeps the old rule: the next bars run again', () => {
    const calls = runner(() => ({ err: named('runtime:limit', 'a limit') }))
    ask(def(), rows(), ctx())
    ask(def(), rows(), ctx())
    expect(calls.length).toBe(2)
    expect(runtimeBudgetStoppedFor('u_budget')).toBe(false)
  })

  it('⭐ Retry forgets the stop, repaints, and the SAME bars run again', () => {
    let slow = true
    const calls = runner(() => (slow ? { err: named('runtime:time-budget', 'slow') } : { cols: { v: [1, 2, 3] } }))
    const landed = []
    const off = onRuntimeColumnsLanded((k) => landed.push(k))
    const bars = rows()
    ask(def(), bars, ctx())
    expect(ask(def(), bars, ctx()).err.guard).toBe('runtime:time-budget')
    slow = false
    expect(retryRuntimeBudgetStops('u_budget')).toBe(true)
    expect(landed).toContain('retry')
    expect(runtimeBudgetStoppedFor('u_budget')).toBe(false)
    expect(ask(def(), bars, ctx()).cols).toEqual({}) // a new run is posted for the same bars
    expect(calls.length).toBe(2)
    expect(ask(def(), bars, ctx()).cols).toEqual({ v: [1, 2, 3] }) // and it landed
    off()
  })

  it('⭐ a run half (`<id>~run`) is its document\'s: stopped-for and Retry both find it', () => {
    runner(() => ({ err: named('runtime:time-budget', 'slow') }))
    ask(def('u_host~run'), rows(), ctx())
    expect(runtimeBudgetStoppedFor('u_host')).toBe(true)
    expect(retryRuntimeBudgetStops('u_host')).toBe(true)
    expect(runtimeBudgetStoppedFor('u_host')).toBe(false)
    expect(retryRuntimeBudgetStops('u_host')).toBe(false)
  })

  it('⛔ never persisted: remembering writes nothing to storage', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem')
    runner(() => ({ err: named('runtime:time-budget', 'slow') }))
    ask(def(), rows(), ctx())
    ask(def(), rows(), ctx())
    expect(runtimeBudgetStoppedFor('u_budget')).toBe(true)
    expect(set).not.toHaveBeenCalled()
  })
})

describe('the strip offers Retry', () => {
  const registry = {
    getDefinition: (id) => ({ u_rt: { id: 'u_rt', meta: { name: 'Heavy runtime' } }, u_host: { id: 'u_host', meta: { name: 'Heavy host' } } }[id] || null),
    registryGeneration: () => 1,
  }
  it('⭐ a stopped runtime document\'s row carries Retry; a host document stopped in its run half gets its own row', () => {
    setRuntimeErrorNotice('i1', 'not drawn on this chart (runtime:time-budget): slow', '')
    rememberRuntimeBudgetStop('k1', 'u_rt', named('runtime:time-budget', 'slow'))
    rememberRuntimeBudgetStop('k2', 'u_host~run', named('runtime:time-budget', 'slow'))
    const settings = { indicatorInstances: [{ instanceId: 'i1', defId: 'u_rt', hidden: false }, { instanceId: 'i2', defId: 'u_host', hidden: false }] }
    render(<AttachedPineDisclosures settings={settings} registry={registry} />)
    const buttons = screen.getAllByRole('button', { name: 'Retry' })
    expect(buttons).toHaveLength(2)
    expect(screen.getByText(/^Heavy runtime — not drawn on this chart: slow/)).toBeTruthy()
    expect(screen.getByText(/^Heavy host — stopped by this chart's time budget, and not run again on its next bars/)).toBeTruthy()
    fireEvent.click(buttons[1])
    expect(runtimeBudgetStoppedFor('u_host')).toBe(false)
    expect(runtimeBudgetStoppedFor('u_rt')).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('⛔ CONTROL — a refusal the budget did not stop offers no Retry', () => {
    setRuntimeErrorNotice('i1', 'not drawn on this chart (runtime:limit): a limit', '')
    const settings = { indicatorInstances: [{ instanceId: 'i1', defId: 'u_rt', hidden: false }] }
    render(<AttachedPineDisclosures settings={settings} registry={registry} />)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
