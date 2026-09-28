import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextSelection } from '@tiptap/pm/state'
import { FONT_OPTIONS } from '../../../../utils/fontFamilies'
import { textColorClass } from '../../lib/textColor'
import { linkPasteKey } from '../../lib/linkPasteOffer'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// Wave 10 lane 10A (clause 4d, typing cost): the editor toolbar's buttons KEEP THEIR DOM NODES
// when the page re-renders.
//
// `ToolButton` was declared inside NoteEditorPage, so every render of the page made it a NEW
// component type and React unmounted and re-mounted all twelve buttons (and the SVG icons in
// them). The page rendered on every keystroke, so every keystroke paid for it: in a traced
// Chromium keystroke at 2,000 paragraphs, ~12.6 buttons were torn down and rebuilt per key and
// `removeChild` / `insertBefore` were the largest self-time entries of the CPU profile
// (docs/notebook/perf-budgets.md §7). The rail is asserted on the DOM a member's browser holds:
// the same <button> element before and after a re-render the toolbar really made.
//
// Wave 10 follow-up F1 (clause 4d, the next lever): a keystroke no longer re-renders the PAGE
// at all. The page used to bump a counter on every editor `transaction` and `selectionUpdate`
// (`bumpToolbar`), re-running the header, properties, thesis, backlinks and side panels per key.
// Now the toolbar row (`EditorToolbarState`), the colour menu, the table toolbar and the find
// bar each subscribe to the editor themselves and re-render only when what they show changed.
// The rails below count renders (jsdom, never timing) and check that every toolbar control
// still follows the editor while the page stands still.

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const NOTES = {
  n1: { id: 'n1', title: 'Main note', subtitle: '', folderId: null, ticker: null,
    tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z', isFavorite: false,
    bodyJson: { type: 'doc', content: [P('Start of the note.'), P('Second line here.')] } },
}

// Render counters for the page's heavy sections (header, properties, thesis, backlinks) and
// for one child of the toolbar row. A plain function component re-renders whenever its parent
// does, so each counter moves exactly when its parent rendered.
const renders = vi.hoisted(() => ({ share: 0, properties: 0, thesis: 0, backlinks: 0, toolbar: 0 }))
const AUTH = vi.hoisted(() => ({ user: { id: 'u1' }, isPaid: false }))

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({ note: NOTES[noteId], isLoading: false, update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
// The header's share control, and the three sections under the title.
vi.mock('./NoteShareControls', () => ({ default: () => { renders.share += 1; return null } }))
vi.mock('./PropertiesSection', () => ({ default: () => { renders.properties += 1; return null } }))
vi.mock('./ThesisSection', () => ({ default: () => { renders.thesis += 1; return null } }))
vi.mock('./NoteBacklinksSection', () => ({ default: () => { renders.backlinks += 1; return null } }))
// A child of the toolbar row: it renders exactly when the row does.
vi.mock('./NoteExportControls', () => ({ default: () => { renders.toolbar += 1; return null } }))

beforeEach(() => {
  AUTH.isPaid = false
  __resetNotebookFlags()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => { __resetNotebookFlags(); vi.clearAllMocks() })

async function mount(noteId = 'n1') {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const div = document.createElement('div')
  document.body.appendChild(div)
  const tree = () => <MemoryRouter><NoteEditorPage noteId={noteId} onBack={vi.fn()} showBack /></MemoryRouter>
  const { rerender } = render(tree(), { container: div })
  const pm = await waitFor(() => {
    const el = div.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return { editor: pm.editor, pm, root: div, rerender: () => rerender(tree()) }
}

const boldButton = (toolbar) => within(toolbar).getAllByRole('button').find((b) => b.textContent === 'B')
const toolButton = (toolbar, label) => within(toolbar).getAllByRole('button').find((b) => b.textContent === label)
const isLit = (el) => /toolBtnActive/.test(el.className)

const HEAVY = ['share', 'properties', 'thesis', 'backlinks']
const heavyCounts = () => Object.fromEntries(HEAVY.map((k) => [k, renders[k]]))
const delta = (before) => Object.fromEntries(HEAVY.map((k) => [k, renders[k] - before[k]]))
const NONE = Object.fromEntries(HEAVY.map((k) => [k, 0]))

/** Wait until nothing renders for a while (the mount's own reads settle). */
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    const before = JSON.stringify(renders)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    if (JSON.stringify(renders) === before) return
  }
  throw new Error('the page never went quiet')
}

function rangeOf(editor, text) {
  let hit = null
  editor.state.doc.descendants((n, pos) => {
    if (hit || !n.isText) return
    const i = n.text.indexOf(text)
    if (i >= 0) hit = { from: pos + i, to: pos + i + text.length }
  })
  if (!hit) throw new Error(`"${text}" is not in the note`)
  return hit
}
const select = (editor, text) => act(() => {
  const { from, to } = rangeOf(editor, text)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
})
const caretAfter = (editor, text) => act(() => {
  const { to } = rangeOf(editor, text)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, to)))
})
const typeKey = (editor, ch) => act(() => { editor.view.dispatch(editor.state.tr.insertText(ch)) })

