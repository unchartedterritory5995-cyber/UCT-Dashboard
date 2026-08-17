// app/src/components/chart/engine/__tests__/alertSets.test.js
//
// ─── PER-CHART ALERT SETS: `scope` IS DATA, AND ABSENT MEANS GLOBAL ──────────
//
// Spec §5 shipped the instance model as
// `[{instanceId, defId, defVersion, inputs, styleOverrides, placement, hidden,
// scope?}]` with the note *"`scope` (chartId) present from day one as data;
// global default at cutover, per-chart + templates flips on in Phase C"*.
//
// ⛔ IT WAS NOT PRESENT. B5 shipped `{instanceId, defId, defVersion, inputs,
// placement, hidden}` and no `scope` anywhere, so this is an ADDITION and the
// thing that has to be proved is what an addition to a shape that every
// production blob already has can break:
//
//   1. an existing user's blob must not GROW — no `scope` key may be written
//      into any instance that did not already carry one;
//   2. an existing user's blob must not SHRINK — no instance may be lost;
//   3. a scoped instance must survive the two merges every chart is on
//      (`mergeChartSettings`, and `mergeSettingsOverride` for a grid cell);
//   4. absent, explicit-`undefined` and explicit-`null` are three different
//      things ON THE WAY IN and only two on the way OUT, so "unscoped" has to be
//      asserted through a REAL JSON ROUND TRIP rather than an object literal.
//
// ⚠️ (4) IS NOT PEDANTRY — B5 Task 4 shipped a half-deletion that every
// output-reading test passed, for exactly this reason: `JSON.stringify` DROPS an
// `undefined` value and LWC's `merge()` SKIPS one, so `{scope: undefined}` and
// `{}` serialise identically while `{scope: null}` does not.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  instanceScope,
  scopeInstance,
  instancesForChart,
  alertSetFor,
  applyAlertTemplate,
  templateInstanceId,
  TEMPLATE_ID_PREFIX,
  addressBase,
  instancesForAddress,
} from '../alertSets'
import { validateInstance, normalizeInstances } from '../instances'
import { withInstances } from '../instanceControls'
import * as engineRegistry from '../nativeRegistry'
import { mergeChartSettings, mergeSettingsOverride } from '../../chartDefaults'
import { BLOB_FIXTURES } from '../__fixtures__'

const R = engineRegistry
const base = { indicators: {}, indicatorInstances: [] }
const ids = (list) => list.map(i => i.instanceId)

// ─── 1. the filter ───────────────────────────────────────────────────────────

describe('a scope is a chart id, and an absent one is global', () => {
  it('a scoped instance is invisible to a chart that is not its scope', () => {
    const cs = withInstances(base, [
      { instanceId: 'rsi-global', defId: 'rsi', inputs: {} },
      { instanceId: 'rsi-chart-2', defId: 'rsi', inputs: { period: 7 }, scope: 'chart-2' },
    ])
    expect(ids(instancesForChart(cs, 'chart-1'))).toEqual(['rsi-global'])
    expect(ids(instancesForChart(cs, 'chart-2'))).toEqual(['rsi-global', 'rsi-chart-2'])
  })

  it('…and it is invisible to a caller that names no chart at all', () => {
    // A surface with no chart identity (the render route, a headless capture)
    // must not silently inherit another chart's private indicators.
    const cs = withInstances(base, [
      { instanceId: 'rsi-global', defId: 'rsi', inputs: {} },
      { instanceId: 'rsi-chart-2', defId: 'rsi', inputs: {}, scope: 'chart-2' },
    ])
    expect(ids(instancesForChart(cs, null))).toEqual(['rsi-global'])
    expect(ids(instancesForChart(cs, undefined))).toEqual(['rsi-global'])
  })

  it('a bare array is accepted as well as a settings blob', () => {
    const list = [{ instanceId: 'a', defId: 'rsi', inputs: {}, scope: 'c1' }]
    expect(ids(instancesForChart(list, 'c1'))).toEqual(['a'])
    expect(ids(instancesForChart(list, 'c2'))).toEqual([])
  })

  it('ORDER is the stored order — the filter never re-sorts', () => {
    const list = [
      { instanceId: 'z', defId: 'rsi', inputs: {} },
      { instanceId: 'y', defId: 'macd', inputs: {}, scope: 'c1' },
      { instanceId: 'x', defId: 'bb', inputs: {} },
    ]
    expect(ids(instancesForChart(list, 'c1'))).toEqual(['z', 'y', 'x'])
  })

  it('garbage is skipped, never thrown on — this runs inside the paint', () => {
    expect(instancesForChart(null, 'c1')).toEqual([])
    expect(instancesForChart({ indicatorInstances: 'nope' }, 'c1')).toEqual([])
    expect(ids(instancesForChart([null, 7, { instanceId: 'a', defId: 'rsi' }], 'c1'))).toEqual(['a'])
  })
})

