// Finish program, lane KEYS round 3. The position page: a skip link to "Why did you take it?".
//
// On a position's page the field is below the chart, and the chart's header is 22 Tab stops
// (measured, Q17). The card now offers "Skip to why you took it" in the shell's skip-link slot
// when the page asks for it. It lands directly in front of the field.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EntryContextCard from './EntryContextCard'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const META = { version: 1, fields: [], missingReasons: {}, notCaptured: {}, captureKinds: ['at_entry'], whyMaxChars: 500 }
const field = (value) => ({ value, source: 'x', asOf: '2026-10-02', missing: null, detail: null })
const CONTEXT = {
  symbol: 'NVDA', entryDay: '2026-10-02', captureKind: 'at_entry', capturedLate: false,
  captureDay: '2026-10-02', capturedAt: '2026-10-02T14:31:07+00:00', trigger: 'manual_add', version: 1,
  fields: {
    regime: field('amber'), exposure: field(72.5), breadth_pct_above_50: field(55.14), rs_rank: field(80),
    days_to_earnings: field(3), uct_scans: field([]),
  },
  why: null,
}
function mock(answer) {
  global.fetch = vi.fn((url) => (String(url).endsWith('/api/j2/entry-context/meta') ? json(META) : answer()))
}
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const TABBABLE = 'a[href], button:not([disabled]), select, input, textarea'

describe('EntryContextCard: skip to the reason', () => {
  it('with skipLink, the link lands directly in front of the field', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mock(() => json({ status: 'captured', key: {}, context: CONTEXT, reason: null }))
    render(<div><button type="button">a chart button</button><EntryContextCard kind="position" id="p1" skipLink /></div>)
    const box = await screen.findByRole('textbox')
    const link = screen.getByRole('link', { name: 'Skip to why you took it' })
    fireEvent.click(link)
    const landed = document.activeElement
    expect(landed.getAttribute('tabindex')).toBe('-1')
    const next = [...document.querySelectorAll(TABBABLE)]
      .find((n) => landed.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(next).toBe(box)
  })

  it('without skipLink (a trade page, every existing caller) there is no link', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mock(() => json({ status: 'captured', key: {}, context: CONTEXT, reason: null }))
    render(<EntryContextCard kind="position" id="p1" />)
    await screen.findByRole('textbox')
    expect(screen.queryByRole('link', { name: 'Skip to why you took it' })).toBeNull()
  })

  it('no captured context means no field, so no link', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mock(() => json({ status: 'not_captured', key: {}, context: null, reason: 'Nothing was captured.' }))
    render(<EntryContextCard kind="position" id="p1" skipLink />)
    await screen.findByText('Nothing was captured.')
    expect(screen.queryByRole('link', { name: 'Skip to why you took it' })).toBeNull()
  })
})
