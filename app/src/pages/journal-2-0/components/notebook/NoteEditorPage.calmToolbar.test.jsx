// Notebook simplify, Task 4 ("a calmer editor"), through a REAL NoteEditorPage.
//
// At 1025 px and up:
//   - the formatting row is B, I, H1, H2, bullet list, numbered list, link, image, the mic, "Aa", Insert;
//   - "Aa" ("More formatting") holds Font, Size, Text color and highlight, Quote, Code, Attach a file and
//     Divider, each running what its row control runs; it reads as active in a quote or code block;
//   - the header's Ask and Writing help are ONE "AI" menu when both are there, and today's plain button
//     when only one is;
//   - the line under the title says the folder, up to three tags and the ticker (no sector, no
//     "N properties", no review state).
// The touch tier (1024 px and below) keeps its row: the row controls still exist and the desktop-only
// ones are hidden there.
//
// ⛔ WHAT jsdom CAN SAY. It applies no stylesheet. "Hidden at desktop" and "desktop only" are CSS
// facts, so the stylesheet is read (comments out) and the classes that carry them are held to it; the
// rendered row is then read through those classes. The real-browser look is the owner's preview.
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TextSelection } from '@tiptap/pm/state'
import { TEXT_COLOR_MENU_LABEL } from './TextColorMenu'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import NoteMenuActions from './NoteMenuActions'
import NoteExportControls from './NoteExportControls'
import { EXPORT_FORMATS } from './export/exportFormats'
import { BUILTIN_NOTE_KINDS } from '../../lib/noteKinds'
import { FONT_OPTIONS } from '../../../../utils/fontFamilies'
import { expectSecondView } from '../../lib/testing/menuSecondView.testkit'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const baseNote = () => ({
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null, ticker: 'NVDA',
  tags: ['breakout', 'semis', 'ai', 'swing'], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false, bodyJson: { type: 'doc', content: [P('First line.'), P('Second line.')] },
})
let NOTE = baseNote()
let PROPERTIES = []
const AUTH = { user: { id: 'u1' }, isPaid: true }
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: vi.fn(async (p) => ({ ...NOTE, ...p })), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => AUTH }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [{ id: 'f1', name: 'Semis', parentId: null }] }) }))
vi.mock('../VoiceInputButton', async () => {
  const React = await import('react')
  const Stub = React.forwardRef(function StubMic(_props, ref) {
    React.useImperativeHandle(ref, () => ({ available: true, start: () => true }))
    return <button type="button" aria-label="Start voice input" />
  })
  return { default: Stub }
})

// "Keep live blocks" saves through lane B's client (the journal styles one); mocked at that module's boundary.
const createJournalStyle = vi.fn()
vi.mock('../../lib/journalStyles', async (importOriginal) => ({
  ...(await importOriginal()),
  createJournalStyle: (...a) => createJournalStyle(...a),
  fetchJournalStyles: async () => ({ kinds: BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })), styles: [], blockKinds: [] }),
}))
vi.mock('../../lib/exportNote', () => ({ exportNoteAsPng: vi.fn(async () => ({ ok: true })), printNote: vi.fn() }))

const derived = (id, name, value) => ({ id, name, type: 'text', source: 'financial_derived', value })

