// app/src/components/chart/discoveryBrowseAdd.test.jsx
//
// ─── BROWSE AND CLICK — THE HALF OF DISCOVERY NOTHING WAS DRIVING ───────────
//
// ⚰️⚰️ THE REGRESSION, AS THE MEMBER MET IT. *"I can browse them and see the
// rows, but clicking either the row or the ＋ Add does nothing."* Technical
// indicators added; Symbols, Indexes and Breadth were dead.
//
// ⛔ AND EVERY EXISTING CASE WENT THROUGH `search(q)`, WHICH IS WHY NONE OF THEM
// SAW IT. With a query, `useSymbolDiscovery` answers and `symbolRows.byKey` is
// populated, so `addRow` finds the RESULT and hands it to `createFromResult`.
// With NO query — a member clicking the `Indexes` tab and reading the list — the
// rows come from `browsed`, `byKey` is empty, and the same handler falls through
// to `addInstance(settings, row.id)`. There is no engine definition called `SPX`,
// so `addInstance` refuses BY IDENTITY, `commit` sees `next === settings` and
// returns false, and the click is a silent no-op.
//
// ⭐ SO THESE CASES NEVER TYPE. They open the one Add door, pick a tab, and click
// a row — which is the gesture the bug report describes and the only gesture the
// suite was not making.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useState } from 'react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { parseSource } from './engine/sourceRef'

// `/api/breadth-symbols` is fetched once per module by `useBreadthSymbols`; the
// Breadth tab browses whatever it holds. Two published rows is enough to click.
const BREADTH_ROWS = [
  { symbol: 'UCTA50', name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'Moving averages' },
  { symbol: 'UCTNH', name: 'New Highs', group: 'nhnl', group_label: 'New highs / lows' },
]

// ⚠️ PARTIAL. `symbolFamily` / `breadthRecord` are named exports the CREATE path
// reads once a breadth row is actually clicked — which nothing reached before the
// fix, so a wholesale mock looked sufficient and was not.
vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    all: () => BREADTH_ROWS,
    rows: BREADTH_ROWS,
    bySymbol: new Map(BREADTH_ROWS.map((r) => [r.symbol, r])),
    loading: false,
    error: null,
  }),
}))

function Host({ initial, seen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { if (seen) { seen.cs = next; seen.writes = (seen.writes || 0) + 1 } setCs(next) }}
      onClose={() => {}}
    />
  )
}

const fresh = () => mergeChartSettings(JSON.stringify({}))
const show = (seen, cs) => render(<Host initial={cs || fresh()} seen={seen} />)
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
const openAdd = () => {
  if (!document.body.querySelector('[data-testid="add-surface"]')) {
    fireEvent.click(screen.getByTestId('add-enter'))
  }
}
/** Pick a discovery TAB — and never type, which is the whole point. */
const pickTab = (key) => {
  const btn = document.body.querySelector(`[role="tab"][data-tab="${key}"]`)
  expect(btn, `no discovery tab keyed ${key}`).toBeTruthy()
  fireEvent.click(btn)
}
const rows = () => screen.queryAllByRole('option')
const rowByKey = (key) => rows().find((o) => o.dataset.resultKey === key)
const rowNames = () => rows().map((o) => (o.querySelector('[class*="resName"]')?.textContent || '').trim())

/** Every live (non-tombstoned) instance on the blob. */
const live = (cs) => (Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : [])
  .filter((i) => i && !i.deleted)
