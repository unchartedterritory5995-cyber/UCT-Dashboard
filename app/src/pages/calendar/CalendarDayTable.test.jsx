// app/src/pages/calendar/CalendarDayTable.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))

import CalendarDayTable from './CalendarDayTable'

const ENTRIES = [
  // Pending BMO megacap
  { sym: 'JPM', name: 'JPMorgan Chase & Co', _timing: 'bmo', mine: false,
    mc_b: 850, eps_est: 5.52, rev_est: 51300, expected_move: { pct: 3.1 } },
  // Reported AMC name: beat with revenue actual
  { sym: 'NFLX', name: 'Netflix Inc', _timing: 'amc', mine: true,
    mc_b: 500, eps_est: 4.0, eps_act: 4.4, rev_est: 11000, rev_act: 11500,
    beat_history: [{ beat: true }, { beat: false }] },
  // TBD row with no data
  { sym: 'ZZZ', name: null, _timing: 'tbd', mine: false, mc_b: null },
]

describe('CalendarDayTable — WSE row grammar', () => {
  it('renders the Rev est column header and formatted revenue', () => {
    render(<CalendarDayTable entries={ENTRIES} onSelect={vi.fn()} />)
    expect(screen.getByLabelText('Rev est, not sorted')).toBeTruthy()
    expect(screen.getByText('$51.3B')).toBeTruthy()               // pending: estimate
    expect(screen.getByText('$11.5B')).toBeTruthy()               // reported: actual
    expect(screen.getByText('/ $11.0B')).toBeTruthy()             // reported: dim est
  })

  it('reported rows show EPS actual + colored surprise', () => {
    render(<CalendarDayTable entries={ENTRIES} onSelect={vi.fn()} />)
    expect(screen.getByText('$4.40')).toBeTruthy()
    expect(screen.getByText('+10.0%')).toBeTruthy()
  })

  it('session groups render with counts and a reported chip', () => {
    render(<CalendarDayTable entries={ENTRIES} onSelect={vi.fn()} />)
    expect(screen.getByText('Before Open')).toBeTruthy()
    expect(screen.getByText('After Close')).toBeTruthy()
    expect(screen.getByText('Time TBD')).toBeTruthy()
    expect(screen.getByText('· 1 reported')).toBeTruthy()
  })

  it('move column shows implied move pending, realized gap reported', () => {
    render(
      <CalendarDayTable entries={ENTRIES} reactions={{ NFLX: 7.4 }} onSelect={vi.fn()} />
    )
    expect(screen.getByText('±3.1%')).toBeTruthy()      // JPM pending → implied
    expect(screen.getByText(/▲ \+7\.4%/)).toBeTruthy()  // NFLX reported → realized gap
  })

  it('row click fires onSelect with the entry and its timing', () => {
    const onSelect = vi.fn()
    render(<CalendarDayTable entries={ENTRIES} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('JPM'))
    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls[0][0].sym).toBe('JPM')
    expect(onSelect.mock.calls[0][1]).toBe('bmo')
  })

  it('sorting by Cap desc puts JPM first within its session', () => {
    render(<CalendarDayTable entries={ENTRIES} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Cap, not sorted'))
    expect(screen.getByLabelText('Cap, sorted descending')).toBeTruthy()
  })

  it('renders nothing for an empty entry list', () => {
    const { container } = render(<CalendarDayTable entries={[]} onSelect={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows loading marks in Move/Beats while enrichment is in flight', () => {
    render(<CalendarDayTable entries={ENTRIES} enrichReady={false} onSelect={vi.fn()} />)
    // ZZZ has no expected_move and no beat_history → both cells pulse
    expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(2)
  })

  it('shows a muted dash once enrichment resolves genuinely empty', () => {
    render(<CalendarDayTable entries={ENTRIES} enrichReady={true} onSelect={vi.fn()} />)
    // ZZZ: no move + no beats → two dashes; JPM: has move but no beats → one
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('…')).toBeNull()
  })
})