/**
 * The first edit of a save cycle flips the page's save status to "dirty" (scheduleAutosave,
 * the Wave Q1 durability path, which this lane does not touch): that ONE render is the page's
 * own. Every rail that asks "did the page stay still" starts after it, so the answer it reads
 * is the toolbar's subscription and not that status render.
 */
async function startEditing(editor) {
  caretAfter(editor, 'Second line here.')
  typeKey(editor, ' ')
}

describe('NoteEditorPage — the toolbar is reconciled, never re-mounted (wave 10, lane 10A)', () => {
  it('a button keeps its DOM node across a re-render the toolbar really made', async () => {
    const { editor, root } = await mount()
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const link = within(toolbar).getByRole('button', { name: 'Insert link' })
    const bold = boldButton(toolbar)
    expect(bold).toBeTruthy()
    expect(bold.className).not.toMatch(/toolBtnActive/)

    // Select the text and make it bold: the toolbar re-renders to light the Bold button.
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run() })
    // Non-vacuity: the re-render happened (the Bold button now reads active) ...
    await waitFor(() => expect(boldButton(toolbar).className).toMatch(/toolBtnActive/))
    // ... and it was a reconcile: the SAME elements, updated in place.
    expect(boldButton(toolbar)).toBe(bold)
    expect(within(toolbar).getByRole('button', { name: 'Insert link' })).toBe(link)
    expect(link.isConnected && bold.isConnected).toBe(true)
  }, 60000)   // the first test pays the page module's transform

  it('typing keeps every toolbar button node', async () => {
    const { editor, root } = await mount()
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const before = within(toolbar).getAllByRole('button')
    expect(before.length).toBeGreaterThanOrEqual(10)
    for (const ch of 'typed') {
      act(() => { editor.view.dispatch(editor.state.tr.insertText(ch, editor.state.doc.content.size - 1)) })
    }
    await waitFor(() => expect(editor.getText()).toContain('typed'))
    const after = within(toolbar).getAllByRole('button')
    for (const b of before.filter((x) => /toolBtn/.test(x.className) && !/historyBtn/.test(x.className))) {
      expect(after).toContain(b)
    }
  }, 60000)
})

