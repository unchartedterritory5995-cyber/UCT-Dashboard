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
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

import { resolvePaneOrder, storedPaneOrder, PRICE_PANE } from './engine/paneOrder'

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
const show = (cs) => render(<Host initial={cs} />)
const openTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))

/** ⚰️⚰️ THE MARKUP THESE READ HAS CHANGED TWICE AND THE QUESTIONS HAVE NOT.
 *  A pane heading was `.sectionLabel` and is `.insGroupHead`; a row's name was
 *  `.actLabel` inside an expander button and is `.insRowName` on the row itself;
 *  SELECTING was clicking that expander and is now clicking the row, because the
 *  form no longer opens underneath it. Every claim below is the claim it was. */
const groups = () => [...document.body.querySelectorAll('[data-pane-group]')].map((g) => ({
  id: g.getAttribute('data-pane-group'),
  kind: g.getAttribute('data-pane-kind'),
  name: g.querySelector('[class*="insGroupHead"]').textContent.trim(),
  rows: [...g.querySelectorAll('[class*="insRowName"]')].map((n) => n.textContent.trim()),
}))
const rowFor = (re) => [...document.body.querySelectorAll('[data-structure-row]')]
  .find((r) => re.test((r.querySelector('[class*="insRowName"]')?.textContent || '').trim()))
const select = (re) => fireEvent.click(rowFor(re))
const inspectorFor = () => document.body.querySelector('[data-inspector-for]')
  ?.getAttribute('data-inspector-for')
/** The Inspector's own controls for whatever is selected. */
const inspector = () => document.body.querySelector('[data-inspector-for]')
const insBtn = (re) => [...(inspector()?.querySelectorAll('button') || [])]
  .find((b) => re.test(b.getAttribute('aria-label') || b.textContent || ''))
/** Select a row and press one of its Inspector verbs — the two-step a member
 *  makes now that the rows carry no action icons of their own. */
