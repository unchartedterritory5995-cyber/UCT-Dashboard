import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings, instanceTombstone } from './chartDefaults'
import { getDefinition, listDefinitions } from './engine/nativeRegistry'
import { CARVED_OUT_ROWS } from './indicatorCatalog'

// ─── THE INDICATORS TAB, END TO END ─────────────────────────────────────────
//
// This tab had NO rendering test at all. It is the surface B3 Task 12 changed
// — the VWAP row's fields are GENERATED from the engine definition now, and its
// writes go through `instanceControls` rather than straight into
// `settings.indicators.vwap` — and both halves of that are only observable
// here, through the real JSX, in the state a user is actually in.
//
// ⚠️ THE STATE THAT MATTERS IS "AN INSTANCE ALREADY EXISTS". With no stored
// instance the old raw writer looked fine, because `migrateLegacyToInstances`
// projects the legacy section on every paint. It SKIPS an instance id it
// already has — so the moment any control door has created `legacy:vwap` (the
// toolbar checkbox, either right-click door, Ctrl or Alt+U), a write to the
// legacy section is read by nobody. Every case below that could pass either way
// is paired with one that cannot.
//
// ─── …AND SINCE THE CONSOLIDATION, THE TAB HAS TWO MODES ────────────────────
//
// It used to render EVERY row open — four MA overlays, the volume pane and one
// section per DEFINITION whether or not the chart drew it. It now shows the
// ACTIVE list collapsed, with the catalogue behind the search box. So every case
// says which mode it is in, and the two helpers below are the two ways a member
// reaches a control:
//
//   `expand(label)` — open one active indicator's settings (the accordion);
//   `search(text)`  — enter discovery and filter the catalogue.
//
// ⛔ NEITHER HELPER REACHES PAST THE UI. A case that poked component state would
// pass over a tab whose only door was broken, which is what these exist to catch.

const base = (extra) => mergeChartSettings(JSON.stringify(extra || {}))
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]
const liveVwap = (cs) => (cs.indicatorInstances || []).find(i => i.defId === 'vwap' && !i.deleted)

/** Every active row's expander, which is also every active row's LABEL.
 *  ⚠️ SCOPED TO `[data-row-id]`, NOT TO `[aria-expanded]` ALONE — the modal's
 *  Templates menu button carries `aria-expanded` too, and a bare query counted
 *  it as an indicator. */
const expanders = () => [...document.body.querySelectorAll('[data-row-id] [aria-expanded]')]
const activeLabels = () => expanders().map((b) => b.textContent.trim())

/** Open (or close) one active row's settings — the same gesture a member makes. */
const expand = (re) => {
  const btn = expanders().find((b) => re.test(b.textContent || ''))
  expect(btn, `no active indicator row matching ${re}`).toBeTruthy()
  fireEvent.click(btn)
  return btn
}

/** Type into the tab's search box — the ONE door into discovery mode. */
const search = (text) => {
  const box = screen.getByRole('searchbox', { name: /Search indicators/i })
  fireEvent.focus(box)
  fireEvent.change(box, { target: { value: text } })
  return box
}

/** One catalogue result row, by its long name. */
const result = (re) => screen.getByRole('option', { name: re })

const WITH_INSTANCE = {
  indicators: { vwap: { enabled: true, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 } },
  indicatorInstances: [{
    instanceId: 'legacy:vwap', defId: 'vwap', hidden: false,
    inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  }],
}

