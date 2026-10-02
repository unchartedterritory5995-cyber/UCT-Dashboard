// G-040 ruling 1 — the Screener capture: its embed, its search line, and the
// locked-note refusal, all through the real modules.
//
// ⛔ THE LOAD-BEARING CASE IS "NEVER RE-RUNS". `fetch` is handed a LIVE screener
// answer that disagrees with the capture on every field; the embed must show the
// captured values, none of the live ones, and must not ask at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import ScreenerEmbed, { screenerRunHref } from './ScreenerEmbed'
import { buildWidgetEmbedAttrs, resolveEmbedRender } from '../../lib/widgetEmbedCore'
import { decodeSpec } from '../../../screener/shell/specUrl'
import { sendCaptureToJournal } from '../../lib/sendToJournal'

const CAPTURE = {
  name: 'Screener — UCT Universe',
  criteria: ['UCT Universe', 'Price: ≥ $10', 'RS Rank: ≥ 90'],
  spec: { filters: { price: { op: 'gte', min: 10 } }, sort: { key: 'rs_rank', dir: 'desc' } },
  asOf: '2026-09-30 03:00 ET (nightly build)',
  columns: [{ key: 'ticker', label: 'Ticker' }, { key: 'price', label: 'Price' }, { key: 'rs_rank', label: 'RS' }],
  rows: [
    { ticker: 'NVDA', cells: ['NVDA', '$181.20', '97'] },
    { ticker: 'AMD', cells: ['AMD', '$160.05', '91'] },
  ],
  total: 57,
  coverage: null,
}
const CAPTURED_AT = '2026-09-30T14:42:00.000Z'
const attrsOf = (cap) => buildWidgetEmbedAttrs('screener', cap, { capturedAt: CAPTURED_AT })

// What `/api/screener/scan` would say TODAY — every value different.
const LIVE_ANSWER = {
  total: 999, page: 1, snapshot_date: '2026-10-01',
  rows: [{ ticker: 'LIVEX', price: 1.23, rs_rank: 12 }, { ticker: 'NVDA', price: 999.99, rs_rank: 1 }],
}

let fetchSpy
beforeEach(() => {
  localStorage.clear()
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => LIVE_ANSWER }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

describe('ScreenerEmbed — a frozen snapshot that never re-runs', () => {
  it('renders exactly the captured values, and never asks for the live ones', async () => {
    const attrs = attrsOf(CAPTURE)
    expect(resolveEmbedRender(attrs).kind).toBe('live')            // renders from its payload
    render(<ScreenerEmbed attrs={attrs} height={320} />)
    await settle()

    expect(screen.getByText('Screener — UCT Universe')).toBeInTheDocument()
    expect(screen.getByTestId('screener-embed-total')).toHaveTextContent('57 matches')
    expect(screen.getByTestId('screener-embed-asof'))
      .toHaveTextContent('As of 2026-09-30 03:00 ET (nightly build) · captured Sep 30, 2026, 10:42 AM ET')
    for (const c of CAPTURE.criteria) expect(screen.getByText(c)).toBeInTheDocument()
    expect(screen.getByTestId('screener-embed-row-NVDA')).toHaveTextContent('NVDA$181.2097')
    expect(screen.getByTestId('screener-embed-row-AMD')).toHaveTextContent('AMD$160.0591')
    expect(screen.getByTestId('screener-embed-cut')).toHaveTextContent('Showing the first 2 of 57 matches, as captured.')

    // ⛔ The live answer reached nothing on screen…
    expect(screen.queryByText('LIVEX')).toBeNull()
    expect(screen.queryByText(/999/)).toBeNull()
    expect(screen.queryByText('$999.99')).toBeNull()
    // …because nothing asked for it.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('"Run this scan now" is a NEW run of the captured definition, and says so', async () => {
    render(<ScreenerEmbed attrs={attrsOf(CAPTURE)} />)
    const link = screen.getByTestId('screener-embed-run')
    expect(link).toHaveTextContent('Run this scan now')
    expect(link.closest('p')).toHaveTextContent('a new run on today’s data, not this snapshot')
    const href = link.getAttribute('href')
    expect(href.startsWith('/screener?s=')).toBe(true)
    const decoded = decodeSpec(new URLSearchParams(href.split('?')[1]).get('s'))
    expect(decoded.filters).toEqual(CAPTURE.spec.filters)
    expect(decoded.sort).toEqual(CAPTURE.spec.sort)
    expect(screenerRunHref(null)).toBeNull()
  })

  it('ZERO matches is carried honestly — words, and the Screener’s own coverage receipt', async () => {
    const latest = { evaluated: 2615, answered: 0, dropped: 0, not_computable: 2615 }
    render(<ScreenerEmbed attrs={attrsOf({ ...CAPTURE, rows: [], total: 0, coverage: [{ label: 'Pullback MA', coverage: latest }] })} />)
    expect(screen.getByTestId('screener-embed-total')).toHaveTextContent('0 matches')
    expect(screen.getByTestId('screener-embed-empty')).toHaveTextContent('No stocks matched this screen when it was captured.')
    // CoverageLine's own four counts and its own "gap in what we hold" sentence.
    expect(screen.getByTestId('coverage-line')).toHaveTextContent('2,615 evaluated·0 answered·0 dropped·2,615 not computable')
    expect(screen.getByTestId('coverage-nodata')).toHaveTextContent('that is a gap in what we hold, not a quiet market')
    expect(screen.getByText('Scan filter: Pullback MA')).toBeInTheDocument()
    expect(screen.queryByTestId('screener-embed-cut')).toBeNull()
  })
})

describe('the search line — a captured screen’s tickers are findable', () => {
  it('searchText carries the name, the total and every captured ticker', () => {
    const { searchText } = attrsOf(CAPTURE)
    expect(searchText).toBe('[screener: Screener — UCT Universe — 57 matches · NVDA AMD — as of 2026-09-30 03:00 ET (nightly build)]')
    expect(searchText).toMatch(/\bNVDA\b/)
    expect(searchText).toMatch(/\bAMD\b/)
  })
})

describe('ruling 149 — a locked note refuses the capture, with the doors’ own words', () => {
  it('the toast names the lock and the frozen capture waits in the inbox', async () => {
    localStorage.setItem('uct.jw.lastNote', JSON.stringify({ id: 'nL', ts: Date.now(), title: 'Plan' }))
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body })
      if (String(url) === '/api/j2/notes/nL/embeds') return { ok: false, status: 423, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    const msg = await sendCaptureToJournal('screener', CAPTURE, { label: 'Screener results' })
    expect(msg).toBe('“Plan” is locked — Screener results captured to your inbox until you unlock it')
    const inbox = calls.find((c) => c.url === '/api/j2/inbox')
    const body = JSON.parse(inbox.body)
    expect(body.widgetId).toBe('screener')
    expect(body.params.rows).toEqual(CAPTURE.rows)
    expect(body.params.total).toBe(57)
  })
})
