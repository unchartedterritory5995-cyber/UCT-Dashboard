import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NoteFind } from '../../lib/noteFindExtension'
import NoteFindBar from './NoteFindBar'
import styles from './NoteFindBar.module.css'

const EXT = [StarterKit, NoteFind]

let editor
afterEach(() => { editor?.destroy(); editor = null; vi.restoreAllMocks() })

function mountEditor(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: EXT, content })
  return editor
}

describe('NoteFindBar', () => {
  it('typing a term highlights matches and shows a 1-based match count', () => {
    const ed = mountEditor('<p>buy the dip, buy the breakout</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'buy' } })
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('shows 0/0 once a term is typed with no matches', () => {
    const ed = mountEditor('<p>the capex thesis</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'zzz' } })
    expect(screen.getByText('0/0')).toBeInTheDocument()
  })

  it('shows nothing before any term is typed', () => {
    const ed = mountEditor('<p>buy the dip</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    expect(screen.queryByText(/\d\/\d/)).not.toBeInTheDocument()
  })

  it('Enter advances to the next match; the count reflects the new position', () => {
    const ed = mountEditor('<p>buy buy buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    const input = screen.getByRole('searchbox', { name: 'Find in note' })
    fireEvent.change(input, { target: { value: 'buy' } })
    expect(screen.getByText('1/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/3')).toBeInTheDocument()
  })

  it('Shift+Enter moves to the previous match, wrapping to the last', () => {
    const ed = mountEditor('<p>buy buy buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    const input = screen.getByRole('searchbox', { name: 'Find in note' })
    fireEvent.change(input, { target: { value: 'buy' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('3/3')).toBeInTheDocument() // wraps to last
  })

  it('the Next/Previous buttons drive the same navigation as the keyboard', () => {
    const ed = mountEditor('<p>buy buy buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'buy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(screen.getByText('2/3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('the Next/Previous buttons are disabled when there are no matches', () => {
    const ed = mountEditor('<p>the capex thesis</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'zzz' } })
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeDisabled()
  })

  it('Escape clears the highlight and calls onClose', () => {
    const ed = mountEditor('<p>buy the dip</p>')
    const onClose = vi.fn()
    render(<NoteFindBar editor={ed} onClose={onClose} />)
    const input = screen.getByRole('searchbox', { name: 'Find in note' })
    fireEvent.change(input, { target: { value: 'buy' } })
    expect(ed.view.dom.querySelectorAll('.uct-find-match').length).toBe(1)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(ed.view.dom.querySelectorAll('.uct-find-match').length).toBe(0)
    expect(onClose).toHaveBeenCalled()
  })

  it('the close button clears the highlight and calls onClose', () => {
    const ed = mountEditor('<p>buy the dip</p>')
    const onClose = vi.fn()
    render(<NoteFindBar editor={ed} onClose={onClose} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'buy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }))
    expect(ed.view.dom.querySelectorAll('.uct-find-match').length).toBe(0)
    expect(onClose).toHaveBeenCalled()
  })

  it('is case-insensitive', () => {
    const ed = mountEditor('<p>NVDA breakout</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'nvda' } })
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('focuses its own input on mount', () => {
    const ed = mountEditor('<p>buy the dip</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    expect(screen.getByRole('searchbox', { name: 'Find in note' })).toHaveFocus()
  })
})

// ── Wave 5: replace + match case ─────────────────────────────────────────────
describe('NoteFindBar — replace', () => {
  const find = (value) => fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value } })

  it('the toggle shows and hides a labelled replace row (aria-expanded tells which)', () => {
    const ed = mountEditor('<p>buy buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: 'Show replace' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide replace' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeInTheDocument()
  })

  it('opened for replace (Ctrl+H) shows the row at once', () => {
    const ed = mountEditor('<p>buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    expect(screen.getByRole('textbox', { name: 'Replace with' })).toBeInTheDocument()
  })

  it('Enter in the replace field replaces the active match and moves on', () => {
    const ed = mountEditor('<p>buy the dip, buy more</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('buy')
    const field = screen.getByRole('textbox', { name: 'Replace with' })
    fireEvent.change(field, { target: { value: 'sell' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(ed.getText()).toBe('sell the dip, buy more')
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('Ctrl/Cmd+Enter (and the button) replace ALL, and say how many in the live region', () => {
    const ed = mountEditor('<p>a margin, a margin, a margin</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('margin')
    const field = screen.getByRole('textbox', { name: 'Replace with' })
    fireEvent.change(field, { target: { value: 'spread' } })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(ed.getText()).toBe('a spread, a spread, a spread')
    const live = screen.getByText('Replaced 3 matches')
    expect(live.getAttribute('aria-live')).toBe('polite')
  })

  it('the Replace all button does the same', () => {
    const ed = mountEditor('<p>x y x</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('x')
    fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), { target: { value: 'z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(ed.getText()).toBe('z y z')
  })

  it('Match case is a pressed-state toggle that re-searches', () => {
    const ed = mountEditor('<p>Fed fed FED</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    find('fed')
    expect(screen.getByText('1/3')).toBeInTheDocument()
    const aa = screen.getByRole('button', { name: 'Match case' })
    expect(aa.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(aa)
    expect(aa.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('a read-only editor gets no replace door at all', () => {
    const ed = mountEditor('<p>buy</p>')
    ed.setEditable(false)
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    expect(screen.queryByRole('button', { name: 'Show replace' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
  })

  it('Escape in the replace field closes the bar', () => {
    const ed = mountEditor('<p>buy</p>')
    const onClose = vi.fn()
    render(<NoteFindBar editor={ed} onClose={onClose} initialReplace />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Replace with' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

// ── Wave 5 fix round 1 ───────────────────────────────────────────────────────
describe('NoteFindBar — fix round 1', () => {
  const find = (value) => fireEvent.change(screen.getByRole('searchbox', { name: 'Find in note' }), { target: { value } })
  const replaceWith = (value) => fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), { target: { value } })
  const setPlatform = (value) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
  afterEach(() => { delete navigator.platform })

  it('S6: Whole word is a pressed-state toggle; MU -> MRVL then rewrites only the ticker', () => {
    const ed = mountEditor('<p>MU is up much; the community likes MU.</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('MU')
    expect(screen.getByText('1/4')).toBeInTheDocument()
    const word = screen.getByRole('button', { name: 'Whole word' })
    expect(word.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(word)
    expect(word.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('1/2')).toBeInTheDocument()
    replaceWith('MRVL')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(ed.getText()).toBe('MRVL is up much; the community likes MRVL.')
  })

  it('S6: AMD -> NVDA with Whole word does not touch AMDL', () => {
    const ed = mountEditor('<p>AMD and AMDL</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('AMD')
    fireEvent.click(screen.getByRole('button', { name: 'Whole word' }))
    replaceWith('NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(ed.getText()).toBe('NVDA and AMDL')
  })

  it('S5: "Replaced N matches" carries an Undo that restores every match in one step', () => {
    const ed = mountEditor('<p>a margin, a margin, a margin</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('margin')
    replaceWith('spread')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(ed.getText()).toBe('a spread, a spread, a spread')
    const undoBtn = screen.getByRole('button', { name: 'Undo' })
    // The touch tier's 44px floor: the Undo is a textBtn, which that tier sizes.
    expect(undoBtn.className).toContain(styles.textBtn)
    fireEvent.click(undoBtn)
    expect(ed.getText()).toBe('a margin, a margin, a margin')
    expect(screen.getByText('Replace all undone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('S5: once the note has moved on, the Undo refuses (it would undo the member\'s own typing)', () => {
    const ed = mountEditor('<p>x y x</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('x')
    replaceWith('z')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    const undoBtn = screen.getByRole('button', { name: 'Undo' })
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' typed')
    fireEvent.click(undoBtn)
    expect(ed.getText()).toBe('z y z typed')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  // R1-N4 (re-review): the refusal said nothing -- a dead click, or an Undo that
  // just vanished. It now names why, and the editor's own undo chord.
  it.each([
    ['Win32', 'Ctrl+Z'],
    ['MacIntel', 'Cmd+Z'],
  ])('R1-N4: on %s a refused Undo says why and names %s', (platform, chord) => {
    setPlatform(platform)
    const ed = mountEditor('<p>x y x</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('x')
    replaceWith('z')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    const undoBtn = screen.getByRole('button', { name: 'Undo' })
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' typed')
    fireEvent.click(undoBtn)
    expect(ed.getText()).toBe('z y z typed') // refused: the member's typing stays
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText(`The note changed since — use ${chord} to undo in the editor`)).toBeInTheDocument()
  })

  it('R1-N4: when the bar redraws after the note moved on, the reason REPLACES the Undo (never a silent vanish)', () => {
    setPlatform('Win32')
    const ed = mountEditor('<p>x y x</p>')
    const view = render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('x')
    replaceWith('z')
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(screen.getByText('Replaced 2 matches')).toBeInTheDocument()
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, ' typed')
    view.rerender(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    const live = screen.getByText('The note changed since — use Ctrl+Z to undo in the editor')
    expect(live.getAttribute('aria-live')).toBe('polite') // said, not just shown
  })

  it('S5: the touch tier sizes every textBtn to the 44px floor', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteFindBar.module.css'), 'utf8')
    const tier = css.slice(css.indexOf('@media (max-width: 1024px)'))
    expect(tier.slice(0, tier.indexOf('\n}'))).toMatch(/\.textBtn\s*\{[^}]*min-height:\s*var\(--tap-min/)
  })

  it.each([
    ['MacIntel', 'Replace (Cmd+Option+F)', 'Cmd+Enter'],
    ['Win32', 'Replace (Ctrl+H)', 'Ctrl+Enter'],
  ])('S7: on %s the tooltips name the platform\'s own chords', (platform, replaceTitle, allChord) => {
    setPlatform(platform)
    const ed = mountEditor('<p>buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: 'Show replace' })
    expect(toggle.getAttribute('title')).toBe(replaceTitle)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Replace all' }).getAttribute('title')).toContain(`(${allChord})`)
  })

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
  ])('N5: Enter in the replace field while an IME is composing (%s) replaces nothing', (_label, extra) => {
    const ed = mountEditor('<p>buy the dip</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} initialReplace />)
    find('buy')
    replaceWith('sell')
    const field = screen.getByRole('textbox', { name: 'Replace with' })
    fireEvent.keyDown(field, { key: 'Enter', ...extra })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, ...extra })
    expect(ed.getText()).toBe('buy the dip')
    // ...and the same Enter without composition does replace (the control).
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(ed.getText()).toBe('sell the dip')
  })

  it('N5: Enter in the find field while composing does not move to the next match', () => {
    const ed = mountEditor('<p>buy buy buy</p>')
    render(<NoteFindBar editor={ed} onClose={vi.fn()} />)
    find('buy')
    const input = screen.getByRole('searchbox', { name: 'Find in note' })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(screen.getByText('1/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/3')).toBeInTheDocument()
  })
})
