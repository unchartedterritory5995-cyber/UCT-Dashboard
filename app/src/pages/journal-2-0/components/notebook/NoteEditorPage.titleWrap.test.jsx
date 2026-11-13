// Final polish (WebKit at 390 px, production): a long note title was clipped ("UXCHART phone che…") in a one-line
// <input>. The title is an auto-growing <textarea> now, so it WRAPS, and it keeps every contract the input had: its
// name, the `data-note-title` hook NotebookTab's skip link finds, one line of text (a pasted line break is a space),
// and Enter going on to the body (Shift+Enter to the subtitle), never a newline in the title.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { installFetch, Providers } from '../../a11y/fixtures'
import NoteEditorPage, { useAutoGrow } from './NoteEditorPage'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}
afterEach(() => cleanup())

async function renderEditor() {
  installFetch()
  render(
    <Providers route="/journal/notebook?note=n1">
      <NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} />
    </Providers>,
  )
  const title = await screen.findByPlaceholderText('Title')
  await waitFor(() => { if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted') })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  return title
}

describe('the note title wraps', () => {
  it('is a one-row textarea with the same name and hook', async () => {
    const title = await renderEditor()
    expect(title.tagName).toBe('TEXTAREA')
    expect(title).toHaveAttribute('rows', '1')
    expect(title).toHaveAttribute('data-note-title')
    expect(screen.getByRole('textbox', { name: 'Note title' })).toBe(title)
  })

  it('stays one line of text: a pasted line break becomes a space', async () => {
    const title = await renderEditor()
    fireEvent.change(title, { target: { value: 'NVDA flag\ninto earnings' } })
    expect(title.value).toBe('NVDA flag into earnings')
  })

  it('Enter goes on to the body and never types a newline', async () => {
    const title = await renderEditor()
    const notCancelled = fireEvent.keyDown(title, { key: 'Enter' })
    expect(notCancelled).toBe(false)
    await waitFor(() => expect(document.activeElement?.closest?.('.ProseMirror')).toBeTruthy())
  })
})

describe('useAutoGrow', () => {
  function Probe() {
    const ref = useRef(null)
    const [v, setV] = useState('short')
    useAutoGrow(ref, v)
    return <textarea ref={ref} value={v} onChange={(e) => setV(e.target.value)} data-testid="t" />
  }

  it('sets the textarea as tall as its text, and again when the text changes', () => {
    let h = 40
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => h })
    try {
      render(<Probe />)
      const t = screen.getByTestId('t')
      expect(t.style.height).toBe('40px')
      h = 80
      fireEvent.change(t, { target: { value: 'a much longer title that wraps onto a second line' } })
      expect(t.style.height).toBe('80px')
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', desc)
      else delete HTMLElement.prototype.scrollHeight
    }
  })
})

// Final polish (WebKit at 390 px, production): an open note offers the Journal header's tools in its own ⋯, so the
// phone header can fold away on a note address (lib/journalToolsDoor.js). The note page registers that door while it
// is on screen -- from its first commit, the loading skeleton included -- and releases it when it goes.
describe('an open note offers the "Journal tools" door', () => {
  it('registers while mounted and releases on unmount', async () => {
    const { journalToolsDoorMounted } = await import('../../lib/journalToolsDoor')
    await renderEditor()
    expect(journalToolsDoorMounted()).toBe(true)
    cleanup()
    expect(journalToolsDoorMounted()).toBe(false)
  })

  it('opened on a phone, the note ⋯ carries "Journal tools" after Find and Outline, and it opens the tools', async () => {
    const { OPEN_JOURNAL_TOOLS_EVENT } = await import('../../lib/journalToolsDoor')
    const { MQ } = await import('../../../../styles/breakpoints')
    const real = window.matchMedia
    window.matchMedia = (q) => ({ matches: q === MQ.phone, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      await renderEditor()
      fireEvent.click(screen.getByRole('button', { name: /more note actions/i }))
      // Simplify pass 2 (A9): the row reads "Trade journal tools", the same words as the list's ⋯ row.
      const item = await screen.findByRole('button', { name: /^Trade journal tools$/ })
      expect(item).toHaveAttribute('data-journal-tools-door')
      let opened = 0
      const on = () => { opened += 1 }
      window.addEventListener(OPEN_JOURNAL_TOOLS_EVENT, on)
      fireEvent.click(item)
      window.removeEventListener(OPEN_JOURNAL_TOOLS_EVENT, on)
      expect(opened).toBe(1)
    } finally {
      window.matchMedia = real
    }
  })})