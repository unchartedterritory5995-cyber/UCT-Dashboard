// app/src/pages/dashboard/TheWeek.test.jsx
//
// ⛔ The brief assumed `/api/calendar` returns `{events: [...]}`. It does
// not — `api/routers/calendar.py::_get_calendar_payload` returns
// `{week_start, week_end, days: {DATE: {bmo, amc, tbd, ...}}, source,
// is_current_week}`, verified by reading the router directly. Tests here
// use the REAL shape (`days` keyed by date, earnings chips carrying `sym`
// under bmo/amc/tbd) rather than the brief's `{events: []}` stand-in, so a
// regression in that field mapping is actually caught.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import TheWeek from './TheWeek'

let deskData
let calData

vi.mock('swr', () => ({
  default: (key) => ({
    data: String(key).includes('desk') ? deskData : calData,
  }),
}))

beforeEach(() => {
  deskData = { articles: [{ slug: 'sunday-scans-da5', title: 'Sunday Scans', url: '#' }] }
  calData = { days: {} }
})

describe('TheWeek', () => {
  test('surfaces the latest Sunday Scan', () => {
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.getByText(/Sunday Scans/i)).toBeTruthy()
  })

  // 🔴 THE CARRIED FIX (task 13). Panel-level omission was already covered;
  // the WHOLE-COMPONENT case was not, and it is the same defect one level up
  // — a "The Week" TileCard header standing over an empty grid. Zone B must
  // never render an empty labelled frame, so the hero returns null when it has
  // nothing at all to say.
  test('renders NOTHING — not even its own header — when all three panels are empty', () => {
    deskData = { articles: [] }
    calData = { days: {} }
    const { container } = render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(container.textContent).toBe('')
    expect(screen.queryByText('The Week')).toBeNull()
  })

  // The control: without it the assertion above is satisfied by a component
  // that renders nothing under every input.
  test('and it DOES render its header as soon as one panel has content', () => {
    deskData = { articles: [{ slug: 'sunday-scans-ctrl', title: 'Sunday Scans', url: '#' }] }
    calData = { days: {} }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.getByText('The Week')).toBeTruthy()
  })

  test('omits panels with no data instead of rendering an empty frame', () => {
    // calendar returned no days at all — "on deck" must not render an empty shell
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.queryByText(/on deck/i)).toBeNull()
  })

  test('omits "From the Desk" when nothing is left after the scan is pulled out', () => {
    deskData = { articles: [{ slug: 'sunday-scans-da5', title: 'Sunday Scans', url: '#' }] }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.queryByText(/from the desk/i)).toBeNull()
  })

  test('omits the Sunday Scan panel when no article carries the sunday-scans- prefix', () => {
    deskData = { articles: [{ slug: 'regular-post', title: 'Regular Post', url: '#' }] }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.queryByText(/latest sunday scan/i)).toBeNull()
    expect(screen.getByText(/from the desk/i)).toBeTruthy()
  })

  test('reads the REAL /api/calendar shape — days keyed by date, symbols under bmo/amc/tbd', () => {
    calData = {
      week_start: '2026-08-31',
      week_end: '2026-09-04',
      days: {
        '2026-08-31': { label: 'Mon Aug 31', day: 'Monday', is_today: false, bmo: [{ sym: 'ZM' }], amc: [], tbd: [] },
        '2026-09-01': { label: 'Tue Sep 1', day: 'Tuesday', is_today: false, bmo: [], amc: [{ sym: 'CRWD' }], tbd: [] },
        '2026-09-02': { label: 'Wed Sep 2', day: 'Wednesday', is_today: false, bmo: [], amc: [], tbd: [{ sym: 'DOCU' }] },
      },
      source: 'range',
      is_current_week: false,
    }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.getByText(/next week on deck/i)).toBeTruthy()
    expect(screen.getByText('ZM')).toBeTruthy()
    expect(screen.getByText('CRWD')).toBeTruthy()
    expect(screen.getByText('DOCU')).toBeTruthy()
  })

  test('a `{events: [...]}` calendar payload (the brief\'s wrong assumption) still omits the panel cleanly', () => {
    // Guards against a regression that trusts the brief's shape instead of
    // the real one: an {events:[]} payload has no `days` key, so onDeck must
    // resolve to empty rather than throwing on undefined.
    calData = { events: [] }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.queryByText(/on deck/i)).toBeNull()
  })

  test('uses the internal reader link only when the article has a native body', () => {
    deskData = {
      articles: [
        { slug: 'sunday-scans-da5', title: 'Sunday Scans', url: 'https://x.test/scan', has_body: true },
      ],
    }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    const link = screen.getByText('Sunday Scans')
    expect(link.getAttribute('href')).toBe('/desk/article/sunday-scans-da5')
  })

  test('falls back to the external url when the article has no native body', () => {
    deskData = {
      articles: [
        { slug: 'sunday-scans-da5', title: 'Sunday Scans', url: 'https://x.test/scan', has_body: false },
      ],
    }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    const link = screen.getByText('Sunday Scans')
    expect(link.getAttribute('href')).toBe('https://x.test/scan')
  })
})
