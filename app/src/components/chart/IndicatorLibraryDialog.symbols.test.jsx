// app/src/components/chart/IndicatorLibraryDialog.symbols.test.jsx
//
// ─── P2.2 · ADD TO CHART, FOR EVERYTHING ────────────────────────────────────
//
// The member types one box and gets indicators, formulas, securities and breadth
// back. The claims that can actually go wrong are not "does it render":
//
//   • the dialog reads the FACADE and not four systems (§4)
//   • a symbol row ADDS and does not toggle, because duplicates are approved
//   • existing technical adding is byte-for-byte what it was (§3)
//   • capability comes from the real system and nothing is fabricated (§13)
//   • the created instance is the P2.1 one — `dataSeries` + `sym:` — with the
//     catalogue's display name beside it, never inside the source

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import IndicatorLibraryDialog from './IndicatorLibraryDialog'
import { mergeChartSettings } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import { DIRECT_SERIES_DEF_ID } from './discoveryCatalog'
import { clearSecondaryBars, primeSecondaryBars } from './engine/secondaryBars'
import { parseSource, instanceLabel } from './engine/sourceRef'

// ─── the two endpoints, doubled at the NETWORK boundary ─────────────────────
//
// ⛔ NOT AT THE HOOK. Mocking `useSymbolDiscovery` would test this file's idea of
// what the hook returns; mocking `fetch` exercises the debounce, the abort, the
// facade's adapters and the dedup — everything between the endpoint and the row.
const TICKERS = {
  QQQ: [{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', exchange: 'NASDAQ', entity_id: 1 }],
  SPY: [{ ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'etf', exchange: 'NYSE', entity_id: 2 }],
  TWTR: [{ ticker: 'TWTR', name: 'Twitter Inc', type: 'delisted', delisted: true, delisted_date: '2022-10-28' }],
}
const BREADTH_PAYLOAD = {
  symbols: [
    { symbol: 'UCTA50', metric: 'pct_above_50sma', name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'Moving averages' },
    { symbol: 'UCTNH', metric: 'new_highs', name: 'New Highs', group: 'highs_lows', group_label: 'Highs and lows' },
  ],
  groups: [{ id: 'ma', label: 'Moving averages' }],
}

let fetchCalls = []
beforeEach(() => {
  fetchCalls = []
  clearSecondaryBars()
  vi.stubGlobal('fetch', vi.fn((url) => {
    fetchCalls.push(String(url))
    if (String(url).startsWith('/api/breadth-symbols')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(BREADTH_PAYLOAD) })
    }
    const m = /q=([^&]*)/.exec(String(url))
    const q = decodeURIComponent(m ? m[1] : '').toUpperCase()
    const results = TICKERS[q] || []
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results }) })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const base = () => mergeChartSettings(null)

const open = (settings = base()) => {
  const onChange = vi.fn()
  const view = render(
    <IndicatorLibraryDialog
      open onClose={() => {}} settings={settings} onChange={onChange} registry={engineRegistry}
    />,
  )
  return { view, onChange }
}

/** Type, then let the 150 ms debounce and the reply land. */
const search = async (text) => {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } })
  await act(async () => { await new Promise((r) => setTimeout(r, 220)) })
}

const rowFor = (id) => [...screen.queryAllByRole('option')].find((el) => el.dataset.defId === id)

const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && i.deleted !== true)
const ofDef = (cs, defId) => live(cs).filter((i) => i.defId === defId)

// ─── discovery ──────────────────────────────────────────────────────────────

