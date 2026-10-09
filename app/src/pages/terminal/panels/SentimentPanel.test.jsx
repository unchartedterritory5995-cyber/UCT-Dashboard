// SENT: sentiment and macro. Rails:
//   * each sentiment series shows its latest reading, its OWN date, and its change vs a week and four
//     weeks back, read from the Breadth Monitor rows; a series with no reading says "No data";
//   * weekly surveys are one reading per survey date (a carried value is not a second reading);
//   * Fear & Greed carries CNN's own band word;
//   * the economy block reads only series the catalog publishes; a dark catalog (404) says so;
//     a series with no data says so; a failed series read is an error with Retry;
//   * a failed sentiment read is an error with Retry, never empty data; a 402 says paid plan;
//   * the registry: `SENT` resolves to this panel, market-only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import SentimentPanel, {
  ECON_CATALOG, SENTIMENT_URL, changeSince, fearGreedBand, sentimentRows, seriesPoints, SENTIMENT_SERIES,
} from './SentimentPanel'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

// Newest first, as /api/breadth-monitor serves them. AAII carries its survey date across sessions.
const ROWS = [
  { date: '2026-10-08', aaii_bulls: 41.2, aaii_bears: 30.1, aaii_spread: 11.1, aaii_survey_date: '2026-10-07',
    naaim: 88.5, naaim_date: '2026-10-07', cboe_putcall: 0.82, cnn_fear_greed: 72 },
  { date: '2026-10-07', aaii_bulls: 41.2, aaii_bears: 30.1, aaii_spread: 11.1, aaii_survey_date: '2026-10-07',
    naaim: 88.5, naaim_date: '2026-10-07', cboe_putcall: 0.9, cnn_fear_greed: 70 },
  { date: '2026-10-01', aaii_bulls: 38.0, aaii_bears: 33.0, aaii_spread: 5.0, aaii_survey_date: '2026-09-30',
    naaim: 80.0, naaim_date: '2026-09-30', cboe_putcall: 1.0, cnn_fear_greed: 60 },
  { date: '2026-09-09', aaii_bulls: 30.0, aaii_bears: 40.0, aaii_spread: -10.0, aaii_survey_date: '2026-09-09',
    naaim: 60.0, naaim_date: '2026-09-09', cboe_putcall: 1.1, cnn_fear_greed: 40 },
]
const CATALOG = {
  series: [
    { symbol: 'UST10Y', short_name: '10Y Treasury yield', frequency: 'D', units: { display: '%', fmt: 'pct2', scale: 1 } },
    { symbol: 'USUNRATE', short_name: 'Unemployment rate', frequency: 'M', units: { display: '%', fmt: 'pct1', scale: 1 } },
    { symbol: 'NOTSHOWN', short_name: 'Not on the list', frequency: 'M', units: {} },
  ],
}
const pt = (iso, v, ps) => [Math.floor(Date.parse(`${iso}T12:30:00Z`) / 1000), v, ps, ps, 'V']
const UST10Y = {
  symbol: 'UST10Y', columns: ['t', 'v', 'ps', 'pe', 'pit'], meta: CATALOG.series[0],
  points: [pt('2026-10-06', 4.1, '2026-10-06'), pt('2026-10-07', 4.25, '2026-10-07')],
}

