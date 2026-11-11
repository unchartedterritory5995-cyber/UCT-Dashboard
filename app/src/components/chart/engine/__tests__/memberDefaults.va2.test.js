// app/src/components/chart/engine/__tests__/memberDefaults.va2.test.js
//
// ─── UCT RS unit VA2 (§17.8) — "Save as my default", generic for every shipped indicator ──
//
// The store is ONE key in the chart settings blob, `indicatorDefaults[defId] = {inputs}`.
// Pinned here:
//   · save writes only what differs from UCT's own values (`meta.createInputs`, else the
//     declared default), never a `source` input, and UCT's own values clear the entry;
//   · the two NEW-instance doors (`addInstance`, `setIndicatorEnabled` → ensure) start a
//     copy from it, and nothing edits a copy already on the chart;
//   · a value the definition refuses now is skipped at apply time, never stored;
//   · "Reset to UCT default" forgets the default AND puts this copy back on UCT's values;
//   · the blob allow-list keeps it (sanitised), absent stays absent (the merged digests),
//     and Restore Defaults / a preset carry it over (an Indicators-owned key);
//   · a member-authored definition cannot carry one.
import { describe, it, expect } from 'vitest'
import * as engineRegistry from '../nativeRegistry'
import {
  saveInstanceAsDefault, clearIndicatorDefault, resetInstanceToUctDefault, memberDefaultInputs,
  memberDefaultState, canSaveAsDefault, addInstance, setIndicatorEnabled, removeDefinition, findInstance,
  setInstanceInput, withIndicatorDefaultsOf, INDICATOR_DEFAULTS_KEY,
} from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { mergeChartSettings, sanitizeIndicatorDefaults, CHART_DEFAULTS } from '../../chartDefaults'
import { keepIndicatorState } from '../../indicatorPreservation'
import { INDICATOR_OWNED_TOP_KEYS } from '../../builder/agentSeams'
import { classifySettingPath } from '../../chartSettingsDescriptors'

const RS = 'rsLine'
const rsDef = () => engineRegistry.getDefinition(RS)
const withRs = (inputs = {}) => mergeChartSettings({
  indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs, hidden: false }],
})
const instOf = (cs, id) => findInstance(cs, id)

describe('saveInstanceAsDefault', () => {
  it('saves only what differs from UCT\'s values, and identity when nothing would change', () => {
    const cs = withRs({ benchmark: 'RSP', maLength: 21, headlineRating: 'both', color: '#6ba3be' })
    const next = saveInstanceAsDefault(cs, 'rs-1', engineRegistry)
    expect(next[INDICATOR_DEFAULTS_KEY]).toEqual({ rsLine: { inputs: { benchmark: 'RSP', headlineRating: 'both' } } })
    // the copy on the chart is untouched
    expect(instOf(next, 'rs-1')).toEqual(instOf(cs, 'rs-1'))
    // saving again is a no-op by identity
    expect(saveInstanceAsDefault(next, 'rs-1', engineRegistry)).toBe(next)
    // a copy at UCT's values with nothing saved: identity
    const plain = withRs({ maLength: 21 })
    expect(saveInstanceAsDefault(plain, 'rs-1', engineRegistry)).toBe(plain)
  })

  it('saving UCT\'s own values over a saved default clears the entry (and the key with it)', () => {
    const saved = saveInstanceAsDefault(withRs({ benchmark: 'QQQ' }), 'rs-1', engineRegistry)
    const back = setInstanceInput(saved, 'rs-1', 'benchmark', 'SPY', engineRegistry)
    const cleared = saveInstanceAsDefault(back, 'rs-1', engineRegistry)
    expect(INDICATOR_DEFAULTS_KEY in cleared).toBe(false)
  })

  it('never saves a `source` input (it names a line on THIS chart)', () => {
    const cs = mergeChartSettings({ indicatorInstances: [{ instanceId: 'roc-1', defId: 'roc', inputs: { source: 'high', period: 20 }, hidden: false }] })
    const next = saveInstanceAsDefault(cs, 'roc-1', engineRegistry)
    expect(next[INDICATOR_DEFAULTS_KEY]).toEqual({ roc: { inputs: { period: 20 } } })
  })

  it('identity for a missing instance, and for a definition that cannot carry a default', () => {
    const cs = withRs({ benchmark: 'RSP' })
    expect(saveInstanceAsDefault(cs, 'nope', engineRegistry)).toBe(cs)
    expect(canSaveAsDefault(rsDef())).toBe(true)
    expect(canSaveAsDefault({ id: 'u_0123456789ab', inputs: [{ key: 'x', type: 'int', default: 1 }] })).toBe(false)
    expect(canSaveAsDefault(null)).toBe(false)
  })
})

