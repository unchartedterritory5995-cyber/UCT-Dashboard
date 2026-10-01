// PeriodSortConfig on the TERM-067 form primitives: every control is named by its
// visible label, the date rule is said in words, and Sort sends what it always sent.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import PeriodSortConfig from './PeriodSortConfig'

afterEach(cleanup)
const SEL = { start: 20260105, end: 20260210 }
const mount = (props = {}) => {
  const onSort = vi.fn()
  const onCancel = vi.fn()
  render(<PeriodSortConfig sel={SEL} onSort={onSort} onCancel={onCancel} {...props} />)
  return { onSort, onCancel }
}

describe('PeriodSortConfig', () => {
  it('every control is reachable by its visible label', () => {
    mount()
    expect(screen.getByLabelText('Sort').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Start')).toHaveValue('2026-01-05')
    expect(screen.getByLabelText('End')).toHaveValue('2026-02-10')
    expect(screen.getByLabelText('Timeframe')).toHaveValue('D')
    expect(screen.getByLabelText('Mark start')).toHaveValue('off')
    expect(screen.getByLabelText(/Replay mode/).getAttribute('type')).toBe('checkbox')
  })

  it('a valid range shows no error and marks nothing invalid', () => {
    mount()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('End').hasAttribute('aria-invalid')).toBe(false)
    expect(screen.getByRole('button', { name: 'Sort' })).toBeEnabled()
  })

  it('an end on or before the start says so beside the field, and Sort stays disabled', () => {
    const { onSort } = mount()
    const end = screen.getByLabelText('End')
    fireEvent.change(end, { target: { value: '2026-01-05' } })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('End must be after start.')
    expect(end.getAttribute('aria-invalid')).toBe('true')
    expect(end.getAttribute('aria-describedby')).toBe(alert.id)
    const sort = screen.getByRole('button', { name: 'Sort' })
    expect(sort).toBeDisabled()
    fireEvent.click(sort)
    expect(onSort).not.toHaveBeenCalled()
    // fixing the date clears the message
    fireEvent.change(end, { target: { value: '2026-03-01' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Sort sends the same six arguments it always sent', () => {
    const { onSort } = mount()
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'sector' } })
    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: 'W' } })
    fireEvent.change(screen.getByLabelText('Mark start'), { target: { value: 'line' } })
    fireEvent.click(screen.getByLabelText(/Replay mode/))
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(onSort.mock.calls).toEqual([[20260105, 20260210, true, 'sector', 'W', 'line']])
  })

  it('the default grouping is sent as null, and Cancel cancels', () => {
    const { onSort, onCancel } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(onSort.mock.calls[0]).toEqual([20260105, 20260210, false, null, 'D', 'off'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