describe('an inert field says WHY, to a screen reader and not only to a pointer', () => {
  // ⚰️ MEASURED ON PRODUCTION 2026-08-15. Every moving-average row ships `Offset`
  // and `Plot style` disabled — deliberately: `indicatorRegistry.MA_FIELDS` marks
  // them `disabled: NOT_WIRED` ("Coming soon — needs renderer support") because
  // honouring them needs series-level work, and the file's own rule is that
  // "showing them inert is honest; showing them live would silently do nothing".
  //
  // The reason was rendered only as a `title` on the ROW — a hover tooltip. The
  // controls themselves carried a bare `disabled`: no `aria-disabled`, no
  // description. So a mouse user got the sentence and a screen-reader user got
  // "dimmed, no reason". The toggle branch already put the reason on its control;
  // the number and select branches did not.
  //
  // `IndicatorSettingsDialog` states the rule: "`aria-disabled` alongside
  // `disabled` so the reason reaches assistive tech, which a bare `disabled`
  // attribute does not carry."
  //
  // ⚠️ THE SWEEP NOW WALKS THE ACCORDION, AND THAT IS NOT A WEAKENING. A row's
  // fields render only while it is OPEN and only one row is open at a time, so
  // the four MA rows are visited in turn and every inert control is still
  // asserted over. Opening ONE row and lowering the threshold would have been
  // the weakening; this keeps the count.
  const disabledControls = () => [...document.body.querySelectorAll('input,select,button')]
    .filter((e) => e.disabled)

  const MA_ROWS = [/EMA 9/, /EMA 20/, /SMA 50/, /SMA 200/]

  it('every disabled control carries aria-disabled, the reason, and a resolvable description', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()

    let seen = 0
    for (const row of MA_ROWS) {
      expand(row)
      const dis = disabledControls()
      // ⛔ THE CONTROL, PER ROW. If nothing renders disabled every assertion below
      // is vacuous — and the MA rows are the reason this test exists.
      expect(dis.length, `${row}: no disabled control rendered — the sweep proves nothing`)
        .toBeGreaterThan(1)
      seen += dis.length

      for (const el of dis) {
        const where = `${row} ${el.tagName}[${el.getAttribute('aria-describedby') || el.title || '?'}]`
        expect(el.getAttribute('aria-disabled'), `${where}: disabled with no aria-disabled`).toBe('true')
        expect(el.title, `${where}: disabled with no reason on the control`).toBeTruthy()

        const id = el.getAttribute('aria-describedby')
        expect(id, `${where}: no aria-describedby`).toBeTruthy()
        const described = document.getElementById(id)
        expect(described, `${where}: aria-describedby points at nothing`).toBeTruthy()
        expect(described.textContent.trim(), `${where}: the description is empty`).toBe(el.title)
      }
      expand(row)   // collapse before the next, so each sweep stays one row's
    }
    expect(seen, 'the four MA rows between them rendered fewer inert controls than one row has')
      .toBeGreaterThan(4)
  })

  it('an ENABLED control gets none of it — the reason is not sprayed everywhere', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    expand(/EMA 9/)
    const live = [...document.body.querySelectorAll('input,select')].filter((e) => !e.disabled)
    expect(live.length, 'no enabled control rendered').toBeGreaterThan(1)
    for (const el of live) {
      expect(el.getAttribute('aria-disabled'), `${el.tagName} is live but marked aria-disabled`).toBeNull()
    }
  })
})

describe('ChartSettingsModal — the ACTIVE list is what the chart draws', () => {
  // ⚰️ THIS DESCRIBE USED TO ASSERT THE SECTION LIST — `['Moving averages',
  // 'Volume', …every definition's short name, …the carved-out ones]` — because
  // the tab rendered a section per definition whether or not the chart drew it.
  // That WAS the defect: twenty-two sections, every field open, and no way to add
  // anything not already listed. The list is now what is ON, so the expectation
  // is what is on.
  //
  // ⛔ STILL DERIVED, NOT TYPED. The labels come from `CHART_DEFAULTS.overlays`
  // and the count from the same array, so a new default overlay needs no edit
  // here — the property the old hardcoded group list is remembered for losing.

  it('lists the MA overlays and the volume pane, and NOT the definitions that are off', () => {
    const cs = base()
    render(<ChartSettingsModal open settings={cs} onChange={vi.fn()} />)
    openIndicators()

    const labels = activeLabels()
    for (const ov of cs.overlays) {
      expect(labels, `${ov.type} ${ov.period} is on the chart and not in the list`)
        .toContain(`${ov.type} ${ov.period}`)
    }
    expect(labels, 'the volume pane is drawn and not listed').toContain('Volume')

    // ⛔ AND THE CONTROL: an indicator that is OFF is NOT here. A fresh blob ships
    // seventeen definitions off; one of them appearing means the tab has gone back
    // to listing the catalogue as if it were the chart.
    expect(labels.join('|'), 'a definition that is OFF is being listed as active')
      .not.toMatch(/VWAP/)
    expect(labels.length, 'the active list grew past what a fresh chart draws')
      .toBe(cs.overlays.length + 1)
  })

  it('…and every definition IS reachable — through search, which is the add-flow', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    // An empty query in discovery mode is the whole catalogue: one option per
    // shipped definition plus the carved-out sections. Derived from the registry,
    // for exactly the reason the old section list had to be.
    search('')
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('data-def-id'))
    for (const def of listDefinitions()) {
      expect(options, `${def.id} is in the registry and offered nowhere`).toContain(def.id)
    }
    for (const row of CARVED_OUT_ROWS) {
      expect(options, `${row.id} is carved out and offered nowhere`).toContain(row.id)
    }
  })

  it('offers exactly the controls the DEFINITION declares, by its own labels', () => {
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
    openIndicators()
    expand(/Session VWAP/)
    // Not a hardcoded list: read the labels off the definition and demand each one.
    for (const input of getDefinition('vwap').inputs) {
      expect(screen.getAllByText(input.label).length, `no control for ${input.key}`).toBeGreaterThan(0)
    }
  })
})

