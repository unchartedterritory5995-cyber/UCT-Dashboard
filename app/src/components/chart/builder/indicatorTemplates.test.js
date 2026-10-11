// app/src/components/chart/builder/indicatorTemplates.test.js — FT-070 / COV-11
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { withInstances, findInstance, duplicateInstance, addInstanceCopy } from '../engine/instanceControls'
import { adoptOverlayAverages } from '../maAdoption'
import { applyAlertTemplate } from '../engine/alertSets'
import { instancesOf } from './agentSeams'
import {
  captureIndicatorTemplate, applyIndicatorTemplate, parseIndicatorTemplates, withTemplateSaved,
  withoutTemplate, applySummary, indicatorTemplatesEnabled, cleanTemplateName,
  INDICATOR_TEMPLATES_PREF, MAX_INDICATOR_TEMPLATES,
} from './indicatorTemplates'

const view = (cs) => adoptOverlayAverages(cs) || cs
const json = (v) => JSON.parse(JSON.stringify(v))
const load = (cs) => view(mergeChartSettings(JSON.stringify(cs)))
const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && !i.deleted)

/** A chart with RSI(7), an EMA(9) of that RSI, and MACD hidden — the member's setup. */
function source() {
  const base = mergeChartSettings(null)
  const raw = load({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema', color: '#ff9800' }, hidden: false },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: true },
    ],
  })
  return load(withInstances(raw, raw.indicatorInstances, registry))
}
/** A fresh chart, as a new member's chart reads (the default indicators only). */
function bare() {
  const base = mergeChartSettings(null)
  return load({ ...base, indicatorInstances: [], overlays: [] })
}
/** A blob with no indicator at all. */
const empty = () => ({ indicatorInstances: [], overlays: [], indicators: {} })
const capture = (cs, name = 'Momentum') => {
  const r = captureIndicatorTemplate(cs, registry, { name, id: 'itfixed01', now: 1 })
  expect(r.ok, JSON.stringify(r)).toBe(true)
  return r.template
}

afterEach(() => { vi.unstubAllEnvs() })

describe('capture — a chart\'s indicators as a template object', () => {
  it('captures every live indicator with its configuration, never identity, and is a valid alertSets template', () => {
    const cs = source()
    const t = capture(cs)
    expect(t).toMatchObject({ id: 'itfixed01', name: 'Momentum', alerts: [] })
    const n = instancesOf(cs, registry).filter((r) => !r.setting).length
    expect(t.instances).toHaveLength(n)
    for (const e of t.instances) {
      expect(e.instanceId).toBeUndefined()
      expect(e.scope).toBeUndefined()
      expect(typeof e.key).toBe('string')
    }
    const rsi = t.instances.find((e) => e.defId === 'rsi')
    expect(rsi.inputs.period).toBe(7)
    const macd = t.instances.find((e) => e.defId === 'macd')
    expect(macd.hidden).toBe(true)
    // the EMA's source named the RSI by id; the template names it by KEY
    const ema = t.instances.find((e) => e.defId === 'movingAverage' && e.sources)
    expect(ema.sources.source).toEqual({ key: rsi.key, plotKey: 'rsi' })
    expect(ema.inputs.source).toBeUndefined()
    // ⭐ the template object IS alertSets' — its own validator accepts it
    expect(() => applyAlertTemplate(t, 'c1')).not.toThrow()
  })
  it('refuses a blank name and an empty chart, and never captures the live preview or a tombstone', () => {
    expect(captureIndicatorTemplate(source(), registry, { name: '   ' })).toEqual({ ok: false, reason: 'bad-name' })
    expect(captureIndicatorTemplate(empty(), registry, { name: 'x' })).toEqual({ ok: false, reason: 'empty' })
    const cs = source()
    const withJunk = { ...cs, indicatorInstances: [...cs.indicatorInstances,
      { instanceId: 'u_studio-preview', defId: 'u_studio-preview', inputs: {} },
      { instanceId: 'inst:stoch:1', defId: 'stoch', deleted: true }] }
    const t = capture(withJunk)
    expect(t.instances.some((e) => String(e.defId).includes('studio-preview'))).toBe(false)
    expect(t.instances.some((e) => e.defId === 'stoch')).toBe(false)
    expect(cleanTemplateName('  a   b  ')).toBe('a b')
    expect(cleanTemplateName('x'.repeat(80))).toHaveLength(40)
  })
})

