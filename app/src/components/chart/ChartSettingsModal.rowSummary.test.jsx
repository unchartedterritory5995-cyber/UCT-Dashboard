// app/src/components/chart/ChartSettingsModal.rowSummary.test.jsx
//
// ─── WHAT A ROW SAYS, AND WHAT THE PANE SAYS FOR IT ────────────────────────
//
// ⛔⛔ THE LIST USED TO SAY ONLY THE NAME. For an indicator that was enough —
// everyone knows where RSI draws. Universal Data broke it: `QQQ` and `SPY` sit in
// the same flat list as `EMA 9` and `Volume` with nothing to say they are
// INSTRUMENTS, in panes of their own, drawn as lines. Four questions a member had
// to open the row to answer.
//
// ⚰️⚰️ THE ANSWER WAS A SUMMARY LINE ON THE ROW, AND IT IS NOT ANY MORE. The
// Inspector reduced a row to a micro-rail and a name (2026-09-17); every fact the
// summary printed moved to the surface that could state it without repeating
// anything — the PANE HEADING for where it draws, the NAME for what it reads when
// the heading does not already say it, and the Inspector's own controls for the
// rest. This file followed them there, and its questions are unchanged.
//
// ⭐ NOTHING HERE IS A SECOND OPINION. Every assertion reads a surface that is
// DERIVED from the same canonical helpers the renderer consumes, so these cases
// also pin that the panel cannot drift from the chart — change the style or the
// source through the REAL control and the list must agree, with no reopen.
//
// ⛔ AND NO ENGINE VOCABULARY MAY REACH A MEMBER. The lesson the old
// accessible-name cases encoded is kept in the last describe, against the control
// that replaced the expander they were written for.

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


/** The structure row whose NAME matches.
 *
 *  ⚰️⚰️ IT WAS `[class*="actLabel"]` INSIDE AN EXPANDER BUTTON. A row is a
 *  micro-rail and a name now, and `data-structure-row` marks one.
 *  ⛔ STILL ANCHORED WHERE A CASE ANCHORS IT: an exact-name match is the whole
 *  guarantee the contextual suffix must not break by accident. */
const rowFor = (re) => [...document.body.querySelectorAll('[data-structure-row]')]
  .find((r) => re.test((r.querySelector('[class*="insRowName"]')?.textContent || '').trim()))

/** What the row PRINTS — the contextual name, and nothing else. */
const nameOf = (re) => {
  const row = rowFor(re)
  expect(row, `no active row matching ${re}`).toBeTruthy()
  return (row.querySelector('[class*="insRowName"]')?.textContent || '').trim()
}

/** The PANE this row is filed under — `chartDataMap`'s grouping, as read. */
const paneOf = (re) => {
  const g = rowFor(re)?.closest('[data-pane-group]')
  return (g?.querySelector('[class*="insGroupHead"]')?.textContent || '').trim()
}

const openRow = (re) => fireEvent.click(rowFor(re))
/** The INSPECTOR — the right-hand column, where a selected row's controls live. */
const inspector = () => document.body.querySelector('[data-inspector-for]')
const selectIn = (re, labelRe) => {
  const panel = inspector()
  // ⛔ AND IT MUST BE THIS ROW'S FORM. A stale selection would otherwise let a
  // case assert against the control of whatever was selected before it.
  if (!panel || panel.getAttribute('data-inspector-for') !== rowFor(re)?.getAttribute('data-row-id')) return undefined
  return [...panel.querySelectorAll('select')]
    .find((s) => labelRe.test(s.getAttribute('aria-label') || ''))
}

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { cleanup(); clearSecondaryBars() })

