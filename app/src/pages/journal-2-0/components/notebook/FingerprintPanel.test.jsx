// Wave 13 lane 13I-2 — the fingerprint panel's load-bearing rails:
//   * THE FREEZE IS WRITTEN THROUGH THE MEMBER'S OWN SAVE PATH: the server's fingerprint lands in
//     `ta.fingerprint` by `updateAttributes` (the editor transaction autosave persists), after the
//     freeze route stops answering 404 (the save has landed) — and no request ever writes a note.
//   * A SUGGESTION NEVER APPLIES ITSELF: the pattern engine's confirmed detection is shown as a
//     suggestion; the tag changes only on the member's click.
//   * FROZEN MEANS FROZEN: an attr that already carries a fingerprint is never re-frozen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import FingerprintPanel, { FREEZE_RETRY_MS, embedKeyFor } from './FingerprintPanel'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const cell = (value, missing = null) => ({ value, source: 'screener_row', missing })
const FP = {
  v: 1, symbol: 'NVDA', requested_as_of: '2026-09-30', as_of: '2026-09-30', mode: 'nightly',
  fields: {
    rs_rank: cell(94), adr_pct: cell(5.9), base_depth_pct: cell(11.2), pole_pct: cell(62.4), ma_stack: cell('full-bull'),
    vol_nweek_low: cell(15), rs_line_trend: cell('up'), base_length_bars: cell(null, 'no_flat_base'),
    patterns: { value: [{ setup: 'vcp', asof_date: '2026-09-29', confidence: 81.2, key_level: 100 }], source: 'pattern_vision', missing: null },
  },
}
const META = { version: 1, fields: [], missingReasons: { no_flat_base: 'no flat base ends at this day' }, transientMissing: [] }

const ATTRS = { widgetId: 'chart', embedId: 'e-1', capturedAt: '2026-09-30T18:00:00Z', params: { symbol: 'NVDA', tf: 'D', to: 1790791200 } }
const editorWith = (noteId = 'n-1', isEditable = true) => ({ isEditable, storage: { uctJournalWidgets: { noteId } } })

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

function renderPanel(props) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <FingerprintPanel {...props} />
    </SWRConfig>,
  )
}

const noteWrites = () => global.fetch.mock.calls.filter(([url, init]) =>
  String(url).startsWith('/api/j2/notes') && (init?.method || 'GET') !== 'GET')

