// Wave 5 — word count + reading time: what counts, how it reads, and that it
// stays off the keystroke path.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../lib/tiptap'
import { countWords, noteStats, readingMinutes, statsLabel, WORDS_PER_MINUTE } from '../../lib/noteStats'
import NoteStats, { DOC_DEBOUNCE_MS, SELECTION_DEBOUNCE_MS } from './NoteStats'

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null; vi.useRealTimers(); document.body.innerHTML = '' })
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x)) })

describe('what counts as a word', () => {
  it.each([
    ['plain prose', 'Margins widened sharply this quarter.', 5],
    ['a possessive, a hyphen, an abbreviation, a decimal', "NVDA's long-term U.S. 3.5% target", 5],
    ['punctuation and dashes are not words', 'Up — then down; flat!', 4],
    ['each Han / Kana character is a word', '市场上涨', 4],
    ['nothing', '   ', 0],
  ])('%s', (_label, text, n) => { expect(countWords(text)).toBe(n) })

  it('a line break separates words (never glues "one" to "line")', () => {
    const ed = mount([P('line one', { type: 'hardBreak' }, 'line two')])
    expect(noteStats(ed.state.doc).words).toBe(4)
  })

  it('only prose counts: a formula, a chart, a file chip add nothing, and never glue neighbours', () => {
    const ed = mount([
      P('Area', { type: 'inlineMath', attrs: { latex: '\\pi r^2' } }, 'here'),
      { type: 'attachmentChip', attrs: { name: 'q3-filing.pdf', href: '/x' } },
      P('After chip.'),
    ])
    expect(noteStats(ed.state.doc).words).toBe(4) // Area, here, After, chip
  })

  it('counts across blocks: headings, lists, callouts, toggles', () => {
    const ed = mount([
      { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Two words' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [P('three more words')] }] },
      { type: 'callout', attrs: { emoji: '💡' }, content: [P('one')] },
    ])
    expect(noteStats(ed.state.doc).words).toBe(6)
  })
})

describe('reading time and the label', () => {
  it(`reads at ${WORDS_PER_MINUTE} words a minute, never under a minute when there are words`, () => {
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(1)).toBe(1)
    expect(readingMinutes(WORDS_PER_MINUTE * 5)).toBe(5)
  })

  it('reads plainly', () => {
    expect(statsLabel({ words: 1204, minutes: 5 })).toBe('1,204 words · 5 min read')
    expect(statsLabel({ words: 1, minutes: 1 })).toBe('1 word · 1 min read')
    expect(statsLabel({ words: 0, minutes: 0 })).toBe('No words yet')
    expect(statsLabel({ words: 1204, minutes: 5 }, 38)).toBe('38 of 1,204 words selected')
  })
})

describe('<NoteStats>', () => {
  it('shows the note\'s count, and updates a beat after typing pauses -- not inside the keystroke', () => {
    vi.useFakeTimers()
    const ed = mount([P('one two three')])
    render(<NoteStats editor={ed} />)
    expect(screen.getByTestId('note-stats').textContent).toBe('3 words · 1 min read')
    act(() => { ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' four five') })
    expect(screen.getByTestId('note-stats').textContent).toBe('3 words · 1 min read')
    act(() => { vi.advanceTimersByTime(DOC_DEBOUNCE_MS) })
    expect(screen.getByTestId('note-stats').textContent).toBe('5 words · 1 min read')
  })

  it('S3: recounts after a content swap that emits no update (a restore, a sync, an adoption)', () => {
    vi.useFakeTimers()
    const ed = mount([P('one two three')])
    render(<NoteStats editor={ed} />)
    act(() => { ed.commands.setContent({ type: 'doc', content: [P('a b c d e f g h')] }, { emitUpdate: false }) })
    act(() => { vi.advanceTimersByTime(DOC_DEBOUNCE_MS) })
    expect(screen.getByTestId('note-stats').textContent).toBe('8 words · 1 min read')
  })

  it('becomes the selection\'s share while text is selected, and returns when the caret collapses', () => {
    vi.useFakeTimers()
    const ed = mount([P('alpha beta gamma delta')])
    render(<NoteStats editor={ed} />)
    act(() => { ed.commands.setTextSelection({ from: 1, to: 12 }); vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS) })
    expect(screen.getByTestId('note-stats').textContent).toBe('2 of 4 words selected')
    act(() => { ed.commands.setTextSelection(3); vi.advanceTimersByTime(SELECTION_DEBOUNCE_MS) })
    expect(screen.getByTestId('note-stats').textContent).toBe('4 words · 1 min read')
  })

  it('is not a live region (a count that changes per word must not talk over a screen reader)', () => {
    const ed = mount([P('x')])
    render(<NoteStats editor={ed} />)
    const el = screen.getByTestId('note-stats')
    expect(el.getAttribute('aria-live')).toBe(null)
    expect(el.getAttribute('role')).toBe(null)
  })

  it('stops listening when unmounted', () => {
    const ed = mount([P('x')])
    const off = vi.spyOn(ed, 'off')
    const { unmount } = render(<NoteStats editor={ed} />)
    unmount()
    expect(off.mock.calls.map((c) => c[0]).sort()).toEqual(['selectionUpdate', 'transaction'])
  })
})