describe('a NEW copy starts from the saved default; an existing one never moves', () => {
  const saved = () => saveInstanceAsDefault(withRs({ benchmark: 'RSP', lookback: 52 }), 'rs-1', engineRegistry)

  it('addInstance (another copy) carries it', () => {
    const next = addInstance(saved(), RS, engineRegistry)
    const added = next.indicatorInstances.find((i) => i.defId === RS && i.instanceId !== 'rs-1')
    expect(added.inputs).toMatchObject({ benchmark: 'RSP', lookback: 52 })
    expect(instOf(next, 'rs-1').inputs).toEqual({ benchmark: 'RSP', lookback: 52 })
  })

  it('turning it on after a remove (ensureLegacyInstance) carries it, over the remembered mirror', () => {
    // a member who had QQQ on the legacy copy, removed it, then saved RSP elsewhere
    let cs = setIndicatorEnabled(mergeChartSettings(null), RS, true, engineRegistry)
    cs = setInstanceInput(cs, legacyInstanceId(RS), 'benchmark', 'QQQ', engineRegistry)
    cs = removeDefinition(cs, RS, engineRegistry)
    cs = { ...cs, [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { benchmark: 'RSP' } } } }
    const on = setIndicatorEnabled(cs, RS, true, engineRegistry)
    expect(instOf(on, legacyInstanceId(RS)).inputs.benchmark).toBe('RSP')
  })

  it('with no default saved, a new copy is byte-identical to before (UCT\'s values, createInputs kept)', () => {
    const a = addInstance(mergeChartSettings(null), 'stoch', engineRegistry)
    const st = a.indicatorInstances.find((i) => i.defId === 'stoch')
    expect(st.inputs.smoothK).toBe(3)
    expect(INDICATOR_DEFAULTS_KEY in a).toBe(false)
  })

  it('a saved value the definition refuses NOW is skipped, never stored on the new copy', () => {
    const cs = { ...mergeChartSettings(null), [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { lookback: 9999, benchmark: 'TSLA', maLength: 50, nope: 1 } } } }
    expect(memberDefaultInputs(cs, rsDef())).toEqual({ maLength: 50 })
    const next = addInstance(cs, RS, engineRegistry)
    const added = next.indicatorInstances.find((i) => i.defId === RS)
    expect(added.inputs.maLength).toBe(50)
    expect(added.inputs.lookback).toBe(252)
    expect(added.inputs.benchmark).toBe('SPY')
    expect('nope' in added.inputs).toBe(false)
  })
})

describe('resetInstanceToUctDefault and clearIndicatorDefault', () => {
  it('reset forgets the default AND puts this copy on UCT\'s values', () => {
    const saved = saveInstanceAsDefault(withRs({ benchmark: 'RSP', showRating: false }), 'rs-1', engineRegistry)
    const reset = resetInstanceToUctDefault(saved, 'rs-1', engineRegistry)
    expect(INDICATOR_DEFAULTS_KEY in reset).toBe(false)
    expect(instOf(reset, 'rs-1').inputs).toMatchObject({ benchmark: 'SPY', showRating: true })
    // already there: identity
    expect(resetInstanceToUctDefault(reset, 'rs-1', engineRegistry)).toBe(reset)
  })

  it('reset keeps the copy\'s source (which line it reads is not a default)', () => {
    const cs = mergeChartSettings({ indicatorInstances: [{ instanceId: 'roc-1', defId: 'roc', inputs: { source: 'high', period: 20 }, hidden: false }] })
    const reset = resetInstanceToUctDefault(cs, 'roc-1', engineRegistry)
    expect(instOf(reset, 'roc-1').inputs).toMatchObject({ source: 'high', period: 12 })
  })

  it('clear removes one definition\'s entry and leaves the others', () => {
    const cs = { ...withRs(), [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { benchmark: 'RSP' } }, roc: { inputs: { period: 20 } } } }
    const next = clearIndicatorDefault(cs, RS)
    expect(next[INDICATOR_DEFAULTS_KEY]).toEqual({ roc: { inputs: { period: 20 } } })
    expect(clearIndicatorDefault(next, RS)).toBe(next)
  })
})