describe('ChartSettingsModal — the row is a CONTROL DOOR onto a flipped indicator', () => {
  it('adding VWAP from search writes an INSTANCE, not just the legacy flag', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openIndicators()
    search('vwap')
    fireEvent.click(result(/Session VWAP/))
    const next = lastCall(onChange)
    expect(liveVwap(next), 'the add wrote the mirror alone — the chart reads the instance').toBeTruthy()
    expect(next.indicators.vwap.enabled, 'the mirror keeps the alert evaluator alive').toBe(true)
  })

  it('REMOVING VWAP tombstones it — the mirror alone comes back on the next paint', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={onChange} />)
    openIndicators()
    // ⚰️ THIS CLICKED A LABELLED "Remove indicator" BUTTON inside the open row.
    // That button is retired: once the ✕ shipped in the header it was a second
    // door onto one verb, two clicks deeper. The ✕ is the door.
    fireEvent.click(screen.getByRole('button', { name: /^Remove Session VWAP/ }))
    const next = lastCall(onChange)
    expect(next.indicators.vwap.enabled).toBe(false)
    expect(next.indicatorInstances.some(i => i.instanceId === 'legacy:vwap' && i.deleted === true)).toBe(true)
  })

  it('⛔ the ✕ is the ONLY remove door — the expanded form offers no second one', () => {
    // ⚰️ BOTH SHIPPED FOR ONE BUILD. The brief wanted Remove behind the expander
    // ("accidental removal should not be one click away in a dense list"); the
    // owner then asked for the ✕ on the row, and kept only the ✕. Two controls
    // for one verb is the split this whole tab exists to end, so the absence is
    // asserted rather than assumed — a stray second door would tombstone through
    // its own path and drift.
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
    openIndicators()
    expect(screen.getByRole('button', { name: /^Remove Session VWAP/ }),
      'the row lost its ✕').toBeTruthy()
    expand(/Session VWAP/)
    expect(screen.queryByRole('button', { name: 'Remove indicator' }),
      'a second Remove door came back inside the expanded form').toBeNull()
  })

  it('🔴 removing a MOVING AVERAGE tombstones its slot — it never SPLICES', () => {
    // ⚰️ THIS CASE USED TO ASSERT THE OPPOSITE: that EMA 9 and Volume offered no
    // ✕ at all, because `cs.overlays` is merged POSITIONALLY and a splice was
    // unsafe. The owner asked for the ✕ anyway, and the answer was the codebase's
    // own idiom — a tombstone. The DANGER the old case described is exactly what
    // this one now pins.
    //
    // 🔴 WHAT A SPLICE WOULD DO, MEASURED AGAINST THE REAL MERGE: drop slot 0 and
    // `mergeChartSettings` reads EMA 20's stored values into EMA 9's slot, SMA
    // 50's into EMA 20's, SMA 200's into SMA 50's, and RESURRECTS a default SMA
    // 200 in the vacated fourth. One delete silently rewrites three moving
    // averages and hands back a line nobody asked for. So the assertion is not
    // "the row went away" — it is that the ARRAY DID NOT MOVE.
    const onChange = vi.fn()
    const before = base()
    render(<ChartSettingsModal open settings={before} onChange={onChange} />)
    openIndicators()
    fireEvent.click(screen.getByRole('button', { name: 'Remove EMA 9' }))
    const next = lastCall(onChange)

    expect(next.overlays, 'the slot was spliced out — every later MA just shifted')
      .toHaveLength(before.overlays.length)
    expect(next.overlays[0].removed, 'slot 0 is not tombstoned').toBe(true)
    // …and every OTHER slot is byte-identical, which is the whole claim.
    for (let i = 1; i < before.overlays.length; i++) {
      expect(next.overlays[i], `slot ${i} moved or changed`).toEqual(before.overlays[i])
    }
    // ⛔ AND IT SURVIVES A ROUND TRIP THROUGH THE MERGE, which is where a splice
    // would have done its damage — the tombstone must not be healed away.
    const reread = mergeChartSettings(JSON.stringify(next))
    expect(reread.overlays[0].removed, 'the merge healed the tombstone away').toBe(true)
    expect(reread.overlays[1].period, 'EMA 20 slid into EMA 9\'s slot').toBe(before.overlays[1].period)
  })

  it('…and the tombstoned MA leaves the ACTIVE list but comes back from search', () => {
    const removed = mergeChartSettings(JSON.stringify({
      overlays: [{ removed: true }, {}, {}, {}],
    }))
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={removed} onChange={onChange} />)
    openIndicators()
    expect(activeLabels(), 'a removed moving average is still listed as active').not.toContain('EMA 9')

    // ⭐ THE OWNER'S ACTUAL REPORT: searching "moving average" answered "No
    // indicator matches" while four were drawn on the chart. It is a catalogue
    // row now, and adding REVIVES the tombstone rather than minting a stranger —
    // so the colour and period the member set are still theirs.
    search('moving average')
    const row = result(/Moving Average/)
    // ⚠️ THE ROW READS "Active", AND CORRECTLY SO — three moving averages are
    // still drawn, so the ADD verb is the ＋ beside it rather than the row body.
    // (`isRowOn` for this row is "at least one live overlay", not "all four".)
    expect(within(row).getByText('Active')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: /Add another Moving Average/ }))
    const next = lastCall(onChange)
    expect(next.overlays[0].removed, 'add-back did not revive the tombstoned slot').toBe(false)
    expect(next.overlays[0].period, 'add-back replaced the member\'s EMA 9 with a stranger')
      .toBe(removed.overlays[0].period)
    expect(next.overlays, 'add-back appended instead of reviving')
      .toHaveLength(removed.overlays.length)
  })

  it('🔴 removing VOLUME writes `removed`, never `visible` — two different facts', () => {
    // ⛔ `visible: false` is the row's own hide toggle: still mine, still listed,
    // one click back. `removed: true` is "off this chart", and it is what the ✕
    // means. Collapsing them would make the hide switch a delete button, which is
    // the defect this whole tab's hide/remove split exists to end.
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openIndicators()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Volume' }))
    const next = lastCall(onChange)
    expect(next.volume.removed).toBe(true)
    expect(next.volume.visible, 'removing the pane also flipped the hide toggle').toBe(true)
  })

  it('⭐ Volume shows BOTH its colours on the collapsed row, not just the up one', () => {
    // ⭐ OWNER, 2026-09-10. One swatch on a two-colour indicator is a lie: the
    // pane draws an UP colour and a DOWN colour, and showing only the first says
    // the down bars are that colour too.
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    const row = document.body.querySelector('[data-row-id="volume"]')
    const swatches = row.querySelectorAll('[class*="actSwatch"] [data-color-swatch]')
    expect(swatches, 'the volume row shows one colour for a two-colour pane').toHaveLength(2)
    expect([...swatches].map(sw => sw.getAttribute('title')))
      .toEqual(['Volume — Up bars', 'Volume — Down bars'])
  })

  it('⭐⭐ …and the TOGGLE only HIDES it: off is not gone, and the settings survive', () => {
    // 🔴 THE ONE BEHAVIOUR CHANGE THIS CONSOLIDATION MAKES ON THIS TAB. The toggle
    // used to write `enabled`, which routes at `setIndicatorEnabled` and
    // TOMBSTONES every instance — so "turn RSI off for a second" threw away its
    // period, its colour and its width, and the row it lived on disappeared from
    // the list. A settings list whose disable switch is a delete button is a list
    // nobody dares touch.
    //
    // `hidden` is the verb the instance already had: `binder.js` and `pool.js`
    // skip it before computing, and `isIndicatorEnabled` deliberately still counts
    // it as ON — which is what keeps the row in place. Same eye the legend chip
    // writes, same door.
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={onChange} />)
    openIndicators()
    fireEvent.click(screen.getByRole('switch', { name: /Toggle Session VWAP/ }))
    const next = lastCall(onChange)
    const inst = (next.indicatorInstances || []).find(i => i.instanceId === 'legacy:vwap')
    expect(inst.hidden, 'the toggle did not hide the line').toBe(true)
    expect(inst.deleted, 'the toggle DELETED the indicator — off must not mean gone').toBeFalsy()
    expect(inst.inputs.opacity, 'hiding an indicator threw away its settings').toBe(100)
    // ⛔ AND THE MIRROR IS NOT TOUCHED. `setInstanceHidden` says so in its own
    // docstring — "`isIndicatorEnabled` counts a hidden instance as ON, so
    // writing `indicators[defId].enabled = false` here would make the checkbox
    // disagree with the reader on the very next paint". A blob whose mirror the
    // fold has already dropped keeps no `indicators` key at all, which is why
    // this asserts "not false" rather than "true".
    expect(next.indicators?.vwap?.enabled,
      'hiding wrote the mirror off — the `?indicators=` route and the alert '
      + 'evaluator would then disagree with a chart that still owns the instance')
      .not.toBe(false)
  })

  it('⭐ the opacity box reaches the STORED INSTANCE, which a raw section write never did', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={onChange} />)
    openIndicators()
    expand(/Session VWAP/)
    // Found by its LABEL ROW, not by role: the tab renders several unnamed
    // number inputs and `getByRole('spinbutton')` matches all of them.
    const row = screen.getByText('Opacity %').closest('div')
    const box = row.querySelector('input[type="number"]')
    fireEvent.change(box, { target: { value: '40' } })
    const next = lastCall(onChange)
    expect(liveVwap(next).inputs.opacity, 'the opacity write never reached the instance').toBe(40)
    expect(next.indicators.vwap.opacity, 'the legacy mirror stopped being written').toBe(40)
  })

  it('a TOMBSTONED VWAP is absent from the list, though the legacy mirror still says on', () => {
    const cs = base({
      indicators: { vwap: { enabled: true } },
      indicatorInstances: [instanceTombstone('legacy:vwap')],
    })
    // ⭐ B5 TASK 9: the divergence the fixture sets up is between the SEEDED
    // instance and the tombstone, because the mirror no longer survives the
    // merge. `base()` folds `indicators.vwap.enabled` — and the tombstone
    // reserves the id, so the fold must NOT seed one, which is the divergence.
    expect(cs.indicators.vwap, 'the mirror survived the fold').toBeUndefined()
    expect(cs.indicatorInstances, 'the fixture does not set up the divergence')
      .toContainEqual(instanceTombstone('legacy:vwap'))
    expect(cs.indicatorInstances.filter(i => i.defId === 'vwap')).toEqual([])
    render(<ChartSettingsModal open settings={cs} onChange={vi.fn()} />)
    openIndicators()
    expect(activeLabels().join('|'),
      'the list showed an indicator over a chart with no line').not.toMatch(/VWAP/)
    // …and the catalogue agrees: the row is offerable, not ticked.
    search('vwap')
    expect(result(/Session VWAP/).getAttribute('aria-selected'),
      'the catalogue ticked a row over a chart with no line').toBe('false')
  })
})

