// ─── A CONTROL THAT CANNOT DO ANYTHING MUST NOT LOOK LIKE IT CAN ────────────
//
// ⭐ RETARGETED A FIFTH TIME, AND FOR THE LAST TIME.
//
// `engineInert` existed to say "this control is drawn by the engine and this
// field is not what sets it". It has been re-pointed four times as its subjects
// migrated out from under it — Stoch → MACD → VWAP → rsi/bb → nothing — and B4
// Task 8 took the last step: spec §6 replaced the toolbar's fifteen indicator
// rows with one "Manage indicators →" launcher, so `engineInert`, `inertTitle`,
// `shownInput` and `updateIndicator` are DELETED. With no per-indicator control
// left on this surface there is nothing to tell the truth about, and an inert
// helper reads as live logic.
//
// The file is NOT deleted, because "the predicate has no subject" is not the
// same claim as "the surface has no writer", and only the second one can still
// fail. What remains failable, and what this file now holds:
//
//   1. THIS SURFACE CARRIES NO PER-INDICATOR WRITER. A behavioural test cannot
//      prove the ABSENCE of a writer — `updateIndicator` writing
//      `cs.indicators.<id>` raw is the defect class that produced control doors
//      five and six — so the check is a SOURCE PROBE, deliberately.
//   2. THE ROWS ARE REALLY GONE, and the launcher that replaced them works.
//   3. THE COUNT READS THROUGH `isOn`, so a TOMBSTONED indicator lowers it. A
//      count off the raw mirror says "2 on" over a chart drawing one.
//   4. THE VOLUME-OVERLAY STRIP SURVIVES. It is not an indicator control — it
//      moves an ALREADY-ENABLED oscillator between panes.
//   5. `engineDrawnInputs`' MIGRATED-ID FILTER. That claim was moved down a
//      level at B3 Task 8 precisely because its row-level subjects kept
//      expiring; it is a pure function and it outlives every surface.
//
// ⛔ WHEN B5 DELETES `cs.indicators`, DELETE THIS FILE.
//
// ⚠️ NEVER use fireEvent.click to assert a control is inert — it dispatches a
// raw MouseEvent straight at the node, bypassing the `disabled` check no real
// browser bypasses. Use userEvent and/or the native element.click().
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings, instanceTombstone } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'
import { ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS, engineDrawnDefIds, engineDrawnInputs } from './engine/flipState'
import { setIndicatorEnabled } from './engine/instanceControls'
import { catalogRows } from './indicatorCatalog'
import * as engineRegistry from './engine/nativeRegistry'

const SRC = readFileSync(
  resolve(process.cwd(), 'src/components/chart/ChartToolbar.jsx'), 'utf8')

const MACD_INSTANCE = {
  instanceId: 'legacy:macd', defId: 'macd', defVersion: 2,
  inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
  placement: { target: 'pane' }, hidden: false,
}
const VWAP_INSTANCE = {
  instanceId: 'legacy:vwap', defId: 'vwap', defVersion: 1,
  inputs: { color: '#ff0000' }, placement: { target: 'price' }, hidden: false,
}

const settingsWith = (over) => mergeChartSettings(JSON.stringify({
  indicators: {
    macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    vwap: { enabled: true, color: '#26C6DA' },
    stoch: { enabled: true },
  },
  ...over,
}))

function mount(settings, onUpdateSettings = vi.fn()) {
  return render(
    <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
      <ChartToolbar
        activeTool="cursor"
        setActiveTool={() => {}}
        chartSettings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </AuthContext.Provider>,
  )
}
const openPanel = (user) => user.click(screen.getByTitle('Chart Settings'))
const launcher = () => screen.getByRole('button', { name: /Manage indicators/ })
/** The launcher's own count element. ⚠️ NOT a `\b2\b` on the button's TEXT: it
 *  renders as `Manage indicators2→`, and `s2` has no word boundary between
 *  them — so that regex fails on a perfectly CORRECT count. */
const activeCount = () => launcher().querySelector('[class*="sLauncherCount"]').textContent

