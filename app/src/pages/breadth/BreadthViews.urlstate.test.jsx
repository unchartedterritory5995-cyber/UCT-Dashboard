/**
 * §5's two halves at the container: what a link DOES when it opens, and what
 * the container reports back for the link to carry.
 *
 * The router lives one level up (`Breadth.jsx`), so this drives the same props
 * the page passes — which is also the proof that the default (`urlState={null}`)
 * is "today's behaviour exactly": every other file in this directory renders
 * this component without them and is unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

// A SERVER that has an opinion — this is the thing the URL has to beat.
const remote = vi.hoisted(() => ({ value: null }))
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: remote.value ?? {}, setPref: vi.fn(), loading: false }),
  parsePref: (v) => v,
}))

import BreadthViews from './BreadthViews'
import { SEEK_OUT_OF_WINDOW } from './views/breadthViewShared'
import { PREF_KEY } from './useBreadthViews'

const mkRows = (n) => Array.from({ length: n }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60,
    pct_above_50sma: 60 - (i % 30), pct_above_200sma: 55, pct_above_5sma: 40,
    pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 300 - (i % 50), down_4pct_today: 100, new_52w_highs: 40, new_52w_lows: 9,
    mcclellan_osc: 20, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
  }
})
const rows = mkRows(40)
const deep = mkRows(200)

const switcher = () => within(screen.getByRole('group', { name: 'Visualization style' }))
const cursorDate = () => screen.getByTestId('cursor-date').textContent

beforeEach(() => { localStorage.clear(); remote.value = null })

describe('the URL wins over stored preferences', () => {
  it('opens the style the link names, over the server’s saved one', () => {
    // ⛔ This is the race the override exists for: the preference blob arrives
    // in an effect AFTER first paint and setStates the whole thing, so a
    // "apply the URL on mount" effect in the container would be silently
    // stomped a tick later.
    remote.value = { [PREF_KEY]: { viewStyle: 'radar', byView: {} } }
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: 'clock', date: null, compare: null }} />)
    expect(switcher().getByRole('button', { name: 'Regime Clock' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves the stored style alone when the link names none', () => {
    remote.value = { [PREF_KEY]: { viewStyle: 'radar', byView: {} } }
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }} />)
    expect(switcher().getByRole('button', { name: 'Radar' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('opens compare on the link’s quad, over a stored single layout', () => {
    remote.value = { [PREF_KEY]: { viewStyle: 'radar', byView: {}, layout: 'single' } }
    const quad = ['ribbon', 'clock', 'events', 'radar']
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: quad }} />)
    expect(screen.getByTestId('layout-compare')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId(/^compare-pane-\d+$/)
      .map(p => p.getAttribute('data-pane-style'))).toEqual(quad)
  })
})

describe('?date= uses Wave A’s refusal, not a second one', () => {
  it('seeks to a session inside the loaded window', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: rows[9].date, compare: null }} />)
    expect(cursorDate()).toBe(rows[9].date)
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
  })

  it('refuses a session the window does not hold, and says why', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: '2025-03-11', compare: null }} />)
    // The cursor did NOT quietly land on the newest row pretending otherwise.
    expect(cursorDate()).toBe(rows[0].date)
    const refusal = screen.getByTestId('url-date-refusal')
    expect(refusal.textContent).toContain('2025-03-11')      // still legible
    expect(refusal.textContent).toContain(SEEK_OUT_OF_WINDOW)
  })

  it('lands the same link once the window is widened', () => {
    // The Analogue Deck's promise, applied to the URL: widen and it goes live.
    const target = deep[150].date
    const { rerender } = render(<BreadthViews rows={rows} onDrill={() => {}}
                                              urlState={{ view: null, date: target, compare: null }} />)
    expect(screen.getByTestId('url-date-refusal')).toBeTruthy()

    rerender(<BreadthViews rows={deep} onDrill={() => {}}
                           urlState={{ view: null, date: target, compare: null }} />)
    expect(cursorDate()).toBe(target)
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
  })

  it('does not fight the user after it has landed', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: rows[9].date, compare: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'LATEST' }))
    expect(cursorDate()).toBe(rows[0].date)      // stays where the user put it
  })
})

describe('what the container reports back for the link', () => {
  const lastCall = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0]

  it('reports the style, and NO date while the cursor is on the newest row', () => {
    // A link that pinned today's date would still say "2026-08-28" tomorrow —
    // a different read than the one that was shared.
    const onUrlChange = vi.fn()
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }}
                         onUrlChange={onUrlChange} />)
    expect(lastCall(onUrlChange)).toMatchObject({ view: 'treemap', date: null, layout: 'single' })
  })

  it('reports the date once the cursor leaves the newest row, and drops it again', () => {
    const onUrlChange = vi.fn()
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }}
                         onUrlChange={onUrlChange} />)
    fireEvent.click(screen.getByLabelText('Previous day'))
    expect(lastCall(onUrlChange).date).toBe(rows[1].date)
    fireEvent.click(screen.getByRole('button', { name: 'LATEST' }))
    expect(lastCall(onUrlChange).date).toBeNull()
  })

  it('reports the layout and the quad when compare is on', () => {
    const onUrlChange = vi.fn()
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }}
                         onUrlChange={onUrlChange} />)
    expect(lastCall(onUrlChange).layout).toBe('single')
    fireEvent.click(screen.getByTestId('layout-compare'))
    const after = lastCall(onUrlChange)
    expect(after.layout).toBe('compare')
    expect(after.compare).toHaveLength(4)
  })
})

describe('no URL state at all is today’s behaviour exactly', () => {
  it('renders, reports nothing, and shows no refusal', () => {
    expect(() => render(<BreadthViews rows={rows} onDrill={() => {}} />)).not.toThrow()
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
    expect(cursorDate()).toBe(rows[0].date)
    expect(screen.getByTestId('layout-single')).toHaveAttribute('aria-pressed', 'true')
  })
})