// ─── 2. absent vs undefined vs null — through a REAL round trip ──────────────

describe('an instance with NO scope is global, and that is NOT the same as scope null', () => {
  const ABSENT = { instanceId: 'a', defId: 'rsi', inputs: {}, hidden: false }
  const UNDEF = { instanceId: 'b', defId: 'rsi', inputs: {}, hidden: false, scope: undefined }
  const NULL = { instanceId: 'c', defId: 'rsi', inputs: {}, hidden: false, scope: null }

  it('the SERIALISER collapses two of the three, which is why this is measured', () => {
    const rt = JSON.parse(JSON.stringify([ABSENT, UNDEF, NULL]))
    expect(Object.prototype.hasOwnProperty.call(rt[0], 'scope')).toBe(false)
    // ⚠️ the trap: an explicit `undefined` is INDISTINGUISHABLE from absent the
    // moment it is stored. Anything that means to distinguish them is a lie.
    expect(Object.prototype.hasOwnProperty.call(rt[1], 'scope')).toBe(false)
    // …and `null` is NOT collapsed. It survives, so it is a stored value with a
    // meaning, and the meaning cannot be "global" or the two would be the same.
    expect(Object.prototype.hasOwnProperty.call(rt[2], 'scope')).toBe(true)
    expect(rt[2].scope).toBe(null)
  })

  it('absent and explicit-undefined both read as GLOBAL, before and after JSON', () => {
    for (const inst of [ABSENT, UNDEF, ...JSON.parse(JSON.stringify([ABSENT, UNDEF]))]) {
      expect(instanceScope(inst)).toBeUndefined()
      expect(ids(instancesForChart([inst], 'any-chart'))).toEqual([inst.instanceId])
    }
  })

  it('an explicit null is REFUSED by the validator, and says why', () => {
    const res = validateInstance(JSON.parse(JSON.stringify(NULL)), R)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/scope/)
    // The message has to name the rule, not just the type — "absent means
    // global" is the thing a reader has to be told.
    expect(res.errors.join(' ')).toMatch(/absent/i)
  })

  it('…while an absent scope and a real chart id are both VALID', () => {
    expect(validateInstance(ABSENT, R).ok).toBe(true)
    expect(validateInstance({ ...ABSENT, scope: 'chart-2' }, R).ok).toBe(true)
    expect(validateInstance({ ...ABSENT, scope: '' }, R).ok).toBe(false)
    expect(validateInstance({ ...ABSENT, scope: 7 }, R).ok).toBe(false)
  })
})

// ─── 3. the field ORDER — a stored blob's key order may not move ────────────

