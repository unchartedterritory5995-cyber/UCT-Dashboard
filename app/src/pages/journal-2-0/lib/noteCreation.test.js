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
