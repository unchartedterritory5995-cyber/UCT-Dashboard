import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeHistory } from '@tiptap/pm/history'

// Wave 10 lane 10B — G-144: Undo / Redo on the touch tier.
//
// A phone has no Ctrl+Z, so before this a mistaken tap on a phone had no way
// back. The rail is asserted by what the member SEES (the editor's rendered
// text and the buttons' rendered labels), never by a spied command:
//   - both controls render in the editor toolbar, labelled in words;
//   - with nothing to undo, Undo is DISABLED (never a dead click);
//   - one tap of Undo removes exactly ONE history step, and Redo puts it back;
//   - a locked note shows neither (a control that would do nothing is hidden);
//   - the stylesheet shows them at <=1024px only, at the 44px tap floor.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTES = {
  n1: { id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Start.')] } },
  locked: { id: 'locked', title: 'Locked note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    locked: true, bodyJson: { type: 'doc', content: [P('Locked body.')] } },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({ note: NOTES[noteId], isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, isPaid: false }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

async function mount(noteId) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  document.body.appendChild(div)
  render(
    <MemoryRouter><NoteEditorPage noteId={noteId} onBack={vi.fn()} showBack /></MemoryRouter>,
    { container: div },
  )
  const pm = await waitFor(() => {
    const el = div.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return { editor: pm.editor, pm, root: div }
}

/** Type `text` at the end as its OWN history step (closeHistory seals the
 *  group before it), the way two taps a second apart land on a phone. */
function typeStep(editor, text) {
  act(() => {
    editor.view.dispatch(closeHistory(editor.state.tr))
    const end = editor.state.doc.content.size - 1
    editor.view.dispatch(editor.state.tr.insertText(text, end))
  })
}

describe('NoteEditorPage — touch Undo / Redo (wave 10, G-144)', () => {
  it('renders Undo and Redo in the editor toolbar, labelled in words', async () => {
    const { root } = await mount('n1')
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const undo = within(toolbar).getByRole('button', { name: 'Undo' })
    const redo = within(toolbar).getByRole('button', { name: 'Redo' })
    expect(undo.textContent).toBe('Undo')
    expect(redo.textContent).toBe('Redo')
  })

  it('with nothing to undo, both are DISABLED — never a dead click', async () => {
    const { root } = await mount('n1')
    expect(within(root).getByRole('button', { name: 'Undo' }).disabled).toBe(true)
    expect(within(root).getByRole('button', { name: 'Redo' }).disabled).toBe(true)
  })

  it('one tap of Undo removes exactly ONE step; Redo puts it back', async () => {
    const { editor, pm, root } = await mount('n1')
    typeStep(editor, ' one')
    typeStep(editor, ' two')
    expect(pm.textContent).toBe('Start. one two')
    const undo = within(root).getByRole('button', { name: 'Undo' })
    const redo = within(root).getByRole('button', { name: 'Redo' })
    await waitFor(() => expect(undo.disabled).toBe(false))
    expect(redo.disabled).toBe(true)

    fireEvent.click(undo)
    // Exactly one step: " two" is gone, " one" is still there.
    await waitFor(() => expect(pm.textContent).toBe('Start. one'))
    await waitFor(() => expect(redo.disabled).toBe(false))

    fireEvent.click(redo)
    await waitFor(() => expect(pm.textContent).toBe('Start. one two'))
    await waitFor(() => expect(redo.disabled).toBe(true))
  })

  it('CONTROL: two taps of Undo remove both steps, back to what was opened', async () => {
    const { editor, pm, root } = await mount('n1')
    typeStep(editor, ' one')
    typeStep(editor, ' two')
    const undo = within(root).getByRole('button', { name: 'Undo' })
    await waitFor(() => expect(undo.disabled).toBe(false))
    fireEvent.click(undo)
    await waitFor(() => expect(pm.textContent).toBe('Start. one'))
    fireEvent.click(undo)
    await waitFor(() => expect(pm.textContent).toBe('Start.'))
    await waitFor(() => expect(undo.disabled).toBe(true))
  })

  it('a LOCKED note shows neither control', async () => {
    const { root } = await mount('locked')
    await screen.findByText('Locked body.')
    expect(within(root).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(within(root).queryByRole('button', { name: 'Redo' })).toBeNull()
  })

  // Review M-5 (fix round 1): the JS half of "Undo stays reachable on a phone".
  // The layout half (the pair really on screen after 60 typed lines at 390 px)
  // is measured in real Chromium by tools/notebook_wave10b_walk.py (row B10);
  // jsdom has no layout, so here the sentinel's box is stubbed and the page's
  // own scroll check is driven by a real scroll event.
  it('the pair floats once its place in the row has scrolled above the top bar, and returns', async () => {
    const { root } = await mount('n1')
    const undo = within(root).getByRole('button', { name: 'Undo' })
    const group = undo.parentElement
    const sentinel = group.previousElementSibling
    expect(sentinel.getAttribute('aria-hidden')).toBe('true')
    expect(group.hasAttribute('data-history-floating')).toBe(false)
    let box = { top: -140, bottom: -96, height: 44, left: 0, right: 0, width: 0 }
    sentinel.getBoundingClientRect = () => box
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => requestAnimationFrame(() => r()))
    })
    expect(group.getAttribute('data-history-floating')).toBe('true')
    expect(group.className).toMatch(/historyFloat/)
    box = { top: 300, bottom: 344, height: 44, left: 0, right: 0, width: 0 }
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => requestAnimationFrame(() => r()))
    })
    expect(group.hasAttribute('data-history-floating')).toBe(false)
    // CONTROL: a sentinel with no box (above 640 px it is display:none) never floats
    box = { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => requestAnimationFrame(() => r()))
    })
    expect(group.hasAttribute('data-history-floating')).toBe(false)
  })

  it('the buttons carry the tap-floor class and the touch-only class', async () => {
    const { root } = await mount('n1')
    const undo = within(root).getByRole('button', { name: 'Undo' })
    const cls = undo.className
    expect(cls).toMatch(/toolBtn/)
    expect(cls).toMatch(/historyBtn/)
  })
})

describe('NoteEditorPage.module.css — Undo / Redo are touch-tier controls', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const touchBlocks = [...css.matchAll(/@media\s*\(max-width:\s*1024px\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]).join('\n')
  const topLevel = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

  it('hidden above 1024px', () => {
    expect(topLevel).toMatch(/\.historyBtn\s*\{\s*display:\s*none;?\s*\}/)
  })
  it('shown at <=1024px', () => {
    expect(touchBlocks).toMatch(/\.historyBtn\s*\{[^}]*display:\s*inline-flex/)
  })
  it('.toolBtn meets the 44px floor on BOTH axes at <=1024px', () => {
    const rules = [...touchBlocks.matchAll(/(^|[},\s])\.toolBtn\s*\{([^}]*)\}/g)].map((m) => m[2])
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.some((r) => /min-height:\s*var\(--tap-min/.test(r) && /min-width:\s*var\(--tap-min/.test(r))).toBe(true)
  })
})
