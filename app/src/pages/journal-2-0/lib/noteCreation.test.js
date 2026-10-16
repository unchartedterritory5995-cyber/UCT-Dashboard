import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNoteViaApi } from './noteCreation'

// No test file existed for this module before this pass. Scoped to what
// this pass touches (the new optional `subtitle` param, for the Duplicate
// note action, UX #12, 2026-09-22) -- not a full behavioral suite for the
// module's other, already-exercised-via-NotebookTab.test.jsx call sites.

let lastBody = null

beforeEach(() => {
  lastBody = null
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'POST') {
      lastBody = JSON.parse(opts.body)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: { id: 'new1' } }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

describe('createNoteViaApi — subtitle', () => {
  it('includes subtitle in the POST body when provided', async () => {
    await createNoteViaApi({ title: 'A note', subtitle: 'A subtitle' })
    expect(lastBody.subtitle).toBe('A subtitle')
  })

  it('⛔ CONTROL — omits subtitle entirely when not provided (every pre-existing caller)', async () => {
    await createNoteViaApi({ title: 'A note' })
    expect('subtitle' in lastBody).toBe(false)
  })
})

// Tier 2 part B: the earnings follow-up's report date. Sent only as { reportDate: <string> }.
describe('createNoteViaApi -- earningsFollowup (Tier 2 part B)', () => {
  it('puts { reportDate } in the body', async () => {
    await createNoteViaApi({ title: 'x', kindId: 'earnings_followup', ticker: 'ORCL', earningsFollowup: { reportDate: '2026-10-14' } })
    expect(lastBody.earningsFollowup).toEqual({ reportDate: '2026-10-14' })
  })
  it('sends nothing else the caller put inside it', async () => {
    await createNoteViaApi({ title: 'x', earningsFollowup: { reportDate: '2026-10-14', extra: 'no' } })
    expect(lastBody.earningsFollowup).toEqual({ reportDate: '2026-10-14' })
  })
  it('a non-object, or a date that is not a string, stays off the wire', async () => {
    await createNoteViaApi({ title: 'x', earningsFollowup: 'yes' })
    expect('earningsFollowup' in lastBody).toBe(false)
    await createNoteViaApi({ title: 'x', earningsFollowup: { reportDate: 5 } })
    expect('earningsFollowup' in lastBody).toBe(false)
  })
  it('CONTROL -- every pre-existing caller sends no such key', async () => {
    await createNoteViaApi({ title: 'x' })
    expect('earningsFollowup' in lastBody).toBe(false)
  })
})
