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

  // ─── S4 · the Quote of the Day is first-class on the WEEKEND state ───────
  test('renders the Quote of the Day as its own panel', () => {
    // The mocked `swr` above answers every key with calData, so
    // useQuoteOfTheDay sees `{days:{}}` — no `.quote` — and falls back to the
    // local rotation, which is exactly the offline path a member would get.
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.getByText(/quote of the day/i)).toBeTruthy()
  })

  test('a card with NOTHING about the week is still null — the quote does not resurrect the frame', () => {
    // ⛔ THE GATE MUST NOT COUNT THE QUOTE. The quote is available almost
    // always, so counting it would make the empty-frame gate unreachable and
    // put a "The Week" header over a card that says nothing about the week.
    deskData = { articles: [] }
    calData = { days: {} }
    const { container } = render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(container.textContent).toBe('')
    expect(screen.queryByText(/quote of the day/i)).toBeNull()
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

  // 🔴 PRODUCTION DEFECT, seen only by looking at the deployed page. The
  // reading list excluded the scan by OBJECT IDENTITY (`a !== scan`), so it
  // dropped only the one post we picked. The desk holds several posts sharing
  // the "Sunday Scans" title, and the live weekend hero rendered that same
  // headline FOUR times under "From the Desk", directly beneath the panel
  // already showing it. Exclude by KIND, not by identity.
  test('From the Desk excludes EVERY sunday-scans post, not just the one it picked', () => {
    deskData = { articles: [
      { slug: 'sunday-scans-w3', title: 'Sunday Scans', url: '#' },
      { slug: 'sunday-scans-w2', title: 'Sunday Scans', url: '#' },
      { slug: 'sunday-scans-w1', title: 'Sunday Scans', url: '#' },
      { slug: 'the-tape-friday', title: 'Friday Tape Read', url: '#' },
    ] }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    // the hero panel still shows it exactly once
    expect(screen.getAllByText(/Sunday Scans/i)).toHaveLength(1)
    // and the non-scan article is what the reading list actually offers
    expect(screen.getByText('Friday Tape Read')).toBeTruthy()
  })

  // CONTROL: a desk with no scan at all still lists its articles, so the
  // filter above cannot pass by simply hiding everything.
  test('CONTROL: with no sunday-scans post, From the Desk still lists articles', () => {
    deskData = { articles: [{ slug: 'the-tape-friday', title: 'Friday Tape Read', url: '#' }] }
    render(<MemoryRouter><TheWeek /></MemoryRouter>)
    expect(screen.getByText('Friday Tape Read')).toBeTruthy()
  })
})