const act = (row, verb) => { select(row); fireEvent.click(insBtn(verb)) }
const enterArrange = () => fireEvent.click(screen.getByTestId('arrange-enter'))

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

    // ⚰️ THE SWITCH USED TO BE ON THE ROW. It is the Inspector's ON/OFF pill now
    // — the rows carry a rail and a name and nothing else — so hiding a series is
    // select-then-toggle. The WRITE is the same `setInstanceHidden`.
    act(/Relative Strength/, /^Toggle /)
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

  it('⭐ REMOVE IS THE INSPECTOR\'S, AND IT TAKES THE SELECTED ROW OFF THE CHART', () => {
    // ⚰️⚰️ THE ✕ ON EVERY ROW IS RETIRED, and with it the case that removing
    // ANOTHER row must not blank the panel — a member cannot remove another row
    // without selecting it first, so the situation is unreachable through the UI.
    // `deselectIfRemoved` is kept anyway, as the belt behind the same claim, and
    // the half of it that IS reachable is asserted below.
    //
    // ⛔ THE VERB DID NOT MOVE FOR MINIMALISM'S SAKE. A dense structure list is
    // exactly where a mis-click deletes a configured indicator, and the Inspector
    // is somewhere a member arrived deliberately. `removeRow` itself — tombstone
    // for a fixture, `removeInstance` for an instance — is byte-identical.
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()

    act(/^EMA 9$/, /^Remove /)
    expect(rowFor(/^EMA 9$/), 'the row did not actually go — this is vacuous').toBeFalsy()
    // …and it took only itself: the rest of the chart is untouched.
    expect(rowFor(/Relative Strength/), 'an unrelated row went with it').toBeTruthy()
    expect(rowFor(/^EMA 20$/)).toBeTruthy()
  })

  it('⭐ …and removing the SELECTED row empties the Inspector', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()
    act(/Relative Strength/, /^Remove /)
    // ⭐ THE EMPTY STATE IS A REAL STATE NOW, not an absence. The right column is
    // permanent, so it says what it is for rather than leaving a blank rectangle
    // — and it still carries no `data-inspector-for`, which is what "nothing is
    // selected" means to everything that reads this panel.
    expect(inspectorFor()).toBeFalsy()
    expect(document.body.querySelectorAll('[data-inspector-for]').length).toBe(0)
    expect(screen.getByTestId('inspector-empty')).toBeTruthy()
  })

  it('⛔ THE LIST POINTS `aria-controls` AT THE REGION ITS SELECTION DRIVES', () => {
    // ⚰️ IT WAS ON EACH ROW'S EXPANDER, paired with `aria-expanded`, because each
    // row opened a region of its own. There is one region now and the LIST drives
    // it, which is the list-and-detail pattern `listbox` is for — so the pointer
    // belongs on the listbox, and `aria-expanded` has nothing left to describe.
    //
    // ⛔ THE CLAIM IS THE ONE IT ALWAYS WAS: a screen-reader user told that
    // something changed must have a way to find WHAT changed.
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    const list = document.body.querySelector('[role="listbox"][aria-label="Series on this chart"]')
    expect(list, 'the structure is not a listbox').toBeTruthy()
    expect(list.getAttribute('aria-controls'), 'it points somewhere before anything is selected').toBeFalsy()

    select(/Relative Strength/)
    const id = list.getAttribute('aria-controls')
    expect(id, 'a selection with nothing to point at').toBeTruthy()
    // ⚠️ ROW IDS CARRY COLONS (`inst:rsi:1`). `getElementById` takes them
    // literally — only a CSS selector would need escaping, and nothing here
    // resolves it that way.
    expect(id).toContain(':')
    expect(document.getElementById(id), 'the Inspector is not the region named').toBeTruthy()
    expect(document.getElementById(id).getAttribute('data-inspector-for'))
      .toBe(rowFor(/Relative Strength/).getAttribute('data-row-id'))
  })

  it('⛔ THE ROWS ARE OPTIONS, AND EXACTLY ONE IS SELECTED AND TABBABLE', () => {
    // ⭐ A ROVING TABINDEX, which is what makes one Tab stop reach the whole list
    // and the arrows walk it — the keyboard equivalent of the click this design
    // reduced every row to.
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab(); select(/Relative Strength/)
    const opts = [...document.body.querySelectorAll('[data-structure-row]')]
    expect(opts.length).toBeGreaterThan(1)
    expect(opts.every((o) => o.getAttribute('role') === 'option')).toBe(true)
    expect(opts.filter((o) => o.getAttribute('aria-selected') === 'true').length).toBe(1)
    expect(opts.filter((o) => o.getAttribute('tabindex') === '0').length).toBe(1)
  })

  it('⭐ ↓ AND ↑ WALK THE WHOLE STRUCTURE, PANE BOUNDARIES INCLUDED', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    const list = document.body.querySelector('[role="listbox"][aria-label="Series on this chart"]')
    const names = () => [...document.body.querySelectorAll('[data-structure-row]')]
      .map((r) => r.querySelector('[class*="insRowName"]').textContent.trim())

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(inspectorFor(), 'the first arrow selected nothing').toBeTruthy()
    fireEvent.keyDown(list, { key: 'End' })
    // ⛔ END REACHES THE LAST ROW OF THE LAST PANE — the walk is over the FLAT
    // order, so a member never has to know where one pane stops and the next
    // starts in order to get to the bottom of their own chart.
    const last = names()[names().length - 1]
    expect((inspector().querySelector('[class*="insHeadName"]').textContent || '').trim()).toBe(last)
    fireEvent.keyDown(list, { key: 'Home' })
    expect((inspector().querySelector('[class*="insHeadName"]').textContent || '').trim()).toBe(names()[0])
  })
})

