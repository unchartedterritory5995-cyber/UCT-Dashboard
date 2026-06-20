import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AuthContext } from '../context/AuthContext'
import PatternFeedbackChip from './PatternFeedbackChip'

function renderAs(role, props = {}) {
  return render(
    <AuthContext.Provider value={{ user: role ? { id: 1, role } : null }}>
      <PatternFeedbackChip ticker="NVDA" setup="vcp" source="chart" {...props} />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))
})

describe('PatternFeedbackChip', () => {
  it('renders nothing for non-admins', () => {
    const { container } = renderAs('member')
    expect(container.textContent).toBe('')
  })

  it('renders nothing with no provider (does not throw)', () => {
    const { container } = render(<PatternFeedbackChip ticker="NVDA" setup="vcp" />)
    expect(container.textContent).toBe('')
  })

  it('admin sees thumbs + refine link', () => {
    renderAs('admin')
    expect(screen.getByLabelText('thumbs up')).toBeInTheDocument()
    expect(screen.getByLabelText('thumbs down')).toBeInTheDocument()
    expect(screen.getByText('refine ↗')).toBeInTheDocument()
  })

  it('posts feedback with source on 👎', () => {
    renderAs('admin', { source: 'scanner', setup: 'scan:pullback', ticker: 'AAPL' })
    fireEvent.click(screen.getByLabelText('thumbs down'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/patterns/feedback',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.rating).toBe('down')
    expect(body.source).toBe('scanner')
    expect(body.setup).toBe('scan:pullback')
  })
})
