// app/src/components/chart/ChartSettingsModal.displayIn.test.jsx
//
// ─── THE ROW THAT REPORTS THE PANE CAN NOW CHANGE IT ────────────────────────
//
// ⭐⭐ TWO VIEWS OF ONE VALUE. The collapsed summary reads `resolveDisplayTarget`
// + `displayTargetOptions`; this control offers exactly what that same helper
// returns and writes through `setInstanceDisplayTarget`. There is no
// summary-specific state and no editor-specific target vocabulary, so the two
// cannot disagree about where a series is — which is what these cases pin.
//
// ⛔ EVERY VALIDATION BELONGS TO THE HELPER. Self-exclusion, tombstones, and
// "only a pane OWNER may be joined" are asserted here as OUTCOMES, because the
// UI adds none of its own — a second copy of those rules is the thing this phase
// was written to avoid.
//
// ⛔⛔ AND THE ORPHAN CASE IS THE ONE THAT MATTERS. A deleted host must leave the
// member's placement alone and SAY SO; a control that quietly showed "Own pane"
// would report a healthy line that draws nothing.

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
import { displayTargetOptions, resolveDisplayTarget, hasExplicitTarget } from './engine/displayTarget'

vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: (sym) => (sym === 'UCTA50' ? 'breadth' : 'security') }
})

const TF = 'D'
const WINDOW = 400
function prime(symbol) {
  primeSecondaryBars(symbol, TF, WINDOW, {
    bars: Array.from({ length: 12 }, (_, i) => ({
      t: `2026-09-${String(i + 1).padStart(2, '0')}`,
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
    })),
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

/** ⚠️ STATEFUL: the modal is CONTROLLED, so a write only becomes visible when
 *  the new settings come back in. A no-op handler would make every live case
 *  below read the pre-change row. */
function Host({ initial, seen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal open settings={cs}
      onChange={(next) => { if (seen) seen.cs = next; setCs(next) }} onClose={() => {}} />
  )
}
const show = (cs, seen) => render(<Host initial={cs} seen={seen} />)
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))

/** ⚰️⚰️ THE ROW IS THE TARGET, AND THE NAME IS THE WHOLE ROW.
 *
 *  This matched `.actLabel` inside an expander BUTTON, and `summaryOf` read the
 *  `.actMeta` line beside it — the collapsed row's one-line answer to *what does
 *  this read, where does it draw*. The Inspector retires both: a row carries a
 *  micro-rail and a NAME, the name itself says what a foreign source is
 *  (`EMA 20 · QQQ`, and plain `EMA 20` inside QQQ's own pane, because the heading
 *  above it already said it), and everything else the summary printed is in the
 *  right column for the one row selected. */
const rowFor = (re) => [...document.body.querySelectorAll('[data-structure-row]')]
  .find((r) => re.test((r.querySelector('[class*="insRowName"]')?.textContent || '').trim()))
const nameOf = (re) => (rowFor(re)?.querySelector('[class*="insRowName"]')?.textContent || '').trim()
/** The PANE this row is filed under — `chartDataMap`'s grouping, as the member
 *  reads it. It is the answer to *where does this draw*, which is why no row
 *  restates it. */
const paneHeadOf = (re) => {
  const g = rowFor(re)?.closest('[data-pane-group]')
  return (g?.querySelector('[class*="insGroupHead"]')?.textContent || '').trim()
}
const openRow = (re) => fireEvent.click(rowFor(re))
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
const displayIn = (re) => {
  const panel = inspector()
  // ⛔ AND IT MUST BE THIS ROW'S FORM. A stale selection would otherwise let a
  // case assert against the control of whatever was selected before it.
  if (!panel || !rowFor(re) || panel.getAttribute('data-inspector-for') !== rowFor(re).getAttribute('data-row-id')) return undefined
  return [...panel.querySelectorAll('select')]
    .find((s) => /display in/i.test(s.getAttribute('aria-label') || ''))
}

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars() })

describe('where the control appears', () => {
  it('⭐ a direct series row has one, with an accessible label', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators(); openRow(/^QQQ$/)
    const sel = displayIn(/^QQQ$/)
    expect(sel, 'no Display-in control on a Universal Data row').toBeTruthy()
    expect(sel.getAttribute('aria-label')).toBe('QQQ display in')
    expect(sel.disabled).toBe(false)
  })

  it('⛔⛔ A FIXTURE GAINS NOTHING — derived, exactly as the summary\'s silence is', () => {
    // `displayTargetOptions` returning EMPTY means one place to draw. The legacy
    // overlays and the volume pane are not engine-owned at all, and an ordinary
    // price overlay (`bb`) has nowhere else to go — neither should grow a control
    // that offers a choice it does not have.
    let cs = addInstance(mergeChartSettings({}), 'bb', registry)
    cs = withSeries(cs, 'QQQ').cs
    show(cs); openIndicators()
    for (const name of [/^EMA 9$/, /^Volume$/]) {
      openRow(name)
      expect(displayIn(name), `${name} grew a Display-in control`).toBeFalsy()
    }
    openRow(/Bollinger|^BB/)
    expect(displayIn(/Bollinger|^BB/), 'a plain price overlay grew one').toBeFalsy()
    // …and the control case really is present, so this is a contrast and not an
    // assertion that the tab renders nothing.
    openRow(/^QQQ$/)
    expect(displayIn(/^QQQ$/)).toBeTruthy()
  })
})