describe('⚰️⚰️ THE EDITOR IS A SECOND COLUMN, NOT A REGION INSIDE A ROW', () => {
  // ⚰️⚰️ A WHOLE DESCRIBE BLOCK IS RETIRED HERE, AND IT IS THE DESIGN THAT WENT,
  // NOT THE COVERAGE. It asserted that the editor was a CHILD of its own row, that
  // clicking the open row CLOSED it, and that only one row was open at a time —
  // three true statements about an INLINE ACCORDION, which the owner retired on
  // 2026-09-17: *"Do NOT preserve the old interaction where click row → row
  // expands → everything below moves."*
  //
  // ⛔ THE ACCORDION'S REAL DEFECT WAS GEOMETRY. Opening a row pushed every row
  // beneath it down by the height of a form, so walking a list of eleven meant
  // reading a panel that reflowed under the pointer on every selection. The cases
  // below assert the property that replaced it: the left column does not move.
  const rowTops = () => [...document.body.querySelectorAll('[data-structure-row]')]
    .map((r) => r.getAttribute('data-row-id')).join('|')

  it('⭐⭐ the editor is a SIBLING of the structure — never inside a row', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab()
    select(/Relative Strength/)
    const panel = document.body.querySelector('[data-inspector-for]')
    expect(panel, 'no editor at all').toBeTruthy()
    expect(panel.getAttribute('data-inspector-for')).toBe(r.id)
    // ⛔ THE ONE THING THE ACCORDION GUARANTEED AND THIS FORBIDS.
    expect(panel.closest('[data-structure-row]'), 'the editor is nested inside a row again').toBeFalsy()
    expect(panel.closest('[data-testid="inspector"]'), 'the editor is not in the right column').toBeTruthy()
  })

  it('⭐⭐ SELECTING A DIFFERENT ROW SWAPS THE FORM AND MOVES NOTHING ELSE', () => {
    let cs = base()
    const a2 = withDef(cs, 'rsi'); cs = a2.cs
    const b2 = withDef(cs, 'macd'); cs = b2.cs
    show(cs); openTab()

    const before = rowTops()
    select(/Relative Strength/)
    expect(inspectorFor()).toBe(a2.id)
    expect(rowTops(), 'selecting a row re-laid-out the structure').toBe(before)

    select(/MACD/)
    expect(inspectorFor()).toBe(b2.id)
    expect(rowTops(), 'changing selection re-laid-out the structure').toBe(before)
    expect(document.body.querySelectorAll('[data-inspector-for]').length).toBe(1)
  })

  it('⚰️ clicking the SELECTED row again KEEPS it — it does not toggle shut', () => {
    // ⚰️ THE ACCORDION CLOSED ON A SECOND CLICK, correctly: the row was the
    // control that opened it. A persistent column must not blank itself because
    // the member clicked the thing they are already editing — that is a two-pixel
    // mis-click away from losing the form they are working in.
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    select(/Relative Strength/)
    const id = inspectorFor()
    expect(id).toBeTruthy()
    select(/Relative Strength/)
    expect(inspectorFor(), 'a second click emptied the Inspector').toBe(id)
  })

  it('⭐ no selection → no editor, and a real empty state instead', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    expect(document.body.querySelectorAll('[data-inspector-for]').length).toBe(0)
    expect(screen.getByTestId('inspector-empty')).toBeTruthy()
  })

  it('⭐⭐ every control the inline editor carried is still in the Inspector', () => {
    let cs = base()
    const s2 = withSeries(cs, 'QQQ'); cs = s2.cs
    show(cs); openTab()
    select(/^QQQ$/)
    const panel = document.body.querySelector('[data-inspector-for]')
    // display destination, plot style, and the row's own declared inputs
    expect([...panel.querySelectorAll('select')]
      .some((x) => /display in/i.test(x.getAttribute('aria-label') || '')), 'no Display-in').toBe(true)
    expect(panel.querySelectorAll('[class*="insField"]').length, 'no field rows').toBeGreaterThan(0)
    // …and the verbs, which used to be an icon on the row.
    expect(insBtn(/^Remove /), 'no Remove').toBeTruthy()
    expect(insBtn(/^Toggle /), 'no visibility switch').toBeTruthy()
  })

  it('⭐⭐ CORE AND APPEARANCE ARE DERIVED FROM THE DEFINITION, not listed here', () => {
    // ⭐ `styleInputKeys` reads `plots[].$refs`, which IS the set of inputs that
    // reach the renderer as style — so a definition sorts its own controls and one
    // that renames a styled input sorts itself too, with no edit in the view.
    let cs = base()
    cs = withSeries(cs, 'QQQ').cs
    show(cs); openTab(); select(/^QQQ$/)
    const labels = [...inspector().querySelectorAll('[class*="insSectionLabel"]')]
      .map((n) => n.textContent.trim())
    expect(labels).toContain('Core')
    expect(labels).toContain('Appearance')

    // ⚠️ ADDRESSED BY `data-field`, NOT BY HASHED CLASS NAME. `[class*="insField"]`
    // also matches `insFieldLabel` and `insFieldCtl` — CSS-module substrings are a
    // prefix trap, and the version of this that used one found the LABEL SPAN
    // first and read `null.textContent`.
    const sectionOf = (key) => inspector().querySelector(`[data-field="${key}"]`)
      ?.closest('[data-section]')?.getAttribute('data-section')
    // What it READS is core; what it LOOKS LIKE is appearance. `dataSeries`
    // declares exactly one of each, and NEITHER is named in the view.
    expect(sectionOf('source'), 'the instrument is not a Core control').toBe('core')
    expect(sectionOf('__display__'), 'the destination is not a Core control').toBe('core')
    expect(sectionOf('color'), 'a colour is not an Appearance control').toBe('appearance')
  })
})

