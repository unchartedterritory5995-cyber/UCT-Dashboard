import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NewNoteMenu, { NewNoteCaret } from './NewNoteMenu'

describe('NewNoteMenu', () => {
  it('the main button makes a blank note in one press', () => {
    const onBlank = vi.fn()
    render(<NewNoteMenu onBlank={onBlank} onFromOutline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    expect(onBlank).toHaveBeenCalledTimes(1)
  })
  it('the menu lists only the doors that work (gatesOff)', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(items).toEqual(['From an outline'])
  })
  it('voice and today appear when their handlers are given, and each fires', () => {
    const onVoice = vi.fn(); const onToday = vi.fn()
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onVoice={onVoice} onToday={onToday} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['From an outline', 'Voice note', "Today's note"])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice note' }))
    expect(onVoice).toHaveBeenCalledTimes(1)
  })
  // P0.10: the voice-notes tour keeps this menu open while its card describes the voice item. The
  // card is portalled to document.body, so a press on its Next button is "outside" the menu;
  // without an exemption the menu closed on pointerdown and the tour ended before the click landed.
  it('a press on the tour card (data-tour-card) leaves the menu open; a press elsewhere closes it', () => {
    render(
      <div>
        <NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onVoice={vi.fn()} />
        <div data-tour-card="non-modal"><button type="button">Next</button></div>
        <p>elsewhere</p>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
  // M2 (final review): `run` closed the menu but left focus on the item, which then unmounted, so
  // when the New-note sheet or the voice dialog closed, focus returned to a detached item (<body>).
  // Focus goes back to the caret BEFORE the chosen item runs, so whatever opens and closes after
  // it hands focus back to a live control.
  it('M2: focus is on the caret by the time a chosen item runs, for every item', () => {
    const seen = {}
    const spy = (name) => vi.fn(() => { seen[name] = document.activeElement })
    const onFromOutline = spy('outline'); const onVoice = spy('voice'); const onToday = spy('today')
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={onFromOutline} onVoice={onVoice} onToday={onToday} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    for (const [name, label] of [['outline', 'From an outline'], ['voice', 'Voice note'], ['today', "Today's note"]]) {
      fireEvent.click(caret)
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
      expect(screen.queryByRole('menu'), `${name}: menu closed`).toBeNull()
      expect(seen[name], `${name}: focus was on the caret when the item ran`).toBe(caret)
      expect(document.activeElement, `${name}: and it is still there afterwards`).toBe(caret)
    }
  })
  it('Escape closes the menu and returns focus to the caret', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    fireEvent.click(caret)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
  })
})

describe('NewNoteMenu: From a style (Notebook P1)', () => {
  it('lists "From a style" only when a handler is passed', () => {
    const { rerender } = render(<NewNoteMenu onBlank={() => {}} onFromOutline={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.queryByRole('menuitem', { name: /From a style/ })).toBeNull()
    const onFromStyle = vi.fn()
    rerender(<NewNoteMenu onBlank={() => {}} onFromOutline={() => {}} onFromStyle={onFromStyle} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /From a style/ }))
    expect(onFromStyle).toHaveBeenCalledTimes(1)
  })
})

// P1 follow-up (owner GO 2026-10-12): the notes list renders the caret WITHOUT the primary button
// (the list keeps its own "+ New note"). Same menu, same doors, and no second "new-note-home"
// anchor: that one belongs to Home's split button alone.
describe('NewNoteCaret: the caret alone (the notes list)', () => {
  it('renders the caret and the same menu, no primary button and no Home anchor', () => {
    const onFromOutline = vi.fn(); const onFromStyle = vi.fn(); const onToday = vi.fn()
    const { container } = render(<NewNoteCaret onFromOutline={onFromOutline} onFromStyle={onFromStyle} onToday={onToday} />)
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull()
    expect(container.querySelector('[data-tour="new-note-home"]')).toBeNull()
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    expect(caret).toHaveAttribute('aria-haspopup', 'menu')
    expect(caret.className).toMatch(/\bbtn btn-primary btn-sm\b/)
    fireEvent.click(caret)
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(['From an outline', 'From a style', "Today's note"])
    fireEvent.click(screen.getByRole('menuitem', { name: 'From a style' }))
    expect(onFromStyle).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(caret)
  })
  it('the voice item keeps its tour anchor in this form too', () => {
    render(<NewNoteCaret onFromOutline={vi.fn()} onVoice={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getByRole('menuitem', { name: 'Voice note' })).toHaveAttribute('data-tour', 'new-note-voice')
  })
  it('Left/Right inside the open menu do not escape it (a toolbar around it cannot steal them)', () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><NewNoteCaret onFromOutline={vi.fn()} onToday={vi.fn()} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const [first] = screen.getAllByRole('menuitem')
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) fireEvent.keyDown(first, { key })
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(outer).toHaveBeenCalledTimes(1)   // the keys the menu does not need still bubble
  })
})

