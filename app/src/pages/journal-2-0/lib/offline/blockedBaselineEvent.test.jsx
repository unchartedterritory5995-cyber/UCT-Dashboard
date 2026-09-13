/**
 * Wave Q1 — ITEM 2: THE NULL IS INSTRUMENTED, NOT HUNTED.
 *
 * Nine driven paths failed to reproduce `baseUpdatedAt: null`. A tenth guess is
 * not evidence, so the drain's refusal now reports itself and the observation
 * window counts occurrences. That turns an open question into a measurement —
 * and it is only a measurement if the instrument fires on exactly the thing it
 * claims to measure.
 *
 * ⛔ SO EVERY TEST HERE IS "AND ON NOTHING ELSE". An event that also fires on a
 * transient network failure would make a healthy offline session look like the
 * incident recurring, and the flip condition ("zero occurrences") would be
 * unreadable. Each firing case has a matching silent case.
 *
 * ⛔ AND NO NOTE CONTENT. The key set is pinned exactly, not spot-checked for a
 * `body` key: "we did not send the body" is not the property — "we sent these
 * seven fields and no others" is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, listOutbox } from './notebookDb'
import { drainOutbox, NO_BASELINE, BLOCKED, SENT, KEPT, FORKED } from './outboxDrain'
import { useOutboxDrain } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import {
  BLOCKED_BASELINE_EVENT, describeBaseline, flagState, blockedBaselineProps, postBlockedBaseline,
} from './blockedBaselineEvent'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

let db

function installLocks() {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: async (name, opts, cb) => {
        if (opts?.ifAvailable) return cb({ name })
        return new Promise(() => {})
      },
    },
  })
}
function removeLocks() {
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
}

async function queue(theDb, { noteId = 'n1', base = null, text = 'written offline', queuedAt = 5 } = {}) {
  await putNoteWithIntent(theDb, {
    noteId, title: 'queued', subtitle: '', bodyJson: doc(text),
    baseUpdatedAt: base, generation: 7, sessionId: 'sess-9', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: `note:${noteId}`, noteId, kind: 'note-update',
    patch: { title: 'queued', subtitle: '', bodyJson: doc(text) },
    baseUpdatedAt: base, generation: 7, queuedAt,
  })
}

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
  installLocks()
})
afterEach(() => {
  removeLocks()
  delete globalThis.indexedDB
  localStorage.clear()
  vi.clearAllMocks()
})

function mount(extra = {}) {
  const connect = vi.fn(async () => db)
  return renderHook(() => useOutboxDrain({
    accountId: 'acct1', connect, fork: vi.fn(), intervalMs: 100000, ...extra,
  }))
}

/* ─── the drain's own description of the refusal ──────────────────────────── */