describe('⚰️ the Track B deep link lands on the inline editor', () => {
  it('⚰️ `data:<instanceId>` opens Indicators with THAT row SELECTED', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    // ⚠️ INSTANCE IDS CARRY COLONS. The prefix is sliced by length, never split.
    expect(r.id).toContain(':')
    render(<ChartSettingsModal open scrollTo={`data:${r.id}`} settings={cs} onChange={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Indicators' }).getAttribute('aria-selected')).toBe('true')
    const panel = document.body.querySelector('[data-inspector-for]')
    expect(panel, 'the deep link opened no editor').toBeTruthy()
    expect(panel.getAttribute('data-inspector-for')).toBe(r.id)
    // ⚰️ IT USED TO ASSERT THE PANEL WAS INSIDE THE ROW. It is the right column
    // now, so the landing is proved the way a member sees it: the row is the
    // selected one in the structure, and the Inspector is showing it.
    const row = [...document.body.querySelectorAll('[data-structure-row]')]
      .find((x) => x.getAttribute('data-row-id') === r.id)
    expect(row, 'the linked row is not in the structure at all').toBeTruthy()
    expect(row.getAttribute('aria-selected'), 'the deep link did not select the row').toBe('true')
  })

  it('⭐ `ind:<instanceId>` still works — the older spelling is not dropped', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    render(<ChartSettingsModal open scrollTo={`ind:${r.id}`} settings={cs} onChange={() => {}} onClose={() => {}} />)
    expect(document.body.querySelector('[data-inspector-for]')?.getAttribute('data-inspector-for')).toBe(r.id)
  })

  it('⭐⭐ with TWO QQQ series the link opens the one it names', () => {
    let cs = base()
    const a = withSeries(cs, 'QQQ'); cs = a.cs
    const b = withSeries(cs, 'QQQ'); cs = b.cs
    expect(a.id).not.toBe(b.id)
    render(<ChartSettingsModal open scrollTo={`data:${b.id}`} settings={cs} onChange={() => {}} onClose={() => {}} />)
    expect(document.body.querySelector('[data-inspector-for]').getAttribute('data-inspector-for')).toBe(b.id)
  })
})

