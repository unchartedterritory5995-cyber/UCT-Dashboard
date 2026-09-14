// app/src/components/chart/ChartSettingsModal.chartData.test.jsx
//
// ─── THE TAB, NOT THE DERIVATION ────────────────────────────────────────────
//
// `chartDataMap.test.js` pins what the pane map COMPUTES. This pins what the tab
// DOES with it: that the groups reach the DOM in the map's order, that selecting
// a row puts that row's form in the inspector, that the inspector survives
// everything except its own row leaving, and that none of the engine's internal
// vocabulary reaches a member's eyes.
//
// ⛔ THE LAST ONE IS A RAIL, NOT A STYLE NOTE. `@inst:dataSeries:1` is a real
// value inside this component — it is the `value` of a Display-in option and the
// stored placement target. It must never be TEXT. A leak here is not cosmetic:
// it is the settings panel showing a member an identifier they cannot act on,
// which is what the pane map exists to replace.

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource, paneOfTarget } from './engine/sourceRef'
import { primeSecondaryBars, clearSecondaryBars } from './engine/secondaryBars'
import { addInstance, setInstanceDisplayTarget, removeInstance } from './engine/instanceControls'
import { listAllIndicators, readEnabled } from './indicatorRegistry'
import { paneMap } from './chartDataMap'

vi.mock('../../hooks/useBreadthSymbols', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, symbolFamily: () => 'security' }
})

function prime(symbol) {
  primeSecondaryBars(symbol, 'D', 400, {
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
function withDef(cs, defId) {
  const next = addInstance(cs, defId, registry)
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

/** ⚠️ STATEFUL: the modal is CONTROLLED, so a write is only visible once the new
 *  settings come back in. A no-op handler makes every live case below vacuous. */
function Host({ initial }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} />
}
const show = (cs) => render(<Host initial={cs} />)
const openTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Chart Data' }))

const groups = () => [...document.body.querySelectorAll('[data-pane-group]')].map((g) => ({
  id: g.getAttribute('data-pane-group'),
  kind: g.getAttribute('data-pane-kind'),
  name: g.querySelector('[class*="sectionLabel"]').textContent.trim(),
  rows: [...g.querySelectorAll('[class*="actLabel"]')].map((n) => n.textContent.trim()),
}))
const rowFor = (re) => [...document.body.querySelectorAll('[data-row-id]')]
  .find((r) => re.test((r.querySelector('[class*="actLabel"]')?.textContent || '').trim()))
const select = (re) => fireEvent.click(rowFor(re).querySelector('[aria-expanded]'))
const inspectorFor = () => document.body.querySelector('[data-inspector-for]')
  ?.getAttribute('data-inspector-for')

const base = () => mergeChartSettings({})

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars() })

describe('the left column IS the pane map', () => {
  it('⭐ renders one group per map group, in the map\'s own order', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    cs = withSeries(cs, 'QQQ').cs
    show(cs); openTab()

    const expected = paneMap(
      listAllIndicators(cs, registry, {}).filter((r) => r.path.kind !== 'indicator' || readEnabled(r)),
      cs,
      (id) => registry.getDefinition(id),
    )
    expect(groups().map((g) => g.id)).toEqual(expected.map((g) => g.id))
    expect(groups().map((g) => g.name)).toEqual(expected.map((g) => g.name))
  })

  it('⭐⭐ a guest is listed UNDER its host, not in a group of its own', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    show(cs); openTab()

    const hostGroup = groups().find((g) => g.id === host.id)
    expect(hostGroup.rows).toContain('QQQ')
    expect(groups().some((g) => g.id === guest.id), 'the guest kept a pane of its own').toBe(false)
  })

  it('⛔⛔ an orphan is grouped as NEEDS ATTENTION and says why', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = removeInstance(cs, host.id, registry)
    show(cs); openTab()

    const orphans = groups().find((g) => g.kind === 'orphans')
    expect(orphans, 'the orphan was filed as an ordinary row').toBeTruthy()
    expect(orphans.rows).toContain('QQQ')
    expect(document.body.textContent)
      .toMatch(/no longer on the chart/i)
    // ⛔ AND IT WAS NOT RE-HOMED ONTO PRICE.
    expect(groups().find((g) => g.id === 'price').rows).not.toContain('QQQ')
  })
})