describe('the drain describes the refusal it just made', () => {
  it('⭐ a baseline-less entry comes back BLOCKED and carries a report', async () => {
    await queue(db, { base: null })
    const results = await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()

    expect(results[0].outcome).toBe(BLOCKED)
    expect(results[0].report).toMatchObject({
      reason: NO_BASELINE,
      noteId: 'n1',
      baseUpdatedAt: null,
      generation: 7,
      sessionId: 'sess-9',       // read off the durable RECORD, which has it
      queuedAt: 5,
    })
  })

  it('⛔ a SENT entry carries no report', async () => {
    await queue(db, { base: 'T1' })
    const results = await drainOutbox(db, { send: vi.fn(async () => ({ id: 'n1', updatedAt: 'T2' })), fork: vi.fn() })
    expect(results[0].outcome).toBe(SENT)
    expect(results[0].report).toBeUndefined()
  })

  it('⛔ a TRANSIENT failure carries no report — it is still going to be retried', async () => {
    await queue(db, { base: 'T1' })
    const boom = Object.assign(new Error('network down'), { status: 0 })
    const results = await drainOutbox(db, { send: vi.fn(async () => { throw boom }), fork: vi.fn() })
    expect(results[0].outcome).toBe(KEPT)
    expect(results[0].report).toBeUndefined()
  })

  it('⛔ a CONFLICT that forks carries no report', async () => {
    await queue(db, { base: 'T1' })
    const conflict = Object.assign(new Error('conflict'), { status: 409 })
    const results = await drainOutbox(db, {
      send: vi.fn(async () => { throw conflict }),
      fork: vi.fn(async () => ({ id: 'n1', updatedAt: 'T9', bodyJson: doc('server') })),
    })
    await settleIdb()
    expect(results[0].outcome).toBe(FORKED)
    expect(results[0].report).toBeUndefined()
  })

  it('⛔⛔ a NON-TRANSIENT rejection is BLOCKED but carries no report', async () => {
    // It is blocked for a reason a human can already read off `lastError`. Only
    // the unexplained one is instrumented — otherwise the window's count would
    // be dominated by understood failures and would answer nothing.
    await queue(db, { base: 'T1' })
    const rejected = Object.assign(new Error('bad request'), { status: 400 })
    const results = await drainOutbox(db, { send: vi.fn(async () => { throw rejected }), fork: vi.fn() })
    await settleIdb()
    expect(results[0].outcome).toBe(BLOCKED)
    expect(results[0].report).toBeUndefined()
  })

  it('⛔⛔ IT CANNOT DOUBLE-COUNT: a re-drain of an already-blocked entry is silent', async () => {
    // The `permanent` branch runs BEFORE the baseline check, so the report marks
    // the TRANSITION into blocked, once. Without this the retry interval would
    // manufacture an occurrence every tick and the window would read as a
    // storm of incidents that never happened.
    await queue(db, { base: null })
    const first = await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    expect(first[0].report?.reason).toBe(NO_BASELINE)
    expect((await listOutbox(db))[0].permanent).toBe(true)

    const second = await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    expect(second[0].outcome).toBe(BLOCKED)
    expect(second[0].report).toBeUndefined()
  })

  it('⭐ an EMPTY-STRING baseline reports too, and says which shape it was', async () => {
    // The second defect this wave found: `''` survives `??` and dies at `if (x)`.
    // It must be distinguishable from `null` in the window, or "the null came
    // back" and "the empty string came back" become the same line.
    await queue(db, { base: '' })
    const results = await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    expect(results[0].report.baseUpdatedAt).toBe('')
    expect(describeBaseline(results[0].report.baseUpdatedAt)).toBe('empty-string')
  })
})

/* ─── the wire: the hook actually carries it ──────────────────────────────── */

describe('⭐ THE WIRE — the hook reports what the drain described', () => {
  it('fires exactly once, with the drain’s report', async () => {
    // §MUTATION: delete the reporting loop in `useOutboxDrain.drainNow` and this
    // goes red while every other rail in the wave stays green.
    await queue(db, { base: null })
    const report = vi.fn(async () => {})
    const { result } = mount({ report, send: vi.fn() })
    await waitFor(() => expect(result.current.isLeader).toBe(true))
    await act(async () => { await result.current.drainNow(); await settleIdb() })

    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toMatchObject({ reason: NO_BASELINE, noteId: 'n1' })
  })

  it('⛔ and does NOT fire on a healthy drain', async () => {
    await queue(db, { base: 'T1' })
    const report = vi.fn(async () => {})
    const { result } = mount({ report, send: vi.fn(async () => ({ id: 'n1', updatedAt: 'T2' })) })
    await waitFor(() => expect(result.current.isLeader).toBe(true))
    await act(async () => { await result.current.drainNow(); await settleIdb() })
    expect(report).not.toHaveBeenCalled()
  })

  it('⛔⛔ a reporter that THROWS does not break the drain', async () => {
    // An instrument that can break the thing it measures is worse than no
    // instrument. The queue must still settle exactly as it would have.
    await queue(db, { base: null })
    const report = vi.fn(async () => { throw new Error('telemetry is down') })
    const { result } = mount({ report, send: vi.fn() })
    await waitFor(() => expect(result.current.isLeader).toBe(true))
    let summary
    await act(async () => { summary = await result.current.drainNow(); await settleIdb() })

    expect(summary).toMatchObject({ blocked: 1 })
    expect((await listOutbox(db))[0].permanent).toBe(true)
  })
})

/* ─── the payload ─────────────────────────────────────────────────────────── */

