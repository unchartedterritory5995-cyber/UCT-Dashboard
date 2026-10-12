import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NewNoteMenu from './NewNoteMenu'

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
