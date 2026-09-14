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
import { displayTargetOptions, resolveDisplayTarget } from './engine/displayTarget'

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

const rowFor = (re) => [...document.body.querySelectorAll('[data-row-id]')]
  .find((r) => re.test((r.querySelector('[class*="actLabel"]')?.textContent || '').trim()))
const summaryOf = (re) => (rowFor(re)?.querySelector('[class*="actMeta"]')?.textContent || '').trim()
const openRow = (re) => fireEvent.click(rowFor(re).querySelector('[aria-expanded]'))
const displayIn = (re) => [...rowFor(re).querySelectorAll('select')]
  .find((s) => /display in/i.test(s.getAttribute('aria-label') || ''))

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
  it('⭐⭐ value-for-value and label-for-label', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    show(b.cs); openIndicators(); openRow(/^SPY$/)
    const sel = displayIn(/^SPY$/)
    const canonical = displayTargetOptions(
      findInstance(b.cs, b.id), b.cs, (id) => registry.getDefinition(id))
    expect([...sel.options].map((o) => o.value)).toEqual(canonical.map((o) => o.value))
    expect([...sel.options].map((o) => o.textContent)).toEqual(canonical.map((o) => o.label))
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
  it('⭐⭐ OWN PANE → QQQ → OWN PANE, with the summary following each time', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    show(b.cs); openIndicators()
    expect(summaryOf(/^SPY$/)).toBe('Line · Own pane')

    openRow(/^SPY$/)
    fireEvent.change(displayIn(/^SPY$/), { target: { value: `@${a.id}` } })
    // ⛔ NO REOPEN, NO REFRESH. The summary is derived from current state.
    expect(summaryOf(/^SPY$/)).toBe('Line · QQQ')

    fireEvent.change(displayIn(/^SPY$/), { target: { value: 'pane' } })
    expect(summaryOf(/^SPY$/)).toBe('Line · Own pane')
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

  it('⭐⭐ the summary says unavailable and the CONTROL agrees', () => {
    const { cs, hostId } = orphan()
    show(cs); openIndicators()
    expect(summaryOf(/^SPY$/)).toMatch(/unavailable/i)
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
    expect(summaryOf(/^SPY$/)).toMatch(/unavailable/i)
    openRow(/^SPY$/)
    expect(displayIn(/^SPY$/).value).toBe(`@${hostId}`)
    expect(displayIn(/^SPY$/).value).not.toBe(`@${replacement.id}`)
  })

  it('⭐⭐ AND AN EXPLICIT CHOICE REPAIRS IT', () => {
    const { cs } = orphan()
    show(cs); openIndicators(); openRow(/^SPY$/)
    fireEvent.change(displayIn(/^SPY$/), { target: { value: 'pane' } })
    expect(summaryOf(/^SPY$/)).toBe('Line · Own pane')
    // …and the unavailable option is gone, because there is nothing unavailable.
    expect([...displayIn(/^SPY$/).options].some((o) => o.disabled)).toBe(false)
  })
})

describe('a derived series places like any other', () => {
  it('⭐ MA over a symbol can be sent to a pane and the summary follows', () => {
    const host = withSeries(mergeChartSettings({}), 'QQQ')
    const ma = withMA(host.cs, 'QQQ')
    show(ma.cs); openIndicators(); openRow(/Moving Average|^MA /)
    const sel = displayIn(/Moving Average|^MA /)
    expect(sel, 'a derived series got no Display-in control').toBeTruthy()
    fireEvent.change(sel, { target: { value: `@${host.id}` } })
    expect(summaryOf(/Moving Average|^MA /)).toMatch(/· QQQ/)
    expect(summaryOf(/Moving Average|^MA /)).toMatch(/Source: QQQ/)
  })
})
