// Go-live wave 1, fix round 2: the note's find bar and table toolbar, drawn from warmed slots (EditorToolSlots.jsx).
//   (a) warm: with the find bar's chunk in hand, Ctrl+F draws the REAL bar and moves focus in the press's own act;
//   (b) cold: before the chunk lands, a stand-in holds focus and what is typed, and hands it to the real bar;
//   (c) failed: the stand-in says Find could not be loaded, offers Try again, never reloads, never throws;
//   (d) the table toolbar's failed fetch renders nothing, throws nothing, and the next mount asks again.
import { Component, useState } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NoteFind } from '../../lib/noteFindExtension'
import { chunkRetry } from '../../lib/lazyChunk'
import {
  editorToolLoaders, findBarModule, tableToolbarModule, FindBarSlot, TableToolbarSlot, FIND_UNAVAILABLE,
} from './EditorToolSlots'
import { pageReload, RELOAD_TO_RECOVER } from '../../lib/heldModule'

const REAL = { ...editorToolLoaders }
const RELOAD_FLAG = 'uct.chunk-reload-attempted' // utils/lazyWithRetry.js sets it just before a reload
const chunkError = () => new Error('Failed to fetch dynamically imported module: http://localhost:3000/assets/X-abc.js')

let editor
function mountEditor(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: [StarterKit, NoteFind], content })
  return editor
}

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <p data-testid="boundary">{String(this.state.error)}</p> : this.props.children }
}

// The editor page's shape: a note field, Ctrl+F on the page, the slot while find is open.
function Page({ ed, onClosed }) {
  const [open, setOpen] = useState(false)
  const onKeyDown = (e) => {
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); setOpen(true) }
  }
  return (
    <div onKeyDown={onKeyDown}>
      <textarea data-testid="note" />
      {open && <FindBarSlot editor={ed} onClose={() => {
        // NoteEditorPage's closeFind: the bar closes, the find marks clear and the note takes focus back.
        setOpen(false); ed?.commands.noteFindClear(); ed?.commands.focus(); onClosed?.()
      }} />}
    </div>
  )
}

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  // jsdom has no scrollIntoView; the real bar scrolls to the active match once the handed query has run.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  // jsdom lays nothing out; ProseMirror measures a Range when the editor takes focus (the Esc case below).
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
  findBarModule.resetForTests()
  tableToolbarModule.resetForTests()
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch {}
})
afterEach(() => {
  Object.assign(editorToolLoaders, REAL)
  findBarModule.resetForTests()
  tableToolbarModule.resetForTests()
  editor?.destroy(); editor = null
  vi.restoreAllMocks()
})

describe('the find bar, warm', () => {
  it('(a) with the chunk in hand, Ctrl+F draws the real bar and focuses it in the same act', async () => {
    await findBarModule.warm()
    expect(findBarModule.get().status).toBe('ready')
    const ed = mountEditor('<p>buy the dip</p>')
    render(<Page ed={ed} />)
    const note = screen.getByTestId('note')
    note.focus()
    // One synchronous act: the press, its render and its effects. Nothing awaited after it.
    act(() => { fireEvent.keyDown(note, { key: 'f', ctrlKey: true }) })
    const field = screen.getByRole('searchbox', { name: 'Find in note' })
    expect(document.activeElement).toBe(field)
    // The real bar (its Match case control), not the stand-in.
    expect(screen.getByRole('button', { name: 'Match case' })).toBeInTheDocument()
    expect(document.querySelector('[data-find-stand-in]')).toBeNull()
  })
})

describe('the find bar, cold', () => {
  it('(b) a stand-in takes focus and the typed text, and the real bar takes over with it as its query', async () => {
    const d = deferred()
    editorToolLoaders.findBar = () => d.promise
    const ed = mountEditor('<p>buy the dip, buy the breakout</p>')
    render(<Page ed={ed} />)
    const note = screen.getByTestId('note')
    note.focus()
    act(() => { fireEvent.keyDown(note, { key: 'f', ctrlKey: true }) })
    const stand = screen.getByRole('searchbox', { name: 'Find in note' })
    expect(document.querySelector('[data-find-stand-in]')).not.toBeNull()
    expect(document.activeElement).toBe(stand)
    fireEvent.change(stand, { target: { value: 'buy' } })
    expect(note.value).toBe('')
    const RealBar = await REAL.findBar()
    // Final fix (B5): the stand-in leaves and the real field holds focus in the SAME commit -- read straight after the
    // one act that lands the chunk, never after a waitFor that would also pass if focus arrived frames later.
    await act(async () => { d.resolve(RealBar) })
    expect(document.querySelector('[data-find-stand-in]')).toBeNull()
    const field = screen.getByRole('searchbox', { name: 'Find in note' })
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('buy')
    expect(field.selectionStart).toBe(3) // the next letter lands after the ones typed
    expect(screen.getByText('1/2')).toBeInTheDocument() // the handed text ran as the query
  })

  it('(b) Esc on the stand-in closes it, the page does not see the Escape, and focus is back in the editor', async () => {
    editorToolLoaders.findBar = () => new Promise(() => {})
    const onClosed = vi.fn()
    const pageKey = vi.fn()
    const ed = mountEditor('<p>buy the dip</p>')
    render(<div onKeyDown={pageKey}><Page ed={ed} onClosed={onClosed} /></div>)
    const note = screen.getByTestId('note')
    act(() => { fireEvent.keyDown(note, { key: 'f', ctrlKey: true }) })
    pageKey.mockClear()
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find in note' }), { key: 'Escape' })
    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(pageKey).not.toHaveBeenCalled()
    expect(screen.queryByRole('searchbox', { name: 'Find in note' })).toBeNull()
    // Final fix (B5): focus is in the note's editor, not dropped on the page with the stand-in (TipTap's focus
    // command lands on the next animation frame, hence the wait).
    await waitFor(() => expect(ed.view.dom.contains(document.activeElement)).toBe(true))
    expect(document.activeElement).not.toBe(document.body)
  })
})