/** The instances whose source names a SYMBOL — the canonical symbol-backed shape. */
const symbolSourcesOf = (cs) => live(cs)
  .map((i) => (i.inputs && i.inputs.source) || null)
  .filter((s) => typeof s === 'string')
  .map((s) => parseSource(s))
  .filter((p) => p && p.kind === 'symbol')

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ TECHNICAL — the control, and it always worked', () => {
  it('browsing Technical and clicking a row creates exactly one instance', async () => {
    const seen = {}
    show(seen); openIndicators(); openAdd(); pickTab('technical')
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const before = live(seen.cs || fresh()).length
    const row = rows().find((o) => o.dataset.defId === 'rsi')
    expect(row, `no RSI row in Technical browse: ${rowNames().slice(0, 8).join(' / ')}`).toBeTruthy()
    fireEvent.click(row)
    await waitFor(() => expect(seen.cs).toBeTruthy())
    expect(live(seen.cs).length).toBe(before + 1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔⛔ THE REGRESSION — browse, click, nothing happened', () => {
  /** One case shape for all three non-technical families. */
  const browseAdds = async (tab, key, what) => {
    const seen = {}
    show(seen); openIndicators(); openAdd(); pickTab(tab)
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const row = rowByKey(key)
    expect(row, `${what}: no row keyed ${key} in ${tab} browse — ${rowNames().slice(0, 10).join(' / ')}`)
      .toBeTruthy()
    fireEvent.click(row)
    await waitFor(() => expect(seen.cs, `${what}: the click wrote NOTHING — silent no-op`).toBeTruthy())
    return seen
  }

  it('INDEX — browsing Indexes and clicking SPX creates a symbol-backed series', async () => {
    const seen = await browseAdds('indexes', 'security:SPX', 'SPX')
    const syms = symbolSourcesOf(seen.cs)
    expect(syms.length, 'no symbol-backed instance was created').toBe(1)
    expect(syms[0].symbol).toBe('SPX')
  })

  it('SYMBOL — browsing Symbols and clicking a popular ticker creates one', async () => {
    const seen = {}
    show(seen); openIndicators(); openAdd(); pickTab('symbols')
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const row = rows().find((o) => String(o.dataset.resultKey || '').startsWith('security:'))
    expect(row, `no security row in Symbols browse — ${rowNames().slice(0, 10).join(' / ')}`).toBeTruthy()
    const ticker = String(row.dataset.resultKey).slice('security:'.length)
    fireEvent.click(row)
    await waitFor(() => expect(seen.cs, 'the click wrote NOTHING — silent no-op').toBeTruthy())
    const syms = symbolSourcesOf(seen.cs)
    expect(syms.length).toBe(1)
    expect(syms[0].symbol).toBe(ticker)
  })

  it('BREADTH — browsing Breadth and clicking a published measure creates one', async () => {
    const seen = await browseAdds('breadth', 'breadth:UCTA50', 'UCTA50')
    const syms = symbolSourcesOf(seen.cs)
    expect(syms.length, 'no breadth-backed instance was created').toBe(1)
    expect(syms[0].symbol).toBe('UCTA50')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔ ONE CLICK, ONE INSTANCE — both doors, no bubbling double-add', () => {
  it('clicking the ROW adds exactly once', async () => {
    const seen = {}
    show(seen); openIndicators(); openAdd(); pickTab('indexes')
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(rowByKey('security:SPX'))
    await waitFor(() => expect(seen.cs).toBeTruthy())
    expect(symbolSourcesOf(seen.cs).length).toBe(1)
    expect(seen.writes, 'one click produced more than one settings write').toBe(1)
  })

  it('clicking the ＋ Add affordance INSIDE the row adds exactly once', async () => {
    // ⭐ IT IS AN `aria-hidden` SPAN, NOT A SECOND BUTTON — the click bubbles to
    // the row's own handler, which is what makes "both doors" one implementation.
    // This case holds that: if anyone ever gives it its own handler, the count
    // goes to two and this reds.
    const seen = {}
    show(seen); openIndicators(); openAdd(); pickTab('indexes')
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const row = rowByKey('security:SPX')
    const plus = row.querySelector('[class*="resAdd"]')
    expect(plus, 'no ＋ Add affordance in the row').toBeTruthy()
    fireEvent.click(plus)
    await waitFor(() => expect(seen.cs).toBeTruthy())
    expect(symbolSourcesOf(seen.cs).length).toBe(1)
    expect(seen.writes, 'the ＋ Add double-added').toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ THEY COEXIST, AND THEY SURVIVE A RELOAD', () => {
  it('QQQ-style symbol + SPX + a breadth measure all land together', async () => {
    const seen = {}
    show(seen); openIndicators(); openAdd()

    pickTab('indexes')
    await waitFor(() => expect(rowByKey('security:SPX')).toBeTruthy())
    fireEvent.click(rowByKey('security:SPX'))
    await waitFor(() => expect(symbolSourcesOf(seen.cs).length).toBe(1))

    openAdd(); pickTab('breadth')
    await waitFor(() => expect(rowByKey('breadth:UCTA50')).toBeTruthy())
    fireEvent.click(rowByKey('breadth:UCTA50'))
    await waitFor(() => expect(symbolSourcesOf(seen.cs).length).toBe(2))

    openAdd(); pickTab('symbols')
    await waitFor(() => expect(rows().some((o) => String(o.dataset.resultKey || '').startsWith('security:'))).toBe(true))
    const sec = rows().find((o) => String(o.dataset.resultKey || '').startsWith('security:'))
    fireEvent.click(sec)
    await waitFor(() => expect(symbolSourcesOf(seen.cs).length).toBe(3))

    const syms = symbolSourcesOf(seen.cs).map((p) => p.symbol)
    expect(syms).toContain('SPX')
    expect(syms).toContain('UCTA50')
    expect(new Set(syms).size, 'two adds collapsed onto one identity').toBe(3)

    // ⭐ RECONSTRUCTION. The blob is what persists; merging it back must keep
    // every one of them, with their sources intact.
    const round = mergeChartSettings(JSON.stringify(seen.cs))
    expect(symbolSourcesOf(round).map((p) => p.symbol).sort()).toEqual(syms.sort())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ WHAT THE MEMBER SEES AFTERWARDS — and what stays hidden', () => {
  const addSpx = async (seen) => {
    show(seen); openIndicators(); openAdd(); pickTab('indexes')
    await waitFor(() => expect(rowByKey('security:SPX')).toBeTruthy())
    fireEvent.click(rowByKey('security:SPX'))
    await waitFor(() => expect(seen.cs).toBeTruthy())
  }

  it('⛔⛔ the left list names it semantically and leaks NO engine identity', async () => {
    const seen = {}
    await addSpx(seen)
    // The whole left structure list, as text.
    const list = document.body.querySelector('[class*="insList"], [class*="insBody"]') || document.body
    const text = list.textContent || ''
    expect(text, 'the substrate surfaced to the member').not.toMatch(/dataSeries/)
    expect(text, 'a raw instance id surfaced to the member').not.toMatch(/inst:/)
    expect(text, 'a raw source ref surfaced to the member').not.toMatch(/sym:/)
    // …and the thing it DID add is addressable by its own row.
    const ids = [...document.body.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId)
    expect(ids.some((i) => /dataSeries/i.test(String(i))), 'the row id is internal — fine — but it must not be shown')
      .toBe(true)
    // ⭐ AND THE NAME IT DOES SHOW IS THE INSTRUMENT. `createDirectSeries` stores
    // NO `display.name` here on purpose — 'SPX' is what the source already derives,
    // so the label stays a function of the source and following a re-point.
    const spxRow = [...document.body.querySelectorAll('[data-row-id^="inst:dataSeries"]')]
      .find((e) => (e.textContent || '').includes('SPX'))
    expect(spxRow, `no left-list row reads SPX — got ${ids.join(', ')}`).toBeTruthy()
  })

  it('⭐ a breadth add keeps the catalogue’s own naming (UCTA50 stays UCTA50)', async () => {
    // ⚠️ NOT A DEFECT AND NOT OURS TO PRETTIFY. `breadthResults` states the rule:
    // a legacy UCT row's SYMBOL is its recognisable name — what a member types and
    // what the axis has shown for a year — so `shortName` stays the symbol and the
    // universe badge is reserved for the namespaced rows that need distinguishing.
    const seen = {}
    show(seen); openIndicators(); openAdd(); pickTab('breadth')
    await waitFor(() => expect(rowByKey('breadth:UCTA50')).toBeTruthy())
    fireEvent.click(rowByKey('breadth:UCTA50'))
    await waitFor(() => expect(seen.cs).toBeTruthy())
    const row = [...document.body.querySelectorAll('[data-row-id^="inst:dataSeries"]')]
      .find((e) => (e.textContent || '').includes('UCTA50'))
    expect(row, 'the breadth series is not named in the left list').toBeTruthy()
    const inst = live(seen.cs).find((i) => (i.inputs && /^sym:UCTA50/.test(String(i.inputs.source))))
    expect(inst.display ?? null, 'a derived name was stored as if it were a choice').toBeNull()
  })

  it('⭐ Display stays AUTOMATIC — the add writes no explicit target', async () => {
    const seen = {}
    await addSpx(seen)
    const inst = live(seen.cs).find((i) => (i.inputs && /^sym:SPX/.test(String(i.inputs.source))))
    expect(inst, 'no SPX instance').toBeTruthy()
    // ⛔ `targetExplicit` is the member's OWN choice of pane. An add must not
    // forge one — that is how an Automatic series stops following its source.
    expect(inst.placement?.targetExplicit ?? false).toBe(false)
  })

  it('⛔ paneOrder and paneSeriesOrder are not written by an add', async () => {
    const before = fresh()
    const seen = {}
    await addSpx(seen)
    expect(seen.cs.paneOrder ?? null).toEqual(before.paneOrder ?? null)
    expect(seen.cs.paneSeriesOrder ?? null).toEqual(before.paneSeriesOrder ?? null)
  })

  it('⭐ delete goes through the canonical writer, and re-adding works after it', async () => {
    const seen = {}
    await addSpx(seen)
    const inst = live(seen.cs).find((i) => (i.inputs && /^sym:SPX/.test(String(i.inputs.source))))
    expect(symbolSourcesOf(seen.cs).length).toBe(1)

    // Select the row, then use its Remove control — the same door the panel offers.
    fireEvent.click(document.body.querySelector(`[data-row-id="${inst.instanceId}"]`))
    const remove = await screen.findByRole('button', { name: /^Remove/i })
    fireEvent.click(remove)
    await waitFor(() => expect(symbolSourcesOf(seen.cs).length).toBe(0))
    // ⚠️ A TOMBSTONE, NOT AN ERASURE — `removeInstance`'s own convention, and the
    // reason `createDirectSeries` reads the minted id back by set difference.
    const tomb = (seen.cs.indicatorInstances || []).find((i) => i && i.instanceId === inst.instanceId)
    expect(tomb?.deleted, 'the instance was spliced out instead of tombstoned').toBe(true)

    // ⭐ AND ADDING IT AGAIN MINTS A **NEW** INSTANCE, not a resurrected corpse.
    openAdd(); pickTab('indexes')
    await waitFor(() => expect(rowByKey('security:SPX')).toBeTruthy())
    fireEvent.click(rowByKey('security:SPX'))
    await waitFor(() => expect(symbolSourcesOf(seen.cs).length).toBe(1))
    const again = live(seen.cs).find((i) => (i.inputs && /^sym:SPX/.test(String(i.inputs.source))))
    expect(again.instanceId, 'the re-add addressed the tombstone').not.toBe(inst.instanceId)
  })

  it('⛔ a symbol row never reads "Active" — it keeps offering (§32)', async () => {
    const seen = {}
    await addSpx(seen)
    openAdd(); pickTab('indexes')
    await waitFor(() => expect(rowByKey('security:SPX')).toBeTruthy())
    const row = rowByKey('security:SPX')
    expect(row.getAttribute('aria-selected')).toBe('false')
    expect(row.textContent).not.toMatch(/Active/)
    expect(row.querySelector('[class*="resAdd"]'), 'the row stopped offering to add').toBeTruthy()
  })
})