describe('memberDefaultState (what the two buttons and the note say)', () => {
  it('UCT values, nothing saved → atUct; a tweak → not atUct; saved and equal → matches', () => {
    const plain = withRs()
    expect(memberDefaultState(plain, instOf(plain, 'rs-1'), rsDef())).toEqual({ available: true, saved: false, matches: true, atUct: true })
    const tweaked = withRs({ benchmark: 'RSP' })
    expect(memberDefaultState(tweaked, instOf(tweaked, 'rs-1'), rsDef())).toMatchObject({ saved: false, matches: false, atUct: false })
    const saved = saveInstanceAsDefault(tweaked, 'rs-1', engineRegistry)
    expect(memberDefaultState(saved, instOf(saved, 'rs-1'), rsDef())).toMatchObject({ saved: true, matches: true, atUct: false })
    const drift = setInstanceInput(saved, 'rs-1', 'maLength', 50, engineRegistry)
    expect(memberDefaultState(drift, instOf(drift, 'rs-1'), rsDef())).toMatchObject({ saved: true, matches: false })
  })
  it('unavailable for no instance or a member definition', () => {
    expect(memberDefaultState(withRs(), null, rsDef()).available).toBe(false)
  })
})

describe('the blob: allow-listed, sanitised, absent stays absent, owned by Indicators', () => {
  it('mergeChartSettings keeps a saved default and drops junk', () => {
    const merged = mergeChartSettings({
      [INDICATOR_DEFAULTS_KEY]: {
        rsLine: { inputs: { benchmark: 'RSP', lookback: 52, bad: { nested: 1 }, inf: Infinity } },
        'bad id with spaces': { inputs: { a: 1 } },
        empty: { inputs: {} },
        notObj: 7,
      },
    })
    expect(merged[INDICATOR_DEFAULTS_KEY]).toEqual({ rsLine: { inputs: { benchmark: 'RSP', lookback: 52 } } })
  })
  it('absent (or all junk) stays absent, so a blob that never saved one merges as before', () => {
    expect(INDICATOR_DEFAULTS_KEY in mergeChartSettings(null)).toBe(false)
    expect(INDICATOR_DEFAULTS_KEY in mergeChartSettings({ [INDICATOR_DEFAULTS_KEY]: { x: { inputs: { a: [1] } } } })).toBe(false)
    expect(sanitizeIndicatorDefaults('nope')).toBeNull()
    expect(INDICATOR_DEFAULTS_KEY in CHART_DEFAULTS).toBe(false)
  })
  it('Restore Defaults and presets carry it over; the Agent classifies it as Indicators-owned', () => {
    expect(INDICATOR_OWNED_TOP_KEYS).toContain(INDICATOR_DEFAULTS_KEY)
    const prev = { ...withRs(), [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { benchmark: 'RSP' } } } }
    expect(keepIndicatorState(JSON.parse(JSON.stringify(CHART_DEFAULTS)), prev)[INDICATOR_DEFAULTS_KEY]).toEqual(prev[INDICATOR_DEFAULTS_KEY])
    expect(classifySettingPath('indicatorDefaults.rsLine.inputs')).toMatchObject({ agent: 'owned:indicator' })
  })
  it('withIndicatorDefaultsOf copies the key both ways (present and absent)', () => {
    const a = { x: 1 }
    const b = { [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { benchmark: 'RSP' } } } }
    expect(withIndicatorDefaultsOf(a, b)).toEqual({ x: 1, ...b })
    expect(withIndicatorDefaultsOf({ ...a, ...b }, {})).toEqual({ x: 1 })
    expect(withIndicatorDefaultsOf(a, {})).toBe(a)
  })
})
