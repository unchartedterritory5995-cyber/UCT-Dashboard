import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NoTradeWindowsEditor from './NoTradeWindowsEditor'

// Stateful test harness — the editor is fully controlled, so a parent must
// own the value array. This wrapper plays that role and surfaces the
// latest array via an `onLatest` callback so assertions are easy.
function Stateful({ initial = [], onLatest }) {
  const [value, setValue] = useState(initial)
  return (
    <NoTradeWindowsEditor
      value={value}
      onChange={(next) => { setValue(next); onLatest?.(next) }}
    />
  )
}

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
    const onLatest = vi.fn()
    render(<Stateful initial={[]} onLatest={onLatest} />)
    await user.click(screen.getByRole('button', { name: /add window/i }))
    expect(onLatest).toHaveBeenLastCalledWith([
      { start: '', end: '', label: '' },
    ])
  })

  it('changing a field calls onChange with updated list', () => {
    const onLatest = vi.fn()
    render(
      <Stateful
        initial={[{ start: '11:30', end: '13:30', label: '' }]}
        onLatest={onLatest}
      />,
    )
    const startInput = screen.getByDisplayValue('11:30')
    fireEvent.change(startInput, { target: { value: '12:00' } })
    const lastCall = onLatest.mock.calls[onLatest.mock.calls.length - 1][0]
    expect(lastCall[0].start).toBe('12:00')
  })

  it('Remove button drops the row', async () => {
    const user = userEvent.setup()
    const onLatest = vi.fn()
    render(
      <Stateful
        initial={[{ start: '11:30', end: '13:30', label: 'Lunch' }]}
        onLatest={onLatest}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onLatest).toHaveBeenLastCalledWith([])
  })
})
