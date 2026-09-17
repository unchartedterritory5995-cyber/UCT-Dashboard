// app/src/components/chart/ChartSettingsModal.rowSummary.test.jsx
//
// ─── THE COLLAPSED ROW SAYS WHERE IT DRAWS AND HOW ──────────────────────────
//
// ⛔⛔ THE LIST USED TO SAY ONLY THE NAME. For an indicator that was enough —
// everyone knows where RSI draws. Universal Data broke it: `QQQ` and `SPY` sit in
// the same flat list as `EMA 9` and `Volume` with nothing to say they are
// INSTRUMENTS, in panes of their own, drawn as lines. Four questions a member had
// to open the row to answer.
//
// ⭐ THE SUMMARY IS NOT A SECOND OPINION. It reads the same seams the expanded
// controls do, so these cases also pin that it cannot drift from the selects
// directly beneath it — change the style through the REAL control and the
// collapsed row must agree.
//
// ⛔ AND IT MUST STAY OUT OF THE EXPANDER'S ACCESSIBLE NAME. The first version
// nested it inside that button, which both renamed the control for a screen
// reader and broke every rail that addresses a row as `/^QQQ$/`. That lesson is
// kept, twice: as a DOM containment check and as an accessible-name check.

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource } from './engine/sourceRef'
import { clearSecondaryBars, primeSecondaryBars } from './engine/secondaryBars'
import {
  addInstance, findInstance, setInstanceInput, setInstanceDisplayTarget, removeInstance,
} from './engine/instanceControls'

// ⚠️ THE BREADTH REGISTRY IS A NETWORK FACT, so the family oracle is stubbed.
// `symbolFamily` answering `'unknown'` would make every source uncapable and the
// Candles case would pass for the wrong reason.
vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: (sym) => (sym === 'UCTA50' ? 'breadth' : 'security') }
})

const TF = 'D'
const WINDOW = 400
const secBar = (t, base) => ({ t, o: base, h: base + 2, l: base - 1.5, c: base + 0.5, v: 1000 })

/** Bars for a symbol, so `anyCachedBars` can answer the capability question. */
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

function withMA(cs, symbol) {
  prime(symbol)
  const added = addInstance(cs, 'movingAverage', registry)
  // ⚰️ `lastCreatedInstance`, NEVER `list[length - 1]`. `addInstance` inserts in
  // SHIPPED STACK ORDER, so the new instance is not necessarily last — taking the
  // tail silently handed back a DIFFERENT instance and the source was written to
  // the wrong series, which read as "the summary dropped its Source" rather than
  // as a broken fixture. It is the same trap `discoveryCatalog` documents by set
  // difference: predicting the slot is predicting the id wearing another hat.
  const id = lastCreatedInstance(cs, added).instanceId
  const next = setInstanceInput(added, id, 'source', symbolSource(symbol, 'close'), registry)
  return { cs: next, id }
}

/** ⚠️ STATEFUL ON PURPOSE. `ChartSettingsModal` is CONTROLLED: a select writes
 *  through `onChange` and nothing re-renders unless the new settings come back
 *  in. With a no-op handler the live-update cases below read the pre-change row
 *  and would look like the summary was stale — when it was the harness. */
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

/** The row block whose expander NAME is exactly this.
 *  ⛔ Anchored on purpose: that is the guarantee the summary must not break. */
const rowFor = (re) => [...document.body.querySelectorAll('[data-row-id]')]
  .find((r) => re.test((r.querySelector('[class*="actLabel"]')?.textContent || '').trim()))

const summaryOf = (re) => {
  const row = rowFor(re)
  expect(row, `no active row matching ${re}`).toBeTruthy()
  return (row.querySelector('[class*="actMeta"]')?.textContent || '').trim()
}

