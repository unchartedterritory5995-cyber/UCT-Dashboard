import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NoteFind } from '../../lib/noteFindExtension'
import NoteFindBar from './NoteFindBar'

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
