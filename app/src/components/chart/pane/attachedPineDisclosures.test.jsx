// app/src/components/chart/pane/attachedPineDisclosures.test.jsx
//
// ─── ⭐⭐ T5b — A SAVED PINE DEFINITION REACHES A PANE ON THE MEMBER'S ROUTE ─
//
// ⛔⛔ EVERY DOOR HERE IS THE SHIPPED ONE. `memberPaneDefinition` builds the
// document, a JSON round trip stands in for the store (which persists the object
// verbatim — `user_definitions.py` overwrites `definition["id"]` and nothing
// else), `installUserDefinitions` is the registry door, `addInstance` is the
// instance door, and the surface under test is `ChartPane` — the shell
// `ChartWidget`, `MobileChartsApp`, `TickerPopup`, the drill modal and the scan
// results all mount. Nothing about this route is invented for the test.
//
// ⚰️ WHAT WENT WRONG BEFORE, AND WHY THE ROUND TRIP IS NOT DECORATION. The
// disclosures used to exist only inside the builder's React state. A member who
// pasted a script, read the three sentences, saved it and opened their own chart
// got the drawing and no sentences at all — including the `window_dependent`
// badge that `_requirement_tags.window_dependent.why_the_pane_may` makes the
// CONDITION on a pane serving `ta.cum`. `compute.source` on the saved artifact is
// 126 characters of the first plot's expression; the 34,378-character Pine is not
// in it and cannot be re-read. If `meta.disclosures` does not survive the trip,
// nothing downstream can reconstruct it — so the trip is the test.
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── the same mock surface `ChartPane.test.jsx` uses, so this file and that one
//    describe ONE component tree. StockChart is the only thing stubbed on the
//    path under test; the registry, the instance doors and the translator are all
//    real.
const { stockChartSpy } = vi.hoisted(() => ({ stockChartSpy: vi.fn() }))
vi.mock('../../StockChart', () => ({
  default: (props) => {
    stockChartSpy(props)
    return <div data-testid="stock-chart"><span data-testid="chart-sym">{props.sym}</span></div>
  },
}))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(({ displayLabel }, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span data-testid="sym-label">{displayLabel}</span>
    }),
  }
})
vi.mock('../ChartSettingsModal', () => ({
  default: ({ open }) => (open ? <div data-testid="settings-modal" /> : null),
}))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => <div /> }))
vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }),
}))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({ data: null, isLoading: false }),
}))
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
}))
vi.mock('../../../hooks/useThemeIndexBars', () => ({
  default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }),
}))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: false, isPremarket: false, isExtended: false }),
}))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartPane from './ChartPane'
import MemberPane from '../builder/memberPane/MemberPane'
import * as registry from '../engine/nativeRegistry'
import { addInstance } from '../engine/instanceControls'
import { mergeChartSettings } from '../chartDefaults'
import { requirementNote } from '../engine/ast/parse'
import {
  memberPaneDefinition, memberPaneVariants,
} from '../builder/memberPane/memberPaneDefinition'
import { attachedDisclosures, attachedNeedsBarCount } from './AttachedPineDisclosures'

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

/** The store's contribution, and its whole contribution: it persists the object
 *  as JSON and mints the id. Anything a document carries that does not survive
 *  `JSON.parse(JSON.stringify(…))` is not in the artifact a member gets back. */
const throughTheStore = (doc, id) => JSON.parse(JSON.stringify({ ...doc, id }))

const installed = []
function installSaved(doc, id) {
  const stored = throughTheStore(doc, id)
  const { installed: got, errors } = registry.installUserDefinitions([stored])
  expect(errors, `the shipped install door refused the saved artifact: ${errors.join(' / ')}`)
    .toEqual([])
  expect(got).toHaveLength(1)
  installed.push(id)
  return got[0]
}

/** The member's chart settings after they add the definition from the indicator
 *  library — `addInstance` is the door that checkbox uses. */
const chartWith = (...ids) => ids.reduce(
  (cs, id) => addInstance(cs, id, registry), mergeChartSettings({}),
)

