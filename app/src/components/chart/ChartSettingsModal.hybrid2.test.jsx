// app/src/components/chart/ChartSettingsModal.hybrid2.test.jsx
//
// ─── ADD MODE KEEPS THE CHART IN VIEW ───────────────────────────────────────
//
// ⭐⭐ THE ONE PRODUCT CLAIM THIS FILE EXISTS FOR: *search → add → SEE IT LAND*.
// The surface may compress the pane map while the member is adding, but it may
// never replace it, and the structure must change the instant something arrives.
// Every case below is driven through the REAL door (`+ Add to Chart` → the real
// search box → a real result click) and asserts against `paneMap`'s own answer,
// so a compressed map that started inventing its own structure fails here.
//
// ⛔ AND NOTHING HERE ASSERTS A NAME AS AN IDENTITY. `paneRowMeta.test.js` owns
// the naming rule; this owns the surface.

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource } from './engine/sourceRef'
import { primeSecondaryBars, clearSecondaryBars } from './engine/secondaryBars'
import { addInstance } from './engine/instanceControls'
import { storedPaneOrder } from './engine/paneOrder'

vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: () => 'security' }
})

// ⚠️ SYMBOL DISCOVERY ASKS A SERVER, and jsdom has none — the real hook returns
// an empty list forever here, which would make every QQQ case below vacuous
// rather than failing. The mock stands in for the NETWORK only: it returns the
// same normalized result shape `/api/ticker-search` does, and everything after
// it — `symbolLibraryRow`, `createFromResult`, the canonical `dataSeries` — is
// the real production path.
// ⛔ THE RESULTS ARE BUILT BY THE REAL NORMALIZER, not hand-written. A result
// without its `create` descriptor is REFUSED by `createFromResult` — measured:
// the row rendered, the click did nothing, and every "see it land" case would
// have been quietly vacuous. `securityResults` is the same function the live hook
// feeds its rows through, so only the HTTP round trip is replaced here.
vi.mock('./useSymbolDiscovery', async () => {
  const { securityResults } = await import('./discoveryCatalog')
  const ROWS = [
    { ticker: 'QQQ', name: 'Invesco QQQ Trust' },
    { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  ]
  return {
    default: (query, enabled) => {
      const q = String(query || '').trim().toUpperCase()
      const hits = (enabled && q) ? ROWS.filter((r) => r.ticker.startsWith(q)) : []
      return { results: securityResults(hits, {}), loading: false }
    },
  }
})

function prime(symbol) {
  primeSecondaryBars(symbol, 'D', 400, {
    bars: Array.from({ length: 12 }, (_, i) => ({
      t: `2026-09-${String(i + 1).padStart(2, '0')}`,
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
    })),
  })
}
const withSeries = (cs, sym) => {
  prime(sym)
  return createDirectSeries(cs, symbolSource(sym, 'close'), registry, { name: sym })
}

let lastSettings = null
function Host({ initial }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { lastSettings = next; setCs(next) }}
      onClose={() => {}}
    />
  )
}
const show = (cs) => { lastSettings = null; return render(<Host initial={cs} />) }
const openTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
const base = () => mergeChartSettings({})

/** The one door, pressed. */
const openAddMode = () => fireEvent.click(screen.getByTestId('add-to-chart'))
const searchBox = () => screen.getByRole('searchbox')
const typeSearch = (q) => fireEvent.change(searchBox(), { target: { value: q } })

const miniMap = () => document.body.querySelector('[data-testid="compressed-pane-map"]')
const miniPanes = () => [...(miniMap()?.querySelectorAll('[data-pane-group]') || [])]
  .map((n) => n.getAttribute('data-pane-group'))
const miniNames = () => [...(miniMap()?.querySelectorAll('[class*="cdMiniName"]') || [])]
  .map((n) => n.textContent.trim())
/** Full-canvas groups (add mode is excluded — the mini map lives inside it). */
const fullPanes = () => [...document.body.querySelectorAll('[data-pane-group]')]
  .filter((n) => !n.closest('[data-testid="compressed-pane-map"]'))
  .map((n) => n.getAttribute('data-pane-group'))

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars() })