describe('NoteEditorPage — a keystroke does not re-render the page (wave 10 F1, rail 1)', () => {
  it('typing N characters re-renders the heavy sections 0 times, and the toolbar at most once per transaction', async () => {
    const { editor } = await mount()
    await settle()
    await startEditing(editor)

    const heavy0 = heavyCounts()
    const toolbar0 = renders.toolbar
    const N = 24
    for (let i = 0; i < N; i += 1) typeKey(editor, 'abcdefghijklmnopqrstuvwx'[i])
    expect(editor.getText()).toContain('abcdefghijklmnopqrstuvwx')
    // ⛔ The rail: not one render of the header, the properties, the thesis or the backlinks.
    expect(delta(heavy0)).toEqual(NONE)
    // The toolbar re-renders only when what it shows changed, never more than once a key.
    expect(renders.toolbar - toolbar0).toBeLessThanOrEqual(N)
  }, 60000)

  it('a transaction that changes what the toolbar shows re-renders it exactly once, and the page not at all', async () => {
    const { editor, root } = await mount()
    await settle()
    await startEditing(editor)
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })

    const heavy0 = heavyCounts()
    const toolbar0 = renders.toolbar
    // Each of these is ONE transaction that emits both `transaction` and `selectionUpdate`
    // (the two events the page used to re-render on) and flips the Bold state.
    const K = 4
    for (let i = 0; i < K; i += 1) {
      act(() => { editor.chain().setTextSelection(rangeOf(editor, 'Start')).toggleBold().run() })
      expect(isLit(boldButton(toolbar))).toBe(i % 2 === 0)
    }
    // Non-vacuity AND the ceiling: once per transaction, exactly.
    expect(renders.toolbar - toolbar0).toBe(K)
    expect(delta(heavy0)).toEqual(NONE)
  }, 60000)

  it('CONTROL: the counters see a real page re-render (typing a title re-renders every heavy section)', async () => {
    const { root } = await mount()
    await settle()
    const heavy0 = heavyCounts()
    fireEvent.change(within(root).getByRole('textbox', { name: 'Note title' }), { target: { value: 'Retitled' } })
    const d = delta(heavy0)
    for (const k of HEAVY) expect(d[k], k).toBeGreaterThan(0)
  }, 60000)
})

