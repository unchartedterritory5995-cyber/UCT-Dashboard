// The date box hands each draft to its host as the member types (zero-network plan PR 1.2): `onDraft(text)`, the masked
// text, so the host warms the date before Enter (chart/dateWarm.js); Escape ends the draft with ''.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartDateNav from './ChartDateNav'
import { wholeDraftDate } from '../../../components/chart/dateWarm'

const meta = () => ({ rightMs: Date.UTC(2026, 10, 13), firstMs: Date.UTC(2000, 0, 3), lastMs: Date.UTC(2026, 10, 13), firstYear: 2000, lastYear: 2026, fullyLoaded: true, loading: false })
const field = () => screen.getByPlaceholderText('M/D/YYYY')

describe('ChartDateNav onDraft', () => {
  it('each keystroke hands the masked draft over; the date is whole only with its last digit', () => {
    const onDraft = vi.fn()
    render(<ChartDateNav paneRef={{ current: { getDateMeta: meta } }} nav={{ goToDate: vi.fn() }} onDraft={onDraft} />)
    fireEvent.focus(field())
    let typed = ''
    for (const d of '03142006') { typed += d; fireEvent.change(field(), { target: { value: typed } }) }
    const drafts = onDraft.mock.calls.map((c) => c[0])
    expect(drafts.at(-1)).toBe('03/14/2006')
    expect(drafts.map(wholeDraftDate).filter((x) => x != null)).toEqual([Date.UTC(2006, 2, 14)])
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(onDraft).toHaveBeenLastCalledWith('')
  })
})