describe('FingerprintPanel', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers(); __resetNotebookFlags(); vi.restoreAllMocks() })

  it('renders nothing and fetches nothing while the fingerprint gate is off', () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: false })
    global.fetch = vi.fn(() => respond(200, {}))
    const { container } = renderPanel({ attrs: ATTRS, updateAttributes: vi.fn(), editor: editorWith() })
    expect(container.innerHTML).toBe('')
    expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/freeze'))).toEqual([])
  })

  it('freezes after the save lands, and writes the result ONLY through updateAttributes', async () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true })
    let freezeCalls = 0
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.endsWith('/meta')) return respond(200, META)
      if (u.includes('/freeze')) {
        freezeCalls += 1
        // The first answer is the server saying the note has not saved yet.
        return freezeCalls === 1 ? respond(404, { detail: 'Not Found' }) : respond(200, { block: { fingerprint: FP } })
      }
      return respond(200, {})
    })
    const updateAttributes = vi.fn()
    renderPanel({ attrs: ATTRS, updateAttributes, editor: editorWith('n-1') })
    await screen.findByText(/Waiting for this note to save/)
    expect(updateAttributes).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(FREEZE_RETRY_MS[0] + 50) })
    expect(freezeCalls).toBe(2)
    const [url, init] = global.fetch.mock.calls.find(([u]) => String(u).includes('/freeze'))
    expect(url).toBe(`/api/j2/notebook-fingerprint/blocks/n-1/${embedKeyFor(ATTRS)}/freeze`)
    expect(init.method).toBe('POST')
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0].ta.fingerprint).toEqual(FP)
    expect(noteWrites()).toEqual([])                     // never a second writer into the note
  })

  it('an attr that already carries a fingerprint is shown and never re-frozen', async () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true })
    global.fetch = vi.fn((url) => (String(url).endsWith('/meta') ? respond(200, META) : respond(200, {})))
    const updateAttributes = vi.fn()
    renderPanel({ attrs: { ...ATTRS, ta: { v: 1, fingerprint: FP } }, updateAttributes, editor: editorWith() })
    expect(await screen.findByText(/as of 2026-09-30/)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/freeze'))).toEqual([])
    expect(updateAttributes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Show all fields/ }))
    expect(screen.getByText(/Not available: no flat base ends at this day/)).toBeTruthy()
  })

  it('a confirmed detection is only SUGGESTED; the tag changes on the member\'s click', async () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true, notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn((url) => (String(url).endsWith('/meta') ? respond(200, META) : respond(200, {})))
    const updateAttributes = vi.fn()
    renderPanel({ attrs: { ...ATTRS, ta: { v: 1, fingerprint: FP } }, updateAttributes, editor: editorWith() })
    const suggestion = await screen.findByTestId('tag-suggestion')
    expect(suggestion.textContent).toMatch(/confirmed VCP \(81% confidence, 2026-09-29\)\. Suggested tag — not applied\./)
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(updateAttributes).not.toHaveBeenCalled()      // shown for 20 s and still not applied
    fireEvent.click(screen.getByRole('button', { name: 'Use “VCP”' }))
    expect(updateAttributes).toHaveBeenCalledTimes(1)
    expect(updateAttributes.mock.calls[0][0].ta).toMatchObject({ setupTag: 'VCP', fingerprint: FP })
  })

  it('with the visual playbook gate off there is no suggestion at all', async () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true, notebook_visual_playbook_enabled: false })
    global.fetch = vi.fn((url) => (String(url).endsWith('/meta') ? respond(200, META) : respond(200, {})))
    renderPanel({ attrs: { ...ATTRS, ta: { v: 1, fingerprint: FP } }, updateAttributes: vi.fn(), editor: editorWith() })
    await screen.findByText(/as of 2026-09-30/)
    expect(screen.queryByTestId('tag-suggestion')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Visual playbook' })).toBeNull()
  })

  it('Plan this setup creates a NEW note whose checklist carries the fingerprint evidence', async () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true })
    global.fetch = vi.fn((url, init) => {
      const u = String(url)
      if (u.endsWith('/meta')) return respond(200, META)
      if (u === '/api/j2/notes' && init?.method === 'POST') return respond(200, { note: { id: 'new-plan' } })
      return respond(200, {})
    })
    const updateAttributes = vi.fn()
    renderPanel({ attrs: { ...ATTRS, ta: { v: 1, fingerprint: FP, setupTag: 'VCP' } }, updateAttributes, editor: editorWith() })
    fireEvent.click(await screen.findByRole('button', { name: /Plan this setup \(Base Breakout Plan\)/ }))
    await screen.findByText(/with the checklist marked from this fingerprint/)
    const create = global.fetch.mock.calls.find(([u, i]) => u === '/api/j2/notes' && i?.method === 'POST')
    const body = JSON.parse(create[1].body)
    const text = JSON.stringify(body.bodyJson)
    expect(text).toContain('"Volume dries up in the tightest part of the base"},{"type":"text","marks":[{"type":"italic"}],"text":" — Fingerprint as of 2026-09-30: Yes. Volume dry-up 3-week low."')
    expect(text).toContain('" — Fingerprint as of 2026-09-30: Yes. RS line up, RS rank 94."')
    expect(body.ticker).toBe('NVDA')
    expect(updateAttributes).not.toHaveBeenCalled()      // it creates; it never edits this note
    expect(global.fetch.mock.calls.filter(([u, i]) => String(u).startsWith('/api/j2/notes/') && i?.method)).toEqual([])
  })

  it('a reader (not editable) never freezes and gets no picker', async () => {
    latchNotebookFlags({ notebook_ta_fingerprint_enabled: true })
    global.fetch = vi.fn((url) => (String(url).endsWith('/meta') ? respond(200, META) : respond(200, {})))
    renderPanel({ attrs: ATTRS, updateAttributes: vi.fn(), editor: editorWith('n-1', false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/freeze'))).toEqual([])
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