describe('⭐ THE ONE DOOR', () => {
  it('the resting state offers Add to Chart, not a bare search box', () => {
    show(base()); openTab()
    expect(screen.getByTestId('add-to-chart')).toBeTruthy()
    // The field exists (the door focuses it) but is not the thing on offer.
    expect(searchBox().closest('[class*="indSearchHidden"]')).toBeTruthy()
  })

  it('⭐ pressing it swaps the door for the field, in the same place', () => {
    show(base()); openTab()
    openAddMode()
    expect(screen.queryByTestId('add-to-chart')).toBeNull()
    expect(searchBox().closest('[class*="indSearchHidden"]')).toBeNull()
  })

  it('and the field says it finds more than indicators', () => {
    show(base()); openTab(); openAddMode()
    expect(searchBox().getAttribute('placeholder')).toMatch(/symbols/i)
  })
})

describe('⭐⭐ ADD MODE COMPRESSES THE MAP — it never replaces it', () => {
  it('⛔ the compressed map is the SAME panes, in the SAME order', () => {
    let cs = base()
    cs = withSeries(cs, 'QQQ')
    cs = addInstance(cs, 'rsi', registry)
    show(cs); openTab()

    const before = fullPanes()
    expect(before.length, 'the full canvas drew no panes').toBeGreaterThan(1)

    openAddMode()
    expect(miniMap(), 'add mode dropped the chart context entirely').toBeTruthy()
    expect(miniPanes(), 'the compressed map invented its own structure').toEqual(before)
  })

  it('⛔ and it is CONTEXT, not a second editor — no controls inside it', () => {
    let cs = withSeries(base(), 'QQQ')
    show(cs); openTab(); openAddMode()
    const mini = miniMap()
    expect(mini.querySelectorAll('button').length, 'the compressed map grew controls').toBe(0)
    expect(mini.querySelector('select'), 'a destination menu reached the compressed map').toBeNull()
    expect(mini.querySelector('[role="switch"]'), 'a visibility toggle reached it').toBeNull()
  })

  it('⛔ leaving add mode brings the full canvas back', () => {
    show(base()); openTab(); openAddMode()
    expect(miniMap()).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Back to active indicators'))
    expect(miniMap()).toBeNull()
    expect(fullPanes().length).toBeGreaterThan(0)
  })
})

describe('⭐⭐ SEARCH → ADD → SEE IT LAND', () => {
  it('⭐⭐ adding QQQ makes a QQQ band appear in the compressed map', async () => {
    prime('QQQ')
    show(base()); openTab(); openAddMode()
    expect(miniNames()).not.toContain('QQQ')

    typeSearch('QQQ')
    const hit = await screen.findByText('QQQ', { selector: '[class*="resName"]' })
    fireEvent.click(hit.closest('li') || hit)

    // ⭐ THE STRUCTURE IS THE CONFIRMATION — the member stays in add mode and
    // watches the map gain a line.
    expect(miniMap(), 'add mode closed instead of showing the landing').toBeTruthy()
    expect(miniNames(), 'QQQ was added but the context did not say so').toContain('QQQ')
  })

  it('⭐⭐ and adding RSI makes an RSI band appear', async () => {
    show(base()); openTab(); openAddMode()
    typeSearch('Relative Strength Index')
    const hit = await screen.findByText(/Relative Strength Index/, { selector: '[class*="resName"]' })
    fireEvent.click(hit.closest('li') || hit)

    expect(miniMap()).toBeTruthy()
    expect(miniNames().some((n) => /RSI/i.test(n)), `panes were ${JSON.stringify(miniNames())}`).toBe(true)
  })

  it('⛔ the landing is marked, and it is marked on the pane that arrived', async () => {
    prime('QQQ')
    show(base()); openTab(); openAddMode()
    typeSearch('QQQ')
    const hit = await screen.findByText('QQQ', { selector: '[class*="resName"]' })
    fireEvent.click(hit.closest('li') || hit)

    const lit = [...miniMap().querySelectorAll('[class*="cdLanded"]')]
    expect(lit.length, 'nothing was highlighted when something landed').toBe(1)
    expect(within(lit[0]).getByText('QQQ')).toBeTruthy()
  })
})