describe('⚰️ switched off is not broken', () => {
  it('⚰️ hiding an own-pane row reads "Not shown", never "Needs attention"', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()
    expect(groups().some((g) => g.id === r.id), 'precondition: it has a pane').toBe(true)

    fireEvent.click(rowFor(/Relative Strength/).querySelector('[role="switch"]'))
    expect(groups().some((g) => g.id === r.id), 'a hidden, empty pane is still drawn').toBe(false)

    const g = groups().find((x) => x.kind === 'hidden')
    expect(g, 'the hidden row is in no group').toBeTruthy()
    expect(g.rows).toContain('Relative Strength Index')
    expect(groups().some((x) => x.kind === 'orphans'), 'switching a row off called it broken').toBe(false)
    expect(document.body.textContent).not.toMatch(/no longer on the chart/i)
    expect(document.body.textContent).toMatch(/Turn one back on/i)
  })
})

describe('⛔⛔ the engine\'s vocabulary never reaches the member', () => {
  it('no @inst, @host, source ref or instance id is rendered as TEXT', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    const orphaned = withSeries(cs, 'SPY'); cs = orphaned.cs
    cs = setInstanceDisplayTarget(cs, orphaned.id, paneOfTarget('inst:gone:9'), registry)
    show(cs); openTab()
    select(/^QQQ$/)

    const text = document.body.textContent
    for (const leak of ['@inst', '@host', 'inst:rsi', 'inst:dataSeries', 'sym:QQQ', '::plot', 'legacy:']) {
      expect(text.includes(leak), `"${leak}" is on screen`).toBe(false)
    }
    // …and the case is not vacuous: the identifiers really are in the DOM as
    // option VALUES, which is the distinction being asserted.
    const values = [...document.body.querySelectorAll('option')].map((o) => o.value)
    expect(values.some((v) => v.startsWith('@inst:')), 'no option carries a host target — this case is asserting on nothing').toBe(true)
  })
})

describe('the inspector holds exactly one selection', () => {
  it('⭐ selecting a row shows THAT row\'s form', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()
    expect(inspectorFor(), 'something was selected before the member chose').toBeFalsy()

    select(/Relative Strength/)
    expect(inspectorFor()).toBe(r.id)
    expect(screen.getByLabelText(/display in/i)).toBeTruthy()
  })

  it('⭐ selecting a SECOND row replaces the first — one form at a time', () => {
    let cs = base()
    const a = withDef(cs, 'rsi'); cs = a.cs
    const b = withDef(cs, 'macd'); cs = b.cs
    show(cs); openTab()
    select(/Relative Strength/); expect(inspectorFor()).toBe(a.id)
    select(/MACD/); expect(inspectorFor()).toBe(b.id)
    expect(document.body.querySelectorAll('[data-inspector-for]').length).toBe(1)
  })

  it('⛔⛔ removing ANOTHER row leaves the selection alone', () => {
    // ⚰️ MEASURED IN THE HARNESS: `removeRow` cleared the selection
    // unconditionally — correct for the accordion it was written for, where the
    // ✕ and the open form were the same row. With a persistent inspector it
    // blanked the panel the member was working in every time they tidied up an
    // unrelated row.
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()
    select(/Relative Strength/)
    expect(inspectorFor()).toBe(r.id)

    fireEvent.click(rowFor(/^EMA 9$/).querySelector('[aria-label^="Remove"]'))
    expect(rowFor(/^EMA 9$/), 'the other row did not actually go — this is vacuous').toBeFalsy()
    expect(inspectorFor(), 'removing an unrelated row blanked the inspector').toBe(r.id)
  })

  it('⭐ …and removing the SELECTED row empties it', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()
    select(/Relative Strength/)
    fireEvent.click(rowFor(/Relative Strength/).querySelector('[aria-label^="Remove"]'))
    expect(inspectorFor()).toBeFalsy()
    expect(document.body.textContent).toMatch(/Select anything on the left/i)
  })

  it('⛔ every row points `aria-controls` at the region that holds its form', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    const id = rowFor(/Relative Strength/).querySelector('[aria-expanded]').getAttribute('aria-controls')
    expect(id, 'aria-expanded with nothing to point at').toBeTruthy()
    expect(document.getElementById(id), 'aria-controls names no element').toBeTruthy()
  })
})

describe('the width is this tab\'s alone', () => {
  it('⭐ Chart Data widens the panel and the other tabs do not', () => {
    show(base())
    const panel = () => document.body.querySelector('[class*="panel"]')
    const wideOn = () => /panelWide/.test(panel().className)

    expect(wideOn(), 'Price Style opened wide').toBe(false)
    openTab()
    expect(wideOn(), 'Chart Data did not widen').toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
    expect(wideOn(), 'the width stuck after leaving Chart Data').toBe(false)
  })
})
