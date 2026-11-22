// The receipt does not wait on the board's save (fast chart.setTimeframe p50 2189 ms, production telemetry 11-05). It follows the
// local read-back, says it is saving, offers no Undo and claims nothing saved; the save's answer patches that same receipt. A failed
// save must show on it. The lock and the in-flight mark hold until the answer. Through the REAL panel on the fixture board, a save
// the test holds open.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { lastTurns } from './trace'
import { planCompound } from './compound'
import { SAVE_WAIT_MS } from './useAgent'
import { AGENT_INFLIGHT_KEY } from './agentFlag'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chart = (id, x, w) => ({ id, type: 'chart', x, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } })
const ONE = () => [[chart('c', 0, 24)], { 'N:c': 'SPY' }]
const TWO = () => [[chart('a', 0, 12), chart('b', 12, 12)], { 'N:a': 'SPY', 'N:b': 'AMD' }]

/** A save that answers only when told to. `seen` holds each persist call's options. */
function heldSave() {
  const held = { seen: [], answers: [] }
  p.st.persist = vi.fn((opts) => new Promise((resolve) => { held.seen.push(opts); held.answers.push(resolve) }))
  return { held, answer: (r) => held.answers.shift()(r) }
}
const receipts = () => screen.queryAllByTestId('agent-receipt')
const lastReceipt = () => receipts().at(-1)
/** Type without waiting for the panel to go idle: the test holds the save open. */
const send = (t) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: t } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
// (a board with an open layout: the fixture's epoch, which is what makes a change a board save at all)
const onBoard = (make = ONE) => { const [w, s] = make(); return p.mount(w, s, { layouts: { entries: [{ id: 1, name: 'Main', kind: 'yours', scope: 'user' }], active: 1, boards: { 1: w } } }) }
const mountHeld = (make = ONE) => ({ ...onBoard(make), ...heldSave() })

