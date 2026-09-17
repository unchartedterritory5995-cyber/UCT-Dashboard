// app/src/components/chart/ChartSettingsModal.inspector.test.jsx
//
// ─── THE UCT INDICATOR INSPECTOR ────────────────────────────────────────────
//
// LEFT = WHAT IS ON MY CHART.  RIGHT = EDIT THE THING I SELECTED.
//
// ⭐⭐ WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY IS NOT. The claims that
// already had a home kept it: `chartData.test.jsx` owns the pane map and the
// two columns, `rowSummary.test.jsx` owns what a row says, `displayIn.test.jsx`
// owns placement and provenance, `indicators.test.jsx` owns the add/remove/hide
// doors. This file holds the ones the Inspector INTRODUCED and nothing else
// asserts:
//
//   · ADD lands, and the thing that landed is what the Inspector is showing;
//   · ARRANGE is a MODE — a pane moves, its guests travel, nothing else writes;
//   · the NARROW layout is one state rendered two ways, with a way back;
//   · no engine vocabulary reaches the member on any of the three surfaces.
//
// ⛔ IT DRIVES THE REAL MODAL, NEVER THE COMPONENT'S STATE. Every gesture below
// is one a member makes, so a case cannot pass over a door that is broken.

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource } from './engine/sourceRef'
import { clearSecondaryBars, primeSecondaryBars } from './engine/secondaryBars'
import {
  addInstance, findInstance, setInstanceInput, setInstanceDisplayTarget,
} from './engine/instanceControls'
import { storedPaneOrder, resolvePaneOrder, PRICE_PANE } from './engine/paneOrder'

// ⚠️ THE BREADTH REGISTRY IS A NETWORK FACT, so the family oracle is stubbed —
// otherwise `symbolFamily` answers `'unknown'` and the Inspector's KIND line is
// (correctly) silent, which would make the header cases pass for no reason.
vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: (sym) => (sym === 'UCTA50' ? 'breadth' : 'security') }
})

const TF = 'D'
const WINDOW = 400
const secBar = (t, base) => ({ t, o: base, h: base + 2, l: base - 1.5, c: base + 0.5, v: 1000 })
function prime(symbol) {
  primeSecondaryBars(symbol, TF, WINDOW, {
    bars: Array.from({ length: 12 }, (_, i) =>
      secBar(`2026-09-${String(i + 1).padStart(2, '0')}`, 100 + i)),
  })
}
function withSeries(cs, symbol) {
  prime(symbol)
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}
function withMA(cs, source) {
  const added = addInstance(cs, 'movingAverage', registry)
  const id = lastCreatedInstance(cs, added).instanceId
  return { cs: setInstanceInput(added, id, 'source', source, registry), id }
}

/** ⚠️ STATEFUL: the modal is CONTROLLED, so a write is only visible once the new
 *  settings come back in. A no-op handler makes every live case here vacuous. */
function Host({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { if (onSeen) onSeen(next); setCs(next) }}
      onClose={() => {}}
    />
  )
}
/** ⚠️ THE SINK IS A CALLBACK, NOT THE `seen` OBJECT ITSELF. Writing through a
 *  PROP inside the component trips the lint rule that guards against mutating
 *  props; handing the host a function and letting the CALLER's closure hold the
 *  object is the same recording with none of that. */
const show = (cs, seen) => render(
  <Host initial={cs} onSeen={seen ? (next) => { seen.cs = next } : undefined} />,
)
const openTab = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))

const rows = () => [...document.body.querySelectorAll('[data-structure-row]')]
const nameOf = (r) => (r.querySelector('[class*="insRowName"]')?.textContent || '').trim()
const names = () => rows().map(nameOf)
const rowFor = (re) => rows().find((r) => re.test(nameOf(r)))
const select = (re) => fireEvent.click(rowFor(re))
const inspector = () => document.body.querySelector('[data-inspector-for]')
const inspectorName = () => (inspector()?.querySelector('[class*="insHeadName"]')?.textContent || '').trim()
const inspectorKind = () => (inspector()?.querySelector('[class*="insHeadKind"]')?.textContent || '').trim()
const paneOf = (re) => {
  const g = rowFor(re)?.closest('[data-pane-group]')
  return (g?.querySelector('[class*="insGroupHead"]')?.textContent || '').trim()
}
const paneIds = () => [...document.body.querySelectorAll('[data-pane-group]')]
  .filter((g) => ['price', 'volume', 'pane'].includes(g.getAttribute('data-pane-kind')))
  .map((g) => g.getAttribute('data-pane-group'))

const base = () => mergeChartSettings({})

/** The engine MA, whose semantic name is `SMA 5`.
 *  ⚠️ IT STOPS AT THE SEPARATOR RATHER THAN BEING A BARE PREFIX. Every default
 *  chart already carries `SMA 50` and `SMA 200`, so a bare `/^SMA 5/` matches a
 *  PRICE OVERLAY and the case reads as a placement bug that is not there —
 *  measured, twice: here and in `displayIn.test.jsx`. */
const ENGINE_MA = /^SMA 5(?:$| ·)/

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars(); vi.unstubAllGlobals() })