const openRow = (re) => fireEvent.click(rowFor(re).querySelector('[aria-expanded]'))
/** The INSPECTOR — the right-hand column, which is where a selected row's
 *  controls now live.
 *
 *  ⭐ THE CONTROLS ARE THE SAME CONTROLS; only the column changed. Chart Data
 *  moved the form out of the row and into a panel beside the pane map, so a
 *  query scoped to `rowFor(...)` now finds the row's NAME and TOGGLE and nothing
 *  else. `data-inspector-for` carries the row id, so these helpers still assert
 *  that the form on screen belongs to the row that was selected — which is the
 *  thing that actually mattered about scoping them to the row. */
const inspector = () => document.body.querySelector('[data-inspector-for]')
const selectIn = (re, labelRe) => {
  const panel = inspector()
  if (!panel || panel.getAttribute('data-inspector-for') !== rowFor(re)?.getAttribute('data-row-id')) return undefined
  return [...panel.querySelectorAll('select')]
    .find((s) => labelRe.test(s.getAttribute('aria-label') || ''))
}

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars() })

describe('what the collapsed row says', () => {
  // ⚰️⚰️ THIS SUITE USED TO ASSERT `Line · Own pane`, AND BOTH HALVES ARE RETIRED
  // (owner §30, 2026-09-16): *"Do not overstuff rows with implementation metadata
  // such as: MA / Line · Price."*
  //
  // `Line` is the same word on nearly every row and is the control the editor
  // directly beneath already offers. `Own pane` is a SECOND statement of what the
  // group heading this row is filed under already says — the rows are grouped by
  // the pane they draw in (`chartDataMap`), so the destination was printed twice.
  //
  // ⭐ WHAT THE ROW STILL ANSWERS is *what does this read* (`Source: QQQ`) and,
  // when there is no pane to file it under at all, *what happened to it*
  // (`Pane unavailable`). Both are things the heading cannot say.
  it('⭐⭐ a direct symbol series is QUIET — its name and its pane say everything', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(summaryOf(/^QQQ$/), 'the row grew furniture back').toBe('')
  })

  it('⛔ …AND A STYLE IS STILL NOT A ROW FACT, whatever it is set to', () => {
    // The control case for the one above: a NON-default presentation must not
    // bring the metadata line back either.
    const { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    const styled = {
      ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => (
        i.instanceId === id ? { ...i, presentation: { plotStyle: 'candles' } } : i)),
    }
    show(styled); openIndicators()
    expect(summaryOf(/^QQQ$/)).toBe('')
  })

  it('⭐⭐ AND THE PANE IS STILL ANSWERED — by the GROUP the row is filed under', () => {
    // ⛔ THE FACT DID NOT GO AWAY, THE DUPLICATE DID. `chartDataMap` groups the
    // rows by the pane each one draws in and the heading names it, which is where
    // a member reads "where is this" — so removing it from the row is removing a
    // repeat, not an answer.
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    const group = rowFor(/^QQQ$/).closest('[data-pane-group]')
    expect(group, 'the QQQ row is not filed under any pane').toBeTruthy()
    expect((group.querySelector('[class*="sectionLabel"]')?.textContent || '').trim())
      .toBe('QQQ')
  })

  it('⭐⭐ A GUEST NAMES ITS HOST — a human label, never an instance id', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    show(moved); openIndicators()
    // ⭐ THE HOST IS NAMED BY THE GROUP THE GUEST IS FILED UNDER, which is where
    // the answer moved (§30) and is the one place it is not a repeat.
    const group = rowFor(/^SPY$/).closest('[data-pane-group]')
    expect((group.querySelector('[class*="sectionLabel"]')?.textContent || '').trim())
      .toBe('QQQ')
    // ⛔ AND THE ADDRESS NEVER LEAKS. `@inst:dataSeries:1` is the engine talking
    // to itself; a member reads the pane by the name of what is in it.
    expect(group.textContent).not.toMatch(/@inst:|inst:dataSeries/)
    expect(summaryOf(/^SPY$/)).not.toMatch(/@|inst:/)
  })

  it('⭐⭐ A DERIVED SERIES NAMES WHAT IT READS', () => {
    const { cs } = withMA(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    // ⚠️ `SMA 5`, NOT `Moving Average` — the engine MA names itself from the
    // member's own `maType` and `period` since 2026-09-16 (`engine/semanticName`).
    const s = summaryOf(/^SMA 5$/)
    expect(s).toBe('Source: QQQ')
  })

  it('⛔ …and the SOURCE IS THE SYMBOL ALONE — not the field, not the type', () => {
    const { cs } = withMA(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    const s = summaryOf(/^SMA 5$/)
    expect(s).not.toMatch(/close|numeric|sym:/)
  })

  it('⛔ NO SOURCE WHEN THE NAME ALREADY IS THE SOURCE — `QQQ · Source: QQQ` says it twice', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(summaryOf(/^QQQ$/)).not.toMatch(/Source/)
  })

  it('⭐⭐ PANE UNAVAILABLE — the host left, and the row says so', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    const orphaned = removeInstance(moved, a.id, registry)
    show(orphaned); openIndicators()
    const s = summaryOf(/^SPY$/)
    expect(s).toMatch(/unavailable/i)
    // ⛔ AND IT DOES NOT SILENTLY CLAIM SOMEWHERE ELSE. Falling back to "Own pane"
    // would tell the member their line is fine while it draws nothing at all.
    expect(s).not.toMatch(/Own pane/)
  })

  it('⛔⛔ NOTHING ON THE FIXTURES — "Line · Main chart" five times is furniture', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    for (const name of [/^EMA 9$/, /^SMA 200$/, /^Volume$/]) {
      expect(summaryOf(name), `${name} grew furniture`).toBe('')
    }
  })

  it('⛔⛔ AND AN ORDINARY ENGINE INDICATOR IS QUIET TOO — the guard that matters', () => {
    // ⚰️ THE CASE ABOVE PASSES FOR A DIFFERENT REASON THAN IT LOOKS, and a bite
    // check is what showed it: EMA/SMA/Volume are LEGACY overlay rows, not
    // engine-owned, so `placementSummary` refuses them on its first line and the
    // `options.length` guard is never reached. Deleting that guard left the whole
    // suite green.
    //
    // ⛔ THIS is the guard's subject: an engine definition with ONE place to draw
    // and one shape to draw it in — a plain price overlay, which declares `price`
    // and reads no source, so `displayTargetOptions` is empty. Nothing to orient
    // anybody about, so nothing is printed.
    let cs = addInstance(mergeChartSettings({}), 'bb', registry)
    cs = withSeries(cs, 'QQQ').cs      // …and a summarised row beside it, so the
    show(cs); openIndicators()         //    absence is a CHOICE, not an empty tab
    // ⚠️ THE CONTROL IS NOW THE **SOURCE** LINE, not the placement one. `Line ·
    // Own pane` is retired (§30), so the thing that proves this tab still prints a
    // summary at all has to be a row whose summary survives: an MA over a symbol
    // says what it reads.
    const { cs: withMa } = withMA(cs, 'QQQ')
    cleanup(); show(withMa); openIndicators()
    expect(summaryOf(/^SMA 5$/), 'the control case lost its summary').toBe('Source: QQQ')
    expect(summaryOf(/Bollinger|^BB/), 'a plain price overlay grew furniture').toBe('')
  })
})

