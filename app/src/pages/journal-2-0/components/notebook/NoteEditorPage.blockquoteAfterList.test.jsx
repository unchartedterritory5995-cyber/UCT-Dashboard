// Wave 10 (lane TY). SECOND coordinator finding from the L12 full proof walk
// (62e252649, which has e1999ca5f but NOT the G-131-first-finding fix
// 3b6e6fde4): the dead-click sweep read the "❝" (blockquote) toolbar button
// DEAD on BOTH `nb-note` and `ed-property`, both `"mode": "desk"`
// (`docs/notebook/proof/l12full-62e252649/deadclick.json`), in both cases
// clicked immediately after "1. List" (toggleOrderedList). Pre-bailout
// (`docs/notebook/proof/l12dc-0100a3032/deadclick.json`) the same button read
// LIVE -- but its only recorded effects were `attributes:type` mutations on
// two unrelated INPUT elements (Add-a-tag, Upload-image), the collateral
// side effects of the OLD whole-page re-render, never the blockquote itself.
//
// Measured directly against the real editor (`__bqProbe.test.js`, since
// deleted -- its finding is reproduced here in the real component):
// `editor.can().toggleBlockquote()` is FALSE the moment the selection sits
// inside an ordered-list item's paragraph, and `toggleBlockquote().run()`
// genuinely changes nothing there. This is a PROSEMIRROR SCHEMA refusal
// (listItem's content is `paragraph block*`; wrapping its one paragraph in a
// blockquote would leave the listItem without the leading `paragraph` the
// schema requires), present since before e1999ca5f -- confirmed by `git show
// e1999ca5f -- NoteEditorPage.jsx | grep blockquote`: the `blockquote`
// signature field, and therefore the button's pressed-state re-render, was
// ALREADY correct the moment the bailout landed. So this is coordinator
// option 1 (a real, pre-existing product dead click the old re-render's
// collateral noise was masking as "LIVE"), not option 2 (no signature gap to
// find) and not option 3 (the instrument's own mutation filter is not in
// question here -- the click really does nothing).
//
// The fix: `canBlockquote` (mirrors canUndo/canRedo's `canRunHistory`
// exactly) disables the button with a reason instead of eating the tap
// silently. This file reproduces the walk's exact sequence -- "1. List" then
// "❝" -- through a REAL mounted NoteEditorPage + a real TipTap editor, and
// asserts on RENDERED DOM: the doc structure (no `<blockquote>` appears) and
// the button's own pressed/disabled state, never component state.
import { render, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTE = {
  id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
  tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
  bodyJson: { type: 'doc', content: [P('Some text to list.')] },
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

describe('G-131 (second finding): "❝" after "1. List" -- desktop, reproduces the walk exactly', () => {
  it('the walk\'s own sequence: caret in a paragraph, click "1. List", then click "❝" -- a real, pre-existing schema refusal, not a regression', async () => {
    const { toolbar, editor } = await mountToolbar()

    // Grab the button ONCE, while it is still enabled and its accessible name
    // is still the glyph -- once disabled, its accessible name becomes the
    // REASON (aria-label tracks `title`, correctly per a11y), so re-querying
    // by name('❝') after disabling it would itself fail. React reuses this
    // same DOM node across re-renders (fixed JSX position), so holding the
    // reference is what lets the test read its RENDERED state at each step.
    const blockquoteBtn = within(toolbar).getByRole('button', { name: '❝' })
    expect(blockquoteBtn).not.toBeDisabled()

    editor.commands.setTextSelection(3)
    expect(editor.isActive('orderedList'), 'not yet a list').toBe(false)

    const orderedListBtn = within(toolbar).getByRole('button', { name: '1. List' })
    fireEvent.mouseDown(orderedListBtn)
    fireEvent.click(orderedListBtn)

    await waitFor(() => expect(editor.isActive('orderedList')).toBe(true))
    const beforeHTML = editor.getHTML()
    expect(beforeHTML, 'the doc is now an ordered list').toMatch(/<ol>/)
    expect(beforeHTML, 'no blockquote yet').not.toMatch(/<blockquote>/)

    // RENDERED DOM, not component state: the button itself now reads disabled,
    // with a reason a member would actually see (its `title`).
    await waitFor(() => expect(blockquoteBtn).toBeDisabled())
    expect(blockquoteBtn.title.toLowerCase()).toMatch(/list/)

    // The walk's exact click -- and it changes NOTHING, matching can()===false.
    fireEvent.mouseDown(blockquoteBtn)
    fireEvent.click(blockquoteBtn)

    const afterHTML = editor.getHTML()
    expect(afterHTML, 'the doc structure is unchanged by the refused click').toBe(beforeHTML)
    expect(afterHTML).not.toMatch(/<blockquote>/)
    expect(editor.isActive('blockquote'), 'the pressed state never lit').toBe(false)
  })

  it('control: on a plain paragraph (no list) the SAME button is live, pressed state updates, and the doc really does gain a <blockquote>', async () => {
    const { toolbar, editor } = await mountToolbar()

    editor.commands.setTextSelection(3)
    expect(editor.isActive('orderedList')).toBe(false)

    const blockquoteBtn = within(toolbar).getByRole('button', { name: '❝' })
    expect(blockquoteBtn, 'enabled on a plain paragraph').not.toBeDisabled()
    expect(blockquoteBtn.title || '').toBe('')

    fireEvent.mouseDown(blockquoteBtn)
    fireEvent.click(blockquoteBtn)

    await waitFor(() => expect(editor.isActive('blockquote')).toBe(true))
    expect(editor.getHTML()).toMatch(/<blockquote>/)
    expect(blockquoteBtn.className).toMatch(/toolBtnActive/)
  })
})