describe('`scope` is appended LAST, so no existing instance changes shape', () => {
  it('scopeInstance puts it after every key the instance already had', () => {
    const inst = { instanceId: 'a', defId: 'rsi', defVersion: 1, inputs: { period: 7 }, placement: { target: 'pane' }, hidden: false }
    const out = scopeInstance(inst, 'chart-2')
    expect(Object.keys(out)).toEqual([
      'instanceId', 'defId', 'defVersion', 'inputs', 'placement', 'hidden', 'scope',
    ])
    expect(out.scope).toBe('chart-2')
    // and the source is untouched — this module is pure
    expect(Object.prototype.hasOwnProperty.call(inst, 'scope')).toBe(false)
  })

  it('re-scoping an already-scoped instance keeps `scope` last, not in place', () => {
    const inst = { instanceId: 'a', scope: 'chart-1', defId: 'rsi', inputs: {}, hidden: false }
    expect(Object.keys(scopeInstance(inst, 'chart-9'))).toEqual([
      'instanceId', 'defId', 'inputs', 'hidden', 'scope',
    ])
  })

  it('clearing a scope REMOVES the key — it does not set it to undefined', () => {
    const scoped = scopeInstance({ instanceId: 'a', defId: 'rsi', inputs: {} }, 'chart-2')
    const cleared = scopeInstance(scoped, null)
    expect(Object.prototype.hasOwnProperty.call(cleared, 'scope')).toBe(false)
    // …which is what makes it survive a JSON round trip as GLOBAL rather than
    // as a key that means nothing.
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(cleared)), 'scope')).toBe(false)
  })

  it('the legacy MIGRATION emits no scope at all — a migrated indicator is global', () => {
    // The strongest form of "key order is unchanged": the key is not written.
    // Every production blob is v1, so this is the shape every user gets.
    for (const { name, cs } of BLOB_FIXTURES) {
      const merged = mergeChartSettings(JSON.stringify(cs))
      for (const inst of merged.indicatorInstances) {
        expect(Object.prototype.hasOwnProperty.call(inst, 'scope'),
          `${name}: the migration wrote a scope into ${inst.instanceId}`).toBe(false)
      }
    }
  })
})

// ─── 4. THE GATE: a real stored blob round-trips unchanged ──────────────────

