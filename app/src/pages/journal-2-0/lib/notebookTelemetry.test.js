// Notebook telemetry helper (wave 6, D14). The server side of the contract —
// every name here is on `_J2_TELEMETRY_EVENTS` — is railed in
// tests/test_notebook_telemetry_events.py, which reads THIS module's source.
import { describe, it, expect, vi } from 'vitest'
import {
  NOTEBOOK_EVENTS, EVENT_SCHEMAS, sanitizeProps, trackNotebookEvent, startNoteOpenTimer,
} from './notebookTelemetry'

const QUERY = 'nvda earnings gap'
const TITLE = 'My NVDA thesis for Q4'

function fakeFetch() {
  const f = vi.fn(() => Promise.resolve({ ok: true }))
  f.bodies = () => f.mock.calls.map(([, init]) => JSON.parse(init.body))
  return f
}

describe('the event set', () => {
  it('is the seven core Notebook actions, each with a schema', () => {
    expect(Object.values(NOTEBOOK_EVENTS).sort()).toEqual([
      'ask_used', 'capture_used', 'conflict_forked', 'note_open_ms', 'save_failed',
      'search_used', 'switcher_used',
    ])
    for (const name of Object.values(NOTEBOOK_EVENTS)) expect(EVENT_SCHEMAS[name]).toBeTruthy()
  })
})

describe('what a caller cannot send', () => {
  it('a search query or a note title in a string prop becomes "other"', () => {
    const f = fakeFetch()
    trackNotebookEvent('search_used', { mode: QUERY, results: 4 }, { fetchImpl: f })
    trackNotebookEvent('note_open_ms', { source: TITLE, ms: 120 }, { fetchImpl: f })
    const sent = JSON.stringify(f.bodies())
    expect(sent).not.toContain('nvda')
    expect(sent).not.toContain('thesis')
    expect(f.bodies()[0]).toEqual({ event: 'search_used', props: { mode: 'other', results: 4 } })
  })

  it('a key that is not on the event schema never leaves', () => {
    const clean = sanitizeProps('ask_used', { scope: 'note', question: QUERY, title: TITLE, body: 'x' })
    expect(clean).toEqual({ scope: 'note' })
  })

  it('numbers must be finite and are rounded; booleans must be booleans', () => {
    expect(sanitizeProps('switcher_used', { results: 3.6, rank: Infinity, picked: 'yes' }))
      .toEqual({ results: 4 })
    expect(sanitizeProps('save_failed', { status: 409, offline: true, reason: 'conflict' }))
      .toEqual({ status: 409, offline: true, reason: 'conflict' })
  })

  it('an unknown event is not sent at all', () => {
    const f = fakeFetch()
    expect(trackNotebookEvent('note_title_typed', { t: TITLE }, { fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('transport', () => {
  it('posts to the existing J2 telemetry door', () => {
    const f = fakeFetch()
    trackNotebookEvent('conflict_forked', { door: 'outbox', queued: true }, { fetchImpl: f })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/j2/telemetry')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
  })

  it('never throws, whether fetch throws or rejects', async () => {
    expect(() => trackNotebookEvent('ask_used', {}, { fetchImpl: () => { throw new Error('x') } })).not.toThrow()
    const rejecting = () => Promise.reject(new Error('offline'))
    expect(() => trackNotebookEvent('ask_used', {}, { fetchImpl: rejecting })).not.toThrow()
    await Promise.resolve()
  })
})

describe('note open timer', () => {
  it('measures from start to stop, and fires once however often stop is called', () => {
    let t = 1000
    const f = fakeFetch()
    const stop = startNoteOpenTimer({ now: () => t, fetchImpl: f })
    t = 1234.4
    expect(stop({ source: 'switcher', ms: 1 })).toEqual({ ms: 234, source: 'switcher' })
    expect(stop({ source: 'switcher' })).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })
})