describe('the receipt follows the read-back, not the save', () => {
  it('says the change while the save is out: saving, no Undo, the word "saved" nowhere; the panel stays locked', async () => {
    const { answer, held, board } = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    expect(board.state.widgets[0].opts.tf).toBe('W')
    expect(lastReceipt().getAttribute('data-saving')).toBe('true')
    expect(lastReceipt().getAttribute('data-undoable')).toBeNull()
    expect(screen.getByTestId('agent-receipt-saving').textContent).toBe('Saving…')
    expect(lastReceipt().textContent).not.toMatch(/\bsaved\b/i)
    expect(screen.queryByTestId('agent-typing')).not.toBeNull()
    expect(p.st.persist).toHaveBeenCalledTimes(1)
    answer({ ok: true })
    await waitFor(() => expect(lastReceipt().getAttribute('data-undoable')).toBe('true'), { timeout: 4000 })
    expect(lastReceipt().getAttribute('data-saving')).toBeNull()
    expect(screen.queryByTestId('agent-receipt-saving')).toBeNull()
    expect(receipts()).toHaveLength(1)
    expect(held.seen).toHaveLength(1)
    await p.idle()
  }, 30000)

  it('the trace shows it: the receipt right after commit:end, and before persist', async () => {
    const { answer } = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    answer({ ok: true })
    await p.idle()
    const t = lastTurns().at(-1)
    const at = (name) => t.marks.find(m => m[0] === name)?.[1]
    expect(at('receipt:saving')).toBeGreaterThanOrEqual(at('commit:end'))
    expect(at('persist')).toBeGreaterThanOrEqual(at('receipt:saving'))
    expect(t.output).toBeLessThanOrEqual(at('persist'))
  }, 30000)

  it('a refused save updates the SAME receipt: not saved, in words, no Undo, and "undo" has nothing to take', async () => {
    const { answer, say } = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    answer({ ok: false, reason: 'not-saved' })
    await waitFor(() => expect(lastReceipt().getAttribute('data-saving')).toBeNull(), { timeout: 4000 })
    await p.idle()
    expect(receipts()).toHaveLength(1)
    expect(lastReceipt().textContent).toMatch(/not saved yet/i)
    expect(lastReceipt().getAttribute('data-undoable')).toBeNull()
    expect(p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2].outcomeData?.kind)).toContain('applied-unsaved')
    await say('undo')
    expect(p.transcript()).toMatch(/nothing/i)
  }, 30000)

  it('a conflict from another window says so on the receipt; a save that THROWS reads as not saved', async () => {
    const first = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    first.answer({ ok: false, conflict: true, reason: 'conflict' })
    await waitFor(() => expect(lastReceipt().textContent).toMatch(/changed in another window/), { timeout: 4000 })
    await p.idle()
    p.st.persist = vi.fn(async () => { throw new Error('offline') })
    send('make this monthly')
    await waitFor(() => expect(lastReceipt().textContent).toMatch(/not saved yet/i), { timeout: 4000 })
    await p.idle()
    expect(lastReceipt().getAttribute('data-saving')).toBeNull()
    expect(lastReceipt().getAttribute('data-undoable')).toBeNull()
  }, 30000)

  describe('a save slower than the deadline', () => {
    const pastDeadline = async () => {
      const m = mountHeld()
      send('make this weekly')
      await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
      await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS + 50)
      await p.idle()                                                       // the panel is free again
      expect(lastReceipt().getAttribute('data-saving')).toBe('true')       // and it never said not saved
      expect(lastReceipt().textContent).toMatch(/taking longer than usual/)
      expect(lastReceipt().textContent).not.toMatch(/not saved/i)
      expect(lastReceipt().getAttribute('data-undoable')).toBeNull()
      return m
    }
    const rows = () => p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2].outcomeData)
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
    afterEach(() => { vi.useRealTimers() })

    it('a late success settles the same receipt: Undo, no note, and one saved row', async () => {
      const { answer, say, board } = await pastDeadline()
      answer({ ok: true })
      await waitFor(() => expect(lastReceipt().getAttribute('data-undoable')).toBe('true'), { timeout: 4000 })
      expect(lastReceipt().getAttribute('data-saving')).toBeNull()
      expect(lastReceipt().textContent).not.toMatch(/taking longer/)
      expect(receipts()).toHaveLength(1)
      expect(rows().filter(r => r.kind === 'save-late')).toEqual([{ kind: 'save-late', ok: true, actions: ['chart.setTimeframe'] }])
      p.st.persist = async () => ({ ok: true })
      await say('undo')
      expect(board.state.widgets[0].opts.tf || 'D').toBe('D')
    }, 30000)
    it('a late conflict says conflict, not a generic note, and offers no Undo', async () => {
      const { answer } = await pastDeadline()
      answer({ ok: false, conflict: true, reason: 'conflict' })
      await waitFor(() => expect(lastReceipt().textContent).toMatch(/changed in another window/), { timeout: 4000 })
      expect(lastReceipt().getAttribute('data-saving')).toBeNull()
      expect(lastReceipt().getAttribute('data-undoable')).toBeNull()
      expect(rows().filter(r => r.kind === 'save-late')[0]).toMatchObject({ ok: false, reason: 'conflict' })
    }, 30000)
    it('the slow note says what "undo" would do meanwhile', async () => {
      await pastDeadline()
      expect(lastReceipt().textContent).toMatch(/“undo” would take back your change before this one, not this one/)
    }, 30000)
    const tf = (b) => b.state.widgets[0].opts.tf || 'D'
    const undoes = async (say, b, ...want) => { for (const w of want) { await say('undo'); expect(tf(b)).toBe(w) } }
    it('AUDIT H1: a late save answering during a typed request keeps its Undo: two undos take back both changes', async () => {
      const { answer, held, say, board } = await pastDeadline()
      send('make this monthly')
      await waitFor(() => expect(held.answers.length).toBeGreaterThan(1), { timeout: 4000 })
      answer({ ok: true })                                                 // the weekly save answers inside the typed turn
      await waitFor(() => expect(receipts()[0].getAttribute('data-saving')).toBeNull(), { timeout: 4000 })
      p.st.persist = async () => ({ ok: true })
      answer({ ok: true })
      await p.idle()
      await waitFor(() => expect(receipts()[0].getAttribute('data-undoable')).toBe('true'), { timeout: 4000 })
      await undoes(say, board, 'W', 'D')
    }, 30000)
    it('AUDIT H1: two late saves answering during one typed request both keep their Undo, in order', async () => {
      const { answer, held, say, board } = await pastDeadline()
      send('make this monthly')
      await waitFor(() => expect(held.answers.length).toBe(2), { timeout: 4000 })
      await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS + 50)
      await p.idle()
      send('make this hourly')
      await waitFor(() => expect(held.answers.length).toBe(3), { timeout: 4000 })
      answer({ ok: true }); answer({ ok: true })
      await waitFor(() => expect(receipts().slice(0, 2).map(r => r.getAttribute('data-saving'))).toEqual([null, null]), { timeout: 4000 })
      p.st.persist = async () => ({ ok: true })
      answer({ ok: true })
      await p.idle()
      await undoes(say, board, 'M', 'W', 'D')
    }, 30000)
    it('AUDIT H3: a typed request whose model call throws still lets the late entry land', async () => {
      const { answer, say, board } = await pastDeadline()
      const inner = globalThis.fetch
      globalThis.fetch = vi.fn(async (url, init) => {
        if (url !== '/api/agent/turn') return inner(url, init)
        answer({ ok: true })                                               // the late answer lands mid-turn
        for (let i = 0; i < 50; i++) await Promise.resolve()
        throw new Error('the model call failed')
      })
      send('what do you make of the tape today')
      await waitFor(() => expect(receipts()[0].getAttribute('data-saving')).toBeNull(), { timeout: 4000 })
      await p.idle()
      globalThis.fetch = inner
      p.st.persist = async () => ({ ok: true })
      await waitFor(() => expect(receipts()[0].getAttribute('data-undoable')).toBe('true'), { timeout: 4000 })
      await undoes(say, board, 'D')
    }, 30000)
    it('AUDIT L1: a late save keeps its place in Undo: the newer change comes back first, then this one', async () => {
      const { answer, say, board } = await pastDeadline()
      p.st.persist = async () => ({ ok: true })
      p.select('c')
      await say('add rsi')
      const rsiOn = () => p.instancesOn(board, 'c').some(i => i.defId === 'rsi')
      expect(rsiOn()).toBe(true)
      answer({ ok: true })
      await waitFor(() => expect(receipts()[0].getAttribute('data-saving')).toBeNull(), { timeout: 4000 })
      await say('undo')
      expect(rsiOn()).toBe(false)
      expect(board.state.widgets[0].opts.tf).toBe('W')
      await say('undo')
      expect(board.state.widgets[0].opts.tf || 'D').toBe('D')
    }, 30000)
    it('AUDIT L2: a late answer is not read as a step of a request started meanwhile', async () => {
      const { answer, held, board } = await pastDeadline()
      const multi = 'make this monthly, then undo that change'
      expect(planCompound(multi, { host: board.host })?.steps).toHaveLength(2)   // a real multi-step request: each step reads its own tap
      send(multi)
      await waitFor(() => expect(held.answers.length).toBeGreaterThan(1), { timeout: 4000 })
      answer({ ok: true })                                                 // the slow save answers while step 1's tap is open
      await waitFor(() => expect(receipts()[0].getAttribute('data-saving')).toBeNull(), { timeout: 4000 })
      p.st.persist = async () => ({ ok: true })
      answer({ ok: true })                                                 // step 1's own save
      await p.idle()
      expect(board.state.widgets[0].opts.tf).toBe('W')                     // step 1 ran and step 2 took it back
      expect(p.transcript()).not.toMatch(/stopped/i)
    }, 30000)
    it('AUDIT L2: the late row goes to its own conversation, not the chat open by then', async () => {
      const { answer } = await pastDeadline()
      const own = p.st.calls.filter(c => c[1] === '/api/agent/record').at(-1)[2]
      expect(own.outcomeData.kind).toBe('applied-unsaved')
      fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
      answer({ ok: true })
      await waitFor(() => expect(rows().some(r => r.kind === 'save-late')).toBe(true), { timeout: 4000 })
      const late = p.st.calls.filter(c => c[1] === '/api/agent/record').map(c => c[2]).find(r => r.outcomeData?.kind === 'save-late')
      expect(late.conversationId).toBe('ac_1')
    }, 30000)
    it('the in-flight mark stays while the save is out', async () => {
      const { answer } = await pastDeadline()
      expect(localStorage.getItem(AGENT_INFLIGHT_KEY)).toBeTruthy()
      answer({ ok: true })
      await waitFor(() => expect(localStorage.getItem(AGENT_INFLIGHT_KEY)).toBeNull(), { timeout: 4000 })
    }, 30000)
    it('a second change queued behind the slow one is not reported as failed; each settles on its own answer', async () => {
      const { answer } = await pastDeadline()
      send('make this monthly')
      await waitFor(() => expect(receipts()).toHaveLength(2), { timeout: 4000 })
      await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS + 50)
      await p.idle()
      expect(receipts().map(r => /not saved/i.test(r.textContent))).toEqual([false, false])
      answer({ ok: true }); answer({ ok: true })
      await waitFor(() => expect(receipts().map(r => r.getAttribute('data-saving'))).toEqual([null, null]), { timeout: 4000 })
      expect(receipts().map(r => r.getAttribute('data-undoable'))).toEqual(['true', 'true'])
    }, 30000)
  })

  it('a failure after the save still clears Saving: the receipt is never left on it', async () => {
    const m = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    vi.spyOn(m.board.host.charts, 'read').mockImplementation(() => { throw new Error('boom') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.answer({ ok: true })
    await waitFor(() => expect(lastReceipt().getAttribute('data-saving')).toBeNull(), { timeout: 4000 })
    expect(screen.queryByTestId('agent-receipt-saving')).toBeNull()
  }, 30000)

  it('the lock holds: a second message while the save is out is not run', async () => {
    const { answer, board } = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    send('make this monthly')
    await new Promise(r => setTimeout(r, 50))
    expect(board.state.widgets[0].opts.tf).toBe('W')
    answer({ ok: true })
    await p.idle()
  }, 30000)

  it('the in-flight mark stays until the save answers', async () => {
    const writes = []
    const set = Storage.prototype.setItem, del = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { if (String(k).includes('inflight')) writes.push(['set', Date.now()]); return set.call(this, k, v) })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (k) { if (String(k).includes('inflight')) writes.push(['clear', Date.now()]); return del.call(this, k) })
    const { answer } = mountHeld()
    send('make this weekly')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    expect(writes.at(-1)[0]).toBe('set')
    answer({ ok: true })
    await waitFor(() => expect(writes.at(-1)[0]).toBe('clear'), { timeout: 4000 })
    await p.idle()
  }, 30000)
})

