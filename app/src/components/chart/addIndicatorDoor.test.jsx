// app/src/components/chart/addIndicatorDoor.test.jsx
//
// ─── ONE ADD INDICATOR DOOR ─────────────────────────────────────────────────
//
// ⭐⭐ THE OWNER'S §6-§9, WHICH ARE ONE FEATURE: *"The primary action should be
// + ADD INDICATOR. The user should not have to decide up front: do I need a
// dataSeries? … If they want QQQ: search QQQ, click QQQ — Invesco QQQ Trust.
// UCT creates the correct underlying dataSeries/secondary-symbol representation."*
//
// ⛔ AND NOTHING HERE IS NEW MACHINERY, WHICH IS THE POINT. `discoveryCatalog`
// (the four-catalogue facade), `useSymbolDiscovery` (the same hook the source
// picker uses) and `createFromResult` (the `addInstance` + `setInstanceInput`
// composition) were all built, tested and unreachable from any add surface. What
// this change did was WIRE them, and what these cases hold is the wiring:
//
//   1. no member-facing "Data Series" row anywhere;
//   2. exactly one "Moving Average" in browse, on an ordinary chart AND on one
//      with a tombstoned overlay to revive;
//   3. a ticker is a first-class result and creates the canonical instance.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useState } from 'react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import {
  LIBRARY_HIDDEN_IDS, hiddenLibraryIds, libraryRowFor, createFromResult,
  securityResults, symbolLibraryRow, lastCreatedInstance, DIRECT_SERIES_DEF_ID,
} from './discoveryCatalog'
import * as registry from './engine/nativeRegistry'
import { parseSource } from './engine/sourceRef'
import { BUILT_IN_ROWS } from './indicatorCatalog'

function Host({ initial, seen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { if (seen) seen.cs = next; setCs(next) }}
      onClose={() => {}}
    />
  )
}
const show = (cs, seen) => render(<Host initial={cs} seen={seen} />)
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
const search = (q) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: q } })
const optionNames = () => screen.queryAllByRole('option')
  .map((o) => (o.querySelector('[class*="resName"]')?.textContent || '').trim())

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('⛔⛔ "DATA SERIES" IS NOT A MEMBER CONCEPT (owner §8)', () => {
  it('⭐⭐ the substrate is never offered as a row to add', () => {
    // ⚰️ MEASURED: `ChartSettingsIndicators` filtered `hiddenLibraryIds` over the
    // BUILT-IN rows only, so `dataSeries` — the one definition that list exists to
    // keep out of browse — was offered here as **"Data Series · Plots a numeric
    // source directly"**. That is the workflow §8 rules out: add a Data Series,
    // then figure out how to turn it into QQQ. The library DIALOG had always
    // filtered both lists; this tab was where the substrate leaked.
    show(mergeChartSettings(JSON.stringify({}))); openIndicators()
    search('series')
    expect(optionNames(), 'the Data Series substrate is offered to members again')
      .not.toContain('Data Series')
    expect(screen.queryAllByRole('option').map((o) => o.dataset.defId))
      .not.toContain('dataSeries')
  })

  it('⛔ and the exclusion is the FROZEN LIST, not an inline id', () => {
    // An exclusion has to be a written claim the per-definition sweeps subtract,
    // or a definition silently stops being listed and no gate can see it.
    expect(LIBRARY_HIDDEN_IDS).toContain(DIRECT_SERIES_DEF_ID)
  })
})

describe('⭐⭐ ONE MOVING AVERAGE IN BROWSE (owner §34)', () => {
  it('an ordinary chart offers exactly one', () => {
    show(mergeChartSettings(JSON.stringify({}))); openIndicators()
    search('moving average')
    const names = optionNames().filter((n) => /moving average/i.test(n))
    expect(names, `browse offers ${names.length} Moving Averages: ${names.join(' / ')}`)
      .toEqual(['Moving Average'])
  })

  it('⭐⭐ AND SO DOES A CHART WITH A TOMBSTONED OVERLAY TO REVIVE', () => {
    // ⚰⚰ TWO MEMBER REPORTS PULLED IN OPPOSITE DIRECTIONS HERE, and the resolution
    // is neither of the two obvious ones. `hiddenLibraryIds` reveals the legacy
    // `ma` row when there IS something to revive — which answered *"I removed my
    // moving average and searching for it finds nothing"* by re-creating *"it
    // looks like UCT has two completely different kinds of Moving Average"* on
    // exactly those charts.
    //
    // ⛔ THE CONFLICT WAS ONLY IN THE WORDS. The two rows do different things, so
    // the fix is to stop calling them the same thing: the revive row is named
    // after what it BRINGS BACK.
    const cs = mergeChartSettings(JSON.stringify({ overlays: [{ removed: true }, {}, {}, {}] }))
    expect(hiddenLibraryIds(cs), 'the revive row is not being offered at all')
      .not.toContain('ma')
    show(cs); openIndicators()
    search('moving average')
    const names = optionNames()
    expect(names.filter((n) => n === 'Moving Average'),
      `two rows read "Moving Average": ${names.join(' / ')}`).toHaveLength(1)
    expect(names.some((n) => /^Restore /.test(n)),
      'the revive offer disappeared with the duplicate name').toBe(true)
  })

  it('⛔ AND THE REVIVE ROW STILL REVIVES — §33, the compatibility half', () => {
    // *"Do NOT break removed-overlay revival."* The rename is presentation over an
    // unchanged writer: same id, same `builtIn: 'overlay'`, same `toggledRow`
    // branch, so the member gets back the EMA 9 they configured rather than a
    // fresh default.
    const before = mergeChartSettings(JSON.stringify({
      overlays: [{ type: 'EMA', period: 9, color: '#4ade80', removed: true }, {}, {}, {}],
    }))
    const seen = { cs: null }
    show(before, seen); openIndicators()
    search('moving average')
    const row = screen.queryAllByRole('option').find((o) => o.dataset.defId === 'ma')
    expect(row, 'the revive row is gone').toBeTruthy()
    expect(row.textContent).toMatch(/Restore EMA 9/)
    fireEvent.click(row)
    expect(seen.cs.overlays[0].removed, 'the tombstone was not revived').toBe(false)
    expect(seen.cs.overlays[0].period, 'the member’s own period was replaced').toBe(9)
    expect(seen.cs.overlays[0].color, 'the member’s own colour was replaced').toBe('#4ade80')
    expect(seen.cs.overlays, 'a new slot was appended instead of reviving').toHaveLength(4)
  })

  it('⛔ the renamer touches a COPY — `BUILT_IN_ROWS` is frozen and shared', () => {
    const cs = mergeChartSettings(JSON.stringify({ overlays: [{ removed: true }, {}, {}, {}] }))
    const src = BUILT_IN_ROWS.find((r) => r.id === 'ma')
    const renamed = libraryRowFor(src, cs)
    expect(renamed).not.toBe(src)
    expect(src.name, 'the shared frozen row was mutated').toBe('Moving Average')
    // …and on a chart with nothing to revive it is the row itself, untouched.
    expect(libraryRowFor(src, mergeChartSettings(JSON.stringify({})))).toBe(src)
  })
})

