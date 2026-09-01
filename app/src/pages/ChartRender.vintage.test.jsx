import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The footer stamp says when the PICTURE WAS TAKEN. It is always "now", so it can
// never disagree with the numbers beside it, however old they are — which is how a
// chart went to the public channel on 2026-08-31 stamped with Monday's time while
// its stats strip described Friday's session (SMH: Day -3.5% off a 573.00 prior
// close, 8/27's, while SMH actually closed +0.6% that Monday).
//
// `compute_stats` now travels with `as_of`, and the footer discloses it when the
// data is not today's. Silent when they agree, so a normal chart is untouched.

vi.mock('../components/StockChart', async () => {
  const React = await import('react')
  return { default: () => React.createElement('canvas', { 'data-testid': 'stock-chart', width: 8, height: 8 }) }
})

const { default: ChartRender } = await import('./ChartRender')

const b64url = (o) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function mountWithStats(stats, extra = '') {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?sym=SMH&tf=D&stats=${b64url(stats)}${extra}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}

const todayET = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())

afterEach(cleanup)

describe('ChartRender footer — data vintage', () => {
  it('says so when the numbers are not from today', () => {
    mountWithStats({ as_of: '2026-08-28', close: 553.11, day_pct: -3.47 })
    expect(document.body.textContent).toMatch(/data as of Aug 28/)
  })

  it('stays silent when the data IS today — a normal chart is unchanged', () => {
    mountWithStats({ as_of: todayET(), close: 556.63, day_pct: 0.64 })
    expect(document.body.textContent).not.toMatch(/data as of/)
  })

  it('stays silent when the payload carries no vintage at all', () => {
    // An older caller sends no `as_of`. Absent is UNKNOWN, and an unknown vintage
    // must not be announced as a stale one.
    mountWithStats({ close: 556.63, day_pct: 0.64 })
    expect(document.body.textContent).not.toMatch(/data as of/)
  })

  it('ignores an unparseable vintage rather than printing rubbish under the chart', () => {
    mountWithStats({ as_of: 'not-a-date', close: 1 })
    expect(document.body.textContent).not.toMatch(/data as of/)
  })

  it('leaves the parity fixture stamp frozen', () => {
    // That span is the one dynamic element the parity gate freezes; appending to
    // it would make two captures of an unchanged chart differ.
    mountWithStats({ as_of: '2026-08-28', close: 553.11 }, '&fixedbars=nvda-d')
    expect(document.body.textContent).toMatch(/parity fixture/)
    expect(document.body.textContent).not.toMatch(/data as of/)
  })

  it('still renders the strip itself', () => {
    mountWithStats({ as_of: '2026-08-28', close: 553.11, day_pct: -3.47 })
    expect(screen.getByTestId('stats-strip')).toBeTruthy()
  })
})
