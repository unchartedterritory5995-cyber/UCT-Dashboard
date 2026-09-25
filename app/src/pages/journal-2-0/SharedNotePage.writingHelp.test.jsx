/**
 * Wave 7 lane H, fix round 1 — review M-11: the PUBLIC share page labels an
 * accepted writing-help block exactly as the owner's editor does ("Compass ·
 * Rewrite · <model> · 09:41"), and an Ask insert keeps its own label.
 *
 * It held by construction (the page is a read-only editor on
 * `buildExtensions()`, so an `askInsert` node renders through AskInsertView)
 * and nothing pinned it. This mounts the REAL page and its real read-only
 * TipTap editor on the payload the server sends; the server half is
 * tests/test_share_writing_help_label.py.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SharedNotePage from './SharedNotePage'
import { SHARED_NOTE_ROUTE, sharedNotePath } from './lib/noteShareLink'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const PUBLIC_NOTE = {
  title: 'Shared thesis', subtitle: null, heroImageUrl: null, updatedAt: '2026-09-25T10:00:00Z',
  bodyJson: { type: 'doc', content: [
    para('My own words.'),
    { type: 'askInsert',
      attrs: { insertedAt: '2026-09-25T09:41:00', scope: 'selection', question: 'Rewrite — shorter',
        action: 'rewrite', model: 'claude-sonnet-5' },
      content: [para('A tighter version.')] },
    { type: 'askInsert',
      attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'What about margins?' },
      content: [para('An Ask answer.')] },
  ] },
}

afterEach(() => vi.restoreAllMocks())

describe('SharedNotePage — the writing-help label on a public page (M-11)', () => {
  it('reads "Compass · Rewrite · claude-sonnet-5 · 09:41", and the Ask insert keeps its own label', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ note: PUBLIC_NOTE }) }))
    render(
      <MemoryRouter initialEntries={[sharedNotePath('tok1')]}>
        <Routes><Route path={SHARED_NOTE_ROUTE} element={<SharedNotePage />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('shared-note')
    expect(await screen.findByText('Compass · Rewrite · claude-sonnet-5 · 09:41')).toBeInTheDocument()
    expect(screen.getByText('A tighter version.')).toBeInTheDocument()
    expect(screen.getByText(/From Ask Notebook/)).toBeInTheDocument()       // control: the other kind
  })
})