describe('NoteEditorPage — every toolbar control follows the editor while the page stands still (wave 10 F1, rail 2)', () => {
  it('the eight active states light and clear with the caret', async () => {
    const { editor, root } = await mount()
    await startEditing(editor)
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const heavy0 = heavyCounts()

    // Marks: a selection, pressed on the button itself (a ToolButton acts on mousedown).
    for (const label of ['B', 'I']) {
      select(editor, 'Start')
      act(() => { fireEvent.mouseDown(toolButton(toolbar, label)) })
      expect(isLit(toolButton(toolbar, label)), `${label} after pressing it`).toBe(true)
      caretAfter(editor, 'Second line')
      expect(isLit(toolButton(toolbar, label)), `${label} with the caret in plain text`).toBe(false)
    }
    // Blocks: the caret in the first paragraph, pressed, then pressed again to clear.
    for (const label of ['H1', 'H2', '• List', '1. List', '❝', '</>']) {
      caretAfter(editor, 'Start')
      act(() => { fireEvent.mouseDown(toolButton(toolbar, label)) })
      expect(isLit(toolButton(toolbar, label)), `${label} after pressing it`).toBe(true)
      caretAfter(editor, 'Second line')
      expect(isLit(toolButton(toolbar, label)), `${label} away from it`).toBe(false)
      caretAfter(editor, 'Start')
      expect(isLit(toolButton(toolbar, label)), `${label} back on it`).toBe(true)
      act(() => { fireEvent.mouseDown(toolButton(toolbar, label)) })
      expect(isLit(toolButton(toolbar, label)), `${label} after pressing it again`).toBe(false)
    }
    expect(delta(heavy0)).toEqual(NONE)
  }, 60000)

  it('the font and size menus show the caret\'s face and size, and set them', async () => {
    const { editor, root } = await mount()
    await startEditing(editor)
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const font = within(toolbar).getByRole('combobox', { name: 'Font family' })
    const size = within(toolbar).getByRole('combobox', { name: 'Text size' })
    const face = FONT_OPTIONS.find((f) => f.value).value
    const heavy0 = heavyCounts()

    select(editor, 'Start')
    act(() => { fireEvent.change(font, { target: { value: face } }) })
    act(() => { fireEvent.change(size, { target: { value: '24px' } }) })
    // A controlled <select> snaps back to its old value unless the toolbar re-rendered.
    expect(font.value).toBe(face)
    expect(size.value).toBe('24px')
    caretAfter(editor, 'Second line')
    expect(font.value).toBe('')
    expect(size.value).toBe('')
    select(editor, 'Start')
    expect(font.value).toBe(face)
    expect(size.value).toBe('24px')
    expect(delta(heavy0)).toEqual(NONE)
  }, 60000)

  it('the colour glyph shows the caret\'s colour, and the open picker follows a highlight chord', async () => {
    const { editor, root } = await mount()
    await startEditing(editor)
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const toggle = within(toolbar).getByRole('button', { name: 'Text color and highlight' })
    const glyph = () => toggle.querySelector('span')
    const heavy0 = heavyCounts()

    select(editor, 'Start')
    act(() => { editor.commands.setTextColor('red') })
    expect(glyph().className).toContain(textColorClass('red'))
    caretAfter(editor, 'Second line')
    expect(glyph().className).not.toContain(textColorClass('red'))
    expect(delta(heavy0)).toEqual(NONE)

    // Opening the picker is the page's own state (`colorOpen`); what follows is the picker's.
    select(editor, 'Start')
    fireEvent.click(toggle)
    const picker = await screen.findByRole('group', { name: 'Text color and highlight' })
    const opened = heavyCounts()
    expect(within(picker).getByRole('button', { name: 'Red text' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(picker).getByRole('button', { name: 'No highlight' }).getAttribute('aria-pressed')).toBe('true')
    // Mod-Shift-H's command, with the picker open: the pressed swatch moves.
    act(() => { editor.commands.toggleHighlight() })
    expect(within(picker).getByRole('button', { name: 'Yellow highlight' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(picker).getByRole('button', { name: 'No highlight' }).getAttribute('aria-pressed')).toBe('false')
    expect(delta(opened)).toEqual(NONE)
    // A pick applies and closes.
    fireEvent.click(within(picker).getByRole('button', { name: 'Blue text' }))
    expect(glyph().className).toContain(textColorClass('blue'))
  }, 60000)

  it('touch Undo and Redo enable as history appears, and each tap is one step', async () => {
    const { editor, root } = await mount()
    await settle()
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    const undo = within(toolbar).getByRole('button', { name: 'Undo' })
    const redo = within(toolbar).getByRole('button', { name: 'Redo' })
    expect(undo.disabled).toBe(true)
    expect(redo.disabled).toBe(true)

    await startEditing(editor)
    const heavy0 = heavyCounts()
    expect(undo.disabled).toBe(false)
    typeKey(editor, 'Z')
    expect(editor.getText()).toContain('Second line here. Z')
    fireEvent.click(undo)
    expect(editor.getText()).not.toContain('here. Z')
    expect(redo.disabled).toBe(false)
    fireEvent.click(redo)
    expect(editor.getText()).toContain('Second line here. Z')
    expect(redo.disabled).toBe(true)
    expect(delta(heavy0)).toEqual(NONE)
  }, 60000)

  it('the table toolbar comes and goes with the caret, with no page re-render', async () => {
    const { editor } = await mount()
    await startEditing(editor)
    act(() => { editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run() })
    await screen.findByRole('toolbar', { name: 'Table' })

    const heavy0 = heavyCounts()
    caretAfter(editor, 'Start of the note.')
    expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull()
    act(() => {
      let cell = null
      editor.state.doc.descendants((n, pos) => { if (cell == null && n.type.name === 'tableCell') cell = pos })
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cell + 2))))
    })
    const bar = screen.getByRole('toolbar', { name: 'Table' })
    // Its commands still act: add a row below, from inside the cell.
    fireEvent.click(within(bar).getByRole('button', { name: 'Add a row below' }))
    let rows = 0
    editor.state.doc.descendants((n) => { if (n.type.name === 'tableRow') rows += 1 })
    expect(rows).toBe(3)
    expect(delta(heavy0)).toEqual(NONE)
  }, 60000)

  it('the find bar withdraws its Replace-all Undo the moment the member types', async () => {
    const { editor, root } = await mount()
    await startEditing(editor)
    fireEvent.click(within(root).getByRole('button', { name: 'Find in note' }))
    const bar = await screen.findByRole('search', { name: 'Find in note' })
    fireEvent.change(within(bar).getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'line' } })
    fireEvent.click(within(bar).getByRole('button', { name: 'Show replace' }))
    fireEvent.change(within(bar).getByRole('textbox', { name: 'Replace with' }), { target: { value: 'row' } })
    fireEvent.click(within(bar).getByRole('button', { name: 'Replace all' }))
    expect(within(bar).getByRole('button', { name: 'Undo' })).toBeTruthy()

    const heavy0 = heavyCounts()
    caretAfter(editor, 'Second row here.')
    typeKey(editor, '!')
    expect(within(bar).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(within(bar).getByText(/The note changed since/)).toBeTruthy()
    expect(delta(heavy0)).toEqual(NONE)
  }, 60000)

  it('the slash, emoji and pasted-link menus open from inside the note', async () => {
    const { editor } = await mount()
    await startEditing(editor)
    caretAfter(editor, 'Second line here.')
    typeKey(editor, ' /')
    await screen.findByRole('listbox', { name: 'Insert block' })
    typeKey(editor, ' ')
    typeKey(editor, ' :rock')
    await screen.findByRole('listbox', { name: 'Insert emoji' })
    typeKey(editor, ' ')
    const { from } = editor.state.selection
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(url, from).setMeta(linkPasteKey, {
        offer: { from, to: from + url.length, url, preview: true, embed: true },
      }))
    })
    await screen.findByRole('toolbar', { name: 'Pasted link' })
  }, 60000)

  it('writing help stays in the toolbar while the member types, and opens', async () => {
    AUTH.isPaid = true
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    const { editor, root } = await mount()
    await startEditing(editor)
    for (const ch of 'more words') typeKey(editor, ch)
    const toolbar = within(root).getByRole('toolbar', { name: 'Editor toolbar' })
    select(editor, 'Start')
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Writing help' }))
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  }, 60000)
})