describe('the options are the canonical helper\'s, verbatim', () => {
  it('⭐⭐ value-for-value and label-for-label, after the Automatic row', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    show(b.cs); openIndicators(); openRow(/^SPY$/)
    const sel = displayIn(/^SPY$/)
    const canonical = displayTargetOptions(
      findInstance(b.cs, b.id), b.cs, (id) => registry.getDefinition(id))

    // ⭐⭐ THE DESTINATIONS ARE STILL THE HELPER'S, VERBATIM AND IN ITS ORDER —
    // which is the claim this case has always made and the reason it exists. What
    // the Inspector adds is ONE row ABOVE them, and it is not a destination: it is
    // the PROVENANCE choice (`Automatic · Own pane`), which the old control could
    // not express at all, so `targetExplicit` was invisible to the member.
    //
    // ⛔⛔ AND `__automatic__` NEVER REACHES STORAGE. `displayTargetOptions` is
    // unchanged, `placement.target` still holds only real destinations, and
    // picking this row writes the destination the resolver would have chosen
    // anyway — the existing return-to-default gesture. The sentinel lives and dies
    // inside `displayInControl`; that it is ABSENT from `canonical` below is the
    // proof.
    const [auto, ...rest] = [...sel.options]
    expect(auto.value, 'the Automatic row is not first').toBe('__automatic__')
    expect(auto.textContent).toMatch(/^Automatic · /)
    expect(canonical.map((o) => o.value), 'the sentinel leaked into the helper')
      .not.toContain('__automatic__')

    expect(rest.map((o) => o.value)).toEqual(canonical.map((o) => o.value))
    expect(rest.map((o) => o.textContent)).toEqual(canonical.map((o) => o.label))
  })

  it('⭐⭐ AUTOMATIC IS THE SELECTED ROW UNTIL THE MEMBER CHOOSES, AND AGAIN AFTER', () => {
    // ⭐ THE FACT THE OLD CONTROL COULD NOT SHOW. A series FOLLOWING its derived
    // destination and one PINNED to the same destination rendered identically, so
    // nothing on screen said which of them would travel when the host moved.
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const seen = { cs: null }
    show(b.cs, seen); openIndicators(); openRow(/^SPY$/)

    // Untouched ⇒ Automatic, and it NAMES where automatic lands.
    expect(displayIn(/^SPY$/).value).toBe('__automatic__')
    expect(hasExplicitTarget(findInstance(b.cs, b.id))).toBe(false)

    // A real destination ⇒ the marker is stamped and the row is that destination.
    fireEvent.change(displayIn(/^SPY$/), { target: { value: `@${a.id}` } })
    expect(displayIn(/^SPY$/).value).toBe(`@${a.id}`)
    expect(hasExplicitTarget(findInstance(seen.cs, b.id)), 'provenance was not recorded').toBe(true)

    // ⛔⛔ AND BACK TO AUTOMATIC CLEARS BOTH KEYS. Not "writes a default target"
    // — DELETES `target` AND `targetExplicit`, through the one writer, so the
    // instance is handed back to derivation exactly as if it had never been moved.
    fireEvent.change(displayIn(/^SPY$/), { target: { value: '__automatic__' } })
    const back = findInstance(seen.cs, b.id)
    expect(hasExplicitTarget(back), 'the explicit marker survived a return to Automatic').toBe(false)
    expect(back.placement && back.placement.target, 'a stored target survived it').toBeUndefined()
    expect(displayIn(/^SPY$/).value).toBe('__automatic__')
  })

  it('⭐ the CURRENT target is the selected one', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    show(moved); openIndicators(); openRow(/^SPY$/)
    expect(displayIn(/^SPY$/).value).toBe(`@${a.id}`)
    expect(resolveDisplayTarget(findInstance(moved, b.id), moved)).toBe(`@${a.id}`)
  })

  it('⛔⛔ AN INSTANCE IS NEVER OFFERED ITSELF', () => {
    // It would be its own guest: the pane it follows is never allocated and the
    // series vanishes. The helper owns this; the control must not re-add it.
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    show(b.cs); openIndicators(); openRow(/^SPY$/)
    const values = [...displayIn(/^SPY$/).options].map((o) => o.value)
    expect(values).not.toContain(`@${b.id}`)
    expect(values, 'the other host is missing — this case proves nothing')
      .toContain(`@${a.id}`)
  })

  it('⭐⭐ DUPLICATE HOSTS ARE DISTINGUISHABLE, by the chart\'s own names', () => {
    let { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    cs = withSeries(cs, 'QQQ').cs
    const spy = withSeries(cs, 'SPY')
    show(spy.cs); openIndicators(); openRow(/^SPY$/)
    const hostLabels = [...displayIn(/^SPY$/).options]
      .map((o) => o.textContent).filter((t) => /QQQ/.test(t))
    expect(hostLabels).toHaveLength(2)
    expect(new Set(hostLabels).size, 'two hosts print one name').toBe(2)
    // ⛔ AND THE VALUE IS STILL THE INSTANCE ID. The label is presentation; the
    // identity is what gets written, so renaming can never re-target a pane.
    const values = [...displayIn(/^SPY$/).options].map((o) => o.value).filter((v) => v.startsWith('@'))
    expect(values).toHaveLength(2)
    for (const v of values) expect(v).toMatch(/^@/)
  })
})