describe('⭐⭐ SEARCH QQQ → ADD QQQ (owner §9)', () => {
  const TICKER_REPLY = {
    ok: true,
    json: () => Promise.resolve({ results: [{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', entity_id: 1 }] }),
  }

  it('⭐⭐ a ticker is a first-class result, headlined by the SYMBOL', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(TICKER_REPLY)))
    show(mergeChartSettings(JSON.stringify({}))); openIndicators()
    search('QQQ')
    return waitFor(() => {
      const row = screen.queryAllByRole('option').find((o) => o.dataset.resultKind === 'security')
      expect(row, 'a ticker search produced no symbol row at all').toBeTruthy()
      // ⭐ THE INVERSION `symbolLibraryRow` DOCUMENTS: for a security the TICKER is
      // the thing and the long name is the gloss — the opposite of an indicator.
      expect((row.querySelector('[class*="resName"]').textContent || '').trim()).toBe('QQQ')
      expect(row.textContent).toMatch(/Invesco QQQ Trust/)
    })
  })

  it('⛔⛔ AND CREATION GOES THROUGH THE FACADE, NOT THROUGH THE ROW', () => {
    // ⚰️ THE TRAP, MEASURED AT THE SEAM. A library ROW's `shortName` is its CHIP
    // (`ETF`, `Breadth`); a RESULT's `shortName` is the series' display NAME.
    // `createFromResult` stamps `display.name` from it, so handing it the row
    // would have labelled a QQQ series **"ETF"** on the chart, in the legend and
    // in the source picker. The two shapes carry different fields on purpose.
    const [res] = securityResults([{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', entity_id: 1 }])
    const row = symbolLibraryRow(res)
    expect(row.shortName, 'the row’s chip stopped being the classification').toBe('ETF')
    expect(res.shortName, 'the result’s short name stopped being the symbol').toBe('QQQ')

    const before = mergeChartSettings(JSON.stringify({}))
    const after = createFromResult(before, res, registry)
    expect(after, 'the create was refused').not.toBe(before)
    const minted = lastCreatedInstance(before, after)
    // ⭐ THE CANONICAL REPRESENTATION, AND NOTHING INVENTED: the `dataSeries`
    // definition pointed at `sym:QQQ:close`. No second symbol engine (§9).
    expect(minted.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(parseSource(minted.inputs.source)).toMatchObject({ kind: 'symbol', symbol: 'QQQ' })
    // ⛔ AND NO DISPLAY NAME IS STORED, because `QQQ` is what the SOURCE already
    // derives — a name identical to the derived one is not a choice.
    expect(minted.display?.name, 'a derived name was frozen onto the instance').toBeUndefined()
  })

  it('⛔ a symbol row NEVER reads "Active" — three QQQ series is legitimate (§32)', () => {
    // `isRowOn` answers per DEFINITION and a symbol row's id is a ticker, so the
    // question is meaningless for it. A row that went inert after the first add
    // would be a door that closes behind the member.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(TICKER_REPLY)))
    const seen = { cs: null }
    show(mergeChartSettings(JSON.stringify({})), seen); openIndicators()
    search('QQQ')
    return waitFor(() => {
      const row = screen.queryAllByRole('option').find((o) => o.dataset.resultKind === 'security')
      expect(row).toBeTruthy()
      fireEvent.click(row)
      expect(seen.cs, 'the click created nothing').toBeTruthy()
      const again = screen.queryAllByRole('option').find((o) => o.dataset.resultKind === 'security')
      expect(again.textContent, 'the symbol row went inert after one add').not.toMatch(/Active/)
    })
  })
})
