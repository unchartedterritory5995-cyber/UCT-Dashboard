// Log Trade's pre-entry checklist, the pure half (Notebook P2a, Task 8; spec §P2 item 1, §7.5).
// Every case here is a real call with an assertion: the write each kind takes, the body it sends,
// what a failure answers (the server's own sentence, never one made up here), the soft warning and
// the preference's three values.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LOG_TRADE_CHECKLIST_PREF, SAVE_TIMEOUT_MS, checklistMode, notSavedLine, saveTicks, saveTicksResult, softWarning, ticksToSave,
} from './logTradeChecklist'

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, body) => ({ ok: false, status, json: async () => body })

describe('saveTicks', () => {
  let saved
  beforeEach(() => { saved = globalThis.fetch; globalThis.fetch = vi.fn(async () => ok()) })
  afterEach(() => { globalThis.fetch = saved })

  it('an open position writes the pre-entry route, with the ids and the total', async () => {
    expect(await saveTicks({ kind: 'position', id: 'p1', setup: 'VCP', checked: ['s1'], total: 2 })).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/positions/p1/pre-entry',
      expect.objectContaining({ method: 'PUT', credentials: 'include' }))
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ setup: 'VCP', checkedRuleIds: ['s1'], totalRules: 2 })
  })

  it("a closed trade writes that trade's adherence record", async () => {
    expect(await saveTicks({ kind: 'trade', id: 't1', setup: 'VCP', checked: [], total: 2 })).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trades/t1/adherence', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ setup: 'VCP', checkedRuleIds: [], totalRules: 2 })
  })

  it('the id is encoded into the path, so it can never step to another route', async () => {
    await saveTicks({ kind: 'position', id: 'a/../b', setup: null, checked: [], total: 1 })
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/j2/trader-blocks/positions/a%2F..%2Fb/pre-entry')
  })

  it('a failure is false, never a throw', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('offline') })
    expect(await saveTicks({ kind: 'trade', id: 't1', setup: null, checked: [], total: 1 })).toBe(false)
    globalThis.fetch = vi.fn(async () => fail(500, {}))
    expect(await saveTicks({ kind: 'trade', id: 't1', setup: null, checked: [], total: 1 })).toBe(false)
  })

  it('an unknown kind writes nothing', async () => {
    expect(await saveTicks({ kind: 'note', id: 'n1', setup: null, checked: [], total: 1 })).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('saveTicksResult: why a save failed, in the words that came back', () => {
  let saved
  beforeEach(() => { saved = globalThis.fetch })
  afterEach(() => { globalThis.fetch = saved })
  const args = { kind: 'position', id: 'p1', setup: 'VCP', checked: ['s1'], total: 2 }

  it("409: the server's own sentence is the reason, word for word, and it is not worth retrying", async () => {
    const detail = 'This trade is already closed or partly closed. Record its rules on the trade instead.'
    globalThis.fetch = vi.fn(async () => fail(409, { detail }))
    expect(await saveTicksResult(args)).toEqual({ ok: false, reason: detail, retryable: false })
  })

  it('a detail with no closing punctuation gets a full stop; one that has any keeps it as sent (M-3)', async () => {
    globalThis.fetch = vi.fn(async () => fail(404, { detail: 'Not found' }))
    expect(await saveTicksResult(args)).toEqual({ ok: false, reason: 'Not found.', retryable: false })
    for (const detail of ['Gone!', 'Closed?', 'Said "no."', 'Closed (see the trade).', 'Wait…']) {
      globalThis.fetch = vi.fn(async () => fail(404, { detail }))
      expect((await saveTicksResult(args)).reason, detail).toBe(detail)
    }
  })

  it('no detail: the status the server answered; no answer at all: that the request never arrived', async () => {
    globalThis.fetch = vi.fn(async () => fail(502, null))
    expect(await saveTicksResult(args)).toEqual({ ok: false, reason: 'The server answered with status 502.', retryable: true })
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError('html') } }))
    expect(await saveTicksResult(args)).toEqual({ ok: false, reason: 'The server answered with status 500.', retryable: true })
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await saveTicksResult(args)).toEqual({ ok: false, reason: 'The request did not reach the server.', retryable: true })
  })

  it('retryable is exactly "no answer, or a 5xx": a 4xx with a sentence is the answer', async () => {
    for (const [status, retryable] of [[400, false], [402, false], [404, false], [409, false], [500, true], [503, true]]) {
      globalThis.fetch = vi.fn(async () => fail(status, { detail: 'x' }))
      expect((await saveTicksResult(args)).retryable, String(status)).toBe(retryable)
    }
  })

  it('success is ok with no reason', async () => {
    globalThis.fetch = vi.fn(async () => ok({ tradeRef: 'pos:p1' }))
    expect(await saveTicksResult(args)).toEqual({ ok: true, reason: null, retryable: false })
  })

  it('I-2: a write the server never answers gives up after 10 s, aborts, and says it did not arrive', async () => {
    vi.useFakeTimers()
    try {
      let signal
      globalThis.fetch = vi.fn((url, init) => { signal = init.signal; return new Promise(() => {}) })
      let settled = null
      saveTicksResult(args).then((r) => { settled = r })
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1)
      expect(settled).toBeNull()
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toEqual({ ok: false, reason: 'The request did not reach the server.', retryable: true })
      expect(signal.aborted).toBe(true)
      expect(SAVE_TIMEOUT_MS).toBe(10000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('I-2: an error body the server starts and never finishes is bounded by the same timer; its status stands', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: () => new Promise(() => {}) }))
      let settled = null
      saveTicksResult(args).then((r) => { settled = r })
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS)
      expect(settled).toEqual({ ok: false, reason: 'The server answered with status 503.', retryable: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('notSavedLine says the trade is logged and the checklist is not, then why', () => {
    expect(notSavedLine('Not found.')).toBe('Your trade is logged, but its pre-entry checklist was not saved. Not found.')
  })
})

