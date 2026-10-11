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
  it('Escape closes the menu and returns focus to the caret', () => {
    render(<NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} />)
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    fireEvent.click(caret)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
  })
})
