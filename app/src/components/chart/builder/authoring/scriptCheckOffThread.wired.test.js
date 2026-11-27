// app/src/components/chart/builder/authoring/scriptCheckOffThread.wired.test.js
//
// ─── ⭐ UNIT (c) — THE WORKERS' CHECK IS WIRED IN: the check's OWN engine loader hands it over, and the member's
// Stop reaches it from `settleScript` ─────────────────────────────────────────────────────────────────────────────
//
// `scriptCheckOffThread.test.js` runs the check with an engine it builds itself (its stand-in workers reset the
// module graph, so the check's own dynamic imports would land in another graph). This file holds the two wires that
// rail cannot see, with the workers' check replaced by a spy:
//   1. `checkScript`'s default loader carries `judgeOffThread`, and the check asks it BEFORE anything is computed on
//      this thread: what it answers is the check's answer (a refusal by name), and a null sends the check to this thread;
//   2. `settleScript` hands its `cancelled` to the check (the default one and a caller's), and the check hands it on.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const S = vi.hoisted(() => ({ calls: [], answer: null, main: 0 }))
vi.mock('./scriptCheckOffThread', () => ({
  judgeOffThread: async (pine, opts) => { S.calls.push({ pine, opts }); return S.answer },
}))
vi.mock('../memberPane/memberPaneDefinition', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, memberPaneDefinition: (...args) => { S.main += 1; return m.memberPaneDefinition(...args) } }
})

import { checkScript, settleScript, UNCHECKED_HEADLINE, UNCHECKED_STATE, SCRIPT_CHECK_UNFINISHED_LINE } from './scriptAnswer'

const PINE = '//@version=5\nindicator("x")\nplot(close)\n'

beforeEach(() => {
  S.calls.length = 0
  S.answer = null
  S.main = 0
})

describe('the check\'s own loader hands it the workers\' check', () => {
  it('what the workers\' check refuses is the check\'s answer, and nothing is computed on this thread', async () => {
    S.answer = { unchecked: true, because: 'status', waitedMs: 1700 }
    const v = await checkScript(PINE)
    expect(S.calls.map((c) => c.pine)).toEqual([PINE])
    expect(v).toEqual({ runs: false, attaches: false, state: UNCHECKED_STATE, lane: 'host', headline: UNCHECKED_HEADLINE,
      withheld: [], notes: [SCRIPT_CHECK_UNFINISHED_LINE], errors: [], unfinished: true })
    expect(S.main, 'the door was not called on this thread').toBe(0)
    S.answer = { unchecked: true, because: 'door-worker' }
    expect((await checkScript(PINE)).notes, 'a fault other than the bound says no line of its own').toEqual([])
    expect(S.main).toBe(0)
  }, 120_000)

  it('CONTROL: a null (no workers here) sends the check to this thread, where the door runs once', async () => {
    S.answer = null
    const v = await checkScript(PINE)
    expect(S.calls.length).toBe(1)
    expect(S.main).toBe(1)
    expect(v.state).not.toBe(UNCHECKED_STATE)
  }, 120_000)

  it('what the workers\' check answers IS what is judged: its pane, its status, its read of the consult', async () => {
    const pane = { ok: false, definition: null, reason: 'the door\'s own words (the rail\'s)', rows: [], notes: [] }
    const status = { state: 'not-yet', headline: 'Not yet', items: [] }
    S.answer = { pane, status, consultPending: false, offThread: true }
    const v = await checkScript(PINE)
    expect(S.main).toBe(0)
    expect(v.runs).toBe(false)
    expect(v.errors).toEqual(['the door\'s own words (the rail\'s)'])
    // a consult the BUILD left unanswered is the workers' read of it: "still being checked", never a refusal
    S.answer = { pane, status, consultPending: true, offThread: true }
    const waiting = await checkScript(PINE)
    expect(waiting.checking).toBe(true)
    expect(waiting.errors).toEqual([])
  }, 120_000)
})

describe('the member\'s Stop reaches the workers\' check', () => {
  it('`checkScript` hands its `cancelled` on', async () => {
    S.answer = { unchecked: true, because: 'stopped' }
    const cancelled = () => true
    await checkScript(PINE, { cancelled })
    expect(S.calls[0].opts.cancelled).toBe(cancelled)
  }, 120_000)

  it('`settleScript` hands its own to the default check, and to a caller\'s check as the third argument', async () => {
    S.answer = { unchecked: true, because: 'stopped' }
    let stopped = false
    await settleScript({ script: { name: 'x', pine: PINE }, reply: '' }, async () => null, { cancelled: () => stopped })
    expect(S.calls.length).toBe(1)
    expect(S.calls[0].opts.cancelled()).toBe(false)
    stopped = true
    expect(S.calls[0].opts.cancelled(), 'it is the member\'s Stop, read live').toBe(true)
    const check = vi.fn(async () => ({ runs: true, attaches: true, state: 'runs', lane: 'host', headline: 'Runs', withheld: [], notes: [], errors: [] }))
    stopped = false
    await settleScript({ script: { name: 'x', pine: PINE }, reply: '' }, async () => null, { check, cancelled: () => stopped })
    expect(check).toHaveBeenCalledTimes(1)
    expect(check.mock.calls[0][0]).toBe(PINE)
    expect(typeof check.mock.calls[0][2].cancelled).toBe('function')
    stopped = true
    expect(check.mock.calls[0][2].cancelled()).toBe(true)
  }, 120_000)
})
