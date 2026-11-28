// The date box hands each draft to its host as the member types (zero-network plan PR 1.2): `onDraft(text, ms)`, the
// masked text and the date Enter will go to (chart/dateText parseDate, whole: review of #2987, N1); Escape ends it.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartDateNav from './ChartDateNav'

const meta = () => ({ rightMs: Date.UTC(2026, 10, 13), firstMs: Date.UTC(2000, 0, 3), lastMs: Date.UTC(2026, 10, 13), firstYear: 2000, lastYear: 2026, fullyLoaded: true, loading: false })
const field = () => screen.getByPlaceholderText('M/D/YYYY')

describe('ChartDateNav onDraft', () => {
  it('each keystroke hands the masked draft and its date over; the date is whole only with its last digit', () => {
    const onDraft = vi.fn()
    render(<ChartDateNav paneRef={{ current: { getDateMeta: meta } }} nav={{ goToDate: vi.fn() }} onDraft={onDraft} />)
    fireEvent.focus(field())
    let typed = ''
    for (const d of '03142006') { typed += d; fireEvent.change(field(), { target: { value: typed } }) }
    expect(onDraft.mock.calls.at(-1)[0]).toBe('03/14/2006')
    // 03/14/20 names 2020 (a 2-digit year, as Enter reads it); 03/14/200 is no date; 03/14/2006 is the date
    expect(onDraft.mock.calls.map((c) => c[1]).filter((x) => x != null)).toEqual([Date.UTC(2020, 2, 14), Date.UTC(2006, 2, 14)])
  })
  it('Enter goes to the date the last draft named (one parser), and Escape ends the draft', () => {
    const onDraft = vi.fn()
    const nav = { goToDate: vi.fn() }
    render(<ChartDateNav paneRef={{ current: { getDateMeta: meta } }} nav={nav} onDraft={onDraft} />)
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: '031406' } })
    const ms = onDraft.mock.calls.at(-1)[1]
    expect(ms).toBe(Date.UTC(2006, 2, 14))
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(nav.goToDate).toHaveBeenCalledWith(ms)
    fireEvent.focus(field())
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(onDraft).toHaveBeenLastCalledWith('', null)
  })
})