describe('the live loop — editor writes, summary reports', () => {
  it('⭐⭐ OWN PANE → QQQ → OWN PANE, with the PANE MAP following each time', () => {
    // ⚰️ IT READ THE ROW'S SUMMARY (`Line · Own pane` → `Line · QQQ`). The row no
    // longer restates its destination (owner §30) — the GROUP it is filed under
    // says it, once, and that is the thing that has to follow the write. Same
    // claim, read where the answer now lives: `chartDataMap` groups by the pane
    // each row draws in, so a re-homed guest MOVES between headings.
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    show(b.cs); openIndicators()
    const paneOf = (re) => {
      const g = rowFor(re).closest('[data-pane-group]')
      return (g?.querySelector('[class*="insGroupHead"]')?.textContent || '').trim()
    }
    expect(paneOf(/^SPY$/)).toBe('SPY')

    openRow(/^SPY$/)
    fireEvent.change(displayIn(/^SPY$/), { target: { value: `@${a.id}` } })
    // ⛔ NO REOPEN, NO REFRESH. The map is derived from current state.
    expect(paneOf(/^SPY$/), 'the guest did not move under its new host').toBe('QQQ')

    fireEvent.change(displayIn(/^SPY$/), { target: { value: 'pane' } })
    expect(paneOf(/^SPY$/), 'the guest did not come back to a pane of its own').toBe('SPY')
  })

  it('⭐ the write goes through the canonical writer, into placement.target', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const seen = { cs: null }
    show(b.cs, seen); openIndicators(); openRow(/^SPY$/)
    fireEvent.change(displayIn(/^SPY$/), { target: { value: 'price' } })
    const inst = findInstance(seen.cs, b.id)
    expect(inst.placement.target).toBe('price')
    // ⛔ AND NOTHING ELSE MOVED. Identity and source are not placement's business.
    expect(inst.instanceId).toBe(b.id)
    expect(inst.inputs.source).toBe('sym:SPY:close')
  })
})