describe('⭐⭐ PANE REORDERING IS DISCOVERABLE (owner §23, §25)', () => {
  // ⚰️ THE OWNER'S REPORT, 2026-09-16: *"The current pane up/down controls are
  // only discoverable if the pointer happens to hover exactly where the invisible
  // buttons are."* Both the ↑/↓ pair and the drag grip rested at `opacity: 0` and
  // appeared on `:hover`, so a member who never happened to sweep the pointer
  // across a pane heading never learned that panes move at all. The fix was to
  // rest them VISIBLE, quietly, on every heading.
  //
  // ⚰️⚰️ AND THEN THAT FIX WAS ITSELF THE PROBLEM. Twelve live controls resting
  // on six pane headings is the "administering a table of chart objects" the
  // Inspector exists to remove — the affordance was discoverable and the panel was
  // no longer calm. The third answer is neither hidden nor permanent: ONE labelled
  // word, `Arrange`, which puts the controls behind an explicit request.
  //
  // ⛔ THE ORIGINAL DEFECT IS STILL WHAT IS BEING GUARDED. `Arrange` is a WORD,
  // always rendered, in the heading a member is already reading — so nothing has
  // to be found by accident, which is the property that was lost in the first
  // place. And the controls it reveals are full-strength, because a member who
  // asked to arrange things is not helped by chrome that is still shy.
  const css = readFileSync(path.resolve(HERE, 'ChartSettingsModal.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('⭐ THE DOOR IS A LABELLED WORD IN THE NORMAL VIEW — not an icon, not a hover', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    const btn = screen.getByTestId('arrange-enter')
    expect(btn, 'there is no way into pane arrangement at all').toBeTruthy()
    // ⛔ A WORD. An icon would be the same discoverability bet that failed.
    expect(btn.textContent.trim()).toMatch(/arrange/i)
    // ⛔ AND VISIBLE AT REST. jsdom applies no stylesheet, so this is a CSS
    // artifact read — the same instrument `legendV2.test.jsx` uses, and the only
    // one that can see the failure that shipped here before.
    // ⚠️ THE RULE IS A GROUPED SELECTOR (`.insHeadAct, .insHeadAdd { … }`), so the
    // pattern has to allow the class anywhere in the selector list rather than
    // only at its head — the version that anchored it found nothing and reported
    // the affordance as MISSING when it was merely sharing a rule with Add.
    const rule = /(?:^|\n)[^{}]*\.insHeadAct[^{}]*\{([^}]*)\}/.exec(css)
    expect(rule, '.insHeadAct is gone — the heading lost its affordance').toBeTruthy()
    expect(/opacity:\s*0(?!\.[1-9])/.test(rule[1]), 'the Arrange word is invisible until hover').toBe(false)
  })

  it('⛔ THE NORMAL VIEW CARRIES NO PANE-MOVE CONTROLS AT ALL', () => {
    // The other half of the same decision: calm by default. Twelve buttons over
    // six headings is what this replaced.
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab()
    expect([...document.body.querySelectorAll('button')]
      .some((x) => /pane (up|down)$/i.test(x.getAttribute('aria-label') || '')),
    'the move arrows are back on the normal view').toBe(false)
    expect(document.body.querySelector('[draggable="true"]'),
      'the normal structure list is draggable').toBeFalsy()
  })

  it('⭐ AND INSIDE ARRANGE THEY ARE PRESENT, FULL-STRENGTH AND LABELLED', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openTab(); enterArrange()
    const moves = [...document.body.querySelectorAll('button')]
      .filter((x) => /pane (up|down)$/i.test(x.getAttribute('aria-label') || ''))
    expect(moves.length, 'Arrange revealed no move controls').toBeGreaterThan(0)
    // ⛔ NOT SHY. Nothing in the mode's own rules hides them until hover.
    const rule = /(?:^|\n)\.insArrBtn\s*\{([^}]*)\}/.exec(css)
    expect(rule, '.insArrBtn is gone').toBeTruthy()
    expect(/opacity:\s*0(?!\.[1-9])/.test(rule[1]), 'the move controls hide until hover again').toBe(false)
    // …and the drag handle is real, on the pane band itself.
    expect(document.body.querySelector('[data-pane-group][draggable="true"]'),
      'no pane can be dragged in Arrange').toBeTruthy()
  })

  it('⭐ Done returns the panel to the calm view', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openTab(); enterArrange()
    fireEvent.click(screen.getByTestId('arrange-done'))
    expect(document.body.querySelector('[data-testid="arrange-list"]'), 'Arrange did not exit').toBeFalsy()
    expect(screen.getByTestId('arrange-enter'), 'the door did not come back').toBeTruthy()
    expect([...document.body.querySelectorAll('button')]
      .some((x) => /pane (up|down)$/i.test(x.getAttribute('aria-label') || ''))).toBe(false)
  })
})