describe('it follows the real controls, live', () => {
  it('⭐⭐ STYLE — the control still writes, and the row still says nothing about it', () => {
    // ⚰️ IT ASSERTED `Line · Own pane` → `Candles · Own pane`. The style left the
    // ROW (§30) and stayed exactly where it was already editable: the control
    // directly beneath it. The claim that survives is the one that mattered — the
    // write lands — and it is read off the CONTROL rather than off a summary that
    // no longer restates it.
    const seen = { cs: null }
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs, seen); openIndicators()
    expect(summaryOf(/^QQQ$/)).toBe('')
    openRow(/^QQQ$/)
    const sel = selectIn(/^QQQ$/, /plot style/i)
    expect([...sel.options].some((o) => o.value === 'candles'),
      'Candles was not offered — this case would pass for the wrong reason').toBe(true)
    fireEvent.change(sel, { target: { value: 'candles' } })
    expect(selectIn(/^QQQ$/, /plot style/i).value, 'the style write did not land').toBe('candles')
    expect(summaryOf(/^QQQ$/), 'the style came back onto the row').toBe('')
  })

  it('⭐⭐ SOURCE — re-point the instrument and the summary follows', async () => {
    // ⛔ THROUGH THE REAL SEARCH, because that is the only door to a symbol the
    // chart is not already holding: `sourceOptions` offers price fields, the
    // instances on this chart and the CURRENT symbol — by design, since there is
    // no catalogue in it. Driving the select straight to `sym:SPY:close` would
    // have been writing a value the control never offered.
    const { cs } = withMA(mergeChartSettings({}), 'QQQ')
    prime('SPY')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ results: [{ ticker: 'SPY', name: 'SPDR', type: 'etf' }] }),
    })))
    show(cs); openIndicators()
    expect(summaryOf(/^SMA 5$/)).toMatch(/Source: QQQ/)
    openRow(/^SMA 5$/)
    fireEvent.change(selectIn(/^SMA 5$/, /source/i), { target: { value: '__search__' } })
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'SPY' } })
    fireEvent.click(await screen.findByRole('button', { name: /SPY/ }))
    // ⛔ NO REOPEN, NO CACHED TEXT. The summary is derived from current state.
    expect(summaryOf(/^SMA 5$/)).toMatch(/Source: SPY/)
    expect(summaryOf(/^SMA 5$/)).not.toMatch(/QQQ/)
    vi.unstubAllGlobals()
  })

  it('⭐ PLACEMENT — a host that disappears turns the guest\'s summary, in place', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    const seen = { cs: null }
    show(moved, seen); openIndicators()
    expect(summaryOf(/^SPY$/), 'a guest in a live pane says nothing — the heading does').toBe('')

    // Remove the host through the row's own ✕, which is the member's door.
    const hostRow = rowFor(/^QQQ$/)
    fireEvent.click(within(hostRow).getByRole('button', { name: /Remove QQQ/i }))
    expect(summaryOf(/^SPY$/)).toMatch(/unavailable/i)
  })

  it('⭐ DUPLICATES — two of one instrument stay told apart in the list', () => {
    let { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    cs = withSeries(cs, 'QQQ').cs
    show(cs); openIndicators()
    const names = [...document.body.querySelectorAll('[data-row-id]')]
      .map((r) => (r.querySelector('[class*="actLabel"]')?.textContent || '').trim())
      .filter((n) => /QQQ/.test(n))
    expect(names).toHaveLength(2)
    expect(new Set(names).size, 'two rows print one name').toBe(2)
    for (const n of names) expect(n).toMatch(/^QQQ/)
  })
})