describe('the PREMISE, restated after the fifth and final exhaustion', () => {
  it('the toolbar carries no per-indicator control, so nothing here can be inert', () => {
    // ⛔ SOURCE PROBE, DELIBERATELY. A behavioural test cannot prove the ABSENCE
    // of a writer: a re-added helper that no row calls renders nothing and no DOM
    // assertion anywhere can see it — which is exactly how `engineInert` went
    // vacuous the first time (a predicate no row consulted could not be caught
    // lying; mutating it to `key === 'stoch'` left 1,245 tests GREEN).
    const gone = []
    if (/const\s+updateIndicator\s*=/.test(SRC)) gone.push('updateIndicator')
    if (/const\s+engineInert\s*=/.test(SRC)) gone.push('engineInert')
    if (/const\s+inertTitle\s*=/.test(SRC)) gone.push('inertTitle')
    if (/const\s+shownInput\s*=/.test(SRC)) gone.push('shownInput')
    // …and the WRITE SHAPE, not just the helper name. A row that inlines
    // `indicators: { …, [key]: … }` is the same second writer under another name.
    if (/indicators\s*:\s*\{[^}]*\[\s*key\s*\]/.test(SRC)) gone.push('an inline indicators[key] write')
    // ⛔ …AND THE ROW ITSELF. MEASURED: pasting the deleted RSI row back — the
    // checkbox, the label span and the period box, calling `updateIndicator` —
    // left every check above GREEN, because the row REFERENCES the helper without
    // DECLARING it. A probe that only watches the writer's declaration cannot see
    // a row that calls a writer under a new name, or one written inline. The row
    // cannot render without its own label span, whatever writer it calls.
    if (/styles\.sIndicatorLabel/.test(SRC)) gone.push('a per-indicator row (styles.sIndicatorLabel)')
    expect(gone,
      'a per-indicator writer is back on the toolbar. Every control it could carry is on the ' +
      'generated dialog, which reaches inputs this surface never could; a second writer here ' +
      'is control door number seven.',
    ).toEqual([])
    // ⛔ AND THE PROBE IS NOT VACUOUS: the patterns above must be able to MATCH.
    // A regex that matches nothing anywhere reports every deletion as done.
    expect(/const\s+isOn\s*=/.test(SRC), 'the `const x =` probe shape matches nothing — it rotted').toBe(true)
    expect(/const\s+update\s*=/.test(SRC)).toBe(true)
  })

  it('…and the fifteen rows really are gone, not merely unreachable', async () => {
    const user = userEvent.setup()
    // ⚠️ `volume.visible: false` ON PURPOSE. With the volume pane shown, the
    // VOLUME-OVERLAY STRIP renders a checkbox per ENABLED oscillator — and those
    // are not indicator rows; they move an already-enabled oscillator between
    // panes. Hiding the pane removes the only other checkboxes on the panel, so a
    // hit here is an indicator row and nothing else. The strip's own case is
    // below, and it is what stops this fixture quietly deleting it.
    mount(settingsWith({ volume: { visible: false } }))
    await openPanel(user)
    expect(screen.queryAllByRole('checkbox', { name: /RSI|MACD|Stoch|Donchian/ })).toHaveLength(0)
    // The label spans the rows rendered are gone too — `indicatorCatalog.test.js`
    // asserts the same thing from the parser's side, on all fifteen at once.
    expect(SRC).not.toContain('styles.sIndicatorLabel')
  })
})

describe('the launcher that replaced them', () => {
  it('the Indicators group is one launcher, and it opens the library', async () => {
    const user = userEvent.setup()
    mount(settingsWith())
    await openPanel(user)
    expect(screen.queryByRole('searchbox')).toBeNull()
    await user.click(launcher())
    expect(screen.getByRole('searchbox'), 'the launcher opened nothing').toBeTruthy()
  })

  it('the launcher says how many are on, through the ONE reader', async () => {
    const user = userEvent.setup()
    const cs = setIndicatorEnabled(
      setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry),
      'stoch', true, engineRegistry)
    mount(cs)
    await openPanel(user)
    expect(activeCount()).toBe('2')
  })

  it('⭐ …and a TOMBSTONE lowers it — a count off the raw mirror would not', async () => {
    // The mirror still says RSI is on. `isIndicatorEnabled` says it is not, and
    // the chart draws nothing. A launcher reading `cs.indicators[id].enabled`
    // reports 2 over a chart showing one line.
    const user = userEvent.setup()
    const on = setIndicatorEnabled(
      setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry),
      'stoch', true, engineRegistry)
    const cs = { ...on, indicatorInstances: [instanceTombstone('legacy:rsi')] }
    expect(cs.indicators.rsi.enabled, 'the fixture does not set up the divergence').toBe(true)
    mount(cs)
    await openPanel(user)
    expect(activeCount(), 'the count read the mirror instead of the instance').toBe('1')
  })

  it('the count covers the CARVED-OUT section too, which has no definition', async () => {
    const user = userEvent.setup()
    mount(mergeChartSettings(JSON.stringify({ indicators: { volumeProfile: { enabled: true } } })))
    await openPanel(user)
    expect(activeCount()).toBe('1')
    expect(catalogRows().some((r) => r.id === 'volumeProfile'),
      'volumeProfile left the catalog — the count above no longer covers it').toBe(true)
  })
})