const err = (status) => Object.assign(new Error(`answered ${status}`), { status })
function serve({ sentiment = { rows: ROWS }, catalog = CATALOG, series = {} } = {}) {
  jsonFetcher.mockImplementation(async (url) => {
    let hit
    if (url === SENTIMENT_URL) hit = sentiment
    else if (url === ECON_CATALOG) hit = catalog
    else if (url.startsWith('/api/econ/series/UST10Y')) hit = series.UST10Y ?? UST10Y
    else if (url.startsWith('/api/econ/series/USUNRATE')) hit = series.USUNRATE ?? err(404)
    else hit = err(404)
    if (hit instanceof Error) throw hit
    return hit
  })
}
function renderPanel() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><SentimentPanel /></SWRConfig>)
}

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('SENT panel', () => {
  it('shows each series with its latest reading, its own date and its changes', async () => {
    serve()
    renderPanel()
    const bulls = await screen.findByTestId('terminal-sent-row-aaii_bulls')
    expect(bulls.textContent).toContain('41.2%')
    expect(bulls.textContent).toContain('Oct 7')        // the survey's date, not the session's
    expect(bulls.textContent).toContain('+3.2 pts')     // vs the 9-30 survey
    expect(bulls.textContent).toContain('+11.2 pts')    // vs the 9-09 survey
    expect(screen.getByTestId('terminal-sent-row-aaii_spread').textContent).toContain('+11.1 pts')
    const pc = screen.getByTestId('terminal-sent-row-cboe_putcall').textContent
    expect(pc).toContain('0.82')
    expect(pc).toContain('Oct 8')
    expect(screen.getByTestId('terminal-sent-row-cnn_fear_greed').textContent).toContain('Greed')
    expect(jsonFetcher).toHaveBeenCalledWith(SENTIMENT_URL)
  })

  it('a series with no reading says so and invents nothing', async () => {
    serve({ sentiment: { rows: ROWS.map(({ naaim, naaim_date, ...r }) => r) } })
    renderPanel()
    expect((await screen.findByTestId('terminal-sent-none-naaim')).textContent).toContain('No data')
    expect(screen.getByTestId('terminal-sent-row-aaii_bulls').textContent).toContain('41.2%')
  })

  it('a failed sentiment read is an error with Retry, never empty rows; a 402 says paid plan', async () => {
    jsonFetcher.mockImplementation(async (url) => { if (url === SENTIMENT_URL) throw err(503); throw err(404) })
    renderPanel()
    expect((await screen.findByTestId('terminal-sent-error')).textContent).toContain('could not be read just now')
    expect(screen.queryByTestId('terminal-sent-table')).toBeNull()
    serve()
    fireEvent.click(within(screen.getByTestId('terminal-sent-error')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-sent-table')).toBeTruthy()
    cleanup()
    jsonFetcher.mockImplementation(async (url) => { if (url === SENTIMENT_URL) throw err(402); throw err(404) })
    renderPanel()
    expect((await screen.findByTestId('terminal-sent-error')).textContent).toContain('paid plan')
  })

  it('the economy block shows published series only, and says when one has no data', async () => {
    serve()
    renderPanel()
    const ten = await screen.findByTestId('terminal-sent-econ-UST10Y')
    expect(await within(ten).findByText('4.25%')).toBeTruthy()
    expect(ten.textContent).toContain('+0.15 pp')
    expect(await screen.findByTestId('terminal-sent-econ-none-USUNRATE')).toBeTruthy()
    expect(screen.queryByText('Not on the list')).toBeNull()
  })

  it('a dark economy catalog says it is not switched on; a failed series read offers Retry', async () => {
    serve({ catalog: err(404) })
    renderPanel()
    expect((await screen.findByTestId('terminal-sent-econ-off')).textContent).toContain('not switched on')
    cleanup()
    serve({ series: { UST10Y: err(500) } })
    renderPanel()
    const bad = await screen.findByTestId('terminal-sent-econ-error-UST10Y')
    expect(within(bad).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('pure helpers: one point per survey date, changes need a real earlier reading', () => {
    const spec = SENTIMENT_SERIES.find((s) => s.key === 'aaii_bulls')
    const pts = seriesPoints(ROWS, spec)
    expect(pts.map((p) => p.date)).toEqual(['2026-09-09', '2026-09-30', '2026-10-07'])
    expect(changeSince(pts, 7)).toBeCloseTo(3.2)
    expect(changeSince(pts.slice(-1), 7)).toBeNull()
    expect(fearGreedBand(10)).toBe('Extreme fear')
    expect(fearGreedBand(50)).toBe('Neutral')
    expect(fearGreedBand(90)).toBe('Extreme greed')
    expect(sentimentRows({}).every((r) => r.last === null)).toBe(true)
  })
})

describe('SENT in the registry', () => {
  it('SENT opens the sentiment panel, market-only', async () => {
    expect(BY_CODE.SENT.group).toBe('Market')
    expect(variantFor('SENT', false).variant.panel).toBe('Sentiment')
    expect(BY_CODE.SENT.ticker).toBeUndefined()
    expect(parseCommand('SENT').code).toBe('SENT')
    expect((await PANEL_IMPORTERS.Sentiment()).default).toBe(SentimentPanel)
  })
})