beforeEach(() => {
  NOTE = baseNote()
  PROPERTIES = []
  AUTH.isPaid = true
  __resetNotebookFlags()
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/j2/notes/n1/properties') return { ok: true, json: async () => ({ properties: PROPERTIES }) }
    if (u === '/api/j2/notes/n1/thesis-summary') return { ok: true, json: async () => ({ evidence: [], changelog: [] }) }
    if (u === '/api/j2/notes/n1/reviews') return { ok: true, json: async () => ({ reviews: [], attention: null }) }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => { __resetNotebookFlags(); vi.clearAllMocks(); vi.restoreAllMocks() })

async function mount({ noteMenu } = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack noteMenu={noteMenu} /></MemoryRouter>
    </SWRConfig>,
  )
  const pm = await waitFor(() => {
    const el = view.container.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  const toolbar = screen.getByRole('toolbar', { name: 'Editor toolbar' })
  await within(toolbar).findByRole('button', { name: 'Start voice input' })
  return { view, editor: pm.editor, toolbar }
}

// ── The stylesheet facts the rendered checks below lean on ─────────────────────────────────────────
const CSS = readFileSync(join(process.cwd(),
  'src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** The bodies of every `@media <query>` block, joined. */
function mediaBlocks(css, query) {
  let out = ''
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    let depth = 1
    let j = re.lastIndex
    for (; j < css.length && depth > 0; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
    }
    if (m[1].replace(/\s+/g, '') === query.replace(/\s+/g, '')) out += css.slice(re.lastIndex, j - 1)
    re.lastIndex = j
  }
  return out
}
function declares(text, selector, prop, value) {
  for (const [, sels, decls] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').some((s) => s.trim() === selector)) continue
    if (decls.split(';').some((d) => d.split(':')[0]?.trim() === prop && d.split(':').slice(1).join(':').trim() === value)) return true
  }
  return false
}
const DESKTOP = mediaBlocks(CSS, '(min-width: 1025px)')

// Classes that take a control out of the DESKTOP row: touch-only controls (never shown above 1024)
// and the row controls folded into "Aa" at desktop. `.desktopOnly` is the reverse.
const NOT_ON_DESKTOP = /\b\S*(historyBtn|scanBtn|formatToggle|insertPhone|foldDesktop)\S*\b/
const onDesktop = (el, root) => {
  for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
    if (NOT_ON_DESKTOP.test(n.className || '')) return false
  }
  return true
}
const onTouch = (el, root) => {
  for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
    if (/desktopOnly/.test(n.className || '')) return false
  }
  return true
}
const nameOf = (el) => {
  const label = el.getAttribute('aria-label')
  if (label) return label.replace(/\s+/g, ' ').trim()
  const copy = el.cloneNode(true)
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
  return (copy.textContent || '').replace(/\s+/g, ' ').trim()
}
const controlsIn = (root) => [...root.querySelectorAll('button, select, input, textarea, a[href]')]

const DESKTOP_ROW = ['B', 'I', 'H1', 'H2', '• List', '1. List', 'Insert link', 'Insert image', 'Start voice input',
  'More formatting', 'Insert']
// The touch row as it was before this task (phoneFormat's ROW_BEFORE_D3P plus the phone's Format and "+").
const TOUCH_ROW = ['Undo', 'Redo', 'Format', 'Insert', 'Font family', 'Text size', 'B', 'I', TEXT_COLOR_MENU_LABEL,
  'H1', 'H2', '• List', '1. List', 'Quote', '</>', 'Insert link', 'Insert image', 'Scan a document with the camera',
  'Attach a file', 'Start voice input', 'Horizontal rule', 'Insert widget']

describe('the stylesheet carries the desktop split', () => {
  it('NON-VACUITY: a desktop block exists', () => {
    expect(DESKTOP.length).toBeGreaterThan(200)
  })
  it('folded row and header controls are hidden at desktop; desktop-only controls show only there', () => {
    expect(declares(DESKTOP, '.toolbarRow .foldDesktop', 'display', 'none')).toBe(true)
    expect(declares(DESKTOP, '.headerControls .foldDesktop', 'display', 'none')).toBe(true)
    expect(declares(DESKTOP, '.askFolded [data-ask-toggle]', 'display', 'none')).toBe(true)
    // Go-live wave 1 (D6): shown at desktop only while it is not `[hidden]`, so the attribute still hides it there.
    expect(declares(DESKTOP, '.desktopOnly:not([hidden])', 'display', 'contents')).toBe(true)
    expect(declares(DESKTOP, '.desktopOnly', 'display', 'contents')).toBe(false)
    // base: hidden everywhere else
    expect(declares(CSS, '.desktopOnly', 'display', 'none')).toBe(true)
  })
  it('CONTROL: the checker can fail', () => {
    expect(declares('.x { display: none; }', '.desktopOnly', 'display', 'none')).toBe(false)
    expect(mediaBlocks('@media (max-width: 640px) { .a { b: c } }', '(min-width: 1025px)')).toBe('')
  })
})

describe('the desktop formatting row', () => {
  it('is exactly B, I, H1, H2, the lists, link, image, the mic, "Aa", Insert, in that order', async () => {
    const { toolbar } = await mount()
    expect(controlsIn(toolbar).filter((el) => onDesktop(el, toolbar)).map(nameOf)).toEqual(DESKTOP_ROW)
  }, 60000)

  it('the touch row is the row it was: every control, same order, and no desktop-only one', async () => {
    const { toolbar } = await mount()
    expect(controlsIn(toolbar).filter((el) => onTouch(el, toolbar)).map(nameOf)).toEqual(TOUCH_ROW)
  }, 60000)

  it('two different "Aa"s: the desktop menu button and the phone Format disclosure are never the same control', async () => {
    const { toolbar } = await mount()
    const more = within(toolbar).getByRole('button', { name: 'More formatting' })
    const format = within(toolbar).getByRole('button', { name: 'Format' })
    expect(more).not.toBe(format)
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).not.toHaveAttribute('data-format-toggle')
    expect(format).toHaveAttribute('data-format-toggle')
    expect(format).not.toHaveAttribute('aria-haspopup')
    expect(onTouch(more, toolbar)).toBe(false)
    expect(onDesktop(format, toolbar)).toBe(false)
  }, 60000)

  it('the Insert button is named "Insert" at desktop and opens the widget palette', async () => {
    const { toolbar } = await mount()
    const insert = controlsIn(toolbar).filter((el) => onDesktop(el, toolbar)).at(-1)
    expect(nameOf(insert)).toBe('Insert')
    fireEvent.click(insert)
    expect(await screen.findByRole('dialog', { name: 'Insert widget' })).toBeTruthy()
  }, 60000)
})

