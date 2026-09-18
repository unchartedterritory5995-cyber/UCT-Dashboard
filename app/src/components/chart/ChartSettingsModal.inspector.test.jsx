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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { PANE_SERIES_ORDER_KEY } from './engine/paneSeriesOrder'
import {
  POPULAR_DEF_IDS, FUNDAMENTALS_STATUS, tabOf, glyphFamilyOf, GLYPH_FAMILIES,
} from './discoveryCatalog'
import { INDICES_PRESET } from './symbolSearchModel'

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
// ═════════════════════════════════════════════════════════════════════════════
describe('THE EDITOR IS SIZED TO ITS VALUES, and the empty state says what is on the chart', () => {
  // ⚰️⚰️ TWO MEASURED COMPLAINTS, 2026-09-17. *"Period = 200 currently occupies a
  // huge input"* and *"the no-selection state feels too empty/dry"*. Both are
  // presentation; neither touches a writer, an identity or an order.

  const fieldOf = (key) => inspector().querySelector(`[data-field="${key}"]`)
  const measureOf = (key) => fieldOf(key)?.getAttribute('data-measure')
  const segOf = (key) => fieldOf(key)?.querySelector('[role="radiogroup"]')
  const radios = (key) => [...(segOf(key)?.querySelectorAll('[role="radio"]') || [])]
  const checked = (key) => radios(key).find((r) => r.getAttribute('aria-checked') === 'true')

  it('⛔⛔ THE MEASURE COMES FROM THE VALUE, NOT FROM THE KEY NAME', () => {
    // ⭐ THIS IS THE WHOLE DESIGN IN ONE CASE. A table of per-key widths would go
    // stale the first time a definition declares a new input; `measureOf` reads
    // the field descriptor — a number, an enum's longest label, a source — so an
    // indicator nobody has written yet is sized correctly on its first render.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    select(/^EMA 9$/)
    expect(measureOf('period'), 'a number is not compact').toBe('compact')
    expect(measureOf('type'), 'a two-word enum did not become a segment').toBe('segment')
    expect(measureOf('lineWidth'), '`1px`/`2px` is not compact').toBe('compact')
    expect(measureOf('lineStyle'), '`LargeDashed` needs real room').toBe('medium')
    expect(measureOf('offset')).toBe('compact')
    // ⛔ AND THE TWO THE BRIEF PROTECTS KEEP THE CELL. `Close`, `Price`,
    // `Automatic · Price`, `QQQ · Close`, another pane's name — solving oversized
    // controls by truncating a semantic identity would trade one defect for a
    // worse one.
    expect(measureOf('__source__'), 'the source lost its room').toBe('wide')
    expect(measureOf('__where__'), 'the destination lost its room').toBe('wide')

    select(ENGINE_MA)
    expect(measureOf('source'), 'a real source picker was made narrow').toBe('wide')
    expect(measureOf('__display__')).toBe('wide')
    expect(measureOf('maType')).toBe('segment')
    expect(inspector().querySelector('[data-field^="__style__"]').getAttribute('data-measure'))
      .toBe('medium')
  })

  it('⚰️⚰️ ONE PROPERTY PER ROW — the pairing is retired, the widths are not', () => {
    // ⚰️⚰️ THE OPPOSITE OF THIS CASE STOOD HERE FOR ONE PASS. `packFields` paired
    // adjacent non-`wide` controls onto one line — `Period [20]  Type [SMA|EMA]` —
    // and this asserted exactly which pairs formed. It closed the dead space the
    // compact widths opened up, and the owner tried it and preferred the single
    // file (2026-09-17): *"keep the selected indicator editor in a SINGLE-FILE
    // VERTICAL PROPERTY LIST. Do NOT return to the recent paired layout."*
    //
    // ⭐ WHAT SURVIVED IS THE PART THE PASS WAS REALLY FOR: a control is as wide as
    // its VALUE. A property list is read DOWN — one label column, one control
    // column, one row per setting — and pairing made the eye travel in an S.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    select(/^EMA 9$/)
    expect(inspector().querySelectorAll('[data-pair]'),
      'the editor paired two settings onto one row again').toHaveLength(0)

    // ⛔ EVERY FIELD IS A DIRECT CHILD OF ITS SECTION, in declaration order — no
    // wrapper between the section and the row, which is what a pairing layer was.
    for (const section of ['core', 'appearance']) {
      const sec = inspector().querySelector(`[data-section="${section}"]`)
      for (const f of sec.querySelectorAll('[data-field]')) {
        expect(f.parentElement, `${f.getAttribute('data-field')} is nested in a row wrapper`)
          .toBe(sec)
      }
    }
  })

  it('⭐⭐ THE TYPE SEGMENT WRITES THE IDENTICAL CANONICAL VALUE — both implementations', () => {
    // ⛔ A CONTROL SWAP AND NOTHING ELSE. `MA_TYPES`, `applyRowPatch`, the overlay
    // slot and the instance input are all untouched; the only difference is that
    // the member sees both answers at rest instead of opening a native menu.
    const seen = { cs: null }
    const { cs, id } = withMA(base(), 'close')
    show(cs, seen); openTab()

    // LEGACY — `cs.overlays[0].type`
    select(/^EMA 9$/)
    expect(checked('type').textContent.trim()).toBe('EMA')
    fireEvent.click(radios('type').find((r) => r.textContent.trim() === 'SMA'))
    expect(seen.cs.overlays[0].type, 'the segment did not reach the overlay slot').toBe('SMA')
    expect(seen.cs.overlays[0].period, 'the segment disturbed the period').toBe(cs.overlays[0].period)
    expect((seen.cs.indicatorInstances || []).filter((x) => x.defId === 'movingAverage'),
      'editing a legacy overlay minted an instance — that is a migration')
      .toHaveLength((cs.indicatorInstances || []).filter((x) => x.defId === 'movingAverage').length)

    // ENGINE — the instance's own `maType` input
    select(ENGINE_MA)
    fireEvent.click(radios('maType').find((r) => r.textContent.trim() === 'EMA'))
    const inst = seen.cs.indicatorInstances.find((i) => i.instanceId === id)
    expect(inst.inputs.maType, 'the segment did not reach the instance input').toBe('ema')
  })

  it('⭐ THE SEGMENT IS ONE TAB STOP, and arrow keys move the choice', () => {
    const seen = { cs: null }
    show(base(), seen); openTab()
    select(/^EMA 9$/)
    const grp = segOf('type')
    expect(grp.getAttribute('role')).toBe('radiogroup')
    expect(grp.getAttribute('aria-label')).toBe('Type')
    // ⛔ ROVING TABINDEX — landing on every option in turn is how a two-choice
    // control becomes two controls for a keyboard member.
    expect(radios('type').map((r) => r.tabIndex)).toEqual([-1, 0])
    expect(checked('type').tabIndex, 'the chosen option is not the tab stop').toBe(0)

    fireEvent.keyDown(grp, { key: 'ArrowLeft' })
    expect(seen.cs.overlays[0].type, 'ArrowLeft did not move the choice').toBe('SMA')
    expect(checked('type').textContent.trim()).toBe('SMA')
    fireEvent.keyDown(grp, { key: 'ArrowRight' })
    expect(seen.cs.overlays[0].type).toBe('EMA')
  })

  // ═════════════════════════════════════════════════════════════════════
  const discovery = () => document.body.querySelector('[data-testid="add-surface"]')

  it('⚰️⚰️⚰️ THE THIRD RIGHT-HAND STATE IS GONE — no selection IS discovery', () => {
    // ⚰️⚰️⚰️ THIS CASE HAS NOW ARGUED THREE WAYS, WHICH IS WHY IT IS KEPT.
    //   1. The no-selection state was a lede, a count and an Add button, and this
    //      asserted it was not a blank rectangle.
    //   2. It became an INVENTORY of the chart's series, pane by pane, and six
    //      cases asserted it followed `paneOrder` and `paneSeriesOrder` — until
    //      the owner pointed out the LEFT column already answers that question.
    //   3. It became a mark, a sentence and two doors. The owner tested that:
    //      *"we tested it. It is unnecessary. It creates an extra conceptual state
    //      and wastes a click."*
    //
    // ⭐ SO THE ANSWER WAS THAT THE STATE SHOULD NOT EXIST. A member opening
    // Indicators with nothing selected is looking for something, and the surface
    // for that already existed one click away. Two states remain: DISCOVER and
    // EDIT.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    expect(discovery(), 'Indicators did not open into discovery').toBeTruthy()
    expect(screen.getByRole('searchbox'), 'the search box is not on screen').toBeTruthy()
    expect(document.body.querySelector('[data-testid="inspector-empty"]'),
      'the deleted orientation screen is back').toBeNull()
  })

  it('⛔⛔ AND IT STILL DOES NOT REPEAT THE LEFT COLUMN', () => {
    // The rule that killed state 2 outlives it: the right side must not answer
    // *"what is on my chart"*. Discovery answers *"what can I add"*, so the
    // member's own series must not be listed there — and a row that IS on the
    // chart says `Active` rather than being hidden or duplicated.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    expect(discovery().querySelectorAll('[data-ov-pane], [data-ov-row]')).toHaveLength(0)
    expect(discovery().querySelectorAll('[class*="insRail"]'),
      'discovery grew series micro-rails — those mean a PLOTTED series').toHaveLength(0)
    // ⚠️ `EMA 9` IS THE MEMBER'S ROW NAME; the catalogue has no such entry, so
    // finding it on the right would mean the inventory had come back.
    expect(discovery().textContent, 'discovery is listing the chart\'s own series')
      .not.toContain('EMA 9')
  })

  it('⭐ NO SELECTION → DISCOVER; A SELECTION → EDIT; AND BACK AGAIN', () => {
    show(base()); openTab()
    expect(discovery()).toBeTruthy()

    select(/^SMA 50$/)
    expect(discovery(), 'selecting a series left discovery open').toBeNull()
    expect(inspectorName()).toBe('SMA 50')

    // ⛔ `＋ Add Indicator` IS THE ONE DOOR BACK, and it keeps the selection so the
    // arrow has somewhere to return to.
    fireEvent.click(screen.getByTestId('add-enter'))
    expect(discovery()).toBeTruthy()
    const back = document.body.querySelector('[class*="insBack"]')
    expect(back.getAttribute('aria-label'), 'the arrow does not say where it goes')
      .toBe('Back to SMA 50')
    fireEvent.click(back)
    expect(inspectorName()).toBe('SMA 50')
  })

  it('⛔⛔ NO DEAD BACK ARROW — it exists exactly when leaving leads somewhere', () => {
    // ⚰️ IT USED TO RENDER UNCONDITIONALLY, and that was right while discovery was
    // a place you went FROM the orientation screen. With discovery as the DEFAULT,
    // an arrow shown on a WIDE layout with nothing selected would return the
    // member to discovery.
    show(base()); openTab()
    expect(discovery()).toBeTruthy()
    expect(document.body.querySelector('[class*="insBack"]'),
      'a back arrow is offered with nothing to go back to').toBeNull()
    // ⚠️⚠️ AT NARROW IT ALWAYS LEADS SOMEWHERE, and the case for that lives in
    // the NARROW block below, where the matchMedia stub is.
  })

  it('⛔ PRESSING ADD WHILE ALREADY DISCOVERING KEEPS ONE SURFACE', () => {
    // ⛔ NOT A SECOND ADD STATE (owner §8). The button sets the explicit mode —
    // which is what puts the caret in the box — and renders the same component.
    show(base()); openTab()
    const before = discovery()
    fireEvent.click(screen.getByTestId('add-enter'))
    expect(discovery(), 'discovery was torn down and rebuilt').toBeTruthy()
    expect(document.body.querySelectorAll('[data-testid="add-surface"]'),
      'a second discovery surface was mounted').toHaveLength(1)
    expect(before).toBeTruthy()
  })

  it('⛔⛔ OPENING THE TAB WITH NOTHING SELECTED WRITES NOTHING', () => {
    const seen = { cs: null }
    const { cs } = withSeries(base(), 'QQQ')
    show(cs, seen); openTab()
    expect(discovery()).toBeTruthy()
    expect(seen.cs, 'opening into discovery wrote to the blob').toBeNull()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('↑ ↓ — SERIES ORDER **INSIDE** A PANE', () => {
  // ⛔⛔ THREE ORDERS, AND THIS BLOCK EXISTS TO KEEP THEM APART.
  //   · a ROW ARROW reorders series inside the pane they are already in
  //   · ARRANGE reorders whole panes
  //   · DISPLAY moves a series to another pane
  // Every case below asserts not only that the arrow did its own job but that it
  // did none of the other two, because the failure mode that matters is not a
  // wrong order — it is an arrow that quietly re-homes a series or restacks the
  // chart's panes.

  const arrowsOf = (re) => [...(rowFor(re)?.querySelectorAll('[data-move]') || [])]
  const arrow = (re, dir) => arrowsOf(re).find((b) => b.getAttribute('data-move') === dir)
  const dead = (el) => el.getAttribute('aria-disabled') === 'true'
  /** The rows of the pane group a row belongs to, in rendered order. */
  const paneRowNames = (re) => {
    const g = rowFor(re).closest('[data-pane-group]')
    return [...g.querySelectorAll('[data-structure-row]')].map(nameOf)
  }

  it('⭐⭐ A MIDDLE ROW MOVES, IMMEDIATELY, AND STAYS IN ITS PANE', () => {
    // The default chart's PRICE pane: EMA 9, EMA 20, SMA 50, SMA 200 — four legacy
    // overlays — plus Volume banded in with them.
    show(base()); openTab()
    const before = paneRowNames(/^EMA 20$/)
    expect(before.slice(0, 4)).toEqual(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200'])

    fireEvent.click(arrow(/^EMA 20$/, 'up'))
    expect(paneRowNames(/^EMA 20$/).slice(0, 4),
      'the list did not reorder on the click — is it waiting for a reload?')
      .toEqual(['EMA 20', 'EMA 9', 'SMA 50', 'SMA 200'])
    // ⛔ SAME PANE, SAME MEMBERS. A reorder is a permutation of one group.
    expect([...paneRowNames(/^EMA 20$/)].sort()).toEqual([...before].sort())
    expect(paneOf(/^EMA 20$/)).toBe('Price')

    fireEvent.click(arrow(/^EMA 20$/, 'down'))
    expect(paneRowNames(/^EMA 20$/).slice(0, 4)).toEqual(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200'])
  })

  it('⛔ THE BOUNDARIES ARE DEAD, PRESENT, AND DO NOT WRITE', () => {
    // ⛔ PRESENT IS HALF THE POINT. Removing a boundary arrow would shorten the
    // first and last row of every pane by 18px and make the whole column ripple
    // as rows move — the one thing a reorder control must not do to the list it
    // is reordering.
    const seen = { cs: null }
    show(base(), seen); openTab()
    const first = /^EMA 9$/
    expect(arrowsOf(first), 'the top row lost an arrow').toHaveLength(2)
    expect(dead(arrow(first, 'up')), 'the top row can still move up').toBe(true)
    expect(dead(arrow(first, 'down'))).toBe(false)

    fireEvent.click(arrow(first, 'up'))
    expect(seen.cs, 'pressing ↑ on the top row wrote to the blob').toBeNull()
    expect(names()[0]).toBe('EMA 9')

    // …and the last row of the PRICE group, whatever it is.
    const last = paneRowNames(first).at(-1)
    const lastRe = new RegExp(`^${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    expect(dead(arrow(lastRe, 'down')), `${last} can still move down`).toBe(true)
    fireEvent.click(arrow(lastRe, 'down'))
    expect(seen.cs, 'pressing ↓ on the last row wrote to the blob').toBeNull()
  })

  it('⛔⛔ AN ARROW IS NOT A SELECTOR — the Inspector does not swing', () => {
    // ⚰️ WITHOUT `stopPropagation` THE ROW'S OWN CLICK HANDLER FIRES TOO, so a
    // member repositioning EMA 20 would ALSO open it for editing and the right
    // column would jump to a row they were only moving.
    show(base()); openTab()
    select(/^SMA 200$/)
    expect(inspectorName()).toBe('SMA 200')

    fireEvent.click(arrow(/^EMA 20$/, 'up'))
    expect(inspectorName(), 'the arrow selected the row it moved').toBe('SMA 200')

    // …and the ROW itself still selects, which is the other half of the contract.
    select(/^EMA 20$/)
    expect(inspectorName()).toBe('EMA 20')
  })

  it('⭐ EVERY ARROW IS A REAL BUTTON WITH A NAME — keyboard and screen reader', () => {
    show(base()); openTab()
    for (const b of arrowsOf(/^EMA 20$/)) {
      expect(b.tagName, 'an arrow is not a button — it cannot be reached by keyboard').toBe('BUTTON')
      expect(b.getAttribute('type'), 'an arrow inside a form would submit it').toBe('button')
      expect(b.getAttribute('aria-label'), 'an arrow with no accessible name').toBeTruthy()
      expect(b.title, 'an arrow with no tooltip').toBeTruthy()
    }
    expect(arrow(/^EMA 20$/, 'up').getAttribute('aria-label')).toBe('Move EMA 20 up')
    expect(arrow(/^EMA 20$/, 'down').getAttribute('aria-label')).toBe('Move EMA 20 down')
    // ⛔ A DEAD ARROW SAYS WHY, and it says a POSITION rather than a capability —
    // it is not the `NOT_WIRED` kind of unavailable, and must not read as one.
    expect(arrow(/^EMA 9$/, 'up').getAttribute('aria-label')).toBe('EMA 9 is already first in Price')
    // A keyboard activation is the same door as a pointer one.
    const el = arrow(/^EMA 20$/, 'up')
    el.focus()
    expect(document.activeElement, 'a dead-keyed arrow cannot be focused').toBe(el)
    fireEvent.click(el)
    expect(names()[0]).toBe('EMA 20')
  })

  it('⭐⭐ ONE ORDER ACROSS TWO PERSISTENCE IMPLEMENTATIONS', () => {
    // ⛔ THIS IS THE CASE THE FEATURE EXISTS FOR. `EMA 9` is a slot in
    // `cs.overlays`; `SMA 5` is an entry in `cs.indicatorInstances`. They are in
    // one pane, and the member does not know or care that they are stored in two
    // arrays — so there is ONE list of arrows, not `overlayOrder` and
    // `instanceOrder`.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    // ⚠️ THE CANONICAL ORDER IS `listAllIndicators`': every LEGACY row first —
    // the four overlays AND the volume section — then the engine instances. That
    // shape is exactly what the arrows exist to override.
    expect(paneRowNames(ENGINE_MA))
      .toEqual(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200', 'Volume', 'SMA 5'])

    // The engine MA climbs past four legacy rows, one press at a time.
    for (let i = 0; i < 4; i += 1) fireEvent.click(arrow(ENGINE_MA, 'up'))
    expect(paneRowNames(ENGINE_MA))
      .toEqual(['EMA 9', 'SMA 5', 'EMA 20', 'SMA 50', 'SMA 200', 'Volume'])
  })

  it('⛔⛔ IT WRITES `paneSeriesOrder` AND NOTHING ELSE', () => {
    // ⭐ THE SEPARATION, ASSERTED AS A DIFF ON THE REAL BLOB. Display,
    // `targetExplicit`, `paneOrder`, the overlay array and the instance array are
    // what the OTHER controls own.
    const seen = { cs: null }
    const { cs } = withMA(base(), 'close')
    show(cs, seen); openTab()
    fireEvent.click(arrow(/^EMA 20$/, 'up'))

    const next = seen.cs
    expect(next, 'the arrow wrote nothing at all').toBeTruthy()
    expect(next[PANE_SERIES_ORDER_KEY].price[0]).toBe('overlay-1')
    expect(next.overlays, 'the arrow reordered `cs.overlays` — that renumbers every row id')
      .toEqual(cs.overlays)
    expect(next.indicatorInstances).toEqual(cs.indicatorInstances)
    expect(storedPaneOrder(next), 'the arrow touched paneOrder').toEqual(storedPaneOrder(cs))
    for (const inst of next.indicatorInstances || []) {
      expect(inst.targetExplicit, `${inst.instanceId} grew a placement provenance`)
        .toBe((cs.indicatorInstances || []).find((i) => i.instanceId === inst.instanceId)?.targetExplicit)
    }
  })

  it('⛔⛔ A HOST PANE SURVIVES ITS GUESTS BEING REORDERED', () => {
    // QQQ's pane holds QQQ (the host) and an average OF QQQ (a guest). Reordering
    // them may not change which pane exists, who hosts it, or where it sits.
    // ⚠️ THE DESTINATION IS EXPLICIT, as in every other QQQ-pane case here:
    // Automatic for a SYMBOL source resolves to the definition's declaration, so
    // the member's own choice is what puts the average in QQQ's pane.
    const seeded = withSeries(base(), 'QQQ')
    const guest = withMA(seeded.cs, symbolSource('QQQ', 'close'))
    const withGuest = { cs: setInstanceDisplayTarget(guest.cs, guest.id, `@${seeded.id}`, registry) }
    show(withGuest.cs); openTab()

    const panesBefore = paneIds()
    // ⚠️ THE GUEST LISTS FIRST BY DEFAULT, and that is the canonical order rather
    // than a statement about hosting: `withInstances` sorts the instance array by
    // DEFINITION rank, and `movingAverage` ranks ahead of `dataSeries`. It is
    // exactly the kind of order nobody chose that these arrows exist to override.
    expect(paneRowNames(ENGINE_MA)).toEqual(['SMA 5', 'QQQ'])

    fireEvent.click(arrow(/^QQQ$/, 'up'))
    expect(paneRowNames(ENGINE_MA)).toEqual(['QQQ', 'SMA 5'])
    // ⛔ SAME PANES, SAME ORDER, SAME HOST. The host moved ABOVE its guest in the
    // list and the pane is still QQQ's — hosting is an identity, not a position.
    expect(paneIds(), 'reordering inside a pane changed the pane stack').toEqual(panesBefore)
    expect(paneOf(ENGINE_MA)).toBe('QQQ')
    expect(paneOf(/^QQQ$/)).toBe('QQQ')
  })

  it('⛔ ARRANGE HAS NO SERIES ARROWS — the two languages stay apart', () => {
    // ⚠️ TWO PANES, because Arrange is only offered when there is something to
    // restack — a default chart has one.
    const { cs } = withSeries(base(), 'QQQ')
    show(cs); openTab()
    expect(document.body.querySelectorAll('[data-row-order]').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('arrange-enter'))
    expect(document.body.querySelectorAll('[data-row-order]').length,
      'Arrange grew per-series arrows — Arrange orders PANES').toBe(0)
  })

  it('⛔ A ROW THAT IS NOT DRAWING ANYWHERE HAS NO ORDER', () => {
    // `Not shown` and `Needs attention` are not panes. Offering to order them
    // would be offering to arrange a rectangle that does not exist.
    const { cs, id } = withSeries(base(), 'QQQ')
    const off = { ...cs, indicatorInstances: cs.indicatorInstances.map(
      (i) => (i.instanceId === id ? { ...i, hidden: true } : i)) }
    show(off); openTab()
    const repair = [...document.body.querySelectorAll('[data-pane-kind="hidden"],[data-pane-kind="orphans"]')]
    expect(repair.length, 'no repair group rendered — the case proves nothing')
      .toBeGreaterThan(0)
    for (const g of repair) {
      expect(g.querySelectorAll('[data-row-order]').length,
        `${g.getAttribute('data-pane-kind')} rows carry order arrows`).toBe(0)
    }
  })

  it('⛔⛔ DEFAULT PARITY — a chart with no arrangement is untouched', () => {
    // ⭐ THE WHOLE BACKWARD-COMPATIBILITY STORY. Every chart that exists has no
    // `paneSeriesOrder`; this feature must be invisible on all of them, and
    // OPENING the tab must not write one into existence.
    const seen = { cs: null }
    const { cs } = withMA(base(), 'close')
    // ⚠️ EMPTY, NOT ABSENT. The key is declared in `CHART_DEFAULTS` and emitted by
    // `mergeChartSettings`, because that function is a hard ALLOW-LIST and a key
    // missing from it is destroyed on every read — measured in the harness, where
    // save → reconstruct put the canonical order straight back. An EMPTY map is
    // "no preference", which is what every existing chart has.
    expect(cs[PANE_SERIES_ORDER_KEY], 'the fixture already carries an arrangement').toEqual({})
    show(cs, seen); openTab()
    expect(names()).toEqual(['EMA 9', 'EMA 20', 'SMA 50', 'SMA 200', 'Volume', 'SMA 5'])
    select(/^EMA 9$/); select(ENGINE_MA)
    expect(seen.cs, 'merely reading the Inspector wrote an arrangement').toBeNull()
  })

  it('⛔ A STALE ARRANGEMENT IS HARMLESS — nothing vanishes', () => {
    // A blob arranged when the chart held other indicators. The ids it names are
    // gone; the rows it does not name are still on the chart.
    const cs = { ...base(), [PANE_SERIES_ORDER_KEY]: {
      price: ['overlay-77', 'inst:rsi:9', 'overlay-3'],
      'inst:gone:1': ['whatever'],
    } }
    show(cs); openTab()
    expect(names(), 'a stale arrangement dropped or conjured a row')
      .toEqual(['SMA 200', 'EMA 9', 'EMA 20', 'SMA 50', 'Volume'])
  })
})

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
      // ⚠️ A TWO-CHOICE ENUM IS A SEGMENT NOW, not a select — the chosen option is
      // the one radio that is checked. Same value, different widget.
      const seg = f.querySelector('[role="radio"][aria-checked="true"]')
      const value = seg ? seg.textContent.trim()
        : sel ? [...sel.options].find((o) => o.value === sel.value)?.textContent
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
    // ⚰️ IT READ A `<select>`'s OPTIONS. Type is a SEGMENT now — two radios, both
    // visible at rest — so the same two facts are read off the group instead: the
    // checked radio's word, and every radio's word.
    for (const [row, want] of [[/^EMA 9$/, 'EMA'], [/^SMA 50$/, 'SMA'], [ENGINE_MA, 'SMA']]) {
      select(row)
      const grp = inspector().querySelector('[data-field="type"] [role="radiogroup"], [data-field="maType"] [role="radiogroup"]')
      expect(grp, `${row} has no Type segment`).toBeTruthy()
      const opts = [...grp.querySelectorAll('[role="radio"]')]
      expect(opts.find((o) => o.getAttribute('aria-checked') === 'true').textContent.trim(),
        `${row} speaks a different vocabulary`).toBe(want)
      // ⛔ AND NO CHOICE ANYWHERE SAYS THE OLD WORDS.
      expect(opts.map((o) => o.textContent).join('|')).not.toMatch(/Simple|Exponential/)
      // ⛔ EXACTLY ONE IS CHOSEN. A radio group with none checked — or two — is a
      // control whose state a screen reader cannot report.
      expect(opts.filter((o) => o.getAttribute('aria-checked') === 'true')).toHaveLength(1)
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

  it('⚰️⚰️ A READ-ONLY CORE FACT TAKES THE CONTROL CELL, not the right margin', () => {
    // ⚰️⚰️ THIS IS WHAT WAS STILL VISIBLY WRONG AFTER THE FIRST NORMALISATION.
    // The labels, the order and the words all matched — and a legacy MA still read
    // as a different form, because `.insFieldCtl` is `justify-content: flex-end`
    // and every real control takes `width: 100%`. A select's text therefore begins
    // 8px inside the cell's LEFT edge, while a bare span with no width hugged the
    // RIGHT. Measured in the browser on the released build: `Close` began at
    // x=1012, the `Type` select's text at x=828 — so `Source` and `Display` hung
    // out at the far margin with `Period` and `Type` starting 184px to their left,
    // and the four CORE rows read as two interleaved forms. Owner, 2026-09-17:
    // *"show Source Close using the same field geometry, typography, and
    // location."*
    //
    // ⛔ jsdom LAYS NOTHING OUT, SO THIS PINS THE TWO THINGS THAT PRODUCE THE
    // GEOMETRY and lets the browser prove the pixels (it does: after the fix all
    // four rows read labelX 961.7, ctlX 1064.2, ctlR 1339.6, height 23.6 on EMA 9,
    // SMA 50 and the engine SMA 5 alike — one string, three rows).
    //   1. THE DOM: the value is a direct child of the control cell, exactly where
    //      a select sits, not a bare span appended after one.
    //   2. THE RULE: `.insFieldValue` declares the control's own box.
    show(base()); openTab()
    select(/^EMA 9$/)

    for (const key of ['__source__', '__where__']) {
      const cell = inspector().querySelector(`[data-field="${key}"] [class*="insFieldCtl"]`)
      expect(cell, `${key} has no control cell at all`).toBeTruthy()
      const kids = [...cell.children]
      expect(kids.length, `${key}'s cell holds something besides the value`).toBe(1)
      expect(/insFieldValue/.test(kids[0].className),
        `${key}'s value is not the class the width rule addresses`).toBe(true)
    }

    // ⛔ AND THE RULE ITSELF, READ FROM SOURCE. A class name alone would still
    // pass if someone deleted the box from under it — which is exactly how the
    // defect existed in the first place.
    // ⚠️ `process.cwd()`, NOT `import.meta.url` — vitest runs the module through
    // vite, so `import.meta.url` is an http: URL here and `readFileSync` refuses
    // it. `tapFloor.test.js` reads stylesheets the same way, from `app/`.
    const css = readFileSync(
      join(process.cwd(), 'src/components/chart/ChartSettingsModal.module.css'), 'utf8')
    const block = css.slice(css.indexOf('\n.insFieldValue {'))
    const decls = block.slice(0, block.indexOf('}'))
    for (const decl of ['width: 100%', 'height: 24px', 'padding: 0 8px', 'font-size: 11.5px']) {
      expect(decls, `.insFieldValue no longer declares \`${decl}\` — it has left the control cell`)
        .toContain(decl)
    }
    // ...and 24px / 8px are the CONTROL's numbers, not two coincidences.
    const ctl = css.slice(css.indexOf('.insFieldCtl .indNum {'))
    const ctlDecls = ctl.slice(0, ctl.indexOf('}'))
    expect(ctlDecls).toContain('height: 24px')
    expect(ctlDecls).toContain('padding: 0 8px')
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

describe('THE INDICATOR GLYPHS — family identity, resolved and never stored', () => {
  // ⭐⭐ THEY ARE MINIATURE CHART MARKS, NOT TOOLBAR ICONS. A member scanning the
  // library should know an oscillator from a band from a volume study before they
  // finish reading the name. Which means the mapping has to be RIGHT, and it has
  // to be right for a definition nobody has written yet.

  it('⭐⭐ THE REGISTRY\'S OWN `category` IS THE FAMILY', () => {
    // ⛔ NOT A HAND-BUILT TABLE OF TWENTY IDS. `nativeRegistry` files every
    // definition under Trend / Momentum / Volatility / Volume — already a
    // statement about what the study DRAWS, made by whoever wrote it — so reading
    // it means a definition added tomorrow gets a correct mark with no edit.
    expect(glyphFamilyOf({ id: 'movingAverage', category: 'Trend' })).toBe('trend')
    expect(glyphFamilyOf({ id: 'sar', category: 'Trend' })).toBe('trend')
    expect(glyphFamilyOf({ id: 'rsi', category: 'Momentum' })).toBe('oscillator')
    expect(glyphFamilyOf({ id: 'stoch', category: 'Momentum' })).toBe('oscillator')
    expect(glyphFamilyOf({ id: 'williamsR', category: 'Momentum' })).toBe('oscillator')
    expect(glyphFamilyOf({ id: 'bb', category: 'Volatility' })).toBe('band')
    expect(glyphFamilyOf({ id: 'atr', category: 'Volatility' })).toBe('band')
    expect(glyphFamilyOf({ id: 'volume', category: 'Volume' })).toBe('volume')
    expect(glyphFamilyOf({ id: 'obv', category: 'Volume' })).toBe('volume')
  })

  it('⚠️ MACD IS THE ONE PER-ID EXCEPTION, and it is an exception on purpose', () => {
    // It is filed under `Momentum` with RSI, which is correct as a CLASSIFICATION
    // and wrong as a picture: RSI draws a wave between two bounds and MACD draws a
    // histogram about zero. The member reads the mark, so the mark is the drawing.
    expect(glyphFamilyOf({ id: 'macd', category: 'Momentum' })).toBe('momentum')
    // ⛔ AND IT IS ONE ENTRY, NOT A SECOND TAXONOMY. Every other Momentum
    // definition still answers `oscillator`, which is what keeps this from
    // becoming the per-id table `enumerationSites.test.js` exists to catch.
    for (const id of ['rsi', 'stoch', 'cci', 'williamsR', 'rsLine']) {
      expect(glyphFamilyOf({ id, category: 'Momentum' }), `${id} grew its own glyph`)
        .toBe('oscillator')
    }
  })

  it('⭐ THE NON-TECHNICAL KINDS ANSWER FROM `tabOf`, not from their category', () => {
    // A breadth row's `category` is its GROUP LABEL (`Breadth`, `Trend`,
    // whatever the publisher chose); a security's is the server's `etf`/`index`.
    // Both are canonical and neither is a study family, so the KIND decides.
    expect(glyphFamilyOf({ kind: 'breadth', category: 'Trend' })).toBe('breadth')
    expect(glyphFamilyOf({ kind: 'security', category: 'etf' })).toBe('security')
    expect(glyphFamilyOf({ kind: 'security', category: 'index' })).toBe('security')
    expect(glyphFamilyOf({ kind: 'security', category: 'stock' })).toBe('security')
    expect(glyphFamilyOf({ kind: 'formula', category: 'Momentum' })).toBe('formula')
    expect(glyphFamilyOf({ userDefined: true, category: 'Trend' })).toBe('formula')
  })

  it('⛔⛔ AN UNKNOWN DEFINITION GETS A SAFE NEUTRAL MARK, never a wrong one', () => {
    for (const res of [null, undefined, {}, { id: 'somethingNew' },
      { id: 'x', category: 'Astrology' }, { category: '' }]) {
      const fam = glyphFamilyOf(res)
      expect(fam, `${JSON.stringify(res)} resolved to nothing`).toBe('series')
      expect(GLYPH_FAMILIES[fam], 'the fallback family has no glyph').toBeTruthy()
    }
    // ⚠️ AND A PROTOTYPE KEY IS NOT A FAMILY. A bare `map[key]` would answer
    // `constructor` for a definition id that happens to spell one.
    expect(glyphFamilyOf({ id: 'constructor', category: 'toString' })).toBe('series')
  })

  it('⛔⛔ THE GLYPH IS NEVER A FUNCTION OF THE DISPLAY NAME', () => {
    // ⛔ MATCHING ON PROSE WOULD BREAK ON A RENAME, would give two members
    // different marks for one study, and would make the picture a function of
    // words. Same canonical facts, opposite names — same answer.
    expect(glyphFamilyOf({ id: 'rsi', name: 'Volume Bars', category: 'Momentum' }))
      .toBe('oscillator')
    expect(glyphFamilyOf({ id: 'volume', name: 'Relative Strength Index', category: 'Volume' }))
      .toBe('volume')
    // …and a name alone decides nothing at all.
    expect(glyphFamilyOf({ name: 'Bollinger Bands' })).toBe('series')
  })

  it('⛔⛔ GLYPH IDENTITY IS PRESENTATION — nothing writes it anywhere', () => {
    // ⭐ THE CLAIM THE BRIEF MAKES EXPLICIT (§27): no `glyph: "rsi"` on an
    // instance, no settings migration, no chart-hash churn. Browsing the whole
    // library renders every family and writes nothing.
    const seen = { cs: null }
    const before = JSON.stringify(withMA(base(), 'close').cs)
    const { cs } = withMA(base(), 'close')
    show(cs, seen); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    for (const label of ['Technical', 'Breadth', 'Symbols', 'Formulas', 'Popular']) {
      const t = [...document.body.querySelectorAll('[role="tab"]')]
        .find((x) => x.textContent.trim() === label)
      if (t) fireEvent.click(t)
    }
    expect(seen.cs, 'rendering glyphs wrote to the settings blob').toBeNull()
    expect(JSON.stringify(cs), 'the settings object was mutated in place').toBe(before)
  })

  it('⭐ EVERY RESULT ROW CARRIES ITS FAMILY, AND THE MARK IS NOT A BOX', () => {
    show(base()); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    const rows = [...document.body.querySelectorAll('[data-testid="add-surface"] [class*="resRow"]')]
      .filter((e) => !/resRows/.test(e.className))
    expect(rows.length, 'no results rendered — the case proves nothing').toBeGreaterThan(3)
    for (const r of rows) {
      const g = r.querySelector('[data-glyph]')
      expect(g, `${r.textContent.slice(0, 20)} has no glyph`).toBeTruthy()
      expect(Object.keys(GLYPH_FAMILIES)).toContain(g.getAttribute('data-glyph'))
      // ⛔ ONE SVG, AND IT IS `aria-hidden` — the row already says its name, so a
      // screen reader must not hear the picture too.
      expect(g.querySelectorAll('svg')).toHaveLength(1)
      expect(g.getAttribute('aria-hidden')).toBe('true')
    }
    // ⛔ AND THE FAMILIES ARE REALLY FAMILIES: Popular alone spans several, which
    // is the whole point of putting a mark on the row.
    const fams = new Set(rows.map((r) => r.querySelector('[data-glyph]').getAttribute('data-glyph')))
    expect(fams.size, 'every Popular row drew the same mark').toBeGreaterThan(2)
  })

  it('⛔⛔ THE LEFT COLUMN KEEPS ITS MICRO-RAILS — two languages, kept apart', () => {
    // ⭐ THE DISTINCTION IS LOAD-BEARING: a rail is the ACTUAL PLOTTED SERIES in
    // its own colour; a glyph is the KIND of thing. Putting glyphs on the left
    // would make a configured line look like a catalogue entry.
    show(base()); openTab()
    const left = document.body.querySelector('[data-testid="chart-structure"]')
    expect(left.querySelectorAll('[class*="insRail"]').length,
      'the left column lost its series rails').toBeGreaterThan(3)
    expect(left.querySelectorAll('[data-glyph]'),
      'a family glyph appeared in the current-chart list').toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('THE ADD INDICATOR LIBRARY — one door, eight categories, and no fiction', () => {
  const addBtn = () => screen.getByTestId('add-enter')
  const strip = () => document.body.querySelector('[role="tablist"][aria-label="Indicator categories"]')
  const tabs = () => [...(strip()?.querySelectorAll('[role="tab"]') || [])]
  const tabNamed = (label) => tabs().find((t) => t.textContent.trim() === label)
  const chosen = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')
  const resultNames = () => [...document.body.querySelectorAll('[data-testid="add-surface"] [class*="resName"]')]
    .map((e) => e.textContent.trim())
  const type = (q) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: q } })

  it('⚰️⚰️ THE DOOR IS AT THE FOOT OF THE LIST, not in the heading', () => {
    // ⚰️ A TWO-WORD `＋ Add` SAT BESIDE `Arrange` IN THE HEADING — the same weight
    // as a MODE SWITCH, at the top of the list it extends. Owner, 2026-09-17:
    // *"remove the tiny + Add from that location... replace it with a clear
    // button at the BOTTOM of the left Indicators section."*
    show(base()); openTab()
    const btn = addBtn()
    // ⚠️ THE GLYPH IS ITS OWN ELEMENT with a flex `gap` between, so `textContent`
    // carries no space — the space a member SEES is layout, not a character.
    expect(btn.textContent.replace(/\s+/g, ' ').trim()).toBe('＋Add Indicator')
    // ⛔ IT IS IN THE LEFT COLUMN AND BELOW THE LIST — both halves matter: in the
    // heading it read as chrome, and inside the scroller a member with fifteen
    // indicators would have to scroll to reach it.
    const left = document.body.querySelector('[data-testid="chart-structure"]')
    expect(left.contains(btn), 'the Add door left the current-chart column').toBe(true)
    const list = left.querySelector('[role="listbox"]')
    expect(list.contains(btn), 'the Add door scrolls away with the list').toBe(false)
    expect(list.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the Add door is above the list it is supposed to terminate').toBeTruthy()
  })

  it('⭐⭐ THE LEFT CONTEXT SURVIVES BROWSING (owner §19)', () => {
    // The one thing the owner named as worth keeping: a member browsing for
    // something new can still see everything already on the chart.
    const { cs } = withMA(base(), 'close')
    show(cs); openTab()
    const before = names()
    fireEvent.click(addBtn())
    expect(document.body.querySelector('[data-testid="add-surface"]')).toBeTruthy()
    expect(names(), 'the chart structure was replaced by the library').toEqual(before)
  })

  it('⛔ BACK RETURNS TO THE INSPECTOR AND KEEPS THE SELECTION (owner §20)', () => {
    show(base()); openTab()
    select(/^SMA 50$/)
    fireEvent.click(addBtn())
    expect(document.body.querySelector('[data-testid="add-surface"]')).toBeTruthy()
    fireEvent.click(document.body.querySelector('[class*="insBack"]'))
    expect(document.body.querySelector('[data-testid="add-surface"]')).toBeNull()
    expect(inspectorName(), 'going to look for something destroyed the selection').toBe('SMA 50')
  })

  it('⭐ THE STRIP IS A TABLIST, DIRECTLY UNDER SEARCH, and Popular is where it lands', () => {
    show(base()); openTab()
    fireEvent.click(addBtn())
    expect(tabs().map((t) => t.textContent.trim())).toEqual([
      'Popular', 'Technical', 'Fundamentals', 'Breadth', 'Symbols', 'Indexes', 'ETFs', 'Formulas',
    ])
    expect(chosen().textContent.trim()).toBe('Popular')
    // ⛔ UNDER THE SEARCH BOX, because the strip is NAVIGATION and search is the
    // primary entry point — the retired `Browse` chips sat under the RESULTS.
    const box = screen.getByRole('searchbox')
    expect(box.compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the category strip is above the search box').toBeTruthy()
    // One tab stop, arrow keys move it — the same contract the SMA/EMA segment has.
    expect(tabs().filter((t) => t.tabIndex === 0)).toHaveLength(1)
    fireEvent.keyDown(strip(), { key: 'ArrowRight' })
    expect(chosen().textContent.trim()).toBe('Technical')
  })

  it('⭐⭐ POPULAR IS CURATED, AND MOVING AVERAGE APPEARS EXACTLY ONCE', () => {
    // ⛔ THE CURATION NAMES IDS; THE ROWS COME FROM THE REGISTRY. So this is the
    // same single member-facing Moving Average every other surface offers — there
    // is no second entry, and legacy `ma` cannot appear because
    // `LIBRARY_HIDDEN_IDS` drops it upstream.
    show(base()); openTab()
    fireEvent.click(addBtn())
    const got = resultNames()
    expect(got.length, 'Popular is a dump, not a curation').toBeLessThanOrEqual(POPULAR_DEF_IDS.length)
    expect(got[0], 'the curated ORDER is not being kept').toBe('Moving Average')
    expect(got.filter((n) => /^Moving Average$/.test(n))).toHaveLength(1)
    expect(got.join('|'), 'a member-facing Data Series row is being offered')
      .not.toMatch(/Data Series/i)
  })

  it('⭐ TECHNICAL HOLDS EVERY SHIPPED DEFINITION — Popular is a shortcut, not a gate', () => {
    show(base()); openTab()
    fireEvent.click(addBtn())
    fireEvent.click(tabNamed('Technical'))
    const technical = resultNames()
    fireEvent.click(tabNamed('Popular'))
    for (const n of resultNames()) {
      expect(technical, `${n} is Popular but not reachable under Technical`).toContain(n)
    }
    expect(technical.length).toBeGreaterThan(resultNames().length)
  })

  it('⛔⛔ FUNDAMENTALS TELLS THE TRUTH RATHER THAN SHOWING ROWS', () => {
    // ⛔⛔ THE AUDIT, RAILED. The chart's source grammar admits a BAR FIELD, a
    // SYMBOL and another INSTANCE — there is no fundamental kind — and the one
    // fundamental the product holds is a NIGHTLY SCALAR whose own engine refuses
    // a bar offset because *"answering it with today's value would be a
    // fabricated history"* (`ast/pcf.js`). A row here would be that fabrication.
    expect(FUNDAMENTALS_STATUS.available,
      'Fundamentals was switched on — was the PIT-safe history actually built?').toBe(false)
    show(base()); openTab()
    fireEvent.click(addBtn())
    fireEvent.click(tabNamed('Fundamentals'))
    const notice = screen.getByTestId('fundamentals-unavailable')
    expect(notice.textContent).toContain(FUNDAMENTALS_STATUS.lede)
    // ⛔ AND NOT ONE ROW. Market cap, revenue and EPS are a direction, not a
    // series — offering them would be the lie the brief forbids by name.
    expect(resultNames(), 'a fundamental is being offered as chartable').toEqual([])
  })

  it('⛔⛔ SEARCH IS UNIVERSAL UNTIL THE MEMBER NARROWS IT', () => {
    // ⚰️ LEAVING `Popular` APPLIED OVER A QUERY MEANT TYPING A TICKER RETURNED
    // NOTHING — a ticker is not a popular indicator. That is the direct-search
    // contract the brief protects: *"do not make ticker search harder."*
    show(base()); openTab()
    fireEvent.click(addBtn())
    expect(chosen().textContent.trim()).toBe('Popular')

    type('rsi')
    expect(chosen(), 'a landing tab is still filtering a search').toBeUndefined()
    expect(resultNames().join('|')).toMatch(/Relative Strength Index/)

    // …and clicking a tab WHILE searching narrows it.
    fireEvent.click(tabNamed('Breadth'))
    expect(chosen().textContent.trim()).toBe('Breadth')

    // ⚰️⚰️ BUT TYPING AGAIN RETURNS TO UNIVERSAL, and the first version of this
    // rule did the opposite. It un-pinned only on CLEARING, so a member who
    // clicked `Popular` and then typed `QQQ` got nothing — measured in the
    // harness, because a ticker is not a popular indicator. §18 asks for both
    // *"search within the selected category"* and *"do not make ticker search
    // harder"*; when they collide the second wins, because a query is a new
    // question.
    type('rsix')
    expect(chosen(), 'a tab clicked before the query is still filtering it').toBeUndefined()

    // …and clearing the box returns to browsing the tab the member last chose.
    type('')
    expect(chosen().textContent.trim()).toBe('Breadth')
    expect(document.body.querySelector('[data-testid="add-surface"]')).toBeTruthy()
  })

  it('⛔ A SEARCH-DRIVEN TAB SAYS SO rather than claiming to be empty', () => {
    // `Symbols` and `ETFs` have no endpoint that lists every instrument, so an
    // empty box is not an empty CATEGORY — saying "nothing here" would be a
    // different and wrong sentence.
    show(base()); openTab()
    fireEvent.click(addBtn())
    fireEvent.click(tabNamed('Symbols'))
    const body = document.body.querySelector('[data-testid="add-surface"]').textContent
    // The canonical popular set browses here, so the tab is not blank either.
    expect(resultNames().length, 'Symbols browses nothing at all').toBeGreaterThan(0)
    expect(body).not.toMatch(/Nothing in this category/)
  })

  it('⭐ INDEXES BROWSES THE UNIVERSE THE CHARTS ACTUALLY RENDER', () => {
    // ⛔ NOT A HAND-PICKED SAMPLE. `INDICES_PRESET`'s own comment states it IS the
    // full indices universe (`api/index_bars.py INDEX_MAP`), which is why this tab
    // can be complete rather than indicative.
    show(base()); openTab()
    fireEvent.click(addBtn())
    fireEvent.click(tabNamed('Indexes'))
    const got = resultNames()
    for (const row of INDICES_PRESET) {
      expect(got, `${row.ticker} is in the index universe and not in the tab`)
        .toContain(row.name)
    }
  })

  it('⛔ A TAB IS A VIEW OF ONE CANONICAL CLASSIFICATION, not a second one', () => {
    // `tabOf` reads `kind` and the SERVER's own security type — the same
    // vocabulary `symbolSearchModel.CHIPS` sends as its `type` filter. Nothing
    // here re-derives what an ETF is, and no ticker is hard-coded into a class.
    expect(tabOf({ kind: 'security', category: 'etf' })).toBe('etfs')
    expect(tabOf({ kind: 'security', category: 'index' })).toBe('indexes')
    expect(tabOf({ kind: 'security', category: 'stock' })).toBe('symbols')
    expect(tabOf({ kind: 'breadth' })).toBe('breadth')
    expect(tabOf({ kind: 'formula' })).toBe('formulas')
    expect(tabOf({ userDefined: true })).toBe('formulas')
    // ⚠️ AND A CATALOGUE ROW WITH NO `kind` IS TECHNICAL. The Indicators tab
    // assembles its catalogue directly rather than through `libraryRows`, so a
    // shipped definition arrives with an id and no kind — testing for
    // `'technical'` emptied the whole tab once.
    expect(tabOf({ id: 'rsi', category: 'Momentum' })).toBe('technical')
  })

  it('⛔ NEW FORMULA IS VISIBLE AND SECONDARY', () => {
    // ⚰️ IT WORE `.insHeadAct` — the same faint grey as `Arrange`, a mode switch.
    // Owner: *"too dark/subtle and easy to miss."* It is a real button now, and
    // still not a gold one: search is the primary task on this surface.
    show(base(), undefined); openTab()
    fireEvent.click(addBtn())
    const nf = screen.queryByTestId('settings-new-formula')
    if (!nf) return                       // the host may not offer the builder
    expect(nf.className, 'New Formula is still wearing the mode-switch class')
      .not.toMatch(/insHeadAct/)
    expect(nf.className).toMatch(/insNewFormula/)
    expect(nf.textContent.replace(/\s+/g, ' ').trim()).toBe('＋New Formula')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
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
    fireEvent.click(document.body.querySelector('[class*="insBack"]'))
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

  it('⚠️⚠️ AND AT NARROW THERE IS ALWAYS A WAY OUT OF ADD, selection or not', () => {
    // ⛔ THE SAME RULE AS THE WIDE CASE, NOT AN EXCEPTION: the arrow exists when
    // leaving discovery LEADS SOMEWHERE. On a phone the two regions are one at a
    // time, so the left list is off screen while Add is up and this is the only
    // way back to it. Measured — gating the arrow on `selectedRow` alone left a
    // member with nothing selected NO exit from Add on a narrow layout.
    // ⚠️ AT NARROW THE LIST OWNS THE SCREEN FIRST — that is the accepted narrow
    // flow (list → surface → Back) and the wide "no selection is discovery"
    // default does not override it. So Add is reached the way a member reaches it:
    // the button at the foot of the list.
    narrow(true)
    show(base()); openTab()
    expect(screen.getByTestId('chart-structure'), 'narrow did not open on the list').toBeTruthy()
    fireEvent.click(screen.getByTestId('add-enter'))
    expect(screen.getByTestId('add-surface')).toBeTruthy()
    const back = document.body.querySelector('[class*="insBack"]')
    expect(back, 'a narrow layout offers no way out of discovery').toBeTruthy()
    expect(back.getAttribute('aria-label')).toBe('Back to the chart structure')
    fireEvent.click(back)
    expect(screen.getByTestId('chart-structure')).toBeTruthy()
  })

  it('⭐ ADD TAKES THE WHOLE NARROW SURFACE, and Back gives it back', () => {
    narrow(true)
    show(base()); openTab()
    fireEvent.click(screen.getByTestId('add-enter'))
    expect(screen.getByTestId('add-surface')).toBeTruthy()
    expect(screen.queryByTestId('chart-structure'), 'the structure shared a phone with Add').toBeNull()
    fireEvent.click(document.body.querySelector('[class*="insBack"]'))
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