describe('ticksToSave: only the ticks of the checklist on screen, in its order', () => {
  it('drops ticks another setup holds, and counts the items shown', () => {
    expect(ticksToSave({ ticked: ['other', 's2', 'rule:r1'], itemIds: ['s1', 's2', 'rule:r1'] }))
      .toEqual({ checked: ['s2', 'rule:r1'], total: 3 })
  })
  it('nothing on screen is nothing to save', () => {
    expect(ticksToSave({ ticked: ['s1'], itemIds: [] })).toEqual({ checked: [], total: 0 })
    expect(ticksToSave({ ticked: undefined, itemIds: undefined })).toEqual({ checked: [], total: 0 })
  })
})

describe('softWarning and checklistMode (IR-S8, both values)', () => {
  it('softWarning: only when requireAll is yes and something is unticked', () => {
    expect(softWarning({ requireAll: 'yes', unticked: 2 })).toBe('2 checklist items not ticked. You can still log this trade.')
    expect(softWarning({ requireAll: 'yes', unticked: 1 })).toBe('1 checklist item not ticked. You can still log this trade.')
    expect(softWarning({ requireAll: 'no', unticked: 2 })).toBeNull()
    expect(softWarning({ requireAll: 'yes', unticked: 0 })).toBeNull()
  })
  it('checklistMode reads the preference: off (default), on, on-warn', () => {
    expect(LOG_TRADE_CHECKLIST_PREF).toBe('notebook_log_trade_checklist')
    expect(checklistMode({})).toEqual({ show: false, requireAll: 'no' })
    expect(checklistMode(undefined)).toEqual({ show: false, requireAll: 'no' })
    expect(checklistMode({ notebook_log_trade_checklist: 'off' })).toEqual({ show: false, requireAll: 'no' })
    expect(checklistMode({ notebook_log_trade_checklist: 'on' })).toEqual({ show: true, requireAll: 'no' })
    expect(checklistMode({ notebook_log_trade_checklist: 'on-warn' })).toEqual({ show: true, requireAll: 'yes' })
    // anything else is off: a value this code does not know never turns the checklist on
    expect(checklistMode({ notebook_log_trade_checklist: 'yes' })).toEqual({ show: false, requireAll: 'no' })
  })
})