const setFlag = (v) => {
  if (v === undefined) delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  else import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = v
}

afterEach(() => {
  cleanup()
  while (installed.length) registry.uninstallUserDefinition(installed.pop())
  setFlag(undefined)
  stockChartSpy.mockClear()
})

// ─── 1. THE ARTIFACT ────────────────────────────────────────────────────────

describe('⭐⭐ the sentences ride on the saved document', () => {
  it('survives the store round trip and the install door', () => {
    const built = memberPaneDefinition({ source: V2, id: 'u_t5b-artifact' })
    expect(built.reason).toBe(null)

    // ⛔ THE PINE IS NOT IN THE ARTIFACT. This is the measurement the whole
    // design rests on — if it were, this component could re-derive the notes and
    // `meta.disclosures` would be a second authority over one value.
    expect(built.definition.compute.source.length).toBeLessThan(400)
    expect(built.definition.compute.source).not.toContain('alertcondition')
    expect(V2.length).toBeGreaterThan(30000)

    const def = installSaved(built.definition, 'u_t5b-artifact')
    // `defSchema` preserves unknown `meta.*` keys (IGNORE-AND-PRESERVE), which is
    // what makes `meta` the sanctioned home rather than a schema change.
    expect(def.meta.disclosures.map((n) => n.name)).toEqual(['alertcondition', 'baseTimeframeFolds'])
    expect(def.meta.requirementTags).toEqual(['window_dependent'])
    // ⛔ VERBATIM, not "contains the word alert". The wording is declared once, in
    // `closedTable.json::_alertconditions`, and a paraphrase anywhere is the
    // second-vocabulary defect this project keeps paying for.
    expect(def.meta.disclosures[0].note).toBe(built.notes[0].note)
    expect(def.meta.disclosures[1].note).toBe(built.notes[1].note)
  })

  it('⛔ and the four drawn series are what got saved, not the scan plot', () => {
    const built = memberPaneDefinition({ source: V2, id: 'u_t5b-plots' })
    const def = installSaved(built.definition, 'u_t5b-plots')
    expect(def.plots.map((p) => p.key)).toEqual(['value', 'out2', 'out3', 'out4'])
    expect(def.plots.map((p) => p.label))
      .toEqual(['Volume', 'Avg Vol Columns', 'Avg Vol Line', 'Scale Padding'])
  })
})

// ─── 2. THE MEMBER'S REAL CHART ─────────────────────────────────────────────