describe('⛔ DIRECT SYMBOL DISCOVERY — the substrate never surfaces', () => {
  it('searching QQQ offers QQQ and says nothing about a data series', async () => {
    prime('QQQ')
    show(base()); openTab(); openAddMode()
    typeSearch('QQQ')
    await screen.findByText('QQQ', { selector: '[class*="resName"]' })
    const text = document.body.textContent
    expect(text).not.toMatch(/Data Series/i)
    expect(text).not.toMatch(/dataSeries/)
    expect(text).not.toMatch(/@inst:/)
  })

  it('⛔ and neither does the map once it has been added', async () => {
    prime('QQQ')
    show(base()); openTab(); openAddMode()
    typeSearch('QQQ')
    const hit = await screen.findByText('QQQ', { selector: '[class*="resName"]' })
    fireEvent.click(hit.closest('li') || hit)
    fireEvent.click(screen.getByLabelText('Back to active indicators'))
    const text = document.body.textContent
    expect(text).not.toMatch(/Data Series|dataSeries|@inst:|sym:/)
  })
})

describe('⭐ THE MAP ITSELF', () => {
  it('⛔ Source and Display are one heading for the whole map, not one per band', () => {
    let cs = withSeries(base(), 'QQQ')
    show(cs); openTab()
    const heads = [...document.body.querySelectorAll('[class*="cdColBar"]')]
    expect(heads.length, 'the column headings were repeated per pane').toBe(1)
  })

  it('⭐ every row carries a Source and a Display', () => {
    show(base()); openTab()
    const rows = [...document.body.querySelectorAll('[data-row-id]')]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.querySelector('[class*="actColSrc"]'), `${r.getAttribute('data-row-id')} had no Source`).toBeTruthy()
      expect(r.querySelector('[class*="actColDisp"]'), `${r.getAttribute('data-row-id')} had no Display`).toBeTruthy()
    }
  })

  it('⛔ the ▲/▼ pair is present at rest — never opacity:0 until hover', () => {
    let cs = withSeries(base(), 'QQQ')
    show(cs); openTab()
    const up = screen.getAllByLabelText(/Move .* pane up/)
    const down = screen.getAllByLabelText(/Move .* pane down/)
    expect(up.length).toBeGreaterThan(0)
    expect(down.length).toBe(up.length)
    // Present in the DOM AND not hidden from the accessibility tree.
    for (const b of [...up, ...down]) expect(b.getAttribute('aria-hidden')).not.toBe('true')
  })

  it('⭐⭐ ▼ moves a whole PANE through the canonical order writer', () => {
    let cs = withSeries(base(), 'QQQ')
    show(cs); openTab()
    const before = fullPanes()
    fireEvent.click(screen.getAllByLabelText(/Move .* pane down/)[0])
    expect(lastSettings, 'the arrow wrote nothing').toBeTruthy()
    // ⛔ THE CANONICAL KEY LIST, not a bespoke array on the side.
    const stored = storedPaneOrder(lastSettings)
    expect(Array.isArray(stored), 'pane order was not written where the chart reads it').toBe(true)
    expect(fullPanes(), 'the map did not follow the write').not.toEqual(before)
  })

  it('⛔ Price can move and cannot be removed', () => {
    let cs = withSeries(base(), 'QQQ')
    show(cs); openTab()
    // It is offered a move control…
    expect(screen.getAllByLabelText(/Move Price pane (up|down)/).length).toBeGreaterThan(0)
    // …and the group itself carries no removal affordance.
    const price = [...document.body.querySelectorAll('[data-pane-group="price"]')]
      .find((n) => !n.closest('[data-testid="compressed-pane-map"]'))
    expect(price).toBeTruthy()
    const head = price.querySelector('[class*="cdGroupHead"]')
    expect(within(head).queryByLabelText(/Remove Price/i)).toBeNull()
  })
})

describe('⛔ NOTHING THE ENGINE SAYS TO ITSELF REACHES A MEMBER', () => {
  it('no raw ref, target or instance id is rendered as text', () => {
    let cs = withSeries(base(), 'QQQ')
    cs = addInstance(cs, 'rsi', registry)
    show(cs); openTab()
    const text = document.body.textContent
    expect(text).not.toMatch(/@inst:|inst:dataSeries|sym:QQQ|targetExplicit/)
  })
})
