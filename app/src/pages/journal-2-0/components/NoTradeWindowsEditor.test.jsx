import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NoTradeWindowsEditor from './NoTradeWindowsEditor'

describe('NoTradeWindowsEditor', () => {
  it('renders existing windows', () => {
    const value = [
      { start: '11:30', end: '13:30', label: 'Lunch' },
      { start: '09:30', end: '09:45', label: '' },
    ]
    render(<NoTradeWindowsEditor value={value} onChange={() => {}} />)
    expect(screen.getByDisplayValue('11:30')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Lunch')).toBeInTheDocument()
  })

  it('Add window appends a blank row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NoTradeWindowsEditor value={[]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /add window/i }))
    expect(onChange).toHaveBeenCalledWith([
      { start: '', end: '', label: '' },
    ])
  })

  it('changing a field calls onChange with updated list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NoTradeWindowsEditor
        value={[{ start: '11:30', end: '13:30', label: '' }]}
        onChange={onChange}
      />,
    )
    const startInput = screen.getByDisplayValue('11:30')
    await user.clear(startInput)
    await user.type(startInput, '12:00')
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastCall[0].start).toBe('12:00')
  })

  it('Remove button drops the row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NoTradeWindowsEditor
        value={[{ start: '11:30', end: '13:30', label: 'Lunch' }]}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