describe('ChartSettingsModal — the ways IN (search · add · author)', () => {
  it('search matches on the SHORT name, not only the long one', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    search('atr')
    // `matches()` is IMPORTED from `IndicatorLibraryDialog`, so an abbreviation a
    // member knows an indicator by finds it here exactly as it does there. A
    // failure here means a SECOND search implementation has appeared.
    expect(screen.getAllByRole('option').map(o => o.getAttribute('data-def-id')))
      .toContain('atr')
  })

  it('an already-active row says so, and still offers a SECOND — duplicates survive', () => {
    // Several definitions are meant to hold more than one line (that is what
    // `addInstance` is for), so "Active" must not be a dead end.
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={onChange} />)
    openIndicators()
    search('vwap')
    const row = result(/Session VWAP/)
    expect(row.getAttribute('aria-selected')).toBe('true')
    expect(within(row).getByText('Active')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: /Add another Session VWAP/ }))
    const next = lastCall(onChange)
    expect((next.indicatorInstances || []).filter(i => i.defId === 'vwap' && !i.deleted).length,
      '"+ Add another" did not add a second instance').toBe(2)
  })

  it('⛔ New Formula renders ONLY when the host can reach the builder', () => {
    // Absent prop ⇒ absent door — the rule `IndicatorLibraryDialog` follows. A
    // surface with no way to open the one mounted `BuilderSheet` must show no
    // button rather than one that opens nothing.
    const { unmount } = render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    expect(screen.queryByRole('button', { name: /New Formula/ })).toBeNull()
    unmount()

    const onCreateFormula = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} onCreateFormula={onCreateFormula} />)
    openIndicators()
    fireEvent.click(screen.getByRole('button', { name: /New Formula/ }))
    expect(onCreateFormula, 'the launcher renders but is wired to nothing').toHaveBeenCalledTimes(1)
  })

  it('the legend gear deep link opens THAT row, already expanded', () => {
    // ⭐ OWNER: "if I click the settings button next to RSI in the legend, it
    // should take me to chart settings with RSI open to edit right away."
    //
    // ⛔ IT RIDES `scrollTo`, THE CHANNEL EVERY OTHER DEEP LINK INTO THIS MODAL
    // ALREADY USES (`watermark`, `axis`, `volume`) — one way in, so a surface
    // cannot grow a second, disagreeing way to ask. The row id is the one the tab
    // publishes as `data-row-id`, so nothing translates between the two.
    //
    // ⚠️ THE ID CONTAINS COLONS (`legacy:vwap`), which is why the prefix is
    // SLICED rather than split on ':' — a split would address row `legacy`.
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={vi.fn()} scrollTo="ind:legacy:vwap" />)
    // …and it lands on the Indicators tab without being told twice.
    expect(screen.getByRole('tab', { name: 'Indicators' }).getAttribute('aria-selected')).toBe('true')
    const row = document.body.querySelector('[data-row-id="legacy:vwap"]')
    expect(row, 'the deep-linked row is not in the active list').toBeTruthy()
    expect(row.querySelector('[aria-expanded]').getAttribute('aria-expanded'),
      'the row the gear named is still collapsed — the member has to hunt for it')
      .toBe('true')
    // The controls it promised are actually there.
    expect(screen.getByText('Opacity %')).toBeTruthy()
  })

  it('⛔ …and WITHOUT the deep link every row starts collapsed', () => {
    // The control: a seed that fired unconditionally would open a row for anyone
    // who merely opened the modal, which is the density the tab exists to fix.
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
    openIndicators()
    expect(expanders().filter(b => b.getAttribute('aria-expanded') === 'true'),
      'a row opened itself with no deep link').toHaveLength(0)
  })

  it('Escape in discovery goes BACK — it does not close the modal out from under you', () => {
    const onClose = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} onClose={onClose} />)
    openIndicators()
    const box = search('vwap')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose, 'Escape while searching closed the whole settings modal').not.toHaveBeenCalled()
    expect(activeLabels(), 'Escape did not return to the active list').toContain('EMA 9')
  })
})