describe('settle: only a ticker or timeframe change skips the wait on other preference writes', () => {
  const mounted = (make) => { const m = onBoard(make); const persist = vi.fn(async () => ({ ok: true })); p.st.persist = persist; return { ...m, persist } }
  it('a timeframe, or a ticker: settle []', async () => {
    const { say, persist } = mounted(ONE)
    await say('make this weekly')
    expect(persist.mock.calls.at(-1)[0]).toEqual({ settle: [] })
    await say('show NVDA')
    expect(persist.mock.calls.at(-1)[0]).toEqual({ settle: [] })
  }, 30000)
  it('NEGATIVE: a change to the chart\'s settings waits as before', async () => {
    const { say, persist } = mounted(ONE)
    p.st.envelopes.push(p.env('apply', [{ action: 'volume.setState', target: 'c', args: { state: 'hidden' } }]))
    await say('hide the volume')
    expect(persist.mock.calls.at(-1)[0]).toBeUndefined()
  }, 30000)
})

describe('only when nothing follows', () => {
  it('NEGATIVE: a model plan keeps the old order: the receipt follows the save', async () => {
    onBoard()
    const { answer } = heldSave()
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setTimeframe', target: 'c', args: { timeframe: 'W' } }]))
    send('kindly flip the chart over to the weekly')
    await waitFor(() => expect(p.st.persist).toHaveBeenCalled(), { timeout: 4000 })
    expect(receipts()).toHaveLength(0)
    answer({ ok: true })
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    await p.idle()
  }, 30000)
  it('NEGATIVE: a request with a deferred step keeps the old order: the receipt follows the save', async () => {
    onBoard()
    const { answer } = heldSave()
    p.st.envelopes.push(p.env('propose', [{ action: 'chart.setTimeframe', target: 'c', args: { timeframe: 'W' } }, { action: 'layout.saveAs', target: 'layouts', args: { name: 'Swing 2' } }]))
    send('make this chart weekly and save this layout as Swing 2')
    await waitFor(() => expect(p.st.persist).toHaveBeenCalled(), { timeout: 4000 })
    expect(receipts()).toHaveLength(0)
    answer({ ok: true })
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 4000 })
    await p.idle()
  }, 30000)
  it('NEGATIVE: two steps of a sentence keep their order: each receipt follows its own save', async () => {
    const m = mountHeld(TWO)
    send('switch both charts to weekly and show NVDA on the left')
    await waitFor(() => expect(p.st.persist).toHaveBeenCalled(), { timeout: 4000 })
    const said = receipts().filter(r => r.getAttribute('data-saving')).length
    expect(said).toBe(0)
    for (let i = 0; i < 4; i++) { if (m.held.answers.length) m.answer({ ok: true }); await new Promise(r => setTimeout(r, 40)) }
  }, 30000)
  it('NEGATIVE: a change whose commit already saved it has nothing to wait for and shows no saving state', async () => {
    const m = onBoard()
    p.select('c')
    await m.say('add rsi')
    expect(lastReceipt().getAttribute('data-saving')).toBeNull()
    expect(lastReceipt().getAttribute('data-undoable')).toBe('true')
  }, 30000)
})