describe('the find bar, failed', () => {
  it('(c) says Find could not be loaded, offers Try again, never reloads and never throws', async () => {
    editorToolLoaders.findBar = () => Promise.reject(chunkError())
    vi.spyOn(chunkRetry, 'importUrl').mockImplementation(() => Promise.reject(chunkError()))
    render(<Boundary><Page ed={null} /></Boundary>)
    const note = screen.getByTestId('note')
    act(() => { fireEvent.keyDown(note, { key: 'f', ctrlKey: true }) })
    await waitFor(() => expect(screen.getByText(FIND_UNAVAILABLE)).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByTestId('boundary')).toBeNull()
    let flag = null
    try { flag = sessionStorage.getItem(RELOAD_FLAG) } catch {}
    expect(flag).toBeNull()
    // Try again, now that the chunk can be fetched: the real bar arrives.
    editorToolLoaders.findBar = REAL.findBar
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Match case' })).toBeInTheDocument())
  })
})

describe('the find bar, Try again (final fix B2 + C5)', () => {
  it('keeps focus on the field while it runs; a repeat failure puts it on Try again and offers Reload; one that lands hands it to the real bar', async () => {
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    editorToolLoaders.findBar = () => Promise.reject(new Error('boom'))
    render(<Page ed={null} />)
    act(() => { fireEvent.keyDown(screen.getByTestId('note'), { key: 'f', ctrlKey: true }) })
    await screen.findByText(FIND_UNAVAILABLE)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    let reject
    const failing = new Promise((_, rej) => { reject = rej })
    editorToolLoaders.findBar = () => failing
    act(() => { screen.getByRole('button', { name: 'Try again' }).focus() })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Find in note' }))
    await act(async () => { reject(new Error('gone')) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText(`${FIND_UNAVAILABLE} ${RELOAD_TO_RECOVER}`)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    const RealBar = await REAL.findBar()
    let resolve
    const landing = new Promise((r) => { resolve = r })
    editorToolLoaders.findBar = () => landing
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Find in note' }))
    await act(async () => { resolve(RealBar) })
    expect(screen.getByRole('button', { name: 'Match case' })).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Find in note' }))
  })
})

describe('the table toolbar', () => {
  it('(d) a failed fetch renders nothing and throws nothing; the next mount asks again', async () => {
    editorToolLoaders.tableToolbar = () => Promise.reject(new Error('boom'))
    const { container } = render(<Boundary><div data-testid="host"><TableToolbarSlot editor={null} /></div></Boundary>)
    await act(async () => { await tableToolbarModule.warm() })
    expect(tableToolbarModule.get().status).toBe('failed')
    expect(screen.queryByTestId('boundary')).toBeNull()
    expect(screen.getByTestId('host').innerHTML).toBe('')
    expect(container.textContent).toBe('')
    // The next editor mount warms again, and this time the chunk lands.
    const load = vi.fn(() => Promise.resolve({ default: () => <div data-testid="table-tools" /> }))
    editorToolLoaders.tableToolbar = load
    await act(async () => { await tableToolbarModule.warm() })
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('table-tools')).toBeInTheDocument()
  })
})

describe('the editor draws the slots', () => {
  it('NoteEditorPage renders FindBarSlot and TableToolbarSlot, and fetches neither chunk itself', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'NoteEditorPage.jsx'), 'utf8')
    expect(src).toContain('<FindBarSlot')
    expect(src).toContain('<TableToolbarSlot')
    expect(src).not.toMatch(/import\(['"]\.\/(NoteFindBar|TableToolbar)['"]\)/)
    expect(src).not.toMatch(/<(NoteFindBar|TableToolbar)/)
  })
})