describe('what a row says, and what the PANE says for it', () => {
  // ⚰️⚰️ THIS SUITE HAS LOST TWO LINES OF METADATA IN TWO STEPS, AND BOTH ARE THE
  // SAME CORRECTION APPLIED TWICE.
  //
  // (1) §30, 2026-09-16: `Line · Own pane` went. `Line` was the same word on
  // nearly every row and was already a control directly beneath it; `Own pane`
  // restated the heading the row was filed under. What survived was `Source: QQQ`
  // and `Pane unavailable`.
  //
  // (2) The Inspector, 2026-09-17: the summary LINE went entirely. A row is a
  // micro-rail and a name — *"Do not make every row look like a settings form."*
  //
  // ⭐⭐ AND THE FACTS DID NOT GO ANYWHERE. Each one moved to the place that could
  // state it without repeating anything:
  //   · WHERE it draws  → the pane heading it is filed under (always did);
  //   · WHAT it reads   → the NAME, but only when the pane does not already say
  //                       it (`EMA 20 · QQQ` on Price, plain `EMA 20` inside QQQ),
  //                       and in full as the Inspector's SOURCE control;
  //   · WHAT BROKE      → the `Needs attention` heading plus the Display control.
  // These cases follow them there. The questions are the questions they were.

  it('⭐⭐ a direct symbol series is QUIET — its name and its pane say everything', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(nameOf(/^QQQ$/), 'the row grew furniture back').toBe('QQQ')
    expect(paneOf(/^QQQ$/)).toBe('QQQ')
  })

  it('⛔ …AND A STYLE IS STILL NOT A ROW FACT, whatever it is set to', () => {
    // The control case for the one above: a NON-default presentation must not
    // bring metadata onto the row either.
    const { cs, id } = withSeries(mergeChartSettings({}), 'QQQ')
    const styled = {
      ...cs,
      indicatorInstances: cs.indicatorInstances.map((i) => (
        i.instanceId === id ? { ...i, presentation: { plotStyle: 'candles' } } : i)),
    }
    show(styled); openIndicators()
    expect(nameOf(/^QQQ$/)).toBe('QQQ')
  })

  it('⭐⭐ THE PANE IS ANSWERED BY THE GROUP THE ROW IS FILED UNDER', () => {
    // ⛔ THE FACT DID NOT GO AWAY, THE DUPLICATE DID. `chartDataMap` groups rows by
    // the pane each one draws in and the heading names it, which is where a member
    // reads "where is this" — so keeping it off the row removes a repeat, not an
    // answer.
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(rowFor(/^QQQ$/).closest('[data-pane-group]'),
      'the QQQ row is not filed under any pane').toBeTruthy()
    expect(paneOf(/^QQQ$/)).toBe('QQQ')
  })

  it('⭐⭐ A GUEST NAMES ITS HOST — a human label, never an instance id', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    show(moved); openIndicators()
    expect(paneOf(/^SPY$/)).toBe('QQQ')
    // ⛔ AND THE ADDRESS NEVER LEAKS. `@inst:dataSeries:1` is the engine talking
    // to itself; a member reads the pane by the name of what is in it.
    const group = rowFor(/^SPY$/).closest('[data-pane-group]')
    expect(group.textContent).not.toMatch(/@inst:|inst:dataSeries/)
    expect(nameOf(/^SPY$/)).not.toMatch(/@|inst:/)
  })

  it('⭐⭐ A DERIVED SERIES NAMES WHAT IT READS — when the pane does not', () => {
    // ⚰️ IT READ `Source: QQQ` OFF A SUMMARY LINE. The fact is on the NAME now,
    // and it is CONDITIONAL rather than unconditional — which is the only new idea
    // in the whole read model. An MA over QQQ sitting on the PRICE pane has to
    // say so, because the heading says `Price` and two averages of two different
    // instruments would otherwise print one name.
    const { cs } = withMA(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    // ⚠️ `SMA 5`, NOT `Moving Average` — the engine MA names itself from the
    // member's own `maType` and `period` since 2026-09-16 (`engine/semanticName`).
    expect(paneOf(/^SMA 5 ·/)).toBe('Price')
    expect(nameOf(/^SMA 5 ·/)).toBe('SMA 5 · QQQ')
  })

  it('⛔ …and the SOURCE IS THE SYMBOL ALONE — not the field, not the type', () => {
    const { cs } = withMA(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    expect(nameOf(/^SMA 5 ·/)).not.toMatch(/close|numeric|sym:/)
  })

  it('⛔ NO SOURCE WHEN THE NAME ALREADY IS THE SOURCE — `QQQ · QQQ` says it twice', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    // `meta.labelFrom === 'source'` is the definition's own declaration that its
    // identity IS what it was pointed at. Read, never guessed.
    expect(nameOf(/^QQQ$/)).toBe('QQQ')
  })

  it('⛔⛔ AND NOT INSIDE ITS OWN PANE EITHER — the heading already said it', () => {
    // ⭐ THE OTHER HALF OF THE CONDITIONAL, and the half that makes it worth
    // having. Send the same instance into QQQ's pane and the suffix goes: the
    // heading directly above the row now carries the word, so the row saying it
    // again is the exact duplication §30 removed from the summary line.
    const host = withSeries(mergeChartSettings({}), 'QQQ')
    const ma = withMA(host.cs, 'QQQ')
    const inHost = setInstanceDisplayTarget(ma.cs, ma.id, `@${host.id}`, registry)
    show(inHost); openIndicators()
    expect(paneOf(/^SMA 5$/)).toBe('QQQ')
    expect(nameOf(/^SMA 5$/)).toBe('SMA 5')
  })

  it('⭐⭐ PANE UNAVAILABLE — the host left, and the panel says so', () => {
    // ⚰️ IT READ THE ROW'S SUMMARY. Two surfaces carry it now, and both have to be
    // true: the row is filed under `Needs attention` — visible without clicking —
    // and the Display control shows the STORED target, worded.
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    const orphaned = removeInstance(moved, a.id, registry)
    show(orphaned); openIndicators()

    expect(paneOf(/^SPY$/)).toMatch(/needs attention/i)
    // ⛔ AND IT DOES NOT SILENTLY CLAIM SOMEWHERE ELSE. Filing it under Price, or
    // showing "Own pane", would tell the member their line is fine while it draws
    // nothing at all.
    expect(paneOf(/^SPY$/)).not.toMatch(/Own pane|^Price$/)

    openRow(/^SPY$/)
    const sel = selectIn(/^SPY$/, /display in/i)
    const selected = [...sel.options].find((o) => o.value === sel.value)
    expect(selected.textContent).toMatch(/unavailable/i)
  })

  it('⛔⛔ NOTHING ON THE FIXTURES — "Line · Main chart" five times is furniture', () => {
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    for (const name of ['EMA 9', 'SMA 200', 'Volume']) {
      expect(nameOf(new RegExp(`^${name}$`)), `${name} grew furniture`).toBe(name)
    }
  })

  it('⛔⛔ AND AN ORDINARY ENGINE INDICATOR IS QUIET TOO — the guard that matters', () => {
    // ⚰️ THE CASE ABOVE PASSES FOR A DIFFERENT REASON THAN IT LOOKS, and a bite
    // check is what showed it: EMA/SMA/Volume are LEGACY overlay rows, not
    // engine-owned, so the naming rule refuses them on its first line and the
    // real branch is never reached. Deleting that branch left the whole suite
    // green.
    //
    // ⛔ THIS is its subject: an engine definition that declares NO source at all
    // — a plain price overlay — so there is nothing a suffix could ever say.
    let cs = addInstance(mergeChartSettings({}), 'bb', registry)
    const { cs: withMa } = withMA(cs, 'QQQ')
    show(withMa); openIndicators()
    // …and the control case beside it, so the silence is a CHOICE and not an
    // empty tab: a row that DOES carry a suffix, on the same screen.
    expect(nameOf(/^SMA 5 ·/), 'the control case lost its suffix').toBe('SMA 5 · QQQ')
    expect(nameOf(/Bollinger|^BB/), 'a plain price overlay grew furniture')
      .not.toMatch(/·/)
  })
})