describe('⭐ THE MEASUREMENT — a real stored blob gains no scope and loses no instance', () => {
  it.each(BLOB_FIXTURES.map(f => [f.name, f.provenance, f.cs]))(
    '%s (%s) round-trips with ZERO scope keys added and ZERO instances lost',
    (_name, _prov, cs) => {
      const once = mergeChartSettings(JSON.stringify(cs))
      const twice = mergeChartSettings(JSON.stringify(once))
      // nothing lost
      expect(ids(twice.indicatorInstances)).toEqual(ids(once.indicatorInstances))
      // nothing gained — the whole list, key for key
      expect(twice.indicatorInstances).toEqual(once.indicatorInstances)
      expect(JSON.stringify(twice.indicatorInstances))
        .toBe(JSON.stringify(once.indicatorInstances))
      // and every one of them is GLOBAL, so every chart still draws them
      for (const inst of twice.indicatorInstances) expect(instanceScope(inst)).toBeUndefined()
      expect(ids(instancesForChart(twice, 'any-chart'))).toEqual(ids(twice.indicatorInstances))
    },
  )

  // ─── THE PIXEL CLAIM, MEASURED WITHOUT A BUILD ────────────────────────────
  //
  // ⛔ THE PARITY GATE WAS NOT RUN, AND THE REASON IS MEASURED RATHER THAN
  // ASSUMED — a second agent holds 23 files in this worktree including
  // `StockChart.jsx`, `binder.js` and `nativeRegistry.js`, and has the registry
  // mid-move from 16 to 17 definitions. Two Playwright builds off that tree
  // would attribute ITS changed pixels to THIS task, which is worse than no
  // number. (`enumerationSites.test.js` fails 6 cases on this tree with no edit
  // of its own, all of them `expected 16 … got 17`.)
  //
  // ⭐ WHAT REPLACES IT IS AN EQUALITY, NOT A SMALLER PROXY. A chart is drawn
  // from the merged settings blob: `mergeChartSettings` is on every chart's
  // path, the binder plans from `indicatorInstances`, and nothing downstream
  // reads the stored blob directly. So if the merged blob is BYTE-IDENTICAL for
  // every fixture — including the genuine production capture — no pixel can
  // move, whatever the renderer does with it.
  //
  // The literal below was computed on the tree BEFORE this task's three
  // frontend edits (`git show HEAD:` bytes for chartDefaults.js, instances.js
  // and instanceControls.js, restored sha256-verified afterwards). It is not a
  // baseline this task minted for itself: it is what the merge already
  // answered, and a change that moved one character of one stored blob would
  // fail here with the fixture named.
  // 2026-08-12: re-pinned when the additive, default-OFF setting `compareHideBase`
  // ("Group only" for Compare Symbols) was added to CHART_DEFAULTS + mergeChartSettings.
  // Every merged blob gains `compareHideBase:false` — a new key nothing reads unless
  // the user enables it, so no pixel moves; the digest necessarily shifts by that one
  // additive field. (Prior value: 313352ceafb4fc29b556e053f3073463de387e96273bc4cf9b651e23db690875)
  // 2026-08-14: re-pinned for the axis-label + dark-pool overlay settings
  // (commits fd0f43658 / cc945fc64). INVESTIGATED, not refreshed: `git diff` of
  // CHART_DEFAULTS across that batch contains ZERO removed lines — the merged
  // blob gains exactly three top-level keys and loses none.
  //   showPriceLabels: true   — the boxed last-price tag, documented in-file as
  //                             "matches prior behavior", so nothing moves
  //   showMaLabels: false     — opt-in, off by default
  //   darkPool: {enabled:false,…} — opt-in + paid-gated, off by default
  // Two default-OFF and one codifying what was already drawn ⇒ no pixel moves;
  // the digest necessarily shifts by those additive fields.
  // 2026-08-16: re-pinned for `header.legendMode` (the on-chart legend's
  // Always / On click / Off mode). INVESTIGATED BY MEASUREMENT, not by reading
  // the diff and hoping: a throwaway rail rebuilt this exact hash over these
  // exact fixtures with `header.legendMode` — and ONLY that key — deleted from
  // each merged blob, preserving key order so the emitted bytes matched, and it
  // reproduced the prior literal EXACTLY. So every other byte of every fixture's
  // merged blob is unchanged and nothing on this path answers differently.
  //   legendMode: 'always'  — resolved by `legendMode.js::legendModeOf` from the
  //                           legacy `header.showLegend`, so a stored blob that
  //                           has never heard of the key merges to the behaviour
  //                           it already had. Zero pixels move for any user.
  // ⚠️ `showLegend` is deliberately still emitted beside it: it is the fallback
  // INPUT the resolver reads, so removing it WOULD change the answer for every
  // user who had turned the legend off, and would have shown up here as a
  // non-additive move.
  // 2026-08-16 (same day, second move): the legend's DEFAULT flipped from
  // 'always' to 'click' (owner call — a chart now starts clean and answers when a
  // candle is clicked). So this is a VALUE change to the one key the previous
  // re-pin ADDED, not a new key. PROVED THE SAME WAY: a throwaway rail rebuilt
  // this hash with `header.legendMode` stripped from each merged blob and
  // reproduced the PRE-FEATURE literal exactly, so nothing else on this path
  // answers differently.
  // ⚠️ `showLegend` still rides along unchanged — it is the resolver's fallback
  // INPUT, and an explicit `false` in it still wins as 'off'.
  // ⭐ 2026-08-17 — AND IT IS BACK TO THE PRE-FEATURE LITERAL, WHICH IS THE
  // POINT. The two moves above were caused by `mergeChartSettings` STAMPING the
  // resolved `legendMode` into every merged blob; every settings write persists
  // that blob, so the default became a recorded user choice and could never be
  // changed again (it reached production and cost the owner the default flip).
  // The merge now carries ONLY an explicit choice, so a default blob is byte-for-
  // byte what it was before this feature existed — and this rail returning to its
  // original value is the proof.
  const MERGED_BLOB_DIGEST_AT_HEAD =
    '2c97ddd7fc6703a5f621c0c4fdf7feea99198fbe0f7753b5dfa8aab3fa602639'

  it('⭐ the merged settings blob is BYTE-IDENTICAL to the tree before this task', () => {
    // ⚠️ A STATIC `node:crypto` IMPORT, NOT `await import()`. Under vitest's
    // jsdom environment the dynamic form resolves to a different implementation
    // and hashes the SAME bytes to a different digest — which reads exactly like
    // a real change. Measured here, on one tree, twice.
    const h = createHash('sha256')
    for (const { name, cs } of BLOB_FIXTURES) {
      h.update(name)
      h.update(' ')
      h.update(JSON.stringify(mergeChartSettings(JSON.stringify(cs))))
      h.update(' ')
    }
    expect(h.digest('hex'),
      'mergeChartSettings answers differently than it did before per-chart scope — ' +
      'every chart is on this path, so this is a pixel change')
      .toBe(MERGED_BLOB_DIGEST_AT_HEAD)
  })

  it('non-vacuity, per fixture — and the GENUINE one carries none, which is stated', () => {
    const counts = Object.fromEntries(BLOB_FIXTURES.map(
      f => [f.name, mergeChartSettings(JSON.stringify(f.cs)).indicatorInstances.length]))
    // ⚠️ THE GENUINE CAPTURE PROJECTS ZERO INSTANCES — every indicator in the
    // owner's live blob is OFF — so "no scope key was added" is VACUOUS for
    // that one fixture on its own. Said out loud rather than hidden behind a
    // corpus total, because a round trip over an empty array proves nothing.
    // What covers it instead is the DIGEST above (byte equality over the whole
    // merged blob, instances or not) and `flipBStoredBlobs.test.jsx`'s July
    // blob, which has RSI and BB enabled and is a real capture too.
    expect(counts['owner-uct-default']).toBe(0)
    const withInstancesCount = Object.values(counts).filter(n => n > 0).length
    expect(withInstancesCount,
      'no fixture projects an instance, so the round trip proves nothing')
      .toBeGreaterThanOrEqual(4)
  })

  it('a SCOPED instance survives mergeChartSettings and a save→load cycle', () => {
    const stored = {
      ...BLOB_FIXTURES[0].cs,
      settingsVersion: 2,
      indicatorInstances: [
        { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
        { instanceId: 'chart-2:macd', defId: 'macd', inputs: {}, hidden: false, scope: 'chart-2' },
      ],
    }
    const once = mergeChartSettings(JSON.stringify(stored))
    const twice = mergeChartSettings(JSON.stringify(once))
    expect(twice.indicatorInstances).toEqual(once.indicatorInstances)
    expect(instanceScope(twice.indicatorInstances.find(i => i.instanceId === 'chart-2:macd')))
      .toBe('chart-2')
    expect(ids(instancesForChart(twice, 'chart-1'))).toEqual(['legacy:rsi'])
    expect(ids(instancesForChart(twice, 'chart-2'))).toEqual(['legacy:rsi', 'chart-2:macd'])
    // …and it is well-formed, so `normalizeInstances` does not quietly drop it
    expect(normalizeInstances(twice.indicatorInstances, R).dropped).toEqual([])
  })

  it('⛔ a SCOPED instance does not suppress the GLOBAL seed for its definition', () => {
    // The v1→v2 fold skips a legacy toggle whose definition is already drawn.
    // A chart-scoped instance is NOT drawn on every chart, so counting it there
    // would delete the indicator from every OTHER chart at migration time.
    const stored = {
      indicators: { rsi: { enabled: true, period: 14 } },
      indicatorInstances: [
        { instanceId: 'chart-2:rsi', defId: 'rsi', inputs: { period: 7 }, hidden: false, scope: 'chart-2' },
      ],
    }
    const cs = mergeChartSettings(JSON.stringify(stored))
    expect(ids(instancesForChart(cs, 'chart-1')),
      'the global RSI was deleted by a scoped one on another chart').toEqual(['legacy:rsi'])
    expect(ids(instancesForChart(cs, 'chart-2')).sort())
      .toEqual(['chart-2:rsi', 'legacy:rsi'])
  })

  it('a scoped instance survives mergeSettingsOverride — the grid-cell path', () => {
    const cs = mergeChartSettings(JSON.stringify({
      settingsVersion: 2,
      indicatorInstances: [
        { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
        { instanceId: 'chart-2:macd', defId: 'macd', inputs: {}, hidden: false, scope: 'chart-2' },
      ],
    }))
    // an override that mentions only ONE instance must not delete the other,
    // and must not strip the scope off the one it does mention
    const next = mergeSettingsOverride(cs, {
      indicatorInstances: [{ instanceId: 'chart-2:macd', inputs: { fastPeriod: 8 } }],
    })
    const macd = next.indicatorInstances.find(i => i.instanceId === 'chart-2:macd')
    expect(macd.scope, 'the override stripped the scope').toBe('chart-2')
    expect(macd.inputs).toEqual({ fastPeriod: 8 })
    expect(ids(next.indicatorInstances)).toEqual(['legacy:rsi', 'chart-2:macd'])
  })
})

// ─── 5. the ALERT set ───────────────────────────────────────────────────────

const alert = (id, extra = {}) => ({ id, sym: 'SPY', indicator: 'rsi', condition: 'above', tf: 'D', ...extra })

describe('alertSetFor — which alerts belong to THIS chart', () => {
  const ALERTS = [
    alert(1),                             // no scope key at all — global
    alert(2, { scope: null }),            // what the API serves for a NULL column
    alert(3, { scope: 'chart-1' }),
    alert(4, { scope: 'chart-2' }),
    alert(5, { scope: '' }),              // empty string — global, not a chart
  ]

  it('a chart sees the global alerts and its own, and nobody else\'s', () => {
    expect(alertSetFor('chart-1', ALERTS).map(a => a.id)).toEqual([1, 2, 3, 5])
    expect(alertSetFor('chart-2', ALERTS).map(a => a.id)).toEqual([1, 2, 4, 5])
  })

  it('⛔ a NULL scope from the API is GLOBAL — the column\'s default must not hide a row', () => {
    // The Python column is nullable and every alert that exists today is NULL.
    // If NULL read as "belongs to no chart" every existing alert would vanish
    // from every chart the day this shipped.
    expect(alertSetFor('chart-1', [alert(2, { scope: null })]).map(a => a.id)).toEqual([2])
  })

  it('naming no chart yields only the global alerts', () => {
    expect(alertSetFor(null, ALERTS).map(a => a.id)).toEqual([1, 2, 5])
  })

  it('order is the server\'s order, and garbage is skipped', () => {
    expect(alertSetFor('chart-1', null)).toEqual([])
    expect(alertSetFor('chart-1', [null, alert(9)]).map(a => a.id)).toEqual([9])
  })
})

// ─── 6. TEMPLATES — applied by instance id, never by replacement ────────────

const TEMPLATE = {
  id: 'momentum',
  name: 'Momentum',
  instances: [
    { key: 'fast', defId: 'rsi', inputs: { period: 7 } },
    { key: 'slow', defId: 'rsi', inputs: { period: 21 } },
  ],
  alerts: [
    { instanceKey: 'fast', indicator: 'rsi', condition: 'cross_above', threshold: 70, tf: '5' },
    { indicator: 'macd.histogram', condition: 'cross_zero', tf: 'D' },
  ],
}

describe('applyAlertTemplate — a PATCH scoped to one chart', () => {
  it('every instance it creates is scoped to the chart and has a DERIVED id', () => {
    const out = applyAlertTemplate(TEMPLATE, 'chart-1')
    expect(ids(out.settings.indicatorInstances)).toEqual([
      templateInstanceId('momentum', 'chart-1', 'fast'),
      templateInstanceId('momentum', 'chart-1', 'slow'),
    ])
    for (const inst of out.settings.indicatorInstances) {
      expect(inst.scope).toBe('chart-1')
      expect(inst.instanceId.startsWith(TEMPLATE_ID_PREFIX)).toBe(true)
      expect(Object.keys(inst).at(-1)).toBe('scope')
    }
  })

  it('the SAME template on a DIFFERENT chart makes different instances', () => {
    const a = applyAlertTemplate(TEMPLATE, 'chart-1')
    const b = applyAlertTemplate(TEMPLATE, 'chart-2')
    expect(ids(a.settings.indicatorInstances)).not.toEqual(ids(b.settings.indicatorInstances))
    // and neither is visible to the other
    const both = [...a.settings.indicatorInstances, ...b.settings.indicatorInstances]
    expect(ids(instancesForChart(both, 'chart-1'))).toEqual(ids(a.settings.indicatorInstances))
  })

  it('applying it TWICE is a fixed point — ids are derived, not generated', () => {
    const once = applyAlertTemplate(TEMPLATE, 'chart-1')
    const twice = applyAlertTemplate(TEMPLATE, 'chart-1')
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    const cs = { indicatorInstances: [] }
    const a = mergeSettingsOverride(cs, once.settings)
    const b = mergeSettingsOverride(a, twice.settings)
    expect(b.indicatorInstances).toEqual(a.indicatorInstances)
  })

  it('⭐ R4: it is a PATCH, so a concurrent add on another widget SURVIVES', () => {
    // Spec §5 safeguard 3 — "multiple chart widgets are concurrent writers;
    // last-writer-wins loses instance adds". A template that handed back a whole
    // array would delete whatever the other widget had just written.
    const cs = {
      indicatorInstances: [
        { instanceId: 'legacy:bb', defId: 'bb', inputs: {}, hidden: false },
      ],
    }
    const next = mergeSettingsOverride(cs, applyAlertTemplate(TEMPLATE, 'chart-1').settings)
    expect(ids(next.indicatorInstances)).toContain('legacy:bb')
    expect(next.indicatorInstances).toHaveLength(3)
  })

  it('the alerts carry the chart scope AND the instance they were armed on', () => {
    const out = applyAlertTemplate(TEMPLATE, 'chart-1')
    expect(out.alerts).toHaveLength(2)
    const [first, second] = out.alerts
    expect(first.scope).toBe('chart-1')
    expect(first.instance_id).toBe(templateInstanceId('momentum', 'chart-1', 'fast'))
    // ⭐ the params come from the INSTANCE the template names, so the alert and
    // the chart cannot disagree about which RSI this is. No defId↔address map
    // is invented: the template author stated both.
    expect(first.params).toEqual({ period: 7 })
    expect(first.indicator).toBe('rsi')
    expect(first.condition).toBe('cross_above')
    expect(first.threshold).toBe(70)
    // an alert that names NO instance is still scoped, and carries no instance id
    expect(second.scope).toBe('chart-1')
    expect(second.instance_id).toBeUndefined()
    expect(second.params).toBeUndefined()
  })

  it('a template applied to NO chart is refused — that is a global write', () => {
    expect(() => applyAlertTemplate(TEMPLATE, '')).toThrow(/chart/i)
    expect(() => applyAlertTemplate(TEMPLATE, null)).toThrow(/chart/i)
    expect(() => applyAlertTemplate({ ...TEMPLATE, id: '' }, 'chart-1')).toThrow(/id/i)
  })

  it('an alert naming an instance the template does not declare is refused', () => {
    expect(() => applyAlertTemplate(
      { ...TEMPLATE, alerts: [{ instanceKey: 'nope', indicator: 'rsi', condition: 'above', tf: 'D' }] },
      'chart-1',
    )).toThrow(/nope/)
  })

  it('the instances it produces are VALID against the registry', () => {
    const out = applyAlertTemplate(TEMPLATE, 'chart-1')
    const { kept, dropped } = normalizeInstances(out.settings.indicatorInstances, R)
    expect(dropped, 'the template produced instances the normaliser drops').toEqual([])
    expect(kept).toHaveLength(2)
  })
})

// ─── WHICH INSTANCE AN ALERT NAMES (Phase C Task 15) ────────────────────────
//
// Task 10 shipped `instance_id` with no producer and named the reason: the
// popover holds an alert ADDRESS and the chart holds a DEFINITION id, and it
// MEASURED `address === defId` as a lie for two of fourteen groups. These cases
// are that measurement, kept — the bridge is derived and the two liars are the
// subjects, so a "simplification" back to equality dies here.
describe('instancesForAddress — the bridge that does NOT lie', () => {
  const inst = (instanceId, defId, inputs) => ({ instanceId, defId, inputs })

  it('addressBase takes the part before the dot, and answers nothing for a non-string', () => {
    expect(addressBase('ichimoku.tenkan')).toBe('ichimoku')
    expect(addressBase('rsi')).toBe('rsi')
    expect(addressBase(undefined)).toBe('')
    expect(addressBase(42)).toBe('')
  })

  it('⭐ matches `williams_r` to a `williamsR` instance — the case equality got WRONG', () => {
    const list = [inst('i1', 'williamsR', { period: 14 })]
    expect(instancesForAddress(list, 'williams_r').map(i => i.instanceId)).toEqual(['i1'])
    // …and the control: a naive `address === defId` returns nothing here, which
    // is why this file carries the case rather than a comment about it.
    expect(list.filter(i => i.defId === 'williams_r')).toEqual([])
  })

  it('⛔ answers NOTHING for the two addresses that name no definition', () => {
    const list = [inst('i1', 'rsi', { period: 14 }), inst('i2', 'williamsR', {})]
    // `price_vs_ma` is a spread the alert lane synthesises; `close` is the bar's
    // own price. Neither is a chart indicator, so neither may be given one.
    expect(instancesForAddress(list, 'price_vs_ma')).toEqual([])
    expect(instancesForAddress(list, 'close')).toEqual([])
    // …and the list really did contain matchable things, so the two empties
    // above are about the ADDRESS and not about an empty fixture.
    expect(instancesForAddress(list, 'rsi')).toHaveLength(1)
  })

  it('matches a grouped address on its base, and keeps STORED order for two of one kind', () => {
    const list = [
      inst('a', 'rsi', { period: 7 }),
      inst('b', 'ichimoku', {}),
      inst('c', 'rsi', { period: 14 }),
    ]
    expect(instancesForAddress(list, 'ichimoku.tenkan').map(i => i.instanceId)).toEqual(['b'])
    expect(instancesForAddress(list, 'rsi').map(i => i.instanceId)).toEqual(['a', 'c'])
    expect(instancesForAddress(list, 'macd.signal')).toEqual([])
  })

  it('reads a settings blob as happily as a bare list, and survives a hostile row', () => {
    const cs = { indicatorInstances: [inst('a', 'rsi', {})] }
    expect(instancesForAddress(cs, 'rsi').map(i => i.instanceId)).toEqual(['a'])
    const hostile = [{ get defId() { throw new Error('boom') } }, inst('a', 'rsi', {})]
    expect(instancesForAddress(hostile, 'rsi').map(i => i.instanceId)).toEqual(['a'])
  })
})
