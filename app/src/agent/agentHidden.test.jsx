// A HIDDEN tab: Chrome never fires requestAnimationFrame there. Simulated faithfully —
// rAF callbacks are swallowed and never run — and every Agent path must still finish.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterRender, whenVisible } from './frames'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
let state = 'visible'
let rafQueue = []
const realRaf = globalThis.requestAnimationFrame
function setVisibility(v) { state = v; document.dispatchEvent(new Event('visibilitychange')) }
beforeEach(() => {
  state = 'visible'; rafQueue = []
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' })
  // While hidden, a frame never comes: the callback is held, never run.
  globalThis.requestAnimationFrame = (cb) => { if (state === 'hidden') { rafQueue.push(cb); return 0 } return realRaf ? realRaf(cb) : setTimeout(cb, 16) }
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ conversationId: 'ac_1' }), { status: 200, headers: { 'content-type': 'application/json' } }))
})
afterEach(() => { globalThis.requestAnimationFrame = realRaf; vi.restoreAllMocks() })

describe('afterRender / whenVisible', () => {
  it('hidden → resolves on a macrotask, never on a frame', async () => {
    setVisibility('hidden')
    await afterRender()
    expect(rafQueue.length).toBe(0)                 // it did not even ask for a frame
  })
  it('visible, then hidden BEFORE the frame came → still resolves', async () => {
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return 0 }   // a frame that never comes
    const p = afterRender()
    setVisibility('hidden')
    await p
    expect(rafQueue.length).toBe(1)
  })
  it('whenVisible: runs at once when visible; from hidden, only on return — and once', () => {
    const f = vi.fn()
    whenVisible(f); expect(f).toHaveBeenCalledTimes(1)
    setVisibility('hidden')
    const g = vi.fn()
    whenVisible(g); expect(g).not.toHaveBeenCalled()
    setVisibility('visible'); setVisibility('hidden'); setVisibility('visible')
    expect(g).toHaveBeenCalledTimes(1)
  })
})

describe('a whole Apply / Undo with the tab hidden (frames never fire)', () => {
  const K = ['chart']
  it('plans, commits, verifies, offers Undo, and Undo completes — all while hidden, each write exactly once', async () => {
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    setVisibility('hidden')
    const ops = [{ action: 'chart.setTimeframe', target: 'c', args: { timeframe: 'W' } }]
    const env = await prepareOps(ops)
    const p = planOps(collectTargets(b.host, K), ops, env, { surface: 'charts' })
    expect(p.ok).toBe(true)
    const res = await commitPlan(b.host, p, { env })
    expect(res.ok).toBe(true)
    expect(b.host.charts.read('c').tf).toBe('W')
    expect(res.undo).not.toBeNull()
    const back = await undoEntry(b.host, res.undo)
    expect(back.ok).toBe(true)
    expect(b.host.charts.read('c').tf).toBe('D')
    expect(rafQueue.length).toBe(0)
  })
  it('a write that FAILS while hidden is reported (no success receipt), and nothing waits on a frame', async () => {
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    setVisibility('hidden')
    b.host.charts.commit = () => { throw new Error('boom') }
    const ops = [{ action: 'chart.setTimeframe', target: 'c', args: { timeframe: 'W' } }]
    const env = await prepareOps(ops)
    const res = await commitPlan(b.host, planOps(collectTargets(b.host, K), ops, env, { surface: 'charts' }), { env })
    expect(res.ok).toBe(false)
    expect(res.undo).toBeNull()
  })
})

describe('in the panel: the receipt and its Undo appear while hidden', () => {
  it('fast-path Apply with the tab hidden → receipt + Undo; after returning, Undo works', async () => {
    const b = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    setVisibility('hidden')
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'make it weekly' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt')).toHaveLength(1), { timeout: 4000 })
    expect(screen.getAllByTestId('agent-undo')).toHaveLength(1)
    expect(b.host.charts.read('c').tf).toBe('W')
    setVisibility('visible')
    fireEvent.click(screen.getByTestId('agent-undo'))
    await waitFor(() => expect(b.host.charts.read('c').tf).toBe('D'), { timeout: 4000 })
  })
})