describe('⭐ one box, four kinds', () => {
  it('⭐⭐ searching QQQ surfaces the security, with its long name as the subtitle', async () => {
    open()
    await search('QQQ')
    const row = rowFor('QQQ')
    expect(row, 'QQQ is not discoverable from the library').toBeTruthy()
    expect(row.dataset.kind).toBe('security')
    // The SYMBOL is the headline and the long name is the gloss — the inversion a
    // technical row does not want.
    expect(within(row).getByText('QQQ')).toBeTruthy()
    expect(within(row).getByText('Invesco QQQ Trust')).toBeTruthy()
    expect(within(row).getByText('ETF')).toBeTruthy()
    // …under its own heading, hoisted because the member named an instrument.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings[0]).toBe('Symbols')
  })

  it('⭐⭐ searching a breadth measure surfaces it, from the local cache', async () => {
    open()
    await search('UCTA50')
    const row = rowFor('UCTA50')
    expect(row, 'UCTA50 is not discoverable').toBeTruthy()
    expect(row.dataset.kind).toBe('breadth')
    expect(within(row).getByText('UCTA50')).toBeTruthy()
    expect(within(row).getByText('% of Stocks Above 50-Day MA')).toBeTruthy()
    expect(within(row).getByText('Breadth')).toBeTruthy()
  })

  it('⭐ a plain-language query reaches breadth by NAME, not only by symbol', async () => {
    open()
    await search('New High')
    expect(rowFor('UCTNH'), 'breadth is only findable by its symbol').toBeTruthy()
  })

  it('⭐ technical and formula rows are untouched by any of it', async () => {
    open()
    await search('RSI')
    const row = rowFor('rsi')
    expect(row).toBeTruthy()
    expect(row.dataset.kind).toBe('technical')
    // The long name is still the headline for a technical row.
    expect(within(row).getByText('Relative Strength Index')).toBeTruthy()
  })

  it('⛔ AN EMPTY BOX ASKS FOR NOTHING — no symbol rows, no ticker request', async () => {
    open()
    await act(async () => { await new Promise((r) => setTimeout(r, 220)) })
    expect([...screen.queryAllByRole('option')].some((el) => el.dataset.kind === 'security')).toBe(false)
    expect(fetchCalls.filter((u) => u.includes('/api/ticker-search')),
      'the library asked for symbols before the member typed anything').toEqual([])
  })

  it('⛔ ONE REQUEST PER QUERY, and the earlier one is aborted', async () => {
    open()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Q' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'QQ' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'QQQ' } })
    await act(async () => { await new Promise((r) => setTimeout(r, 260)) })
    const ticker = fetchCalls.filter((u) => u.includes('/api/ticker-search'))
    // ⭐ THE DEBOUNCE IS THE CLAIM: three keystrokes inside 150 ms are one request.
    expect(ticker.length, `three keystrokes produced ${ticker.length} requests`).toBe(1)
    expect(ticker[0]).toContain('q=QQQ')
  })
})

// ─── adding ─────────────────────────────────────────────────────────────────