// Fix round 1 (review M1, M2). The open menu keeps Left/Right/Home/End to itself in BOTH forms:
// Home's split button too (nothing around it roves, but a window-level Left/Right, such as the video
// seek shortcuts, no longer sees them while a menu item holds focus). Home/End move to the first or
// last item and do not scroll the page.
describe('the open menu keeps Left/Right/Home/End (both forms)', () => {
  it('Home\'s form: Left/Right do not escape the open menu', () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onToday={vi.fn()} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const [first] = screen.getAllByRole('menuitem')
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(outer).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(first)
    expect(screen.getByRole('menu')).toBeTruthy()
  })
  it.each([['Home\'s form', (p) => <NewNoteMenu onBlank={vi.fn()} {...p} />], ['the list form', (p) => <NewNoteCaret {...p} />]])(
    '%s: Home and End focus the first and last item, and the page does not scroll', (_n, mount) => {
      render(mount({ onFromOutline: vi.fn(), onFromStyle: vi.fn(), onToday: vi.fn() }))
      fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
      const items = screen.getAllByRole('menuitem')
      expect(fireEvent.keyDown(items[0], { key: 'End' })).toBe(false)   // false = default prevented
      expect(document.activeElement).toBe(items[items.length - 1])
      expect(fireEvent.keyDown(items[items.length - 1], { key: 'Home' })).toBe(false)
      expect(document.activeElement).toBe(items[0])
    },
  )
})

// Review follow-up R1: the menu button's keyboard pattern. ArrowDown / ArrowUp on the caret open the
// menu on its first / last item, and a Tab that takes focus out of the open menu closes it.
describe.each([["Home's form", (p) => <NewNoteMenu onBlank={vi.fn()} {...p} />], ['the list form', (p) => <NewNoteCaret {...p} />]])(
  'keyboard: open from the caret, close on Tab-out (%s)', (_n, mount) => {
    const doors = () => ({ onFromOutline: vi.fn(), onFromStyle: vi.fn(), onToday: vi.fn() })
    const page = (p) => render(<div>{mount(p)}<button type="button">after</button></div>)
    const caretOf = () => screen.getByRole('button', { name: 'More ways to start a note' })
    it('ArrowDown on the caret opens the menu on the first item', () => {
      page(doors())
      caretOf().focus()
      expect(fireEvent.keyDown(caretOf(), { key: 'ArrowDown' })).toBe(false)   // false = default prevented
      const items = screen.getAllByRole('menuitem')
      expect(caretOf()).toHaveAttribute('aria-expanded', 'true')
      expect(document.activeElement).toBe(items[0])
    })
    it('ArrowUp on the caret opens the menu on the last item', () => {
      page(doors())
      caretOf().focus()
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      const items = screen.getAllByRole('menuitem')
      expect(document.activeElement).toBe(items[items.length - 1])
    })
    it('ArrowDown after ArrowUp still starts at the first item (the request is not remembered)', () => {
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      fireEvent.keyDown(caretOf(), { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
    })
    it('ArrowDown on the caret of an already-open menu moves into it; other keys do not open it', () => {
      page(doors())
      fireEvent.click(caretOf())
      caretOf().focus()
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      const items = screen.getAllByRole('menuitem')
      expect(document.activeElement).toBe(items[items.length - 1])
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      for (const key of ['ArrowLeft', 'ArrowRight', 'a']) fireEvent.keyDown(caretOf(), { key })
      expect(screen.queryByRole('menu')).toBeNull()
    })
    it('Tab out of the open menu closes it and leaves focus where Tab sent it', async () => {
      const user = userEvent.setup()
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowUp' })
      expect(screen.getByRole('menu')).toBeTruthy()
      await user.tab()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))
      expect(caretOf()).toHaveAttribute('aria-expanded', 'false')
    })
    it('focus moving between items, or back to the caret, keeps the menu open', async () => {
      const user = userEvent.setup()
      page(doors())
      fireEvent.keyDown(caretOf(), { key: 'ArrowDown' })
      await user.tab()   // first item -> second item? No: a menu's rows are tabbable buttons, so Tab walks them
      expect(screen.getByRole('menu')).toBeTruthy()
      const items = screen.getAllByRole('menuitem')
      items[1].focus()
      await user.tab({ shift: true })
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(caretOf())
      expect(screen.getByRole('menu')).toBeTruthy()
    })
    it('focus going to the tour card keeps the menu open; focus going anywhere else closes it', () => {
      render(<div>{mount(doors())}<div data-tour-card="non-modal"><button type="button">Next</button></div><button type="button">elsewhere</button></div>)
      fireEvent.click(caretOf())
      const first = screen.getAllByRole('menuitem')[0]
      fireEvent.focusOut(first, { relatedTarget: screen.getByRole('button', { name: 'Next' }) })
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.focusOut(first, { relatedTarget: null })   // the window lost focus: the pointer handler owns outside presses
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.focusOut(first, { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) })
      expect(screen.queryByRole('menu')).toBeNull()
    })
  },
)
