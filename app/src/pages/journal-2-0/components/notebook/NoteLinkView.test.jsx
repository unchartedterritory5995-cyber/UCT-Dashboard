import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

let targetResult
vi.mock('../../hooks/useNoteLinkTarget', () => ({
  default: () => targetResult,
}))

import NoteLinkView from './NoteLinkView'

function nodeFor(noteId) {
  return { attrs: { noteId } }
}

beforeEach(() => {
  navSpy.mockClear()
  targetResult = { status: 'loading' }
})

describe('NoteLinkView', () => {
  it('shows a loading placeholder while the target resolves', () => {
    targetResult = { status: 'loading' }
    render(<NoteLinkView node={nodeFor('n1')} />)
    expect(screen.getByRole('button')).toHaveTextContent('…')
  })

  it('renders the target title when active', () => {
    targetResult = { status: 'active', title: 'NVDA Earnings Thesis' }
    render(<NoteLinkView node={nodeFor('n1')} />)
    expect(screen.getByRole('button')).toHaveTextContent('NVDA Earnings Thesis')
  })

  it('clicking an active link navigates to the target note', () => {
    targetResult = { status: 'active', title: 'Target' }
    render(<NoteLinkView node={nodeFor('n1')} />)
    fireEvent.click(screen.getByRole('button'))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n1')
  })

  it('shows a distinct trashed state with a badge, still clickable', () => {
    targetResult = { status: 'trashed', title: 'Old note' }
    render(<NoteLinkView node={nodeFor('n1')} />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('Old note')
    expect(btn).toHaveTextContent('Trashed')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=n1')
  })

  it('shows an unavailable state and does not navigate on click', () => {
    targetResult = { status: 'unavailable' }
    render(<NoteLinkView node={nodeFor('ghost')} />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('Note unavailable')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(navSpy).not.toHaveBeenCalled()
  })
})
