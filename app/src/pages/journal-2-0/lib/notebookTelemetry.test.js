// Notebook telemetry helper (wave 6, D14). The server side of the contract —
// every name here is on `_J2_TELEMETRY_EVENTS` — is railed in
// tests/test_notebook_telemetry_events.py, which reads THIS module's source.
import { describe, it, expect, vi } from 'vitest'
import {
  NOTEBOOK_EVENTS, EVENT_SCHEMAS, CORE_ACTION_EVENTS, sanitizeProps, trackNotebookEvent, startNoteOpenTimer,
} from './notebookTelemetry'
import { ADAPTERS } from './importer/registry'
import { EXPORT_FORMATS } from '../components/notebook/export/exportFormats'

const QUERY = 'nvda earnings gap'
const TITLE = 'My NVDA thesis for Q4'

function fakeFetch() {
  const f = vi.fn(() => Promise.resolve({ ok: true }))
  f.bodies = () => f.mock.calls.map(([, init]) => JSON.parse(init.body))
  return f
}

describe('the event set', () => {
  it('is the core Notebook actions (the seven of wave 6 + the R-16 eight of wave 10), each with a schema', () => {
    expect(Object.values(NOTEBOOK_EVENTS).sort()).toEqual([
      'ask_used', 'bulk_used', 'capture_used', 'conflict_forked', 'dictation_used', 'export_used',
      'import_used', 'note_open_ms', 'publish_used', 'save_failed', 'save_success', 'search_used',
      'share_used', 'switcher_used', 'writing_help_used',
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

// ⭐ Wave 10 (10D, ruling R-16): "every core action" is a NAMED list. These pin that the
// list is covered, and that two enums are READ from the thing they describe.
describe('R-16 — every core action has an event that fires on its success', () => {
  it('the table names study tasks T1..T10 and the seven named actions, each to a known event', () => {
    const keys = Object.keys(CORE_ACTION_EVENTS)
    for (let t = 1; t <= 10; t += 1) {
      expect(keys.filter((k) => k.startsWith(`T${t} `)), `study task T${t}`).toHaveLength(1)
    }
    for (const named of ['export', 'import', 'save_success', 'share', 'publish', 'writing_help_used', 'dictation_used']) {
      expect(keys, named).toContain(named)
    }
    const known = new Set(Object.values(NOTEBOOK_EVENTS))
    for (const [action, events] of Object.entries(CORE_ACTION_EVENTS)) {
      expect(events.length, action).toBeGreaterThan(0)
      for (const e of events) expect(known.has(e), `${action} -> ${e}`).toBe(true)
    }
  })

  it('every wave-10 event carries at least one core action (none is an orphan)', () => {
    const mapped = new Set(Object.values(CORE_ACTION_EVENTS).flat())
    for (const e of ['save_success', 'export_used', 'import_used', 'share_used', 'publish_used',
      'writing_help_used', 'dictation_used', 'bulk_used']) {
      expect(mapped.has(e), e).toBe(true)
    }
  })

  it('import_used.source is exactly the adapter ids of the importer registry (read, not typed)', () => {
    expect([...EVENT_SCHEMAS.import_used.source.values].sort()).toEqual(ADAPTERS.map((a) => a.id).sort())
  })

  it('export_used.format covers every EXPORT_FORMATS id, plus png and print', () => {
    const want = [...EXPORT_FORMATS.map((f) => f.id), 'png', 'print'].sort()
    expect([...EVENT_SCHEMAS.export_used.format.values].sort()).toEqual(want)
  })
})