describe('NoteEditorPage — editability still re-renders the page (wave 10 F1)', () => {
  // `editor.isEditable` is the one editor fact the page reads in render, and it changes WITHOUT a
  // transaction (the lock effect's setEditable). Unlocking arrives as a page render in which the
  // editor is still read-only; only the lock effect's re-render lets writing help appear.
  it('an unlock that arrives with the note brings writing help back', async () => {
    AUTH.isPaid = true
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    NOTES.lk = { ...NOTES.n1, id: 'lk', locked: true }
    try {
      const { editor, root, rerender } = await mount('lk')
      await settle()
      expect(editor.isEditable).toBe(false)
      expect(within(root).queryByRole('button', { name: 'Writing help' })).toBeNull()
      NOTES.lk = { ...NOTES.lk, locked: false }
      act(() => { rerender() })
      await settle()
      expect(editor.isEditable).toBe(true)
      expect(within(root).getByRole('button', { name: 'Writing help' })).toBeTruthy()
    } finally {
      delete NOTES.lk
    }
  }, 60000)
})

describe('NoteEditorPage — the toolbar reads the editor in ONE place (wave 10 F1, structural)', () => {
  const FILE = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'NoteEditorPage.jsx')
  const src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
  // Comments blanked to spaces (line numbers kept), so prose naming a call is not a call.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (c, p) => p + c.slice(p.length).replace(/[^\n]/g, ' '))
  const lineOf = (i) => code.slice(0, i).split('\n').length
  const start = code.indexOf('export function toolbarStateOf(')
  const end = code.indexOf('\n}\n', start)

  it('non-vacuity: toolbarStateOf exists and holds the reads', () => {
    expect(start).toBeGreaterThan(0)
    const inside = [...code.slice(start, end).matchAll(/\.(isActive|getAttributes)\(/g)]
    expect(inside.length).toBeGreaterThanOrEqual(10)
  })

  it('every isActive( / getAttributes( in NoteEditorPage.jsx is inside toolbarStateOf', () => {
    const outside = [...code.matchAll(/\.(isActive|getAttributes)\(/g)]
      .filter((m) => m.index < start || m.index > end)
      .map((m) => `NoteEditorPage.jsx:${lineOf(m.index)}`)
    expect(outside).toEqual([])
  })

  it('the page subscribes to no per-transaction editor event', () => {
    const subs = [...code.matchAll(/\.on\(\s*['"](transaction|selectionUpdate|update)['"]/g)]
      .map((m) => `NoteEditorPage.jsx:${lineOf(m.index)} ${m[0]}`)
    expect(subs).toEqual([])
    // Non-vacuity: the same search finds the page's own lifecycle subscriptions.
    expect([...code.matchAll(/\.on\(\s*['"](mount|create|unmount)['"]/g)].length).toBeGreaterThan(0)
  })
})