describe('it follows the real controls, live', () => {
  it('⭐⭐ STYLE — the control still writes, and the row still says nothing about it', () => {
    // ⚰️ IT ASSERTED `Line · Own pane` → `Candles · Own pane`. The style left the
    // ROW (§30) and stayed where it was already editable. The claim that survives
    // is the one that mattered — the write lands — read off the CONTROL.
    const seen = { cs: null }
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs, seen); openIndicators()
    expect(nameOf(/^QQQ$/)).toBe('QQQ')
    openRow(/^QQQ$/)
    const sel = selectIn(/^QQQ$/, /plot style/i)
    expect([...sel.options].some((o) => o.value === 'candles'),
      'Candles was not offered — this case would pass for the wrong reason').toBe(true)
    fireEvent.change(sel, { target: { value: 'candles' } })
    expect(selectIn(/^QQQ$/, /plot style/i).value, 'the style write did not land').toBe('candles')
    expect(nameOf(/^QQQ$/), 'the style came back onto the row').toBe('QQQ')
  })

  it('⭐⭐ SOURCE — re-point the instrument and the NAME follows', async () => {
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
    expect(nameOf(/^SMA 5 ·/)).toBe('SMA 5 · QQQ')
    openRow(/^SMA 5 ·/)
    fireEvent.change(selectIn(/^SMA 5 ·/, /source/i), { target: { value: '__search__' } })
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'SPY' } })
    fireEvent.click(await screen.findByRole('button', { name: /SPY/ }))
    // ⛔ NO REOPEN, NO CACHED TEXT. The name is derived from current state.
    expect(nameOf(/^SMA 5 ·/)).toBe('SMA 5 · SPY')
    vi.unstubAllGlobals()
  })

  it('⭐ PLACEMENT — a host that disappears moves the guest, in place', () => {
    const a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'SPY')
    const moved = setInstanceDisplayTarget(b.cs, b.id, `@${a.id}`, registry)
    const seen = { cs: null }
    show(moved, seen); openIndicators()
    expect(paneOf(/^SPY$/), 'the guest is not in its host pane to begin with').toBe('QQQ')

    // ⚰️ IT REMOVED THE HOST THROUGH THE ROW'S OWN ✕. The verbs are the
    // Inspector's now, so the door is select-then-Remove — the same `removeRow`.
    openRow(/^QQQ$/)
    fireEvent.click(within(inspector()).getByRole('button', { name: /Remove QQQ/i }))
    expect(paneOf(/^SPY$/)).toMatch(/needs attention/i)
  })

  it('⭐ DUPLICATES — two of one instrument stay told apart in the list', () => {
    let { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    cs = withSeries(cs, 'QQQ').cs
    show(cs); openIndicators()
    const names = [...document.body.querySelectorAll('[data-structure-row]')]
      .map((r) => (r.querySelector('[class*="insRowName"]')?.textContent || '').trim())
      .filter((n) => /QQQ/.test(n))
    expect(names).toHaveLength(2)
    expect(new Set(names).size, 'two rows print one name').toBe(2)
    for (const n of names) expect(n).toMatch(/^QQQ/)
  })

  it('⛔⛔ …AND IDENTITY IS THE ROW ID, NOT THE NAME — each can be edited alone', () => {
    // ⭐ THE CASE THE WHOLE READ MODEL RESTS ON. Two rows that print the SAME
    // words are still two instances: `data-row-id` is what selects, what the
    // Inspector addresses, and what every writer takes. If the panel ever keyed
    // off the label, editing one duplicate would edit the other and nothing on
    // screen would say so.
    let a = withSeries(mergeChartSettings({}), 'QQQ')
    const b = withSeries(a.cs, 'QQQ')
    show(b.cs); openIndicators()
    const both = [...document.body.querySelectorAll('[data-structure-row]')]
      .filter((r) => /QQQ/.test(r.querySelector('[class*="insRowName"]').textContent))
    expect(both).toHaveLength(2)
    const ids = both.map((r) => r.getAttribute('data-row-id'))
    expect(new Set(ids).size, 'two rows share one address').toBe(2)

    fireEvent.click(both[0])
    expect(inspector().getAttribute('data-inspector-for')).toBe(ids[0])
    fireEvent.click(both[1])
    expect(inspector().getAttribute('data-inspector-for')).toBe(ids[1])
  })
})

