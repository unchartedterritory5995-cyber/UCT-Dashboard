// The date box in the /charts date mode (owner, 2026-11-27): a host-given `nav` takes the box's jumps (go to a date, a
// year, the step buttons) so the host can carry the date to every next symbol; while the host says the box is
// `anchored`, a "Latest" button (and Enter on an empty field) hands the date back (`onLatest`).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartDateNav from './ChartDateNav'

const meta = () => ({ rightMs: Date.UTC(2026, 10, 13), firstMs: Date.UTC(2000, 0, 3), lastMs: Date.UTC(2026, 10, 13), firstYear: 2000, lastYear: 2026, fullyLoaded: true, loading: false })
function setup(props = {}) {
  const pane = { getDateMeta: meta, goToDate: vi.fn(), goToYear: vi.fn(), stepBar: vi.fn(), ensureFullHistory: vi.fn() }
  const nav = { goToDate: vi.fn(), goToYear: vi.fn(), stepBar: vi.fn() }
  const onLatest = vi.fn()
  const view = render(<ChartDateNav paneRef={{ current: pane }} nav={nav} onLatest={onLatest} {...props} />)
  return { pane, nav, onLatest, view }
}
const field = () => screen.getByPlaceholderText('M/D/YYYY')

describe('ChartDateNav in the date mode', () => {
  it('the jumps go to the host nav, not the pane', () => {
    const { pane, nav } = setup()
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: '01032006' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(nav.goToDate).toHaveBeenCalledWith(Date.UTC(2006, 0, 3))
    fireEvent.click(screen.getByRole('button', { name: 'Step back one bar' }))
    expect(nav.stepBar).toHaveBeenCalledWith(-1)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a date or year' }))
    fireEvent.click(screen.getByRole('button', { name: '2006' }))
    expect(nav.goToYear).toHaveBeenCalledWith(2006)
    expect(pane.goToDate).not.toHaveBeenCalled()
    expect(pane.stepBar).not.toHaveBeenCalled()
    expect(pane.goToYear).not.toHaveBeenCalled()
  })
  it('"Latest" shows only while anchored and hands the date back; so does Enter on an empty field', () => {
    const { onLatest, view } = setup()
    expect(screen.queryByRole('button', { name: 'Back to the latest bar' })).toBe(null)
    view.rerender(<ChartDateNav paneRef={{ current: { getDateMeta: meta } }} nav={{ goToDate: vi.fn() }} onLatest={onLatest} anchored />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to the latest bar' }))
    expect(onLatest).toHaveBeenCalledTimes(1)
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: '' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onLatest).toHaveBeenCalledTimes(2)
  })
  it('without a host nav, the pane takes the jumps as before', () => {
    const pane = { getDateMeta: meta, goToDate: vi.fn(), stepBar: vi.fn() }
    render(<ChartDateNav paneRef={{ current: pane }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Step forward one bar' }))
    expect(pane.stepBar).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('button', { name: 'Back to the latest bar' })).toBe(null)
  })
})
