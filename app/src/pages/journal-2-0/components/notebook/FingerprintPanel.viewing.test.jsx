// Finish program, lane FE, finding I5 — VIEWING A NOTE NEVER WRITES.
//
// The panel used to freeze every unfrozen chart the moment a note was opened and write the
// result into the node: opening an old note sent a POST per chart, made the note dirty,
// autosaved it and moved its "last edited" time to now.
//
// The rule now: a freeze happens only (a) when the member presses the button, or (b) for a
// chart the member added while this note has been open in this tab, where the write rides the
// save that insert already caused. "Added during this visit" is the block's own `capturedAt`
// against the moment the note's editor opened (`openedAt` in editor storage, NoteEditorPage).
// With no `openedAt` the panel does not guess: it waits for the button.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import FingerprintPanel, { FREEZE_RETRY_MS } from './FingerprintPanel'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const FP = { v: 1, symbol: 'NVDA', requested_as_of: '2026-09-30', as_of: '2026-09-30', mode: 'nightly', fields: {} }
const META = { version: 1, fields: [], missingReasons: {}, transientMissing: [] }
const OPENED = Date.parse('2026-10-05T14:00:00Z')
const OLD_CHART = { widgetId: 'chart', embedId: 'e-old', capturedAt: '2026-09-30T18:00:00Z', params: { symbol: 'NVDA', tf: 'D', to: 1790791200 } }
const NEW_CHART = { ...OLD_CHART, embedId: 'e-new', capturedAt: '2026-10-05T14:03:00Z' }
const editorWith = (storage = { noteId: 'n-1', openedAt: OPENED }, isEditable = true) => (
  { isEditable, storage: { uctJournalWidgets: storage } }
)
const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

let freezeAnswer
function installFetch() {
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.endsWith('/meta')) return respond(200, META)
    if (u.includes('/freeze')) return freezeAnswer()
    return respond(200, {})
  })
}
const writes = () => global.fetch.mock.calls
  .filter(([, init]) => (init?.method || 'GET').toUpperCase() !== 'GET')
  .map(([url, init]) => `${init.method} ${url}`)

const renderPanel = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <FingerprintPanel {...props} />
  </SWRConfig>,
)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  latchNotebookFlags({ notebook_ta_fingerprint_enabled: true })
  freezeAnswer = () => respond(200, { block: { fingerprint: FP } })
  installFetch()
})
afterEach(() => { vi.useRealTimers(); __resetNotebookFlags(); vi.restoreAllMocks() })

describe('I5 — viewing a note never writes', () => {
  it('opening and closing a note with an unfrozen chart sends ZERO write requests and never touches the node', async () => {
    const updateAttributes = vi.fn()
    const view = renderPanel({ attrs: OLD_CHART, updateAttributes, editor: editorWith() })
    await screen.findByRole('button', { name: 'Freeze the fingerprint' })
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })     // longer than every retry
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(writes()).toEqual([])
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('five old charts in one note: still zero', async () => {
    const updateAttributes = vi.fn()
    const editor = editorWith()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <FingerprintPanel key={i} attrs={{ ...OLD_CHART, embedId: `e-${i}` }} updateAttributes={updateAttributes} editor={editor} />
        ))}
      </SWRConfig>,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(writes()).toEqual([])
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('with no record of when the note was opened, the panel does not guess', async () => {
    const updateAttributes = vi.fn()
    renderPanel({ attrs: NEW_CHART, updateAttributes, editor: editorWith({ noteId: 'n-1' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(writes()).toEqual([])
    expect(updateAttributes).not.toHaveBeenCalled()
  })

  it('the button is the explicit door: one press, one freeze, one node write', async () => {
    const updateAttributes = vi.fn()
    renderPanel({ attrs: OLD_CHART, updateAttributes, editor: editorWith() })
    fireEvent.click(await screen.findByRole('button', { name: 'Freeze the fingerprint' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(writes()).toEqual(['POST /api/j2/notebook-fingerprint/blocks/n-1/e-old/freeze'])
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0].ta.fingerprint).toEqual(FP)
  })

  it('CONTROL — a chart added during this visit still freezes by itself (the save was already the member’s)', async () => {
    const updateAttributes = vi.fn()
    renderPanel({ attrs: NEW_CHART, updateAttributes, editor: editorWith() })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(writes()).toEqual(['POST /api/j2/notebook-fingerprint/blocks/n-1/e-new/freeze'])
    expect(updateAttributes).toHaveBeenCalledTimes(1)
  })

  it('a reader never sees the button', async () => {
    renderPanel({ attrs: OLD_CHART, updateAttributes: vi.fn(), editor: editorWith(undefined, false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(screen.queryByRole('button', { name: 'Freeze the fingerprint' })).toBeNull()
    expect(writes()).toEqual([])
  })
})

describe('the wire the rule depends on', () => {
  it('the note editor records when it opened, in the storage the panel reads', () => {
    // Without this the panel fails closed (no chart ever freezes by itself): safe, but the
    // insert path would silently stop working. Read from the source, comments stripped.
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, 'NoteEditorPage.jsx'), 'utf8')
      .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(src).toMatch(/ed\.storage\.uctJournalWidgets = \{[\s\S]{0,120}?\bopenedAt: Date\.now\(\)/)
  })
})

describe('the retry does not strand "Waiting for this note to save"', () => {
  it('a re-render that restarts the freeze mid-retry keeps retrying, then offers Try again', async () => {
    freezeAnswer = () => respond(404, { detail: 'Not Found' })
    const first = vi.fn()
    const view = renderPanel({ attrs: NEW_CHART, updateAttributes: first, editor: editorWith() })
    await screen.findByText(/Waiting for this note to save/)
    // the embed hands the panel a new updateAttributes (a new node view render): the effect re-runs
    view.rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <FingerprintPanel attrs={NEW_CHART} updateAttributes={vi.fn()} editor={editorWith()} />
      </SWRConfig>,
    )
    const before = global.fetch.mock.calls.filter(([u]) => String(u).includes('/freeze')).length
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_RETRY_MS.reduce((a, b) => a + b, 0) + 2000) })
    const after = global.fetch.mock.calls.filter(([u]) => String(u).includes('/freeze')).length
    expect(after).toBeGreaterThan(before)                       // it went on asking
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