describe('"Aa" (More formatting)', () => {
  const aa = () => screen.getByRole('button', { name: 'More formatting' })
  const open = () => { fireEvent.click(aa()); return screen.getByRole('menu', { name: 'More formatting' }) }
  const selectAll = (editor) => act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1)))
  })

  it('holds Font, Size, Text color and highlight, Quote, Code, Attach a file and Divider, in that order', async () => {
    await mount()
    const menu = open()
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim())).toEqual(
      ['Font', 'Size', TEXT_COLOR_MENU_LABEL, 'Quote', 'Code', 'Attach a file', 'Divider'])
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0])
  }, 60000)

  it('Escape closes it and puts focus back on "Aa"', async () => {
    await mount()
    const menu = open()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'More formatting' })).toBeNull()
    expect(document.activeElement).toBe(aa())
  }, 60000)

  it('Quote, Code and Divider run the editor commands their row buttons run', async () => {
    const { editor, toolbar } = await mount()
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Quote' }))
    expect(editor.isActive('blockquote')).toBe(true)
    // the row's Quote is the same command: pressing it undoes what the menu did
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Quote' }))
    expect(editor.isActive('blockquote')).toBe(false)
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Code' }))
    expect(editor.isActive('codeBlock')).toBe(true)
    fireEvent.click(within(toolbar).getByRole('button', { name: '</>' }))
    expect(editor.isActive('codeBlock')).toBe(false)
    const rules = () => editor.getJSON().content.filter((n) => n.type === 'horizontalRule').length
    expect(rules()).toBe(0)
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Divider' }))
    expect(rules()).toBe(1)
  }, 60000)

  it('Font and Size open their list in the menu; a pick sets it, and Back returns to the first view', async () => {
    const { editor } = await mount()
    selectAll(editor)
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Font' }))
    let menu = screen.getByRole('menu', { name: 'More formatting' })
    // Simplify pass 2: the second view is the engine's now (MenuRows `children`): focus goes to its first CHOICE, and
    // "Back" is named for the menu it goes back to.
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole('menuitemradio')[0]))
    expect(within(menu).getByRole('menuitem', { name: 'Back to More formatting' })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Georgia' }))
    expect(editor.getAttributes('textStyle').fontFamily).toBe('Georgia, serif')
    expect(screen.queryByRole('menu', { name: 'More formatting' })).toBeNull()
    selectAll(editor)
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Size' }))
    menu = screen.getByRole('menu', { name: 'More formatting' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '24' }))
    expect(editor.getAttributes('textStyle').fontSize).toBe('24px')
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Size' }))
    menu = screen.getByRole('menu', { name: 'More formatting' })
    expect(within(menu).getByRole('menuitemradio', { name: '24' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Back to More formatting' }))
    expect(within(screen.getByRole('menu', { name: 'More formatting' })).getByRole('menuitem', { name: 'Size' })).toBeTruthy()
  }, 60000)

  // Simplify pass 2 (Review focus 5): the shared second-view contract, on the editor's own "Aa".
  it('Font meets the shared second-view contract: Back, Left and Escape return to Font; a second Escape closes', async () => {
    await mount()
    await expectSecondView({
      openMenu: open, parentRowName: 'Font', childRowNames: FONT_OPTIONS.map((o) => o.label), trigger: aa,
    })
  }, 60000)

  // Follow-up B, item 3b: the kit runs over Size as well. Its choices are "Default" and the sizes the toolbar's own
  // "Text size" select offers (read from it, so the list is not restated here).
  it('Size meets the shared second-view contract too', async () => {
    const { toolbar } = await mount()
    const sizes = [...within(toolbar).getByRole('combobox', { name: 'Text size' }).querySelectorAll('option')]
      .filter((o) => o.value).map((o) => o.textContent)
    expect(sizes.length, 'non-vacuity: the toolbar offers sizes').toBeGreaterThan(3)
    await expectSecondView({
      openMenu: open, parentRowName: 'Size', childRowNames: ['Default', ...sizes], trigger: aa,
    })
  }, 60000)

  it('Attach a file presses the same file input as the row\'s Attach a file', async () => {
    const { toolbar } = await mount()
    const pressed = []
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() { pressed.push(this) })
    fireEvent.mouseDown(within(toolbar).getByRole('button', { name: 'Attach a file' }))
    fireEvent.click(within(open()).getByRole('menuitem', { name: 'Attach a file' }))
    expect(pressed).toHaveLength(2)
    expect(pressed[0].type).toBe('file')
    expect(pressed[1]).toBe(pressed[0])
  }, 60000)

  it('Text color and highlight opens the picker by "Aa"; Escape there returns focus to "Aa"', async () => {
    await mount()
    fireEvent.click(within(open()).getByRole('menuitem', { name: TEXT_COLOR_MENU_LABEL }))
    const picker = await screen.findByRole('group', { name: TEXT_COLOR_MENU_LABEL })
    expect(aa().parentElement.contains(picker)).toBe(true)
    fireEvent.keyDown(picker, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('group', { name: TEXT_COLOR_MENU_LABEL })).toBeNull())
    expect(document.activeElement).toBe(aa())
  }, 60000)

  it('reads as active while the caret is in a quote or a code block, and not otherwise', async () => {
    const { editor } = await mount()
    expect(aa()).not.toHaveAttribute('data-active')
    act(() => { editor.chain().focus().toggleBlockquote().run() })
    await waitFor(() => expect(aa()).toHaveAttribute('data-active', 'true'))
    expect(aa().className).toMatch(/toolBtnActive/)
    act(() => { editor.chain().focus().toggleBlockquote().run() })
    await waitFor(() => expect(aa()).not.toHaveAttribute('data-active'))
    act(() => { editor.chain().focus().toggleCodeBlock().run() })
    await waitFor(() => expect(aa()).toHaveAttribute('data-active', 'true'))
  }, 60000)

  it('the keyboard shortcuts still format with the buttons folded (Mod-B, Mod-I, Mod-Shift-H)', async () => {
    const { editor } = await mount()
    selectAll(editor)
    const key = (k, extra = {}) => fireEvent.keyDown(editor.view.dom, { key: k, ctrlKey: true, ...extra })
    // keyCode too: ProseMirror's keymap reads the BASE key from it when Shift changes `key` ('H' for h).
    key('b', { keyCode: 66 })
    expect(editor.isActive('bold')).toBe(true)
    key('i', { keyCode: 73 })
    expect(editor.isActive('italic')).toBe(true)
    key('H', { shiftKey: true, keyCode: 72 })
    expect(editor.isActive('highlight')).toBe(true)
  }, 60000)
})