describe('⚰️ whole panes can be reordered from the pane map', () => {
  const paneIds = () => [...document.body.querySelectorAll('[data-pane-group]')]
    .filter((g) => ['price', 'volume', 'pane'].includes(g.getAttribute('data-pane-kind')))
    .map((g) => g.getAttribute('data-pane-group'))
  /** The Move control on ONE pane's heading, found through the group it is in.
   *  ⚠️ SCOPED TO THE GROUP, NOT MATCHED ON THE LABEL: `[aria-label*="Move"]`
   *  also matches every row's "Remove …" button, which is how the orphan case
   *  below first passed against a delete control. */
  const paneEl = (id) => document.body.querySelector(`[data-pane-group="${id}"]`)
  const moveBtn = (id, dir) => [...paneEl(id).querySelectorAll('button')]
    .find((b) => new RegExp(`pane ${dir}$`, 'i').test(b.getAttribute('aria-label') || ''))
  /** ⚰️ THE CONTROLS USED TO BE ON EVERY HEADING IN THE NORMAL VIEW. They live
   *  inside the Arrange mode now (see the discoverability block above), so every
   *  case here opens the tab and then asks to arrange — which is the gesture a
   *  member makes. The WRITERS and the assertions are untouched. */
  const openArrange = () => { openTab(); enterArrange() }

  it('⚰️ Move up puts a pane ABOVE Price — and Move down brings it back', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    show(cs); openArrange()
    expect(paneIds()).toEqual([PRICE_PANE, r.id])

    fireEvent.click(moveBtn(r.id, 'up'))
    expect(paneIds(), 'the pane did not move above Price').toEqual([r.id, PRICE_PANE])

    fireEvent.click(moveBtn(r.id, 'down'))
    expect(paneIds()).toEqual([PRICE_PANE, r.id])
  })

  it('⭐ Price itself is orderable — and has no Remove', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openArrange()
    expect(moveBtn(PRICE_PANE, 'down')).toBeTruthy()
    // ⛔ MOVABLE, NEVER DELETABLE. Price is the chart's own candles; there is no
    // Remove for it anywhere — not on the band in Arrange, and not in the
    // Inspector, because Price is not a ROW and can never be selected as one.
    const price = document.body.querySelector('[data-pane-group="price"]')
    expect(price.querySelector('[aria-label^="Remove Price"]'), 'Price offered a Remove').toBeFalsy()
    expect([...document.body.querySelectorAll('button')]
      .some((b) => /^Remove Price$/i.test(b.getAttribute('aria-label') || '')),
    'something offered to remove the price pane').toBe(false)
  })

  it('⛔ the boundaries disable rather than wrap', () => {
    let cs = base()
    cs = withDef(cs, 'rsi').cs
    show(cs); openArrange()
    expect(moveBtn(PRICE_PANE, 'up').disabled, 'the top pane could move up').toBe(true)
    const rsiId = paneIds().find((k) => k !== PRICE_PANE)
    expect(moveBtn(rsiId, 'down').disabled, 'the bottom pane could move down').toBe(true)
  })

  it('⛔⛔ Needs attention is NOT a pane and offers no reorder', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = removeInstance(cs, host.id, registry)
    // ⚠️ A SECOND REAL PANE, so that Arrange is offered at all. The door is
    // withheld on a chart with ONE pane — a single pane cannot be restacked and a
    // control that cannot act is not a control — and without this the case would
    // pass for the wrong reason: no Arrange button rather than no orphan in it.
    cs = withDef(cs, 'macd').cs
    show(cs); openTab()
    expect(document.body.querySelector('[data-pane-kind="orphans"]'),
      'precondition: there is an orphan group').toBeTruthy()

    // ⛔⛔ AND IT IS SIMPLY NOT IN ARRANGE AT ALL. `hidden` and `orphans` are lists
    // of things that are NOT DRAWING; offering to restack them would be offering
    // to move a rectangle the renderer never allocates. The old panel filtered
    // them out of the reorder controls; this mode filters them out of the list.
    enterArrange()
    const arranged = [...document.body.querySelectorAll('[data-testid="arrange-list"] [data-pane-kind]')]
      .map((g) => g.getAttribute('data-pane-kind'))
    expect(arranged.length, 'Arrange listed nothing').toBeGreaterThan(0)
    expect(arranged).not.toContain('orphans')
    expect(arranged).not.toContain('hidden')
  })

  it('⚰️⚰️ moving a HOST pane carries its guests and rewrites no placement', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    const before = cs.indicatorInstances.map((i) => JSON.stringify(i.placement || null))

    const seen = { cs: null }
    render(<Host initial={cs} onSeen={(next) => { seen.cs = next }} />)
    openArrange()
    // ⭐ THE GUESTS ARE VISIBLE ON THE BAND BEING DRAGGED, which is what makes the
    // move predictable — a member can see what travels before they move it.
    expect([...document.body.querySelectorAll(`[data-pane-group="${host.id}"] [class*="insArrRow"]`)]
      .map((n2) => n2.textContent.trim()), 'the guest is not shown as travelling').toContain('QQQ')

    fireEvent.click(moveBtn(host.id, 'up'))

    const after = seen.cs
    expect(after, 'the move wrote nothing').toBeTruthy()
    // …and it really did travel: back in the normal view it is still listed under
    // its host, which is `chartDataMap`'s answer and not this mode's.
    fireEvent.click(screen.getByTestId('arrange-done'))
    const hostGroup = [...document.body.querySelectorAll('[data-pane-group]')]
      .find((g) => g.getAttribute('data-pane-group') === host.id)
    expect([...hostGroup.querySelectorAll('[class*="insRowName"]')].map((n2) => n2.textContent.trim()))
      .toContain('QQQ')
    // ⛔ AND NOT ONE PLACEMENT CHANGED. Pane order and Display-in are separate
    // facts; a reorder that rewrote targets would make the two fight.
    expect(after.indicatorInstances.map((i) => JSON.stringify(i.placement || null))).toEqual(before)
  })

  it('⭐ the writer is canonical — the UI stores `paneOrder`, nothing else', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    const seen = { cs: null }
    render(<Host initial={cs} onSeen={(next) => { seen.cs = next }} />)
    openArrange()
    fireEvent.click(moveBtn(r.id, 'up'))
    expect(storedPaneOrder(seen.cs)).toEqual([r.id, PRICE_PANE])
    expect(resolvePaneOrder(seen.cs, [r.id])).toEqual([r.id, PRICE_PANE])
  })
})