// ─── THE LEGEND GEAR'S DEEP LINK ────────────────────────────────────────────
//
// `scrollTo="ind:<rowId>"` is the address every legend and pane-readout gear
// sends. It has to land on the Indicators tab WITH THAT ROW OPEN — that is the
// whole of what the gear promises.
//
// ⚰️ AND IT SILENTLY DID NOTHING FOR THE MOVING AVERAGES. The legend names an MA
// row `ma:0`; this tab names it `overlay-0`. Volume and RSI worked by coincidence
// (both surfaces spell those two identically), so a verification round aimed at
// RSI passed while EMA 9 — the first moving average on every chart — opened the
// tab with nothing expanded. That is exactly the shape of bug a per-indicator
// spot-check cannot catch, so this sweeps EVERY row the tab lists.
describe('a gear deep link opens the row it names — every row, not a sample', () => {
  /** The row ids that are actually expanded (a collapsed row renders no fields). */
  const expandedRowIds = () => [...document.body.querySelectorAll('[data-row-id]')]
    .filter((el) => el.querySelector('input,select'))
    .map((el) => el.dataset.rowId)

  const allRowIds = () => [...document.body.querySelectorAll('[data-row-id]')]
    .map((el) => el.dataset.rowId)

  it('⛔ the LEGEND s spelling for a moving average reaches this tab s row', () => {
    // `ma:0` is `LegendRow`'s `rowId` for the first stored overlay — the string
    // `StockChart` puts in `ind:` — and `overlay-0` is what this tab calls it.
    render(<ChartSettingsModal open scrollTo="ind:ma:0" settings={base()} onChange={vi.fn()} />)
    expect(expandedRowIds()).toEqual(['overlay-0'])
  })

  it('…and EVERY moving average, addressed the way the legend addresses it', () => {
    // ⚠️ `base()` ships four overlays, and the STORED INDEX is the address — not
    // the position in the visible list. A test that only checked `ma:0` would miss
    // an off-by-one in the translation.
    for (const [legendId, settingsId] of [
      ['ma:0', 'overlay-0'], ['ma:1', 'overlay-1'],
      ['ma:2', 'overlay-2'], ['ma:3', 'overlay-3'],
    ]) {
      cleanup()
      render(<ChartSettingsModal open scrollTo={`ind:${legendId}`} settings={base()} onChange={vi.fn()} />)
      expect(expandedRowIds(), `${legendId} did not open ${settingsId}`).toEqual([settingsId])
    }
  })

  it('⭐ 0 IS A ROW — the falsy-index trap, asserted on its own', () => {
    // `Number('0')` is falsy, so a `||` guard in the translation would drop EMA 9
    // and nothing else. The case above would still pass for `ma:1`..`ma:3`.
    render(<ChartSettingsModal open scrollTo="ind:ma:0" settings={base()} onChange={vi.fn()} />)
    expect(expandedRowIds(), 'the FIRST moving average is the one a falsy guard eats')
      .toContain('overlay-0')
  })

  it('volume and an engine instance pass straight through, unchanged', () => {
    render(<ChartSettingsModal open scrollTo="ind:volume" settings={base()} onChange={vi.fn()} />)
    expect(expandedRowIds()).toEqual(['volume'])
    cleanup()
    render(<ChartSettingsModal open scrollTo="ind:legacy:vwap"
      settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
    // ⚠️ THE ROW ID ITSELF CONTAINS A COLON. A translation that split on ':'
    // instead of slicing the prefix would address `legacy` and open nothing.
    expect(expandedRowIds()).toEqual(['legacy:vwap'])
  })

  it('⛔ and the control: no `ind:` target opens NOTHING', () => {
    // The accordion still arrives closed on every other way in — the tab button,
    // a `scrollTo` for another tab, a plain open. Without this, a translation that
    // returned a row id for everything would pass every case above.
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    expect(expandedRowIds()).toEqual([])
    cleanup()
    render(<ChartSettingsModal open scrollTo="watermark" settings={base()} onChange={vi.fn()} />)
    expect(expandedRowIds()).toEqual([])
    cleanup()
    // A malformed MA address resolves to nothing rather than to a guess.
    render(<ChartSettingsModal open scrollTo="ind:ma:notanumber" settings={base()} onChange={vi.fn()} />)
    expect(expandedRowIds()).toEqual([])
  })

  it('⛔⛔ EVERY id this tab publishes is reachable from a deep link', () => {
    // The sweep the MA bug needed. Whatever rows the tab lists, each one must open
    // when addressed by its own `data-row-id` — so a row whose id gains a new
    // shape cannot quietly become unreachable.
    // ⚠️ OPENED VIA A DEEP LINK, because a plain `open` lands on the Price Style
    // tab and the Indicators rows are not rendered at all — the sweep would read
    // an empty list and pass while proving nothing. The guard below is what caught
    // that while this case was being written.
    render(<ChartSettingsModal open scrollTo="ind:volume"
      settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
    const ids = allRowIds()
    expect(ids.length, 'no rows listed — this sweep would assert nothing')
      .toBeGreaterThanOrEqual(5)
    for (const id of ids) {
      cleanup()
      render(<ChartSettingsModal open scrollTo={`ind:${id}`}
        settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
      expect(expandedRowIds(), `row "${id}" is listed but no deep link opens it`).toEqual([id])
    }
  })
})