describe('⭐⭐ clicking a row adds the right thing', () => {
  it('⭐⭐ QQQ creates a dataSeries pointed at sym:QQQ:close, with a display name', async () => {
    const { onChange } = open()
    await search('QQQ')
    fireEvent.click(rowFor('QQQ'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    const made = ofDef(next, DIRECT_SERIES_DEF_ID)
    expect(made, 'clicking QQQ created no series').toHaveLength(1)
    expect(made[0].inputs.source).toBe('sym:QQQ:close')
    expect(parseSource(made[0].inputs.source)).toEqual({ kind: 'symbol', symbol: 'QQQ', field: 'close' })
    // ⭐ THE NAME IS BESIDE THE SOURCE, NEVER INSIDE IT.
    expect(made[0].display).toEqual({ name: 'QQQ' })
    expect(made[0].inputs.source).not.toContain('Invesco')
    // …and that is what the legend and the picker will read.
    expect(instanceLabel(engineRegistry.getDefinition(DIRECT_SERIES_DEF_ID), made[0])).toBe('QQQ')
  })

  it('⭐⭐ UCTA50 takes the IDENTICAL path — only the source differs', async () => {
    const { onChange } = open()
    await search('UCTA50')
    fireEvent.click(rowFor('UCTA50'))
    const made = ofDef(onChange.mock.calls[0][0], DIRECT_SERIES_DEF_ID)
    expect(made[0].defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(made[0].inputs.source).toBe('sym:UCTA50:close')
    expect(made[0].display).toEqual({ name: 'UCTA50' })
  })

  it('⭐ a technical row still goes through the writer it always did', async () => {
    const { onChange } = open()
    await search('ATR')
    fireEvent.click(rowFor('atr'))
    const next = onChange.mock.calls[0][0]
    expect(next.indicatorInstances.some((i) => i && i.defId === 'atr' && i.deleted !== true)).toBe(true)
    // …and NOT through the direct-series path.
    expect(ofDef(next, DIRECT_SERIES_DEF_ID)).toHaveLength(0)
  })

  it('⭐ the dialog stays OPEN after an add', async () => {
    open()
    await search('QQQ')
    fireEvent.click(rowFor('QQQ'))
    expect(screen.getByRole('searchbox'), 'the dialog closed after an add').toBeTruthy()
    expect(rowFor('QQQ'), 'the row vanished after an add').toBeTruthy()
  })
})

// ─── duplicates ─────────────────────────────────────────────────────────────

describe('⭐⭐ adding QQQ twice is allowed, and says so', () => {
  it('a second click adds a SECOND instance rather than removing the first', async () => {
    let cs = base()
    const onChange = vi.fn((next) => { cs = next })
    const { rerender } = render(
      <IndicatorLibraryDialog open onClose={() => {}} settings={cs} onChange={onChange} registry={engineRegistry} />,
    )
    await search('QQQ')
    fireEvent.click(rowFor('QQQ'))
    rerender(<IndicatorLibraryDialog open onClose={() => {}} settings={cs} onChange={onChange} registry={engineRegistry} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    fireEvent.click(rowFor('QQQ'))

    const made = ofDef(cs, DIRECT_SERIES_DEF_ID)
    expect(made, 'the second click removed the first instead of adding').toHaveLength(2)
    expect(made[0].instanceId).not.toBe(made[1].instanceId)
    expect(made[0].inputs.source).toBe(made[1].inputs.source)
  })

  it('⛔ a symbol row shows a COUNT, never a checkmark that implies "no more"', async () => {
    let cs = base()
    const onChange = vi.fn((next) => { cs = next })
    const { rerender } = render(
      <IndicatorLibraryDialog open onClose={() => {}} settings={cs} onChange={onChange} registry={engineRegistry} />,
    )
    await search('QQQ')
    expect(within(rowFor('QQQ')).queryByTestId('added-count'), 'a count before anything was added').toBeNull()

    fireEvent.click(rowFor('QQQ'))
    rerender(<IndicatorLibraryDialog open onClose={() => {}} settings={cs} onChange={onChange} registry={engineRegistry} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(within(rowFor('QQQ')).getByTestId('added-count').textContent).toBe('Added')

    fireEvent.click(rowFor('QQQ'))
    rerender(<IndicatorLibraryDialog open onClose={() => {}} settings={cs} onChange={onChange} registry={engineRegistry} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(within(rowFor('QQQ')).getByTestId('added-count').textContent).toBe('Added 2')
    // ⛔ AND NO "+ Add another" — the row itself is the add, and two controls for
    // one verb is the thing this replaces.
    expect(within(rowFor('QQQ')).queryByText(/Add another/)).toBeNull()
  })
})

// ─── capability ─────────────────────────────────────────────────────────────

describe('⛔⛔ what cannot be charted cannot be added', () => {
  it('a DELISTED symbol is discoverable, marked, and refuses to add', async () => {
    const { onChange } = open()
    await search('TWTR')
    const row = rowFor('TWTR')
    expect(row, 'the result was hidden rather than marked').toBeTruthy()
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(within(row).getByTestId('unavailable').textContent).toContain('delisted')
    fireEvent.click(row)
    expect(onChange, 'an unavailable symbol created an instance').not.toHaveBeenCalled()
  })

  it('⛔ …and a symbol the ROUTE said it cannot serve is the same', async () => {
    // ⚠️ THE RULE, NOT THE SYMBOL. `secondaryBars._read` turns an empty bar list
    // WITH a `note` into UNSUPPORTED — which is how a cash index answers. Priming
    // that payload is the real mechanism; nothing here hard-codes a ticker.
    primeSecondaryBars('SPY', 'D', 400, { bars: [], note: 'history not served for this instrument' })
    const { onChange } = open()
    await search('SPY')
    const row = rowFor('SPY')
    expect(within(row).getByTestId('unavailable').textContent)
      .toContain('history not served for this instrument')
    fireEvent.click(row)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('⭐ CONTROL — the same symbol with bars available adds normally', async () => {
    primeSecondaryBars('SPY', 'D', 400, { bars: [{ t: '2026-01-02', o: 1, h: 1, l: 1, c: 1, v: 1 }] })
    const { onChange } = open()
    await search('SPY')
    expect(within(rowFor('SPY')).queryByTestId('unavailable')).toBeNull()
    fireEvent.click(rowFor('SPY'))
    expect(ofDef(onChange.mock.calls[0][0], DIRECT_SERIES_DEF_ID)).toHaveLength(1)
  })
})