// ════════════════════════════════════════════════════════════════════════════
describe('THE INSPECTOR HEADER — what this is, and whether it is drawing', () => {
  it('⭐⭐ it names the INSTANCE and, where it helps, the KIND', () => {
    const { cs } = withSeries(base(), 'QQQ')
    show(cs); openTab(); select(/^QQQ$/)
    expect(inspectorName()).toBe('QQQ')
    // ⛔⛔ AND NOT "Data Series". `dataSeries` is the SUBSTRATE — owner §8 rules
    // out a member ever having to know it exists — so a definition declaring
    // `meta.labelFrom: 'source'` is named by what it was pointed at, and its KIND
    // comes from the source's own provider family rather than from `meta.name`.
    expect(inspectorKind()).not.toMatch(/Data Series/i)
    expect(inspectorKind()).toBe('Market data')
  })

  it('⛔ …and an ORDINARY definition IS its catalogue noun, so it says it once', () => {
    // The gate is `meta.labelFrom`, not a definition id — RSI is unaffected by the
    // `dataSeries` rule and keeps its catalogue name.
    // ⛔ WHICH IS EXACTLY WHY IT GETS NO SECOND LINE. The row's NAME already IS
    // `Relative Strength Index`; printing the kind beneath it would be the same
    // words twice, four pixels apart. The suppression is DERIVED from the two
    // strings agreeing, not from a list of definitions that skip it.
    show(addInstance(base(), 'rsi', registry)); openTab()
    select(/Relative Strength/)
    expect(inspectorName()).toBe('Relative Strength Index')
    expect(inspector().querySelector('[class*="insHeadKind"]'),
      'the kind line repeated the name').toBeNull()
  })

  it('⛔ AND SAYS NOTHING WHEN THE SECOND LINE WOULD REPEAT THE FIRST', () => {
    // `Volume` over `Volume` is furniture. The line is absent, not blank.
    show(base()); openTab(); select(/^Volume$/)
    expect(inspectorName()).toBe('Volume')
    expect(inspector().querySelector('[class*="insHeadKind"]'),
      'the kind line repeated the name').toBeNull()
  })

  it('⭐ the ON/OFF pill is the row\'s visibility, and it HIDES rather than deletes', () => {
    const seen = { cs: null }
    const inst = addInstance(base(), 'rsi', registry)
    const id = lastCreatedInstance(base(), inst).instanceId
    show(inst, seen); openTab(); select(/Relative Strength/)

    const pill = inspector().querySelector('[role="switch"]')
    expect(pill.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(pill)

    const after = findInstance(seen.cs, id)
    expect(after.hidden, 'the pill did not hide the line').toBe(true)
    expect(after.deleted, 'the pill deleted it — off must not mean gone').toBeFalsy()
    // …and the row is still in the list, so the member can turn it back on.
    expect(names().some((n) => /Relative Strength/.test(n)),
      'hiding a series removed its row').toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
describe('ONE MEMBER-FACING MOVING AVERAGE, over two persistence implementations', () => {
  // ⚰️⚰️ THE SPLIT THIS CLOSES, MEASURED IN THE BROWSER ON THE RELEASED BUILD.
  // A moving average reaches this panel two ways and they showed two editors:
  //
  //   legacy `cs.overlays[n]`   CORE: Average type, Period, Offset
  //   engine `movingAverage`    CORE: Source, Period, Type, Display
  //
  // Same concept, different storage, and the member was shown the difference —
  // including two vocabularies for one control (`Exponential` vs `EMA`). The
  // locked product rule is MOVING AVERAGE = ONE USER-FACING CONCEPT.
  //
  // ⛔⛔ AND IT IS CLOSED WITHOUT A MIGRATION. No overlay becomes an instance, no
  // schema changes, no stored value is rewritten or reinterpreted; the rails at
  // the end of this block pin exactly that. What changed is the READ: an inert
  // field is never CORE, the four CORE controls have one order, and the two facts
  // a legacy overlay cannot be asked are stated instead of omitted.

  /** The Inspector's CORE block, as a member reads it: label = value. */
  const coreOf = () => {
    const sec = inspector().querySelector('[data-section="core"]')
    return [...sec.querySelectorAll('[data-field]')].map((f) => {
      const label = f.querySelector('[class*="insFieldLabel"]').textContent.trim()
      const sel = f.querySelector('select')
      const num = f.querySelector('input[type="number"]')
      const ro = f.querySelector('[class*="insFieldValue"]')
      const value = sel ? [...sel.options].find((o) => o.value === sel.value)?.textContent
        : num ? num.value : ro ? ro.textContent.trim() : '?'
      return `${label} = ${value}`
    })
  }
  const labelsOf = (section) => [...inspector()
    .querySelector(`[data-section="${section}"]`).querySelectorAll('[data-field]')]
    .map((f) => f.querySelector('[class*="insFieldLabel"]').textContent.trim())

  it('⭐⭐ LEGACY AND ENGINE MOVING AVERAGES SHOW THE SAME CORE, in the same order', () => {
    // A default chart carries four legacy overlays; this adds an engine MA beside
    // them. The two implementations are then read from one screen.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()

    select(/^EMA 9$/)
    expect(coreOf()).toEqual(['Source = Close', 'Period = 9', 'Type = EMA', 'Display = Price'])

    select(/^SMA 50$/)
    expect(coreOf()).toEqual(['Source = Close', 'Period = 50', 'Type = SMA', 'Display = Price'])

    select(ENGINE_MA)
    // ⛔ THE ENGINE MA'S VALUES DIFFER — it really is sourced and placed
    // differently. The SHAPE is what must not.
    expect(coreOf().map((r) => r.split(' = ')[0]))
      .toEqual(['Source', 'Period', 'Type', 'Display'])
  })

  it('⭐ ONE VOCABULARY FOR THE TYPE — never `Exponential` beside `EMA`', () => {
    // ⚰️ `MA_TYPES` labelled its values `Simple` / `Exponential` while the engine
    // definition labelled the same two `SMA` / `EMA`. The trading words win: they
    // are already what the ROW is called, on the chart and in the legend.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    for (const [row, want] of [[/^EMA 9$/, 'EMA'], [/^SMA 50$/, 'SMA'], [ENGINE_MA, 'SMA']]) {
      select(row)
      const sel = inspector().querySelector('[data-field="type"] select, [data-field="maType"] select')
      expect([...sel.options].find((o) => o.value === sel.value).textContent,
        `${row} speaks a different vocabulary`).toBe(want)
      // ⛔ AND NO OPTION ANYWHERE SAYS THE OLD WORDS.
      expect([...sel.options].map((o) => o.textContent).join('|')).not.toMatch(/Simple|Exponential/)
    }
  })

  it('⛔⛔ THE LEGACY PERIOD STILL WRITES ITS OWN SLOT, and nothing else moves', () => {
    // The normalisation is a READ. The writer under `Period` is the one it always
    // was — `applyRowPatch` → `patchFor` → `cs.overlays[index]` — and the proof is
    // that the OTHER overlays come back byte-identical.
    const seen = { cs: null }
    show(base(), seen); openTab()
    select(/^EMA 9$/)
    const before = JSON.parse(JSON.stringify(base().overlays))
    fireEvent.change(inspector().querySelector('[data-field="period"] input'), { target: { value: '12' } })

    const after = seen.cs.overlays
    expect(after[0].period, 'the period did not reach the overlay slot').toBe(12)
    expect(after[0].type, 'the write disturbed the type').toBe(before[0].type)
    for (let i = 1; i < before.length; i += 1) {
      expect(after[i], `overlay slot ${i} moved`).toEqual(before[i])
    }
    // ⛔ AND NO INSTANCE WAS MINTED. A legacy MA stays legacy.
    expect((seen.cs.indicatorInstances || []).some((x) => x.defId === 'movingAverage'),
      'editing a legacy overlay created an engine instance — that is a migration').toBe(false)
  })

  it('⛔⛔ THE LEGACY SOURCE AND DISPLAY ARE STATED, NOT FAKED', () => {
    // ⚰️ THEY WERE SIMPLY ABSENT, which is why the two editors looked unrelated.
    // `cs.overlays` has no source and no placement: the renderer averages the
    // CLOSE and draws on the PRICE pane, and neither is writable without renderer
    // and persistence work this pass does not do.
    //
    // ⛔ SO THEY ARE VALUES, NOT DISABLED CONTROLS. A greyed dropdown claims there
    // are other choices being withheld; there are none. And they are DERIVED —
    // the source from `paneRowMeta` (which has declared `Close` for an overlay
    // since the read model was written) and the destination from the pane group
    // `chartDataMap` actually filed the row under — so neither can go stale.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    select(/^EMA 9$/)

    for (const key of ['__source__', '__where__']) {
      const f = inspector().querySelector(`[data-field="${key}"]`)
      expect(f, `${key} is missing from the legacy MA`).toBeTruthy()
      expect(f.getAttribute('data-readonly')).toBe('true')
      expect(f.querySelector('select'), 'a read-only fact rendered as a select').toBeNull()
      expect(f.querySelector('[class*="insFieldValue"]').getAttribute('aria-readonly')).toBe('true')
      expect(f.getAttribute('title'), 'the value carries no reason').toBeTruthy()
    }
    // ⛔ AND THE ENGINE MA GETS NEITHER — it has real controls for both.
    select(ENGINE_MA)
    expect(inspector().querySelector('[data-field="__source__"]'),
      'the engine MA grew a read-only stand-in beside its real Source control').toBeNull()
  })

  it('⛔ AN INERT FIELD IS NEVER CORE — it is demoted, not deleted', () => {
    // ⚰️ `offset` and `plotStyle` are declared with `disabled: NOT_WIRED`: they are
    // placeholders for capabilities the legacy renderer does not have. `offset`
    // sat in the MIDDLE of CORE, so EMA 9's primary block read `Type / Period /
    // Offset` against the engine MA's `Source / Period / Type / Display`.
    //
    // ⛔ STILL RENDERED, STILL DISABLED, STILL CARRYING ITS REASON. Deleting a
    // control because it looks inconsistent is a functional change made for a
    // visual reason; the owner asked for an audit, not a cull.
    show(base()); openTab()
    select(/^EMA 9$/)
    expect(labelsOf('core'), 'an inert field is in CORE').not.toContain('Offset')

    const look = labelsOf('appearance')
    expect(look, 'Offset was deleted rather than demoted').toContain('Offset')
    // …and the inert ones sort to the END, after everything that works.
    expect(look.indexOf('Offset')).toBeGreaterThan(look.indexOf('Line width'))
    const offset = inspector().querySelector('[data-field="offset"] input')
    expect(offset.disabled, 'a demoted field quietly became live').toBe(true)
    expect(offset.getAttribute('aria-disabled')).toBe('true')
  })

  it('⭐ LEGACY-ONLY APPEARANCE SURVIVES, and still writes', () => {
    // `Line style`, `Line width` and `Overlap candles` are real capabilities the
    // engine MA does not have. Normalising CORE must not cost them.
    const seen = { cs: null }
    show(base(), seen); openTab()
    select(/^EMA 9$/)
    expect(labelsOf('appearance')).toEqual(expect.arrayContaining(
      ['Color', 'Overlap candles', 'Line style', 'Line width']))

    fireEvent.change(inspector().querySelector('[data-field="lineWidth"] select'), { target: { value: '3' } })
    expect(seen.cs.overlays[0].lineWidth, 'the line width did not reach the slot').toBe(3)
  })

  it('⭐ DUPLICATE AND REMOVE STILL TARGET THE EXACT OBJECT, on both sides', () => {
    const seen = { cs: null }
    const { cs } = withMA(base(), 'close')
    show(cs, seen); openTab()

    // Removing the SECOND legacy overlay must tombstone slot 1 and move nothing.
    select(/^EMA 20$/)
    fireEvent.click([...inspector().querySelectorAll('button')]
      .find((b) => /^Remove /.test(b.getAttribute('aria-label') || '')))
    expect(seen.cs.overlays[1].removed, 'the wrong slot was tombstoned').toBe(true)
    expect(seen.cs.overlays[0].removed, 'a neighbour was tombstoned').toBeFalsy()
    expect(seen.cs.overlays.length, 'the array was spliced — that renumbers every later slot')
      .toBe(cs.overlays.length)
  })

  it('⛔⛔ AND NOTHING ABOUT ANY OF THIS PERSISTS DIFFERENTLY', () => {
    // The whole normalisation is presentation. Mounting the panel — selecting each
    // moving average in turn, legacy and engine — must write nothing at all.
    const seen = { cs: null }
    const { cs } = withMA(base(), 'close')
    const before = JSON.stringify(cs)
    show(cs, seen); openTab()
    for (const re of [/^EMA 9$/, /^EMA 20$/, /^SMA 50$/, /^SMA 200$/, ENGINE_MA]) select(re)
    expect(seen.cs, 'merely reading the Inspector wrote to the blob').toBeNull()
    expect(JSON.stringify(cs), 'the settings object was mutated in place').toBe(before)
  })
})

describe('SEARCH → ADD → SEE IT LAND', () => {
  const TICKER_REPLY = {
    ok: true,
    json: () => Promise.resolve({ results: [{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf' }] }),
  }
  const openAdd = () => fireEvent.click(screen.getByTestId('add-enter'))

  it('⭐⭐ THE STRUCTURE NEVER LEAVES THE SCREEN WHILE A MEMBER SEARCHES', () => {
    // ⭐ THE ONE LESSON HYBRID 2 EARNED AND THIS DESIGN KEEPS. Hybrid 2 had to
    // draw a COMPRESSED PANE MAP beside its results so a member could see where a
    // thing would land; the real, full, ordinary structure list is already there,
    // so there is nothing to compress and nothing to keep in step with the real
    // one.
    show(base()); openTab()
    const before = names()
    openAdd()
    expect(screen.getByTestId('add-surface')).toBeTruthy()
    expect(names(), 'the structure list disappeared into the Add surface').toEqual(before)
  })

  it('⭐⭐ QQQ IS A FIRST-CLASS RESULT — searched, clicked, and it LANDS', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(TICKER_REPLY)))
    const seen = { cs: null }
    show(base(), seen); openTab()
    expect(names().some((n) => /QQQ/.test(n)), 'precondition: no QQQ yet').toBe(false)

    openAdd()
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'QQQ' } })

    const hit = await waitFor(() => {
      const r = within(screen.getByTestId('add-surface')).queryAllByRole('option')
        .find((o) => o.dataset.resultKind === 'security')
      expect(r, 'the ticker never arrived as a result').toBeTruthy()
      return r
    })
    fireEvent.click(hit)

    // ⛔⛔ IT WENT THROUGH THE CANONICAL WRITER. `createFromResult` composes
    // `addInstance` + `setInstanceInput`; a second creation path would mint a
    // different identity and the series would draw in a pane nothing allocated.
    const created = (seen.cs.indicatorInstances || []).find((i) => i.defId === 'dataSeries');
    expect(created, 'the click created no instance').toBeTruthy()
    expect(created.inputs.source).toBe('sym:QQQ:close')

    // …and it LANDED where a member can see it.
    expect(names().some((n) => /^QQQ$/.test(n)), 'QQQ is not in the structure list').toBe(true)
  })

  it('⭐⭐ …AND THE NEW SERIES IS SELECTED, with the Add surface out of the way', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(TICKER_REPLY)))
    show(base()); openTab(); openAdd()
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'QQQ' } })
    const hit = await waitFor(() => {
      const r = within(screen.getByTestId('add-surface')).queryAllByRole('option')
        .find((o) => o.dataset.resultKind === 'security')
      expect(r).toBeTruthy()
      return r
    })
    fireEvent.click(hit)

    expect(document.body.querySelector('[data-testid="add-surface"]'),
      'the Add surface stayed open over the thing that just landed').toBeFalsy()
    expect(inspectorName(), 'the new series is not the one being edited').toBe('QQQ')
    expect(rowFor(/^QQQ$/).getAttribute('aria-selected')).toBe('true')
    // ⭐ AND IT IS MARKED, BRIEFLY, IN THE LIST — a landing mark, not a toast.
    expect(rowFor(/^QQQ$/).getAttribute('data-landed')).toBe('true')
  })

  it('⭐⭐ A DEFINITION LANDS THE SAME WAY — one door, four identities underneath', () => {
    // ⛔ THE MEMBER DOES NOT CARE WHICH WRITER RAN. `createFromResult` for a
    // symbol, `addInstance` for a definition, `toggledRow` for a built-in overlay
    // — the landing is diffed from the ROW IDS, so all of them land identically
    // and none of them needs this surface to know which it was.
    show(base()); openTab(); openAdd()
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'Relative Strength' } })
    fireEvent.click(within(screen.getByTestId('add-surface'))
      .getByRole('option', { name: /Relative Strength Index/ }))

    expect(document.body.querySelector('[data-testid="add-surface"]')).toBeFalsy()
    expect(inspectorName()).toMatch(/Relative Strength Index/)
    expect(paneOf(/Relative Strength/), 'RSI did not land in a pane of its own')
      .toMatch(/RSI/)
  })

  it('⭐⭐ THE SYMBOLS REGION IS DECLARED WHILE THE NETWORK IS STILL ANSWERING', () => {
    // ⚰️⚰️ DISCOVERY ANSWERS FROM TWO SOURCES AND ONLY ONE IS REMOTE. The
    // catalogue and the breadth library are local and resolve on the keystroke;
    // the ticker search is a round trip. So the list renders once without symbols
    // and again with them, and until it does there is nothing on screen to say a
    // second answer is coming — a query with no local match simply reads as
    // "nothing found" for as long as the network takes.
    //
    // ⛔ GATED ON THE **GROUP**, NOT ON `symbolRows.rows.length`. Local BREADTH
    // hits make that array non-empty immediately for a query like `MA` (which
    // substring-matches `% Above 50 EMA`), so a length check suppressed the notice
    // on exactly the queries that needed it. Measured in the browser: absent for
    // `MA`, `RSI` and `EMA`; present only where there was no breadth hit at all.
    let resolve
    const fetchSpy = vi.fn(() => new Promise((r) => { resolve = r }))
    vi.stubGlobal('fetch', fetchSpy)

    show(base()); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'QQQ' } })

    const pending = screen.getByTestId('symbols-pending')
    expect(pending, 'nothing says the symbol search is still running').toBeTruthy()
    expect(pending.textContent).toMatch(/Searching symbols/i)
    // ⛔ ONE LINE, NOT A RESERVED BLOCK. It must not pretend to know how many
    // tickers are coming — reserving a twenty-row group's height for results that
    // may never arrive was measured and rejected.
    expect(within(pending).queryAllByRole('option'), 'the notice reserved result rows').toHaveLength(0)
    void resolve
  })

  it('⛔ …AND IT STANDS DOWN THE MOMENT THE REAL GROUP EXISTS', () => {
    // The control: a notice that outlived its group would sit above the results it
    // was standing in for.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf' }] }),
    })))
    show(base()); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'QQQ' } })

    return waitFor(() => {
      expect(within(screen.getByTestId('add-surface')).queryAllByRole('option')
        .some((o) => o.dataset.resultKind === 'security'), 'the symbols never arrived').toBe(true)
      expect(screen.queryByTestId('symbols-pending'),
        'the loading notice outlived the group it stood in for').toBeNull()
    })
  })

  it('⭐⭐ EVERY RESULT ROW CARRIES THE ANCHOR THE STABILISER ADDRESSES IT BY', () => {
    // ⚰️⚰️ THE DEFECT THIS EXISTS FOR, MEASURED ON THE ACCEPTED BUILD: typing
    // `EMA` rendered `Moving Average`, and 2.5s later nineteen tickers were
    // inserted ABOVE it and every local row moved 1415px — under a pointer already
    // travelling toward one of them. `MA` moved 933px, `RSI` 1098px.
    //
    // ⭐ THE FIX IS SCROLL ANCHORING, and it addresses rows by `data-result-key`
    // rather than by `data-def-id`, because a TICKER and a DEFINITION can collide
    // on `id` while `key` is what React already trusts to keep them distinct. The
    // scroll mechanics themselves need real layout and are proved in the browser;
    // what a unit can pin is that the address the mechanism depends on is emitted
    // on every row, which is the part a future edit could silently drop.
    show(base()); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'Relative Strength' } })

    const rows = within(screen.getByTestId('add-surface')).getAllByRole('option')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.getAttribute('data-result-key'), `a result row has no anchor: ${r.textContent}`).toBeTruthy()
    }
    // …and the scroller the anchoring runs on is the one region that scrolls.
    expect(document.body.querySelector('[class*="insAddBody"]'),
      'the Add surface lost its scroll container').toBeTruthy()
  })

  it('⛔ A REFUSED ADD CHANGES NOTHING — not the chart, and not the selection', () => {
    // Every writer here refuses by IDENTITY. A click that writes nothing must not
    // steal the selection the member is working in.
    const { cs } = withSeries(base(), 'QQQ')
    show(cs); openTab(); select(/^QQQ$/)
    const before = inspectorName()
    openAdd()
    fireEvent.change(screen.getByRole('searchbox', { name: /Search indicators/i }),
      { target: { value: 'zzzz no such thing' } })
    // Nothing to click; leaving takes us back to the same selection.
    fireEvent.click(screen.getByRole('button', { name: /Back to active indicators/i }))
    expect(inspectorName()).toBe(before)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('ARRANGE — an explicit mode, and it moves PANES', () => {
  const enterArrange = () => fireEvent.click(screen.getByTestId('arrange-enter'))
  const moveBtn = (id, dir) => [...document.body
    .querySelector(`[data-pane-group="${id}"]`).querySelectorAll('button')]
    .find((b) => new RegExp(`pane ${dir}$`, 'i').test(b.getAttribute('aria-label') || ''))

  it('⭐⭐ THE DEFAULT VIEW IS CALM — no grips, no arrows, nothing draggable', () => {
    show(addInstance(base(), 'rsi', registry)); openTab()
    expect([...document.body.querySelectorAll('button')]
      .some((b) => /pane (up|down)$/i.test(b.getAttribute('aria-label') || ''))).toBe(false)
    expect(document.body.querySelector('[draggable="true"]')).toBeFalsy()
    // …and the way in is a WORD, so nothing has to be found by accident.
    expect(screen.getByTestId('arrange-enter').textContent).toMatch(/arrange/i)
  })

  it('⛔ AND IT IS NOT OFFERED WHEN THERE IS NOTHING TO ARRANGE', () => {
    // Price alone cannot be restacked; a control that cannot act is not a control.
    show(mergeChartSettings(JSON.stringify({ volume: { visible: false, separatePane: false } })))
    openTab()
    expect(screen.queryByTestId('arrange-enter')).toBeNull()
  })

  it('⭐⭐ A PANE MOVES THROUGH THE CANONICAL WRITER, AND STORES ONLY `paneOrder`', () => {
    const seen = { cs: null }
    const before = addInstance(base(), 'rsi', registry)
    const rsiId = lastCreatedInstance(base(), before).instanceId
    show(before, seen); openTab(); enterArrange()
    // ⚠️ NO `volume` KEY. `cs.volume.separatePane` is false by default and this
    // host passes no `volumeOpts`, so Volume is a BAND inside the candles' pane
    // rather than a pane of its own — and `chartDataMap` refuses to offer a
    // rectangle the renderer never allocates. Two real panes, which is exactly
    // what `paneOrder` should end up holding.
    expect(paneIds()).toEqual([PRICE_PANE, rsiId])

    fireEvent.click(moveBtn(rsiId, 'up'))
    expect(paneIds(), 'the pane did not move').toEqual([rsiId, PRICE_PANE])
    expect(storedPaneOrder(seen.cs)).toEqual([rsiId, PRICE_PANE])
    expect(resolvePaneOrder(seen.cs, [rsiId])).toEqual([rsiId, PRICE_PANE])
  })

  it('⛔⛔ A PANE MOVES; A SERIES DOES NOT — the guests travel and no placement is rewritten', () => {
    const host = withSeries(base(), 'QQQ')
    const guest = withSeries(host.cs, 'SPY')
    const cs = setInstanceDisplayTarget(guest.cs, guest.id, `@${host.id}`, registry)
    const placements = cs.indicatorInstances.map((i) => JSON.stringify(i.placement || null))

    const seen = { cs: null }
    show(cs, seen); openTab(); enterArrange()

    // The guest is shown ON the host's band, so the move is predictable…
    expect([...document.body
      .querySelectorAll(`[data-pane-group="${host.id}"] [class*="insArrRow"]`)]
      .map((n) => n.textContent.trim()), 'the guest is not shown as travelling').toContain('SPY')
    // …and it is INERT: dragging a guest out of its host would make pane
    // arrangement quietly become placement, which writes a different key.
    expect(document.body
      .querySelector(`[data-pane-group="${host.id}"] [class*="insArrRow"][draggable]`)).toBeFalsy()

    fireEvent.click(moveBtn(host.id, 'up'))

    expect(seen.cs, 'the move wrote nothing').toBeTruthy()
    expect(seen.cs.indicatorInstances.map((i) => JSON.stringify(i.placement || null)),
      'a pane reorder rewrote a placement').toEqual(placements)

    fireEvent.click(screen.getByTestId('arrange-done'))
    expect(paneOf(/^SPY$/), 'the guest left its host').toBe('QQQ')
  })

  it('⭐ PRICE IS MOVABLE AND NEVER DELETABLE', () => {
    const before = addInstance(base(), 'rsi', registry)
    show(before); openTab(); enterArrange()
    expect(moveBtn(PRICE_PANE, 'down'), 'Price cannot be moved').toBeTruthy()
    expect([...document.body.querySelectorAll('button')]
      .some((b) => /^Remove Price$/i.test(b.getAttribute('aria-label') || '')),
    'something offered to remove the price pane').toBe(false)
  })

  it('⭐ Done returns to the calm view WITHOUT touching the selection', () => {
    const before = addInstance(base(), 'rsi', registry)
    show(before); openTab()
    select(/Relative Strength/)
    const wasEditing = inspectorName()
    enterArrange()
    expect(inspector(), 'the Inspector stayed live during Arrange').toBeFalsy()
    fireEvent.click(screen.getByTestId('arrange-done'))
    expect(inspectorName(), 'Arrange lost the row the member was editing').toBe(wasEditing)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('NARROW — one state, rendered two ways', () => {
  /** ⚠️ `matchMedia` IS NOT IMPLEMENTED IN JSDOM, so `useMediaQuery` answers
   *  `false` and the component renders the desktop two-column layout. Stubbing it
   *  is what puts the narrow BRANCH under test; nothing about the component
   *  changes, which is the claim. */
  const narrow = (matches) => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query) => ({
      matches, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })))
  }

  it('⭐⭐ BOTH REGIONS AT DESKTOP WIDTH', () => {
    narrow(false)
    show(addInstance(base(), 'rsi', registry)); openTab()
    expect(screen.getByTestId('chart-structure')).toBeTruthy()
    expect(screen.getByTestId('inspector')).toBeTruthy()
  })

  it('⭐⭐ ONE AT A TIME WHEN NARROW: list → tap → Inspector → Back', () => {
    // ⛔ NOT A SECOND ARCHITECTURE. The same `selected`, the same Inspector, the
    // same read model — rendered sequentially instead of side by side, because
    // squeezing a 264px column and a form into 360px is how a desktop panel
    // arrives on a phone looking broken.
    narrow(true)
    show(addInstance(base(), 'rsi', registry)); openTab()

    // The list has the screen to itself.
    expect(screen.getByTestId('chart-structure')).toBeTruthy()
    expect(screen.queryByTestId('inspector'), 'both columns rendered at phone width').toBeNull()

    select(/Relative Strength/)
    expect(screen.getByTestId('inspector')).toBeTruthy()
    expect(screen.queryByTestId('chart-structure'), 'both columns rendered after a tap').toBeNull()
    expect(inspectorName()).toMatch(/Relative Strength Index/)

    // ⭐ AND THERE IS A WAY BACK, which is the whole difference between a
    // navigation model and a broken panel.
    fireEvent.click(screen.getByRole('button', { name: /Back to the chart structure/i }))
    expect(screen.getByTestId('chart-structure')).toBeTruthy()
    expect(screen.queryByTestId('inspector')).toBeNull()
    // ⛔ THE SELECTION SURVIVED THE TRIP. Back is navigation, not a deselect.
    expect(rowFor(/Relative Strength/).getAttribute('aria-selected')).toBe('true')
  })

  it('⭐ ARRANGE TAKES THE WHOLE NARROW SURFACE, and Done gives it back', () => {
    narrow(true)
    show(addInstance(base(), 'rsi', registry)); openTab()
    fireEvent.click(screen.getByTestId('arrange-enter'))
    expect(screen.getByTestId('arrange-list')).toBeTruthy()
    expect(screen.queryByTestId('inspector'), 'the Arrange aside ate half a phone').toBeNull()
    fireEvent.click(screen.getByTestId('arrange-done'))
    expect(screen.getByTestId('chart-structure')).toBeTruthy()
  })

  it('⭐ ADD TAKES THE WHOLE NARROW SURFACE, and Back gives it back', () => {
    narrow(true)
    show(base()); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    expect(screen.getByTestId('add-surface')).toBeTruthy()
    expect(screen.queryByTestId('chart-structure'), 'the structure shared a phone with Add').toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back to active indicators/i }))
    expect(screen.getByTestId('chart-structure')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('⛔⛔ THE ENGINE\'S VOCABULARY NEVER REACHES THE MEMBER', () => {
  const LEAKS = ['@inst', '@host', 'inst:', 'sym:', '::', 'legacy:', 'dataSeries',
    'Data Series', 'movingAverage', 'indicatorInstances', 'targetExplicit', 'paneOrder']

  const scan = (root, where) => {
    const text = root.textContent || ''
    for (const leak of LEAKS) {
      expect(text.includes(leak), `"${leak}" is on screen in ${where}`).toBe(false)
    }
  }

  it('⭐ not in the structure, not in the Inspector, not in Arrange, not in Add', async () => {
    // A chart carrying every shape at once: a symbol series, a guest in its pane,
    // a derived MA, an own-pane oscillator and the two fixtures.
    const host = withSeries(base(), 'QQQ')
    const guest = withSeries(host.cs, 'SPY')
    let cs = setInstanceDisplayTarget(guest.cs, guest.id, `@${host.id}`, registry)
    cs = withMA(cs, symbolSource('QQQ', 'close')).cs
    cs = addInstance(cs, 'rsi', registry)

    show(cs); openTab()
    scan(screen.getByTestId('chart-structure'), 'the structure list')

    for (const re of [/^QQQ$/, /^SPY$/, ENGINE_MA, /Relative Strength/, /^Volume$/, /^EMA 9$/]) {
      select(re)
      scan(inspector(), `the Inspector for ${re}`)
    }

    fireEvent.click(screen.getByTestId('arrange-enter'))
    scan(screen.getByTestId('arrange-list'), 'Arrange')
    fireEvent.click(screen.getByTestId('arrange-done'))

    fireEvent.click(screen.getByTestId('add-enter'))
    scan(screen.getByTestId('add-surface'), 'the Add surface')
  })

  it('⛔ …and the case is NOT vacuous: the ids really are in the DOM, as VALUES', () => {
    const host = withSeries(base(), 'QQQ')
    const guest = withSeries(host.cs, 'SPY')
    show(guest.cs); openTab(); select(/^SPY$/)
    const values = [...document.body.querySelectorAll('option')].map((o) => o.value)
    expect(values.some((v) => v.startsWith('@inst:')),
      'no option carries a host target — this pair is asserting on nothing').toBe(true)
  })

  it('⛔⛔ ONE MOVING AVERAGE, and it is never called "Moving Average #1"', () => {
    // §34 + §8: the member edits Type / Period / Source / Display, and the engine
    // MA names itself from what THEY chose.
    const ma = withMA(base(), 'close')
    show(ma.cs); openTab()
    expect(names().some((n) => /^Moving Average/.test(n)),
      'a row is wearing the generic noun').toBe(false)
    expect(names().some((n) => /#\d/.test(n)), 'a row is wearing an ordinal').toBe(false)
    select(ENGINE_MA)
    expect(inspectorName()).toBe('SMA 5')
    expect(inspectorKind()).toBe('Moving Average')
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('MA over each canonical source lands in the right pane', () => {
  it('⭐ MA(Volume) is listed under VOLUME', () => {
    const { cs } = withMA(base(), 'volume')
    show(cs); openTab()
    // ⛔ THROUGH `resolveDisplayTarget`, NOT A VOLUME SPECIAL CASE. A source's
    // home is what decides, which is why this needs no rule of its own.
    expect(paneOf(ENGINE_MA), 'an average of volume is not in the volume pane').toBe('Volume')
  })

  it('⭐ MA(QQQ) FOLLOWS QQQ when QQQ has a pane, and says so as Automatic', () => {
    const host = withSeries(base(), 'QQQ')
    const ma = withMA(host.cs, symbolSource('QQQ', 'close'))
    // Automatic for a SYMBOL source resolves to the definition's declaration, so
    // the member's explicit choice is what puts it in QQQ's pane…
    const cs = setInstanceDisplayTarget(ma.cs, ma.id, `@${host.id}`, registry)
    show(cs); openTab()
    expect(paneOf(ENGINE_MA)).toBe('QQQ')
    // …and inside that pane the row does not repeat what the heading says.
    expect(nameOf(rowFor(ENGINE_MA))).toBe('SMA 5')
  })

  it('⚰️⚰️ MA(RSI) INSIDE THE RSI PANE DOES NOT REPEAT RSI — across two spellings', () => {
    // ⚰️ MEASURED IN THE BROWSER, on the accepted build: an MA sourced from RSI,
    // filed under the `RSI (14)` heading, printed `SMA 5 · RSI(14)`. The contextual
    // rule is supposed to SUPPRESS that suffix — the heading directly above had
    // already said it — and it did not, because the two strings come from two
    // different canonical namers that disagree about ONE SPACE:
    //   `paneHostLabels`   → `RSI (14)`   (heading, legend chip, destination menu)
    //   `readout.chipLabel` → `RSI(14)`   (what a SOURCE describes as)
    // A strict equality answered "the pane does not say it" about a pane that
    // plainly did, so the redundancy appeared only for an INSTANCE source — a
    // SYMBOL source spells `QQQ` identically on both sides and always worked.
    //
    // ⛔ THE FIX NORMALISES THE COMPARISON AND NOTHING ELSE. Neither authority was
    // rewritten and no rendered label changed spelling; see the case below, which
    // pins that the suffix still prints `chipLabel`'s exact wording when it IS
    // earned — because that is the spelling the on-chart legend uses.
    const rsi = addInstance(base(), 'rsi', registry)
    const rsiId = lastCreatedInstance(base(), rsi).instanceId
    const ma = withMA(rsi, `@${rsiId}::rsi`)
    show(ma.cs); openTab()

    expect(paneOf(ENGINE_MA)).toMatch(/RSI/)
    expect(nameOf(rowFor(ENGINE_MA)), 'the row repeated the pane it is filed under')
      .toBe('SMA 5')
  })

  it('⛔ …AND THE SUFFIX STILL PRINTS, VERBATIM, WHEN THE PANE STOPS SAYING IT', () => {
    // The control for the case above: normalising the comparison must not turn
    // into suppressing the suffix everywhere. On Price the heading says `Price`,
    // so the source is invisible unless the row carries it — and it carries it in
    // `chipLabel`'s spelling, unchanged, because the legend spells it that way.
    const rsi = addInstance(base(), 'rsi', registry)
    const rsiId = lastCreatedInstance(base(), rsi).instanceId
    const ma = withMA(rsi, `@${rsiId}::rsi`)
    const onPrice = setInstanceDisplayTarget(ma.cs, ma.id, 'price', registry)
    show(onPrice); openTab()

    expect(paneOf(ENGINE_MA)).toBe('Price')
    expect(nameOf(rowFor(ENGINE_MA))).toBe('SMA 5 · RSI(14)')
  })

  it('⭐ MA(RSI) FOLLOWS RSI — derived, with no explicit choice at all', () => {
    const rsi = addInstance(base(), 'rsi', registry)
    const rsiId = lastCreatedInstance(base(), rsi).instanceId
    const ma = withMA(rsi, `@${rsiId}::rsi`)
    show(ma.cs); openTab()
    expect(paneOf(ENGINE_MA), 'an average of RSI did not follow RSI').toMatch(/RSI/)
    select(ENGINE_MA)
    // ⛔⛔ AND THE CONTROL SAYS **Automatic**, because nobody chose it. That is the
    // fact `targetExplicit` records and the old control could not show.
    const sel = [...inspector().querySelectorAll('select')]
      .find((s) => /display in/i.test(s.getAttribute('aria-label') || ''))
    expect(sel.value).toBe('__automatic__')
    expect([...sel.options].find((o) => o.value === '__automatic__').textContent)
      .toMatch(/^Automatic · /)
  })
})
