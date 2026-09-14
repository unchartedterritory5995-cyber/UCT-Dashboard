import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// C-07, the member-visible half: the picture says how old its DATA is.
//
// ⛔⛔ THE PAGE COMPOSES NOTHING. `?stale=` arrives already worded, by
// `api/services/discord_render/freshness.py::Envelope.badge` — selected by
// `badge.render_badge`, put on the URL by `badge.vintage_param`. If this page phrased
// the warning itself from a date, there would be two authors for one sentence, which is
// exactly how a chart reached the public channel on 2026-08-31 stamped with Monday's
// clock while its stats strip described Friday's session. So every assertion below is
// about the sentence arriving UNCHANGED, and the "arbitrary text" case is the one that
// proves it: a page that composed anything could not render a sentence it has never seen.
//
// ⛔ AND ABSENT MEANS ABSENT. No parameter draws no badge — the backend sends nothing for
// a fresh verdict, an unknown one, and a stale one with no readable timestamp, so "we
// measured and it is fine" and "we did not measure" look identical here. That is correct:
// in both cases there is nothing to tell a member, and a badge that shows when nothing is
// wrong is not there on the day it matters.

vi.mock('../components/StockChart', async () => {
  const React = await import('react')
  return {
    default: () => React.createElement('canvas', { 'data-testid': 'stock-chart', width: 8, height: 8 }),
    SESSION_EXT_COLOR: '#f0a020',
  }
})

const { default: ChartRender } = await import('./ChartRender')

const b64url = (o) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const BADGE = '⚠ data as of 2026-09-04 16:00 ET (stale)'

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?sym=NVDA&tf=D${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('ChartRender — the STALE badge the backend decided', () => {
  it('draws the sentence it was handed, verbatim', () => {
    mount(`&stale=${encodeURIComponent(BADGE)}`)
    expect(screen.getByTestId('stale-badge').textContent).toBe(BADGE)
  })

  it('renders a sentence it could not possibly have composed', () => {
    // ⛔ THE CONTROL FOR "ONE AUTHOR". A page that phrased the warning from a date would
    // render its own wording here and this would fail; a page that draws what it is given
    // renders whatever the one owner said, which is the property C-07 needs.
    mount('&stale=' + encodeURIComponent('the bars are from last Thursday'))
    expect(screen.getByTestId('stale-badge').textContent).toBe('the bars are from last Thursday')
  })

  it('draws nothing at all when the backend sent no verdict', () => {
    mount('')
    expect(screen.queryByTestId('stale-badge')).toBeNull()
    expect(document.body.textContent).not.toMatch(/stale/i)
  })

  it('draws nothing for an empty parameter — absent and blank are the same silence', () => {
    mount('&stale=')
    expect(screen.queryByTestId('stale-badge')).toBeNull()
  })

  it('is the ONLY vintage sentence under the chart when it is present', () => {
    // The older stats-derived clause fires whenever the strip is not today's. Drawing both
    // would put two sentences about one value under one chart — the disagreement this
    // whole class of bug is made of.
    mount(`&stats=${b64url({ as_of: '2026-08-28', close: 553.11 })}&stale=${encodeURIComponent(BADGE)}`)
    expect(screen.getByTestId('stale-badge').textContent).toBe(BADGE)
    expect(document.body.textContent).not.toMatch(/· data as of Aug 28/)
    expect(document.body.textContent.match(/data as of/g)).toHaveLength(1)
  })

  it('leaves the older stats clause alone when the backend sent no verdict', () => {
    // The fallback still works for a caller that has not been taught to measure freshness —
    // removing it would be a regression dressed as a cleanup.
    mount(`&stats=${b64url({ as_of: '2026-08-28', close: 553.11 })}`)
    expect(screen.queryByTestId('stale-badge')).toBeNull()
    expect(document.body.textContent).toMatch(/data as of Aug 28/)
  })

  it('cannot be turned into a second line or an unbounded string', () => {
    // `/r/chart` is PUBLIC, so this value is attacker-controlled exactly as `?bname=` and
    // `?company=` already are. React escapes it; this is about SHAPE — the footer strip is
    // 20px tall and one line, and a newline or 4 kB of text would wreck the export.
    mount('&stale=' + encodeURIComponent('one\nline\ttwo' + 'x'.repeat(400)))
    const drawn = screen.getByTestId('stale-badge').textContent
    expect(drawn.length).toBeLessThanOrEqual(96)
    expect(drawn).not.toMatch(/[\n\t]/)
    expect(drawn.startsWith('one line two')).toBe(true)
  })

  it('reads the same on two renders — it is input, never a clock', () => {
    // §3.10: the same closed-market input renders the same pixels. The footer's OTHER
    // stamp is a wall clock by design; this one must never be.
    mount(`&stale=${encodeURIComponent(BADGE)}`)
    const first = screen.getByTestId('stale-badge').textContent
    cleanup()
    mount(`&stale=${encodeURIComponent(BADGE)}`)
    expect(screen.getByTestId('stale-badge').textContent).toBe(first)
  })

  it('still renders the chart it is warning about', () => {
    mount(`&stale=${encodeURIComponent(BADGE)}`)
    expect(screen.getByTestId('stock-chart')).toBeTruthy()
  })
})