describe('⭐⭐ the member route — indicatorInstances on ChartPane', () => {
  let def
  let settings
  beforeEach(() => {
    const built = memberPaneDefinition({ source: V2, id: 'u_t5b-route' })
    def = installSaved(built.definition, 'u_t5b-route')
    settings = chartWith('u_t5b-route')
  })

  it('the instance is in indicatorInstances and reaches the chart', () => {
    expect(settings.indicatorInstances.map((i) => i.defId)).toContain('u_t5b-route')
    render(<ChartPane sym="SPY" tf="D" stored={settings} onStore={() => {}} onTfChange={() => {}} />)
    const handed = stockChartSpy.mock.calls.at(-1)[0].settingsOverride
    expect(handed.indicatorInstances.map((i) => i.defId)).toContain('u_t5b-route')
  })

  it('⭐⭐ renders all three disclosures, verbatim, with the live bar count', async () => {
    render(<ChartPane sym="SPY" tf="D" stored={settings} onStore={() => {}} onTfChange={() => {}} />)

    // The chart reports what it DREW. 4,633 is the count the forced-depth SPY
    // capture actually loaded (`tests/fixtures/vendor/…-forced-depth-…json`), so
    // the badge under test names a real number from a real read.
    const onDrawn = stockChartSpy.mock.calls.at(-1)[0].onDrawnBarCount
    expect(typeof onDrawn).toBe('function')
    onDrawn(4633)

    await waitFor(() => {
      const items = [...screen.getByTestId('pine-attached-disclosures').querySelectorAll('li')]
      expect(items).toHaveLength(3)
      expect(items.map((li) => li.textContent)).toEqual([
        def.meta.disclosures[0].note,
        def.meta.disclosures[1].note,
        requirementNote('window_dependent', 4633).note,
      ])
    })
    // ⛔ THE NUMBER IS THE ONE THE CHART REPORTED, not a placeholder. A badge that
    // says "an unknown number of bars" beside a chart holding 4,633 of them is
    // the failure this case exists for.
    expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain('4,633')
  })

  it('⚠️ before the chart reports a count the badge says so rather than guessing', () => {
    render(<ChartPane sym="SPY" tf="D" stored={settings} onStore={() => {}} onTfChange={() => {}} />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent)
      .toContain('an unknown number of')
  })

  it('⚰️⚰️ THE COUNT ARRIVES BEFORE THE INSTANCE DOES — and the badge still names it', async () => {
    // ⚰️ MEASURED IN A REAL BROWSER, 2026-09-13, and it is the defect this case
    // exists for. `ChartPane` first gated its bar-count recording on "does
    // anything attached need it", which reads as the careful thing to do and is
    // wrong: `StockChart` publishes the count from an effect keyed on `ohlcData`,
    // through a REF, so it fires ONCE when the bars land — before the member has
    // added anything. The gate was false at that instant and false forever, and
    // a /charts widget holding 8,462 bars showed **"an unknown number of bars
    // here"** in the one sentence whose whole job is to name the number.
    //
    // ⛔ NO OFFLINE TEST COULD HAVE CAUGHT IT WITHOUT THIS ORDERING. Mount the
    // pane with the instance already present and the gate is true from the first
    // render; every assertion passes and the shipped surface is still vague.
    const plain = mergeChartSettings({})
    const { rerender } = render(
      <ChartPane sym="SPY" tf="D" stored={plain} onStore={() => {}} onTfChange={() => {}} />)
    // the bars land on a chart with nothing attached …
    stockChartSpy.mock.calls.at(-1)[0].onDrawnBarCount(8462)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()

    // … and only then does the member add the indicator.
    rerender(
      <ChartPane sym="SPY" tf="D" stored={settings} onStore={() => {}} onTfChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain('8,462')
    })
    expect(screen.getByTestId('pine-attached-disclosures').textContent)
      .not.toContain('an unknown number of')
  })

  it('⛔ a HIDDEN instance discloses nothing — the series is not on screen', () => {
    const hidden = {
      ...settings,
      indicatorInstances: settings.indicatorInstances.map(
        (i) => (i.defId === 'u_t5b-route' ? { ...i, hidden: true } : i)),
    }
    render(<ChartPane sym="SPY" tf="D" stored={hidden} onStore={() => {}} onTfChange={() => {}} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
  })

  it('⛔ a SAVED-but-not-attached definition discloses nothing', () => {
    // Installed in the registry (it is a member's formula, it is in their
    // library), simply not on this chart. `attachedDisclosures` reads the
    // instances, never the registry's list.
    expect(attachedDisclosures(mergeChartSettings({}), registry)).toEqual([])
    expect(attachedNeedsBarCount(mergeChartSettings({}), registry)).toBe(false)
    expect(attachedNeedsBarCount(settings, registry)).toBe(true)
  })

  it('⚠️ the shipped indicators disclose nothing, so no other chart grows a list', () => {
    const rsi = addInstance(mergeChartSettings({}), 'rsi', registry)
    expect(rsi.indicatorInstances.some((i) => i.defId === 'rsi')).toBe(true)
    render(<ChartPane sym="SPY" tf="D" stored={rsi} onStore={() => {}} onTfChange={() => {}} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
  })
})

// ─── 3. FLAG-OFF, ON THIS ROUTE, NON-VACUOUSLY ──────────────────────────────
//
// ⛔⛔ THE THREE ABSENCES ARE MEASURED SEPARATELY, because they fail separately.
// "Nothing in the DOM" is satisfied by a component that never mounts, by a route
// that produced no instance, and by a test that forgot to build anything — and
// only the middle one is the claim. So each case below carries its own control
// showing the same measurement is POSITIVE with the flag on.

describe('⛔⛔ flag-off on the member route: no pane, no instance, nothing in the DOM', () => {
  const attachSpy = vi.fn()

  beforeEach(() => { attachSpy.mockReset() })

  it('NO PANE — the attach door does not exist, so nothing can be attached', () => {
    setFlag(undefined)
    const { unmount } = render(
      <MemberPane sym="SPY" tf="D" source={V2} settings={mergeChartSettings({})} onAttach={attachSpy} />)
    expect(screen.queryByTestId('pine-member-pane')).toBeNull()
    expect(screen.queryByTestId('pine-member-pane-attach')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add this script to my chart/ })).toBeNull()
    expect(attachSpy).not.toHaveBeenCalled()
    // ⛔ AND IT INSTALLED NOTHING EITHER — the flag is read before any build, so a
    // default bundle never even translates the script.
    expect(registry.listUserDefinitions().map((d) => d.id)).toEqual([])
    unmount()

    // ── the control: the same render with the flag on ──
    setFlag('1')
    render(
      <MemberPane sym="SPY" tf="D" source={V2} settings={mergeChartSettings({})} onAttach={attachSpy} />)
    expect(screen.getByTestId('pine-member-pane')).toBeTruthy()
    const btn = screen.getByRole('button', { name: /Add this script to my chart/ })
    fireEvent.click(btn)
    expect(attachSpy).toHaveBeenCalledTimes(1)
    // The document handed over is the one that was drawn: four series, both
    // disclosures, the tag.
    const handed = attachSpy.mock.calls[0][0]
    expect(handed.plots.map((p) => p.key)).toEqual(['value', 'out2', 'out3', 'out4'])
    expect(handed.meta.disclosures).toHaveLength(2)
    expect(handed.meta.requirementTags).toEqual(['window_dependent'])
    // MemberPane's own throwaway install is torn down on unmount; register it so
    // afterEach cleans up if the unmount path ever changes.
    installed.push(handed.id)
  })

  it('NO INSTANCE, NOTHING IN THE DOM — the chart the flag-off route produced', () => {
    setFlag(undefined)
    render(
      <MemberPane sym="SPY" tf="D" source={V2} settings={mergeChartSettings({})} onAttach={attachSpy} />)
    expect(attachSpy).not.toHaveBeenCalled()
    cleanup()

    // Nothing was attached, so the member's chart settings are the ones they had.
    const untouched = mergeChartSettings({})
    expect((untouched.indicatorInstances || []).filter((i) => String(i.defId).startsWith('u_')))
      .toEqual([])
    render(<ChartPane sym="SPY" tf="D" stored={untouched} onStore={() => {}} onTfChange={() => {}} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    cleanup()

    // ── the control: the SAME ChartPane assertion, positive, once the route has
    //    actually run. This is what makes the absence above a statement about the
    //    flag rather than about a chart with nothing on it.
    const built = memberPaneDefinition({ source: V2, id: 'u_t5b-control' })
    installSaved(built.definition, 'u_t5b-control')
    render(
      <ChartPane sym="SPY" tf="D" stored={chartWith('u_t5b-control')} onStore={() => {}} onTfChange={() => {}} />)
    expect(screen.getByTestId('pine-attached-disclosures')).toBeTruthy()
  })
})

