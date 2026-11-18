// While it works: the seconds, what is usual, and Stop.
//
// Measured on production 2026-11-15: a first preview takes about 14 seconds, and for all
// of it the dock showed one unchanging line with no way out.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { converseTurn, STOPPED_GATE } from '../authoring/converseClient'
import { memberRefusal } from '../authoring/memberWords'
import { modelTurn, STOPPED_LINE, NOTHING_CHANGED } from '../authoring/authoringSession'
import { newAuthoringState } from '../authoring'

vi.mock('../authoring/studioTelemetry', async (orig) => ({ ...(await orig()), logStudioAction: vi.fn() }))

import CreateIndicatorPanel, { USUAL_WAIT, LONG_WAIT_S } from './CreateIndicatorPanel'

const previewTree = () => JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID) || null)
const STOPPED = { ok: false, gate: STOPPED_GATE, reason: '', notUnderstood: [], unavailable: [] }

/** A model the test holds open: each call waits for `release()`, and answers "stopped" when
 *  its signal aborts (what the real client returns when the browser gives the request up). */
function heldConverse() {
  const calls = []
  const converse = (args) => new Promise((resolve) => {
    calls.push({ args, release: async () => resolve(await scriptedConverse(args)) })
    if (args.signal) args.signal.addEventListener('abort', () => resolve(STOPPED))
  })
  return { converse, calls }
}

function mount(converse) {
  const writes = []
  render(<CreateIndicatorPanel settings={mergeChartSettings({})} onChange={(n) => writes.push(n)}
    sym="AAPL" tf="D" onPreview={() => {}} onClose={() => {}} converse={converse} />)
  return { writes }
}
async function type(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
}
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.useRealTimers() })

describe('while a turn is in flight', () => {
  it('counts the seconds and says what is usual, then says when it is running long', async () => {
    const { converse } = heldConverse()
    mount(converse)
    await type('Add a 20 EMA')
    expect(screen.getByTestId('create-indicator-working').textContent).toBe('The UCT Agent is thinking')
    const note = () => screen.getByTestId('create-indicator-working-note').textContent
    expect(note()).toBe(`0s. ${USUAL_WAIT}`)
    await act(async () => { vi.advanceTimersByTime(7000) })
    expect(note()).toBe(`7s. ${USUAL_WAIT}`)
    await act(async () => { vi.advanceTimersByTime((LONG_WAIT_S - 7) * 1000) })
    expect(note()).toBe(`${LONG_WAIT_S}s. This one is taking longer than usual`)
  })

  it('Stop ends the wait: nothing is built, the dock says so, and the next request works', async () => {
    const { converse, calls } = heldConverse()
    const { writes } = mount(converse)
    await type('Add a 20 EMA')
    expect(calls).toHaveLength(1)
    expect(calls[0].args.signal.aborted).toBe(false)
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-stop')) })
    await act(async () => {})
    expect(calls[0].args.signal.aborted).toBe(true)
    expect(screen.queryByTestId('create-indicator-working')).toBeNull()
    expect(lastUct().dataset.kind).toBe('stopped')
    expect(lastUct().textContent).toContain(STOPPED_LINE)
    expect(lastUct().textContent).toContain(NOTHING_CHANGED)
    expect(previewTree()).toBe('null')
    expect(screen.queryByTestId('create-indicator-readback')).toBeNull()
    expect(writes).toHaveLength(0)
    // the answer arriving AFTER the stop is not read
    await act(async () => { await calls[0].release() })
    expect(previewTree()).toBe('null')
    // and the dock is usable again
    await type('Add a 20 EMA')
    await act(async () => { await calls[1].release() })
    await act(async () => {})
    expect(previewTree()).toContain('"value":20')
  })

  it('a turn that finishes on its own takes the waiting row away, Stop included', async () => {
    const { converse, calls } = heldConverse()
    mount(converse)
    await type('Add a 20 EMA')
    expect(screen.getByTestId('create-indicator-stop')).toBeInTheDocument()
    await act(async () => { await calls[0].release() })
    await act(async () => {})
    expect(screen.queryByTestId('create-indicator-stop')).toBeNull()
    expect(previewTree()).toContain('"value":20')
  })
})

describe('the pieces under it', () => {
  it('an answer that lands in the same instant as the press is dropped (the signal decides, not the body)', async () => {
    const ctl = new AbortController()
    const converse = async (args) => { const r = await scriptedConverse(args); ctl.abort(); return r }
    const st = newAuthoringState()
    const out = await modelTurn(st, () => st, 'Add a 20 EMA', { converse, signal: ctl.signal })
    expect(out.stopped).toBe(true)
    expect(out.state).toBeNull()
    expect(out.changed).toBe(false)
    // control: the same call without the abort builds
    const built = await modelTurn(st, () => st, 'Add a 20 EMA', { converse: scriptedConverse })
    expect(built.changed).toBe(true)
  })

  it('converseTurn passes the signal to fetch, and an aborted fetch is "stopped", not a network failure', async () => {
    const ctl = new AbortController()
    let seen = null
    const fetchImpl = (_url, init) => { seen = init.signal; ctl.abort(); return Promise.reject(new Error('aborted')) }
    const r = await converseTurn({ message: 'x', state: newAuthoringState(), fetchImpl, signal: ctl.signal })
    expect(seen).toBe(ctl.signal)
    expect(r.gate).toBe(STOPPED_GATE)
    // control: a rejection with no abort is still the network
    const n = await converseTurn({ message: 'x', state: newAuthoringState(), fetchImpl: () => Promise.reject(new Error('down')) })
    expect(n.gate).toBe('network')
  })

  it('the hourly limit says how long is left when the server says so', async () => {
    const res = (h) => ({ ok: false, status: 429, headers: { get: (k) => (k === 'Retry-After' ? h : null) }, json: async () => ({ detail: 'x' }) })
    const r = await converseTurn({ message: 'x', state: newAuthoringState(), fetchImpl: async () => res('1325') })
    expect(r.gate).toBe('http:429')
    expect(r.retryAfterS).toBe(1325)
    expect(memberRefusal('http:429', '', { retryAfterS: 1325 })).toMatch(/this hour's limit.*about 23 minutes/)
    expect(memberRefusal('http:429', '', { retryAfterS: 40 })).toMatch(/about a minute/)
    // no header, or one that is not a count: the sentence that was there before
    const bare = await converseTurn({ message: 'x', state: newAuthoringState(), fetchImpl: async () => res(null) })
    expect(bare.retryAfterS).toBeUndefined()
    const odd = await converseTurn({ message: 'x', state: newAuthoringState(), fetchImpl: async () => res('soon') })
    expect(odd.retryAfterS).toBeUndefined()
    expect(memberRefusal('http:429', '')).toMatch(/Wait a minute/)
    // and it is the 429's alone: the busy gate has no window to quote
    expect(memberRefusal('rate:busy', '', { retryAfterS: 1325 })).toMatch(/Wait a minute/)
  })
})