describe('the header\'s AI control', () => {
  const header = () => document.querySelector('[data-note-header]')

  it('with Ask and Writing help: ONE "AI" menu of two items, each opening its panel', async () => {
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    await mount()
    const ai = within(header()).getByRole('button', { name: 'AI' })
    expect(ai).toHaveAttribute('aria-haspopup', 'menu')
    expect(ai.closest('[data-header-control]')).toHaveAttribute('data-header-control', 'ai')
    // today's two buttons are folded at desktop (still the touch tier's)
    expect(screen.getByRole('button', { name: 'Ask about this note' }).closest('[class*="askFolded"]')).not.toBeNull()
    expect(within(header()).getByRole('button', { name: 'Writing help' }).className).toMatch(/foldDesktop/)
    expect(onTouch(ai, header())).toBe(false)

    fireEvent.click(ai)
    let menu = screen.getByRole('menu', { name: 'AI' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((el) => el.textContent.trim())).toEqual(['Ask about this note', 'Writing help'])
    // Go-live wave 1 (C5): the menu item carries the desktop walkthrough step's own anchor; the header button keeps
    // `writing-help` (the touch step's), and "AI" carries `note-ai`.
    expect(items[1]).toHaveAttribute('data-tour', 'writing-help-menu')
    expect(within(header()).getByRole('button', { name: 'Writing help' })).toHaveAttribute('data-tour', 'writing-help')
    expect(ai).toHaveAttribute('data-tour', 'note-ai')
    fireEvent.click(items[0])
    expect(await screen.findByRole('dialog', { name: 'Ask about this note' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask' }))
    await waitFor(() => expect(document.activeElement).toBe(ai))

    fireEvent.click(ai)
    menu = screen.getByRole('menu', { name: 'AI' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Writing help' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  }, 60000)

  // Final fix (C5): with Ask already open, AI > "Ask about this note" closed it (it pressed the toggle again).
  it('AI > "Ask about this note" with Ask already open leaves it open and puts the cursor in its field', async () => {
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    await mount()
    const ai = within(header()).getByRole('button', { name: 'AI' })
    fireEvent.click(ai)
    fireEvent.click(within(screen.getByRole('menu', { name: 'AI' })).getByRole('menuitem', { name: 'Ask about this note' }))
    await screen.findByRole('dialog', { name: 'Ask about this note' })
    ai.focus()
    fireEvent.click(ai)
    fireEvent.click(within(screen.getByRole('menu', { name: 'AI' })).getByRole('menuitem', { name: 'Ask about this note' }))
    expect(screen.getByRole('dialog', { name: 'Ask about this note' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Your question about/ })))
  }, 60000)

  it('Escape closes the AI menu and returns focus to "AI"', async () => {
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    await mount()
    const ai = within(header()).getByRole('button', { name: 'AI' })
    fireEvent.click(ai)
    fireEvent.keyDown(screen.getByRole('menu', { name: 'AI' }), { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'AI' })).toBeNull()
    expect(document.activeElement).toBe(ai)
  }, 60000)

  it('with Ask only (no Writing help for this member): the plain "Ask about this note" button (A6), no AI menu', async () => {
    await mount()
    expect(within(header()).queryByRole('button', { name: 'AI' })).toBeNull()
    const ask = screen.getByRole('button', { name: 'Ask about this note' })
    expect(ask).toHaveTextContent(/^Ask about this note$/)
    expect(ask.closest('[class*="askFolded"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Writing help' })).toBeNull()
  }, 60000)
})

describe('the line under the title', () => {
  const summary = () => document.querySelector('[data-note-details-summary]')

  it('says up to three tags and the ticker; no sector, no property count, no review state', async () => {
    PROPERTIES = [derived('builtin:ticker', 'Ticker', 'NVDA'), derived('builtin:sector', 'Sector', 'Technology'),
      derived('builtin:industry', 'Industry', 'Semiconductors')]
    NOTE = { ...baseNote(), propertiesJson: { 'builtin:note_kind': 'thesis' } }
    const { view } = await mount()
    await waitFor(() => expect(summary()?.textContent).toContain('NVDA'))
    // let the properties and the review history answer: what they would have added must still be absent
    await waitFor(() => expect(global.fetch.mock.calls.map(([u]) => String(u))).toContain('/api/j2/notes/n1/properties'))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    const parts = [...summary().querySelectorAll('[class*="item"]')].map((el) => el.textContent)
    expect(parts).toEqual(['#breakout', '#semis', '#ai', '+1', 'NVDA'])
    expect(summary().textContent).not.toMatch(/Technology|propert|review/i)
    // the folder select and the Details toggle are on the same line
    const line = view.container.querySelector('[data-note-details-line]')
    expect(within(line).getByRole('combobox', { name: 'Folder' })).toBeTruthy()
    expect(within(line).getByRole('button', { name: /^details$/i })).toBeTruthy()
  }, 60000)
})

describe('the More menu', () => {
  const more = () => screen.getByRole('button', { name: 'More note actions' })
  const panel = () => document.getElementById(more().getAttribute('aria-controls'))

  it('is Find, Outline, History, Duplicate, Make this a thesis, Lock, Archive, Save as template, Open a note beside, Export, Move to Trash', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await mount({
      noteMenu: (note, api) => <NoteMenuActions note={note} onChanged={api.refresh} onOpenBeside={vi.fn()} />,
    })
    fireEvent.click(more())
    await waitFor(() => expect(within(panel()).getByRole('button', { name: /Make this a thesis/ })).toBeTruthy())
    expect(within(panel()).getAllByRole('button').map((b) => b.textContent.trim())).toEqual([
      'Find in note', 'Outline', 'History', 'Duplicate', 'Make this a thesis', 'Lock', 'Archive', 'Save as template',
      'Open a note beside…', 'Export', 'Move to Trash',
    ])
  }, 60000)
})

describe('Export holds PNG and Print, above the file formats', () => {
  const trigger = () => screen.getByRole('button', { name: /^export/i })

  it('no PNG or Print beside Export; the menu opens on PNG, Print, then the four formats', () => {
    render(<NoteExportControls noteId="n1" title="Plan" columnRef={{ current: null }} onMessage={() => {}} />)
    expect(screen.queryByRole('button', { name: 'PNG' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
    fireEvent.click(trigger())
    const items = within(screen.getByRole('menu', { name: 'Export this note as' })).getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['PNG', 'Print', ...EXPORT_FORMATS.map((f) => f.menuLabel)])
    expect(document.activeElement).toBe(items[0])
  })
})

describe('ONE "Save as template": plain by default, or keep live blocks', () => {
  const NOTE_FOR_MENU = { id: 'n1', title: 'NVDA plan', kindId: 'trade_plan' }
  const renderMenu = () => render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NoteMenuActions note={NOTE_FOR_MENU} onBeforeTemplate={async () => true} />
    </SWRConfig>,
  )
  beforeEach(() => {
    createJournalStyle.mockReset()
    createJournalStyle.mockImplementation(async (body) => ({ style: { id: 's9', name: body.name }, leftOut: [] }))
  })

  it('one entry; it opens on the plain choice and saves a plain template', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    global.fetch = vi.fn(async (url, init) => ({
      ok: true, status: 200, json: async () => ({ template: { id: 't9', name: JSON.parse(init.body).name } }),
    }))
    renderMenu()
    expect(screen.getAllByRole('button', { name: /Save as template/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Save as template with blocks' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Keep live blocks' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('combobox', { name: 'Note type' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText(/Saved “NVDA plan” as a template/)).toBeInTheDocument()
    expect(global.fetch.mock.calls.map(([u]) => String(u))).toContain('/api/j2/note-templates')
    expect(createJournalStyle).not.toHaveBeenCalled()
  })

  it('"Keep live blocks" saves through the blocks path, and says so after the form closes', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep live blocks' }))
    expect(await screen.findByRole('combobox', { name: 'Note type' }, { timeout: 10000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep live blocks' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save template' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Saved as the template “NVDA plan”.')).toBeInTheDocument()
    expect(createJournalStyle).toHaveBeenCalledWith({ fromNoteId: 'n1', name: 'NVDA plan' }, { via: 'from_note' })
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save as template' })))
  })

  it('with journal styles off there is no choice: the plain form, as before', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue('NVDA plan')
    expect(screen.queryByRole('button', { name: 'Keep live blocks' })).toBeNull()
  })
})

// Preview fix round 1 (found walking the built branch in Chromium at 1920 x 945). jsdom lays nothing out, so each
// layout fix is held where it lives -- the rule in the stylesheet and the class or nesting it needs in the DOM. The
// browser walk is the verdict.
const sheet = (name) => readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook', name), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('preview fix round 1: the layout the browser walk found wrong', () => {
  it('item 1: the colour picker sizes to its swatch rows, not to the button it hangs from', () => {
    expect(declares(sheet('TextColorMenu.module.css'), '.popover', 'width', 'max-content')).toBe(true)
  })

  it('item 5: the "Aa" menu hangs from the button\'s left edge, outranking the shared right-aligned menu', async () => {
    expect(declares(sheet('NoteFormatMenu.module.css'), '.anchor > .menuStart', 'left', '0')).toBe(true)
    expect(declares(sheet('NoteFormatMenu.module.css'), '.anchor > .menuStart', 'right', 'auto')).toBe(true)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'More formatting' }))
    const menu = screen.getByRole('menu', { name: 'More formatting' })
    expect(menu.className).toMatch(/menuStart/)
    expect(menu.parentElement.className).toMatch(/anchor/)
  }, 60000)

  it('item 2: at desktop the Ask panel anchors to the AI group, below the header row, not to its folded toggle', async () => {
    expect(declares(DESKTOP, '.headerControls .aiGroup', 'position', 'relative')).toBe(true)
    expect(declares(DESKTOP, '.askFolded > div', 'position', 'static')).toBe(true)
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    await mount()
    const header = document.querySelector('[data-note-header]')
    const ai = within(header).getByRole('button', { name: 'AI' })
    fireEvent.click(ai)
    fireEvent.click(within(screen.getByRole('menu', { name: 'AI' })).getByRole('menuitem', { name: 'Ask about this note' }))
    const panel = await screen.findByRole('dialog', { name: 'Ask about this note' })
    // the box `.askFolded > div` makes static IS the one holding the panel, and the group it then anchors to is the AI
    // group, whose last drawn control is the AI button
    const box = panel.parentElement
    expect(box.parentElement.className).toMatch(/askFolded/)
    expect(box.tagName).toBe('DIV')
    const group = box.parentElement.parentElement
    expect(group.getAttribute('data-header-control')).toBe('ai')
    expect(group.className).toMatch(/aiGroup/)
    expect(group.lastElementChild.contains(ai)).toBe(true)
  }, 60000)

  it('item 3: the header\'s AI button centres its icon, word and chevron in one row', async () => {
    expect(declares(CSS, '.aiBtn', 'display', 'inline-flex')).toBe(true)
    expect(declares(CSS, '.aiBtn', 'align-items', 'center')).toBe(true)
    latchNotebookFlags({ notebook_writing_help_enabled: true })
    await mount()
    const ai = within(document.querySelector('[data-note-header]')).getByRole('button', { name: 'AI' })
    expect(ai.className).toMatch(/aiBtn/)
    // no icon nudged by hand any more (the inline vertical-align that left the word low)
    for (const svg of ai.querySelectorAll('svg')) expect(svg.style.verticalAlign).toBe('')
  }, 60000)
})
