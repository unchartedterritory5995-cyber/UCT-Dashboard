// Wave 10 (lane TY). Coordinator finding, L12 full proof walk 62e252649: G-131
// ("Text colour + highlight") reads touch=BROKEN, "no colour mark in the note",
// after the toolbar re-render bailout (e1999ca5f) landed -- desktop and keyboard
// still read WORKS. This file REPRODUCES the touch door's exact sequence
// (tools/notebook_proof_walk.py::f_text_color / open_format_more) through a real
// NoteEditorPage mount, rather than guessing at the mechanism, per the
// coordinator's "verify, don't assume".
import { render, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TEXT_COLOR_MENU_LABEL } from './TextColorMenu'
import { MQ } from '../../../../styles/breakpoints'

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
  tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
  bodyJson: { type: 'doc', content: [P('Some words to colour.')] },
}
let CURRENT = NOTE
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: CURRENT, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isPaid: true }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  const Stub = React.forwardRef(function StubMic(_props, ref) {
    React.useImperativeHandle(ref, () => ({ available: true, start: () => true }))
    return <button type="button" aria-label="Start voice input" />
  })
  return { default: Stub }
})

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {})

beforeEach(() => {
  CURRENT = NOTE
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

/** Every matchMedia query answers `matches` uniformly -- the same recipe
 *  NoteEditorPage.phoneFormat.test.jsx uses, so useIsTouch() (MQ.touchDown) AND
 *  the format-disclosure's own MQ.phone read the SAME touch tier. */
function mockMatchMedia(matches) {
  const original = window.matchMedia
  window.matchMedia = vi.fn((query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }))
  return () => { window.matchMedia = original }
}

async function mountToolbar() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  document.body.appendChild(div)
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>, { container: div })
  await waitFor(() => {
    if (!div.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
  const toolbar = within(div).getByRole('toolbar', { name: 'Editor toolbar' })
  await within(toolbar).findByRole('button', { name: 'Start voice input' })
  const editor = div.querySelector('.ProseMirror').editor
  return { toolbar, editor, div }
}

describe('G-131 touch door: select text, open Format, open Text color and highlight, pick a swatch', () => {
  it('reproduces tools/notebook_proof_walk.py::f_text_color on the touch tier', async () => {
    const restore = mockMatchMedia(true)
    try {
      const { toolbar, editor } = await mountToolbar()

      // f_text_color: Control+Home + Shift+Control+ArrowRight -- a SELECTION-ONLY
      // transaction (docChanged=false), which is exactly the shape of change the
      // toolbar-sync reducer's bailout has to stay correct across.
      act(() => { editor.commands.setTextSelection({ from: 1, to: 5 }) })
      expect(editor.state.selection.empty, 'a real selection exists, matching the walk').toBe(false)

      // open_format_more: click "Format" (phone-only door)
      const formatToggle = within(toolbar).getByRole('button', { name: 'Format' })
      fireEvent.click(formatToggle)
      await waitFor(() => expect(formatToggle).toHaveAttribute('aria-expanded', 'true'))

      // the walk's btn(pg, "Text color and highlight")
      const colorToggle = within(toolbar).getByRole('button', { name: TEXT_COLOR_MENU_LABEL })
      fireEvent.click(colorToggle)

      // the walk's grp.wait_for(state="visible") -- on touch this is the Sheet's body
      const group = await waitFor(() => {
        const g = document.querySelector(`[role="group"][aria-label="${TEXT_COLOR_MENU_LABEL}"]`)
        if (!g) throw new Error('the Text color and highlight group never rendered')
        return g
      })
      expect(group).toBeTruthy()

      // the walk's swatch tap: grp.locator('button').nth(1) -- the first real colour swatch
      const swatches = within(group).getAllByRole('button')
      fireEvent.mouseDown(swatches[1])
      fireEvent.click(swatches[1])

      await waitFor(() => {
        const html = document.querySelector('.ProseMirror').innerHTML
        expect(html).toMatch(/style="[^"]*color|data-color|data-text-color|class="[^"]*(color|highlight)/)
      })
    } finally {
      restore()
    }
  }, 60000)
})