describe('an orphaned target stays honest', () => {
  const orphan = () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    return { cs: removeInstance(moved, a.id, registry), spyId: b.id, hostId: a.id }
  }

  it('⭐⭐ the PANE HEADING says needs attention and the CONTROL says unavailable', () => {
    // ⚰️ IT READ THE ROW'S SUMMARY LINE (`Pane unavailable`). The Inspector has no
    // summary line — a row is a rail and a name — so the two halves of this claim
    // are read where they now live, and BOTH still have to be true:
    //   · the row is filed under "Needs attention", which is `chartDataMap`'s own
    //     orphan group and is the thing a member sees without clicking anything;
    //   · the Display control shows the STORED target, worded `Pane unavailable`.
    // ⛔ THE POINT IS UNCHANGED: nothing silently heals, and nothing claims a
    // destination this series does not have.
    const { cs, hostId } = orphan()
    show(cs); openIndicators()
    expect(paneHeadOf(/^SPY$/)).toMatch(/needs attention/i)
    openRow(/^SPY$/)
    const sel = displayIn(/^SPY$/)
    // ⛔⛔ IT SHOWS THE STORED TARGET, NOT A HEALED ONE. Displaying "Own pane"
    // would report a healthy line that draws nothing, and picking the value
    // already shown would be a no-op — which is how the original defect hid.
    expect(sel.value).toBe(`@${hostId}`)
    const selected = [...sel.options].find((o) => o.value === sel.value)
    expect(selected.textContent).toMatch(/unavailable/i)
  })

  it('⛔ …and that option is not a DESTINATION — it is disabled', () => {
    const { cs, hostId } = orphan()
    show(cs); openIndicators(); openRow(/^SPY$/)
    const sel = displayIn(/^SPY$/)
    const missing = [...sel.options].find((o) => o.value === `@${hostId}`)
    expect(missing.disabled, 'the unavailable pane is offered as somewhere to go').toBe(true)
    // …and it is understandable without colour: the word says it.
    expect(missing.textContent).toMatch(/unavailable/i)
  })

  it('⛔⛔ NO SILENT RECONNECT — a NEW QQQ does not adopt the orphan', () => {
    // Identity is authoritative. A fresh series with the same ticker, the same
    // name and the same source is a different instance, and the stored target
    // still points at the one that left.
    const { cs, hostId } = orphan()
    const replacement = withSeries(cs, 'QQQ')
    show(replacement.cs); openIndicators()
    expect(paneHeadOf(/^SPY$/)).toMatch(/needs attention/i)
    openRow(/^SPY$/)
    expect(displayIn(/^SPY$/).value).toBe(`@${hostId}`)
    expect(displayIn(/^SPY$/).value).not.toBe(`@${replacement.id}`)
  })

  it('⭐⭐ AND AN EXPLICIT CHOICE REPAIRS IT', () => {
    const { cs } = orphan()
    show(cs); openIndicators(); openRow(/^SPY$/)
    fireEvent.change(displayIn(/^SPY$/), { target: { value: 'pane' } })
    // ⭐ THE REPAIR IS THE ROW LEAVING "Needs attention" — literally, into a pane
    // heading of its own. Nothing anywhere has to print a repair message; the
    // structure list is derived, so the row simply stops being filed under the
    // group for things that are not drawing.
    expect(paneHeadOf(/^SPY$/), 'the row is still filed under Needs attention')
      .toBe('SPY')
    // …and the unavailable option is gone, because there is nothing unavailable.
    expect([...displayIn(/^SPY$/).options].some((o) => o.disabled)).toBe(false)
  })
})

describe('a derived series places like any other', () => {
  it('⭐ MA over a symbol can be sent to a pane, and its NAME follows the pane', () => {
    const host = withSeries(mergeChartSettings({}), 'QQQ')
    const ma = withMA(host.cs, 'QQQ')
    // ⚠️ `SMA 5` — the engine MA names itself from the member's own type and
    // period since 2026-09-16 (`engine/semanticName`), on every surface at once.
    // ⭐ IT MATCHES THE NAME **WITH OR WITHOUT** THE CONTEXTUAL SUFFIX, because the
    // suffix is what this case is about and it changes under the test's own hand.
    // ⚠️ AND IT STOPS AT THE SEPARATOR RATHER THAN BEING A BARE PREFIX: a default
    // chart already carries `SMA 50` and `SMA 200`, so `/^SMA 5/` alone matches the
    // wrong moving average and the case reads as a naming bug that is not there.
    const MA = /^SMA 5(?:$| ·)/

    show(ma.cs); openIndicators()

    // ⛔⛔ ON PRICE IT CARRIES ITS SOURCE, AND THAT IS THE POINT OF THE RULE. The
    // heading above it reads `Price`, so nothing on screen would otherwise say
    // this average is of QQQ rather than of the chart's own candles — two lines
    // that compute completely different numbers and would print one name.
    expect(paneHeadOf(MA)).toBe('Price')
    expect(nameOf(MA)).toBe('SMA 5 · QQQ')

    openRow(MA)
    const sel = displayIn(MA)
    expect(sel, 'a derived series got no Display-in control').toBeTruthy()
    fireEvent.change(sel, { target: { value: `@${host.id}` } })

    // WHERE it went is the heading it is filed under — the row never restates it.
    expect(paneHeadOf(MA)).toBe('QQQ')

    // ⚰️ AND WHAT IT READS USED TO BE A SECOND LINE ON THE ROW (`Source: QQQ`),
    // printed identically in both places.
    // ⭐⭐ THE PANE SAYS IT NOW, SO THE ROW DOES NOT. Inside QQQ's own pane an
    // average OF QQQ is simply `SMA 5`: the heading directly above already carries
    // the word, and saying it twice three pixels apart is the "overstuffed with
    // implementation metadata" this redesign is a correction of.
    //
    // ⛔ SAME INSTANCE, SAME STORED SOURCE, DIFFERENT SENTENCE. Nothing about the
    // blob changed between these two assertions except where the member sent it;
    // the name is DERIVED from the pane, which is why it can never go stale.
    expect(nameOf(MA)).toBe('SMA 5')
  })
})