describe('accessibility — the way this feature broke before', () => {
  // ⚰️⚰️ TWO CASES AND TWO CSS RAILS ARE RETIRED HERE, and it is their SUBJECT
  // that went rather than their point.
  //
  // · `THE SUMMARY IS NOT PART OF THE EXPANDER'S NAME` and its aria-labelledby
  //   back-door twin: there is no summary and no expander. The lesson they encode
  //   — a row's accessible name is the INSTANCE and nothing else — is asserted
  //   below against the control that replaced them.
  // · `THE LAYOUT MODIFIER IS ON THE ROWS WITH METADATA` and `THE SHARED
  //   .actName RULE IS UNTOUCHED`: both pinned a flex rule on a class shared with
  //   `ChartSettingsConditions` and `ChartSettingsInfoFields`, scoped by an
  //   `.actHeadMeta` modifier that existed to make room for a metadata sibling.
  //   No row has a metadata sibling, `.actHeadMeta` is unused, and `.insRowName`
  //   is this panel's own class — shared with nothing, so there is no scope to
  //   keep and nothing for a future edit to globalise.

  it('⛔⛔ A ROW\'S ACCESSIBLE NAME IS THE INSTANCE, and carries no metadata', () => {
    const host = withSeries(mergeChartSettings({}), 'QQQ')
    const ma = withMA(host.cs, 'QQQ')
    show(ma.cs); openIndicators()

    for (const row of document.body.querySelectorAll('[data-structure-row]')) {
      const name = row.getAttribute('aria-label') || row.textContent.trim()
      expect(name, `a row announces engine vocabulary: ${name}`)
        .not.toMatch(/Own pane|Source:|@inst:|sym:|::|legacy:/)
    }
    // …and the one row that legitimately carries a source says it in words.
    expect(nameOf(/^SMA 5 ·/)).toBe('SMA 5 · QQQ')
  })

  it('⛔ THE ROW IS THE TARGET — only ORDER competes with it, and it is two buttons', () => {
    // ⚰️ THE ROW USED TO HOLD FIVE: a toggle, an expander, a colour swatch, a gear
    // and a ✕. A screen-reader user tabbing the list met five controls per
    // indicator and the list stopped being a list. This case then read *"no nested
    // control competes with it"* and swept for ANY button.
    //
    // ⚰️ THE OWNER PUT ONE BACK (2026-09-17), deliberately and with a budget:
    // *"small Up / Down arrows at the RIGHT SIDE of indicator rows"*, which are
    // ORDER and nothing else. Two controls per row, not five, and neither of them
    // duplicates a verb the Inspector owns — so the row is still the target for
    // SELECTING, which is what this case is really about.
    //
    // ⛔ SO THE BUDGET IS ASSERTED RATHER THAN THE ABSENCE. A second control —
    // or one that is not the order handle — fails here exactly as the gear and the
    // ✕ would have.    //
    // ⚰️⚰️ AND THE PAIR BECAME ONE GRIP (2026-09-17). Seven indicators meant
    // fourteen icons and four permanently dimmed ghosts down one edge — owner:
    // *"this creates a repetitive column of arrows and makes the list feel
    // crowded."* Reordering is a DRAG now, so the row's budget went from two
    // controls to one, and that one is invisible until the pointer or the
    // keyboard reaches it.
    // ⛔ THE INVARIANT IS UNCHANGED AND THE BUDGET IS TIGHTER: a row may carry
    // the ORDER handle and nothing else. A gear, a ✕ or a second handle fails
    // here exactly as they always would have.
    const { cs } = withSeries(mergeChartSettings({}), 'QQQ')
    show(cs); openIndicators()
    for (const row of document.body.querySelectorAll('[data-structure-row]')) {
      expect(row.getAttribute('role')).toBe('option')
      const controls = [...row.querySelectorAll('button')]
      expect(controls.length, 'a row grew more controls than the order handle')
        .toBeLessThanOrEqual(1)
      for (const b of controls) {
        expect(b.hasAttribute('data-row-grip'),
          'a row grew a control of its own again').toBe(true)
      }
    }
  })
})