describe('apply — a template\'s indicators onto ONE chart', () => {
  it('adds each indicator as its OWN new instance, configured as saved, and re-points the EMA at the new RSI', () => {
    const t = json(capture(source()))
    const target = bare()
    const r = applyIndicatorTemplate(target, t, registry)
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(true)
    // the member's three are added; the fresh chart's own defaults were already there
    expect(r.added.length + r.already.length).toBe(t.instances.length)
    const addedDefs = r.added.map((a) => findInstance(r.cs, a.instanceId).defId).sort()
    expect(addedDefs).toEqual(['macd', 'movingAverage', 'rsi'])
    expect(r.unavailable).toEqual([])
    const rsiId = r.added.find((a) => a.key === t.instances.find((e) => e.defId === 'rsi').key).instanceId
    const rsi = findInstance(r.cs, rsiId)
    expect(rsi.inputs.period).toBe(7)
    const emaKey = t.instances.find((e) => e.sources).key
    const ema = findInstance(r.cs, r.added.find((a) => a.key === emaKey).instanceId)
    expect(ema.inputs.source).toBe(`@${rsiId}::rsi`)
    expect(ema.inputs.period).toBe(9)
    const macd = live(r.cs).find((i) => i.defId === 'macd')
    expect(macd.hidden).toBe(true)
    // the mirror moves too (door eight's rule)
    expect(r.cs.indicators.rsi.enabled).toBe(true)
    // the target's input is untouched (pure)
    expect(live(target)).toHaveLength(live(bare()).length)
    // and onto a blob with nothing at all, every template indicator is added
    const all = applyIndicatorTemplate(empty(), t, registry)
    expect(all.added).toHaveLength(t.instances.length)
  })

  it('⭐ applying twice adds nothing the second time; a chart that already has it reports "already"', () => {
    const t = json(capture(source()))
    const once = applyIndicatorTemplate(bare(), t, registry)
    const twice = applyIndicatorTemplate(json(once.cs), t, registry)
    expect(twice.ok).toBe(true)
    expect(twice.changed).toBe(false)
    expect(twice.added).toEqual([])
    expect(twice.already).toHaveLength(t.instances.length)
    expect(live(twice.cs)).toHaveLength(live(once.cs).length)
    // and onto the very chart it was saved from: everything is already there
    const self = applyIndicatorTemplate(source(), t, registry)
    expect(self.added).toEqual([])
  })

  it('never removes or edits an indicator already on the chart', () => {
    const t = json(capture(source()))
    const base = mergeChartSettings(null)
    const mine = load({ ...base, indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 21 }, hidden: false }] })
    const before = json(findInstance(mine, 'inst:rsi:1'))
    const r = applyIndicatorTemplate(mine, t, registry)
    expect(findInstance(r.cs, 'inst:rsi:1')).toEqual(before)          // the member's RSI(21), exactly
    expect(live(r.cs).filter((i) => i.defId === 'rsi').map((i) => i.inputs.period).sort()).toEqual([21, 7])
  })

  it('a definition this browser no longer has is reported unavailable, never guessed', () => {
    const t = json(capture(source()))
    t.instances.push({ key: 'kx', defId: 'u_000000000000', inputs: {}, label: 'My deleted formula' })
    const r = applyIndicatorTemplate(bare(), t, registry)
    expect(r.unavailable).toEqual([{ key: 'kx', label: 'My deleted formula', defId: 'u_000000000000' }])
    expect(applySummary('Momentum', r)).toMatch(/1 no longer available \(My deleted formula\)/)
  })

  it('refuses a malformed template through the template object\'s own validator', () => {
    expect(applyIndicatorTemplate(bare(), { name: 'no id', instances: [] }, registry))
      .toMatchObject({ ok: false, reason: 'bad-template' })
    expect(applyIndicatorTemplate(bare(), { id: 't', instances: [{ defId: 'rsi', key: 'a' }], alerts: [{ indicator: 'rsi', instanceKey: 'nope' }] }, registry))
      .toMatchObject({ ok: false, reason: 'bad-template' })
  })

  it('addInstanceCopy is duplicateInstance\'s rule for a body: same configuration, new id, visible state kept', () => {
    const cs = source()
    const rsi = findInstance(cs, 'inst:rsi:1')
    const dup = duplicateInstance(cs, 'inst:rsi:1', registry)
    const copy = addInstanceCopy(cs, { ...json(rsi), instanceId: 'ignored', scope: 'c9', group: { id: 'g' } }, registry)
    const pick = (x) => live(x).filter((i) => i.defId === 'rsi' && i.instanceId !== 'inst:rsi:1')[0]
    const { instanceId: _dupId, ...dupRest } = pick(dup)
    const { instanceId: b, defVersion, ...copyRest } = pick(copy)
    const { defVersion: _dupVersion, ...dupConfig } = dupRest
    expect(copyRest).toEqual(dupConfig)
    expect(defVersion).toBe(registry.getDefinition('rsi').version)   // stamped as addInstance stamps it
    expect(b).not.toBe('ignored')
    expect(pick(copy).scope).toBeUndefined()
    expect(addInstanceCopy(cs, { defId: 'no_such_def' }, registry)).toBe(cs)        // refused by identity
  })
})