describe('the volume-overlay strip survives — it is not an indicator control', () => {
  it('renders for an ENABLED oscillator, and moves it between panes', async () => {
    // It moves an ALREADY-ENABLED oscillator into the volume pane; it does not
    // enable anything, which is why Task 8 kept it and `isOn` with it.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry), spy)
    await openPanel(user)
    const box = screen.getByRole('checkbox', { name: 'RSI' })
    expect(box).toBeTruthy()
    await user.click(box)
    expect(spy.mock.calls.at(-1)[0].volumeOverlayIndicators).toEqual(['rsi'])
  })
})

// ── THE CLAIM THAT OUTLIVED EVERY SURFACE ───────────────────────────────────
//
// Moved down a level at B3 Task 8, exactly because its row-level subjects kept
// expiring. It is a pure function over the settings blob and it does not care
// what the panel looks like — which is what makes it the one part of this file
// B4 could not exhaust.
describe('engineDrawnInputs — the MIGRATED-ID filter', () => {
  it('drops an un-migrated instance, and reports a migrated one in full', () => {
    const unmigrated = engineRegistry.listDefinitions()
      .map(d => d.id)
      .filter(id => !ENGINE_MIGRATED_DEF_IDS.has(id))
    expect(unmigrated, 'every definition is migrated — this control is now empty').not.toHaveLength(0)

    for (const defId of unmigrated) {
      const cs = settingsWith({
        engineEnabled: true,
        indicatorInstances: [{
          instanceId: `legacy:${defId}`, defId, defVersion: 1,
          inputs: {}, placement: engineRegistry.getDefinition(defId).placement, hidden: false,
        }],
      })
      expect(engineDrawnDefIds(cs, engineRegistry).has(defId), `${defId} was reported as engine-drawn`).toBe(false)
      expect(engineDrawnInputs(cs, engineRegistry).has(defId), defId).toBe(false)
    }

    // …and the positive half, so this is a FILTER and not a blanket "return
    // nothing": a migrated definition's instance IS reported, inputs and all.
    const migrated = settingsWith({ engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] })
    expect(engineDrawnDefIds(migrated, engineRegistry).has('vwap')).toBe(true)
    expect(engineDrawnInputs(migrated, engineRegistry).get('vwap').color).toBe('#ff0000')
  })

  it('an instance the VALIDATOR drops is not REPORTED as drawn', () => {
    const cs = settingsWith({
      engineEnabled: true,
      indicatorInstances: [{ ...MACD_INSTANCE, inputs: { ...MACD_INSTANCE.inputs, bogus: 1 } }],
    })
    expect(engineDrawnInputs(cs, engineRegistry).has('macd'),
      'a record `normalizeInstances` refuses was reported as drawn').toBe(false)
  })

  it('⚠️ a flag-off blob reports NOTHING even for a FLIPPED id — a KNOWN divergence', () => {
    // ⛔ A REAL, DELIBERATE INCONSISTENCY, RECORDED RATHER THAN PAPERED OVER.
    // `engineDrawnInputs` returns nothing unless `cs.engineEnabled === true`, but
    // `StockChart` DRAWS a flipped id regardless of that flag, from the stored
    // instance. It is narrow: the flag is false for every existing user, and
    // every existing user also has no stored instance. It bites the first user
    // handed an `?instances=` link on a flag-off chart.
    //
    // ⚠️ ITS ONE CONSUMER WAS THIS TOOLBAR'S `shownInput`, which B4 Task 8
    // deleted — so the divergence no longer reaches any surface. Asserted as it
    // SHIPS so a fix is a deliberate red rather than a surprise.
    const cs = settingsWith({ indicatorInstances: [MACD_INSTANCE] })
    expect(ENGINE_FLIPPED_DEF_IDS.has('macd'), 'macd is not flipped — this case has no subject').toBe(true)
    expect(engineDrawnInputs(cs, engineRegistry).has('macd'),
      'the flag-off fallback changed — that is the FIX; delete this case and say so in the report').toBe(false)
  })
})
