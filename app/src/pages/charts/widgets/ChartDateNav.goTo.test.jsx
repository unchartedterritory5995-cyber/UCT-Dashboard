// Chart date calendar in UCT Signature style (owner 11-15): a "Go to a date" field at the top of the
// calendar jumps the chart to a typed date; the framed day and year are marked as current.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartDateNav from './ChartDateNav'

function setup() {
  const api = {
    getDateMeta: () => ({ rightMs: Date.UTC(2026, 10, 13), firstMs: Date.UTC(2010, 0, 4), lastMs: Date.UTC(2026, 10, 13), firstYear: 2010, lastYear: 2026, fullyLoaded: true, loading: false }),
    goToDate: vi.fn(), goToYear: vi.fn(), stepBar: vi.fn(), ensureFullHistory: vi.fn(),
  }
  render(<ChartDateNav paneRef={{ current: api }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Pick a date or year' }))
  return api
}

describe('ChartDateNav calendar · go to a typed date', () => {
  it('types a date (slashes appear by themselves) and goes there', () => {
    const api = setup()
    const field = screen.getByRole('textbox', { name: 'Go to a date' })
    const go = screen.getByRole('button', { name: 'Go' })
    expect(go.disabled).toBe(true)
    fireEvent.change(field, { target: { value: '3152021' } })
    expect(field.value).toBe('3/15/2021')
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    expect(api.goToDate).toHaveBeenCalledWith(Date.UTC(2021, 2, 15))
    expect(screen.queryByRole('dialog', { name: 'Go to date' })).toBeNull()
  })
  it('Enter in the field goes too', () => {
    const api = setup()
    const field = screen.getByRole('textbox', { name: 'Go to a date' })
    fireEvent.change(field, { target: { value: '01022019' } })
    fireEvent.submit(field.closest('form'))
    expect(api.goToDate).toHaveBeenCalledWith(Date.UTC(2019, 0, 2))
  })
  it('marks the framed day and year as current', () => {
    setup()
    expect(screen.getByRole('button', { name: '13' }).getAttribute('aria-current')).toBe('date')
    expect(screen.getByRole('button', { name: '2026' }).getAttribute('aria-current')).toBe('true')
  })
})