describe('the member\'s list (pref indicator_templates)', () => {
  it('saves at the front, replaces a same-named template, deletes by id, caps, and reads defensively', () => {
    expect(INDICATOR_TEMPLATES_PREF).toBe('indicator_templates')
    const a = { id: 'a', name: 'Swing', instances: [] }
    const b = { id: 'b', name: 'Day', instances: [] }
    let list = withTemplateSaved(undefined, a)
    list = withTemplateSaved(list, b)
    expect(list.map((t) => t.id)).toEqual(['b', 'a'])
    list = withTemplateSaved(JSON.stringify(list), { id: 'a2', name: 'SWING', instances: [] })
    expect(list.map((t) => t.id)).toEqual(['a2', 'b'])
    expect(withoutTemplate(list, 'b').map((t) => t.id)).toEqual(['a2'])
    expect(parseIndicatorTemplates('not json')).toEqual([])
    expect(parseIndicatorTemplates([{ id: 'x' }, null, a])).toEqual([a])
    let big = []
    for (let i = 0; i < MAX_INDICATOR_TEMPLATES + 5; i++) big = withTemplateSaved(big, { id: `t${i}`, name: `T${i}`, instances: [] })
    expect(big).toHaveLength(MAX_INDICATOR_TEMPLATES)
  })
})

describe('the flag', () => {
  it('is OFF by default and ON only for exactly "1"', () => {
    expect(indicatorTemplatesEnabled()).toBe(false)
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', 'true')
    expect(indicatorTemplatesEnabled()).toBe(false)
    vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
    expect(indicatorTemplatesEnabled()).toBe(true)
  })
})

// ─── pre-arm review (2026-10-11) ─────────────────────────────────────────────────
import * as tplModule from './indicatorTemplates'
import { setInstanceDisplayTarget } from '../engine/instanceControls'

describe('pre-arm review — pane placement, ceilings, summary copy', () => {
  /** RSI(7), and an MFI the member put IN the RSI's pane (`@inst:rsi:1`). */
  function sharedPane() {
    const base = mergeChartSettings(null)
    const raw = load({ ...base, indicatorInstances: [
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false },
      { instanceId: 'inst:mfi:1', defId: 'mfi', inputs: {}, hidden: false },
    ] })
    const cs = load(withInstances(raw, raw.indicatorInstances, registry))
    const moved = setInstanceDisplayTarget(cs, 'inst:mfi:1', '@inst:rsi:1', registry)
    expect(moved).not.toBe(cs)
    return load(moved)
  }

  it('⛔ a pane shared with another template indicator follows THAT indicator\'s copy, never an id on the new chart', () => {
    const t = json(capture(sharedPane()))
    // the target chart has its OWN inst:rsi:1 (an RSI 21) — the saved id names it by accident
    const base = mergeChartSettings(null)
    const target = load({ ...base, indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 21 }, hidden: false }] })
    const r = applyIndicatorTemplate(target, t, registry)
    const rsiCopy = r.added.find((a) => findInstance(r.cs, a.instanceId).defId === 'rsi').instanceId
    const mfiCopy = findInstance(r.cs, r.added.find((a) => findInstance(r.cs, a.instanceId).defId === 'mfi').instanceId)
    expect(rsiCopy).not.toBe('inst:rsi:1')
    expect(mfiCopy.placement && mfiCopy.placement.target).toBe(`@${rsiCopy}`)
    // re-applying (after a real persist round trip) still adds nothing
    const again = applyIndicatorTemplate(load(r.cs), t, registry)
    expect(again.added).toEqual([])
  })

  it('⛔ a full list REFUSES the save instead of silently dropping the oldest template; a same-name save still replaces', () => {
    let list = []
    for (let i = 0; i < MAX_INDICATOR_TEMPLATES; i++) list = withTemplateSaved(list, { id: `t${i}`, name: `T${i}`, instances: [] })
    expect(list).toHaveLength(MAX_INDICATOR_TEMPLATES)
    expect(tplModule.planTemplateSave(list, { id: 'new', name: 'Brand new', instances: [] })).toEqual({ ok: false, reason: 'full' })
    expect(withTemplateSaved(list, { id: 'new', name: 'Brand new', instances: [] }).map((t) => t.id)).toEqual(list.map((t) => t.id))
    const re = tplModule.planTemplateSave(list, { id: 'again', name: 't3', instances: [] })
    expect(re).toMatchObject({ ok: true, replaced: true })
    expect(re.list).toHaveLength(MAX_INDICATOR_TEMPLATES)
  })

  it('⛔ the stored list has a byte ceiling, measured as the server measures it', () => {
    expect(tplModule.MAX_INDICATOR_TEMPLATES_BYTES).toBe(262144)
    const fat = { id: 'fat', name: 'Fat', instances: [{ key: 'k1', defId: 'rsi', inputs: { note: 'é'.repeat(140000) } }] }
    expect(tplModule.planTemplateSave([], fat)).toEqual({ ok: false, reason: 'too-big' })
    expect(tplModule.planTemplateSave([], { ...fat, instances: [] })).toMatchObject({ ok: true, replaced: false })
  })

  it('the apply sentence never says "already on this chart" when nothing was', () => {
    const r = { ok: true, added: [], already: [], unavailable: [{ label: 'My formula' }] }
    const s = applySummary('Gone', r)
    expect(s).not.toMatch(/already/)
    expect(s).toMatch(/Nothing from “Gone” could be added\. 1 no longer available \(My formula\)\./)
    expect(applySummary('Mixed', { ok: true, added: [], already: [{}], unavailable: [{ label: 'X' }] }))
      .toBe('Nothing new to add from “Mixed”. 1 already on this chart. 1 no longer available (X).')
  })
})