describe('accessibility and CSS scope — the two ways this feature broke before', () => {
  it('⛔⛔ THE SUMMARY IS NOT PART OF THE EXPANDER\'S NAME', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    const expander = rowFor(/^QQQ$/).querySelector('[aria-expanded]')
    // ⚠️ THE BUTTON LEGITIMATELY CARRIES TWO THINGS: the NAME (`actLabel`) and the
    // definition's shortName BADGE, so its `textContent` reads `QQQSeries` — two
    // correct things concatenated. What it must NEVER carry is the summary.
    expect((expander.querySelector('[class*="actLabel"]').textContent || '').trim()).toBe('QQQ')
    expect(expander.querySelector('[class*="actMeta"]'),
      'the summary is inside the expander again').toBeNull()
    // Nested inside, this read "QQQ Line · Own pane" — a screen reader would
    // announce that as the CONTROL's name, and every rail addressing the row as
    // `QQQ` went red.
    expect(expander.textContent).not.toMatch(/Own pane|Line ·|Source:/)
  })

  it('⛔ …and the expander\'s ACCESSIBLE NAME is the instance, nothing more', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    const row = rowFor(/^QQQ$/)
    // The summary must not reach the accessible name by ANY route — not as text
    // content, not through aria-labelledby, not through a describedby that a
    // reader would announce as the label.
    const expander = row.querySelector('[aria-expanded]')
    const name = expander.getAttribute('aria-label') || expander.textContent.trim()
    // The badge is part of the control's own label and always was; the SUMMARY is
    // the addition, and it must not be announced as the control's name.
    expect(name).not.toMatch(/Own pane|Source:|unavailable/)
    expect(name).toMatch(/^QQQ/)
    // ⛔ AND NO BACK DOOR: not via aria-labelledby either.
    const by = expander.getAttribute('aria-labelledby')
    if (by) {
      for (const id of by.split(/\s+/)) {
        const el = document.getElementById(id)
        if (el) expect(el.textContent).not.toMatch(/Own pane|Source:/)
      }
    }
  })

  it('⛔⛔ THE LAYOUT MODIFIER IS ON THE ROWS WITH METADATA, AND ONLY THOSE', () => {
    // ⚰️ THE KNOWN DEFECT, RAILED. The overnight version made `.actName` stop
    // growing GLOBALLY; that class is shared with `ChartSettingsConditions` and
    // `ChartSettingsInfoFields`, which have no metadata sibling to take the freed
    // space, so their trailing controls would pack left. Scoped by explicit class
    // ownership instead: a row with no summary must not carry the modifier, which
    // is precisely the shape those two components render.
    // ⚠️ THE SUMMARISED SUBJECT MOVED. `QQQ` used to carry `Line · Own pane` and
    // now carries nothing at all (§30); a row that still HAS a summary is one that
    // says what it READS, so the MA over a symbol is the honest subject here.
    const { cs } = withMA(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()

    const headOf = (re) => rowFor(re).querySelector('[class*="actHead"]')
    const hasModifier = (re) => /actHeadMeta/.test(headOf(re).className)

    expect(hasModifier(/^SMA 5$/), 'a summarised row is missing the modifier').toBe(true)
    for (const fixture of [/^EMA 9$/, /^Volume$/, /^SMA 50$/]) {
      expect(hasModifier(fixture), `${fixture} carries the modifier with no summary`).toBe(false)
    }
  })

  it('⛔⛔ THE SHARED `.actName` RULE IS UNTOUCHED — read out of the stylesheet', () => {
    // jsdom has no layout, so this is asserted at the SOURCE: the shared class
    // must still grow, and the override must be reachable only through the
    // modifier. A future edit that globalises it again fails here.
    // ⚰️ CODE, NEVER PROSE — a lesson this repo has paid for twice. The first
    // version of this rail scanned the whole file and matched the COMMENT that
    // documents the old global rule, exactly as a pre-push guard once matched
    // `shell=True` inside its own docstring. Strip the comments, then assert.
    const css = readCss().replace(/\/\*[\s\S]*?\*\//g, '')
    const shared = /\.actName\s*\{[^}]*\}/.exec(css)
    expect(shared, '.actName rule not found').toBeTruthy()
    expect(shared[0], 'the SHARED .actName rule stopped growing — this is the defect')
      .toMatch(/flex:\s*1 1 auto/)

    // …and every rule that shrinks it is scoped by the modifier.
    for (const m of css.matchAll(/([^\n{}]*\.actName[^\n{}]*)\{([^}]*)\}/g)) {
      if (!/flex:\s*0 1 auto/.test(m[2])) continue
      expect(m[1], `an UNSCOPED .actName shrink rule: ${m[1].trim()}`)
        .toMatch(/\.actHeadMeta/)
    }
  })
})

/** The stylesheet as text. ⛔ Read from disk rather than from the CSS-module
 *  proxy, because vitest hands back a class-name map and not the rules. */
function readCss() {
  // eslint-disable-next-line no-undef
  const fs = require('node:fs')
  // eslint-disable-next-line no-undef
  const path = require('node:path')
  // eslint-disable-next-line no-undef
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  return fs.readFileSync(path.join(here, 'ChartSettingsModal.module.css'), 'utf8')
}