// ─── 4. TWO DEFINITIONS FROM ONE SCRIPT, COEXISTING ─────────────────────────

describe('⭐⭐ two definitions that differ on one parameter coexist on one chart', () => {
  it('both install, both take an instance, and the notes are said once', () => {
    // ⭐ `__uct_param_1` (`lenWeekly`, "Weekly Length") is the knob used here and
    // NOT `lookbackBarsHVE`, which the owner named — see the case below for why
    // that one cannot be varied on a pane. Weekly Length has locators in out2,
    // out3 AND out4, so two variants really are two different drawings.
    const v = memberPaneVariants({
      source: V2, paramId: '__uct_param_1', values: [50, 200], idPrefix: 'u_t5b-var',
    })
    expect(v.reason).toBe(null)
    expect(v.variants).toHaveLength(2)

    const a = installSaved(v.variants[0].definition, 'u_t5b-var-0')
    const b = installSaved(v.variants[1].definition, 'u_t5b-var-1')
    expect(a.id).not.toBe(b.id)

    // ⛔ THE TREES REALLY DIFFER. Two documents with the same maths are not two
    // definitions coexisting, they are one definition installed twice — and this
    // whole case would pass on them.
    expect(JSON.stringify(a.compute.trees)).not.toBe(JSON.stringify(b.compute.trees))

    const settings = chartWith('u_t5b-var-0', 'u_t5b-var-1')
    expect(settings.indicatorInstances.filter((i) => String(i.defId).startsWith('u_t5b-var')))
      .toHaveLength(2)

    render(<ChartPane sym="SPY" tf="D" stored={settings} onStore={() => {}} onTfChange={() => {}} />)
    const handed = stockChartSpy.mock.calls.at(-1)[0].settingsOverride
    expect(handed.indicatorInstances.filter((i) => String(i.defId).startsWith('u_t5b-var')))
      .toHaveLength(2)

    // ⛔ THREE SENTENCES, NOT SIX. Both documents came from one script and carry
    // the same two notes and the same tag; rendering each twice reads as two
    // problems, which is the defect `memberPaneDefinition` dedupes rows for one
    // layer down.
    const items = [...screen.getByTestId('pine-attached-disclosures').querySelectorAll('li')]
    expect(items).toHaveLength(3)
  })

  it('⛔⛔ …and `lookbackBarsHVE` is REFUSED BY NAME, with the reason (ruling D1)', () => {
    // ⚰️ THE OWNER NAMED THIS PARAMETER, AND IT IS THE ONE THAT CANNOT VARY A
    // PANE. `lookbackBarsHVE` (`__uct_param_3`) feeds `triggerHVE_Daily` →
    // `isHVEvent` → `alertcondition(isHVEvent, title='HVE Trigger')`, and ruling
    // D1 says a pane never selects an alertcondition. Once that output is gone
    // the knob has no drawn series left to move, so `applyParamEdit` finds no
    // locator for it in `compute.paramManifest`.
    //
    // ⛔ AND THE REFUSAL IS THE PRODUCT, NOT A GAP. Building two documents that
    // differ on a parameter neither of them draws would put two identical panes
    // on a member's chart under two names and look like it worked.
    const v = memberPaneVariants({
      source: V2, paramId: '__uct_param_3', values: [1000, 2500], idPrefix: 'u_t5b-hve',
    })
    expect(v.ok).toBe(false)
    expect(v.variants).toEqual([])
    expect(v.reason).toContain('HVE lookback (bars)')
    expect(v.reason).toContain('reaches')
    expect(v.reason).toContain('no series this pane draws')
    // The script really does declare it — the refusal is about reach, not about a
    // typo in the parameter id.
    const built = memberPaneDefinition({ source: V2, id: 'u_t5b-hve-probe' })
    expect((built.translation.inputParams || []).map((p) => p.id)).toContain('__uct_param_3')
    expect(Object.keys(built.definition.compute.paramManifest)).not.toContain('__uct_param_3')
  })
})

// ─── 5. THE BUILDER AND THE CHART CANNOT DISAGREE ───────────────────────────

test('⛔ one wording, two surfaces — the builder pane and the real chart agree', () => {
  setFlag('1')
  const built = memberPaneDefinition({ source: V2, id: 'u_t5b-parity' })
  installSaved(built.definition, 'u_t5b-parity')
  const onChart = attachedDisclosures(chartWith('u_t5b-parity'), registry, 4633)
  const inBuilder = [
    ...built.notes,
    ...built.requirementTags.map((t) => requirementNote(t, 4633)),
  ]
  expect(onChart).toEqual(inBuilder)
})
