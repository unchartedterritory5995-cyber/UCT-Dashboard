// Notebook telemetry helper (wave 6, D14). The server side of the contract —
// every name here is on `_J2_TELEMETRY_EVENTS` — is railed in
// tests/test_notebook_telemetry_events.py, which reads THIS module's source.
import { describe, it, expect, vi } from 'vitest'
import {
  NOTEBOOK_EVENTS, EVENT_SCHEMAS, CORE_ACTION_EVENTS, sanitizeProps, trackNotebookEvent, startNoteOpenTimer,
} from './notebookTelemetry'
import { ADAPTERS } from './importer/registry'
import { EXPORT_FORMATS } from '../components/notebook/export/exportFormats'
import { LISTED_ITEM_TYPES } from './styleLibrary'
import { BLOCK_KINDS, TOOL_BLOCK_LABELS } from './journalBlocks'
import { WIDGET_IDS, isTraderBlock } from '../../../widgets/registry'

const QUERY = 'nvda earnings gap'
const TITLE = 'My NVDA thesis for Q4'

function fakeFetch() {
  const f = vi.fn(() => Promise.resolve({ ok: true }))
  f.bodies = () => f.mock.calls.map(([, init]) => JSON.parse(init.body))
  return f
}

describe('the event set', () => {
  // P5 (Task 6, ruling P5-R-C7): 17 + P5's three = 20 names.
  it('is the core Notebook actions (the seven of wave 6, the R-16 eight of wave 10, the two of P3a and the three of P5), each with a schema', () => {
    expect(Object.values(NOTEBOOK_EVENTS).sort()).toEqual([
      'ask_used', 'block_used', 'bulk_used', 'capture_used', 'conflict_forked', 'dictation_used', 'export_used',
      'import_used', 'library_viewed', 'note_open_ms', 'publish_used', 'save_failed', 'save_success', 'search_used',
      'share_used', 'style_adopted', 'style_applied', 'style_created', 'switcher_used', 'writing_help_used',
    ])
    expect(Object.values(NOTEBOOK_EVENTS)).toHaveLength(20)
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

  it('P3a: the two library events carry no id, title or handle', () => {
    expect(Object.keys(EVENT_SCHEMAS.library_viewed).sort()).toEqual(['type', 'view'])
    expect(Object.keys(EVENT_SCHEMAS.style_adopted)).toEqual(['notify'])
    // a caller that tried to send the item would send nothing of it
    expect(sanitizeProps('style_adopted', { notify: true, id: 'gal_1', title: TITLE, author: 'anon-7' }))
      .toEqual({ notify: true })
    expect(sanitizeProps('library_viewed', { type: 'style', view: TITLE, handle: 'anon-7' }))
      .toEqual({ type: 'style', view: 'other' })
  })

  it('library_viewed.type is "all" plus exactly the ITEM_TYPES keys a member can view (read, not typed)', () => {
    // P3b: example_note is in ITEM_TYPES but is never a chip, so never a viewed type (R-P3b-2, R9: no event change)
    const viewable = LISTED_ITEM_TYPES.map((t) => t.key)
    expect([...EVENT_SCHEMAS.library_viewed.type.values].sort()).toEqual(['all', ...viewable].sort())
  })

  it('export_used.format covers every EXPORT_FORMATS id, plus png and print', () => {
    const want = [...EXPORT_FORMATS.map((f) => f.id), 'png', 'print'].sort()
    expect([...EVENT_SCHEMAS.export_used.format.values].sort()).toEqual(want)
  })
})

// P5 Task 6: the three journal-style events. Closed enums only, never a style id, a name or a block's params.
describe('P5 - style_applied, style_created and block_used', () => {
  it('each carries one closed-enum prop and nothing else', () => {
    expect(Object.keys(EVENT_SCHEMAS.style_applied)).toEqual(['via'])
    expect(Object.keys(EVENT_SCHEMAS.style_created)).toEqual(['via'])
    expect(Object.keys(EVENT_SCHEMAS.block_used)).toEqual(['kind'])
    expect([...EVENT_SCHEMAS.style_applied.via.values]).toEqual(['new_note', 'switch', 'update'])
    expect([...EVENT_SCHEMAS.style_created.via.values]).toEqual(['editor', 'duplicate', 'from_note'])
  })

  it('block_used.kind is exactly the BLOCK_KINDS ids, in BLOCK_KINDS order (P5-R-C8: 13, read not typed)', () => {
    const ids = BLOCK_KINDS.map((k) => k.id)
    expect(ids).toHaveLength(13)                                     // control: the catalog was read
    expect([...EVENT_SCHEMAS.block_used.kind.values]).toEqual(ids)
  })

  it('every trader block in the registry is a block_used kind, so none can be sent as "other"', () => {
    // Wave 9 (W9-R4): the live blocks (routine, tracker) have no BLOCK_KINDS row, so they are not in the enum and
    // insertWidgetEmbed sends nothing for them (widgetEmbedNode.blockUsed.test.jsx); every other block is.
    const blocks = WIDGET_IDS.filter((id) => isTraderBlock(id) && !Object.hasOwn(TOOL_BLOCK_LABELS, id))
    expect(blocks.length).toBeGreaterThanOrEqual(10)                 // control: the registry was read
    for (const id of blocks) expect(EVENT_SCHEMAS.block_used.kind.values.has(id), id).toBe(true)
    expect(WIDGET_IDS.filter(isTraderBlock)).toContain('routine')    // control: a live block IS registered
    for (const id of Object.keys(TOOL_BLOCK_LABELS)) expect(EVENT_SCHEMAS.block_used.kind.values.has(id), id).toBe(false)
  })

  it('a style id, a name or a typed word cannot ride along', () => {
    expect(sanitizeProps('style_applied', { via: 'switch', styleId: 's1', name: TITLE })).toEqual({ via: 'switch' })
    expect(sanitizeProps('style_created', { via: TITLE })).toEqual({ via: 'other' })
    expect(sanitizeProps('block_used', { kind: 'free text', params: { entry: 1 } })).toEqual({ kind: 'other' })
  })
})