describe('⛔⛔ WHAT IS SENT — ids and counters, never a member’s words', () => {
  const report = {
    reason: NO_BASELINE, noteId: 'n1', baseUpdatedAt: null,
    generation: 7, sessionId: 'sess-9', queuedAt: 1000, attempts: 2,
  }

  it('the key set is EXACTLY these seven fields', () => {
    // ⛔ Pinned as a set, not spot-checked. "There is no body key" is satisfied
    // by a payload that ships the title instead.
    const props = blockedBaselineProps(report, { now: () => 4000 })
    expect(Object.keys(props).sort()).toEqual(
      ['attempts', 'baseline', 'entryAgeMs', 'flag', 'generation', 'noteId', 'sessionId'],
    )
  })

  it('⭐ nothing in the payload can carry note text, even if the entry did', () => {
    const withWords = { ...report, patch: { title: 'MEMBER SECRET', bodyJson: doc('MEMBER SECRET') } }
    const json = JSON.stringify(blockedBaselineProps(withWords, { now: () => 4000 }))
    expect(json).not.toMatch(/MEMBER SECRET/)
    expect(json).not.toMatch(/patch|title|body/i)
  })

  it('the baseline is described, never sent raw', () => {
    expect(blockedBaselineProps(report, { now: () => 4000 }).baseline).toBe('null')
    expect(describeBaseline(null)).toBe('null')
    expect(describeBaseline(undefined)).toBe('undefined')
    expect(describeBaseline('')).toBe('empty-string')
    expect(describeBaseline('   ')).toBe('whitespace')
    expect(describeBaseline(0)).toBe('non-string:number')
    expect(describeBaseline({})).toBe('non-string:object')
    // ⛔ CONTROL: a usable baseline is not one of the failure shapes — it never
    // reaches this function, and the enumeration says so rather than pretending.
    expect(describeBaseline('2026-09-10T03:30:28Z')).toBe('other')
  })

  it('entry age is derived, and survives a missing queuedAt', () => {
    expect(blockedBaselineProps(report, { now: () => 4000 }).entryAgeMs).toBe(3000)
    expect(blockedBaselineProps({ ...report, queuedAt: undefined }, { now: () => 4000 }).entryAgeMs).toBeNull()
  })

  it('⭐ the flag state distinguishes "off by default" from "explicitly off"', () => {
    // `project_feature_flag_ledger`: OFF-and-unset is indistinguishable from
    // off-on-purpose unless something records which it was.
    const store = { getItem: () => null }
    // ⛔⛔ FLIPPED 2026-09-12 — unset now resolves to ON. The DISTINCTION this test
    // exists for is untouched: `byDefault` still separates "unset" from "explicit",
    // which is the whole point of recording it (`project_feature_flag_ledger`).
    expect(flagState(store)).toMatchObject({ key: null, enabled: true, byDefault: true, def: true })
    expect(flagState({ getItem: () => '0' })).toMatchObject({ key: '0', enabled: false, byDefault: false })
    expect(flagState({ getItem: () => '1' })).toMatchObject({ key: '1', enabled: true, byDefault: false })
  })
})

describe('⭐ THE TRANSPORT — the Notebook’s existing allow-listed channel', () => {
  it('posts the allow-listed event name to /api/j2/telemetry', async () => {
    // ⛔ The name must also be in `_J2_TELEMETRY_EVENTS` (api/routers/journal_two.py)
    // or the POST is a 400 and the window measures nothing. Railed there too.
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await postBlockedBaseline({ reason: NO_BASELINE, noteId: 'n1', baseUpdatedAt: null, queuedAt: 1 }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/j2/telemetry')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(JSON.parse(opts.body).event).toBe(BLOCKED_BASELINE_EVENT)
    expect(BLOCKED_BASELINE_EVENT).toBe('notebook_blocked_no_baseline')
  })

  it('⛔ a failing POST is swallowed and still returns what it tried to send', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline, of course') })
    const props = await postBlockedBaseline({ reason: NO_BASELINE, noteId: 'n1', baseUpdatedAt: null, queuedAt: 1 }, { fetchImpl })
    expect(props.noteId).toBe('n1')
  })
})