describe('⚰️⚰️ THE MODAL WIDENS FOR THIS TAB, AND ONLY FOR THIS TAB', () => {
  it('⚰️⚰️ Indicators is WIDE; every other tab is not, and it goes back', () => {
    // ⚰️⚰️ THIS CASE HAS ARGUED BOTH WAYS AND IS KEPT FOR THAT REASON. Chart
    // Data widened the modal to 880 for a two-column pane map + inspector; the
    // owner judged *"a modal that resizes on the way into one tab"* too high a
    // price, the editor went inline, and this asserted the width NEVER changed.
    //
    // ⭐⭐ THE OWNER SET 720 FOR THE INSPECTOR (2026-09-17), which reverses the
    // trade — 160px less than the version that was rejected, on a layout whose two
    // regions have two different jobs. So the claim flips, and what it now guards
    // is the part that did NOT change: the other four tabs are still 560, because
    // widening `.panel` globally would re-lay-out four columns to solve a problem
    // none of them has.
    show(base())
    const cls = () => document.body.querySelector('[class*="panel"]').className
    const atPrice = cls()
    expect(/panelWide/.test(atPrice), 'the Price tab is wide').toBe(false)

    openTab()
    expect(/panelWide/.test(cls()), 'the Inspector did not get its width').toBe(true)

    // ⛔ AND IT HANDS THE WIDTH BACK. A tab that kept it would have widened the
    // whole modal permanently by the back door.
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
    expect(cls(), 'the width did not go back on the way out').toBe(atPrice)
    openTab()
    expect(/panelWide/.test(cls())).toBe(true)
  })
})
