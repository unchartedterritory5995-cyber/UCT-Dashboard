// Phase 1 (Charts operator): the member's saved INDICATOR templates through the Agent. The real planner, runtime, Undo and the real
// Indicators mutation interface on a chart's stored settings; the template list in an in-memory preference with setPrefMerged's
// contract. Assertions read what ended up on the chart and in the stored list, never the sentence. No model unless scripted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, waitFor, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { routeManifest, routingNames, groupOfAction } from './routing'
import { manifestFor } from './capabilities'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { mergedTemplates, indicatorTemplatesKind } from './capabilities/indicatorTemplates'
import { captureIndicatorTemplate } from '../components/chart/builder/indicatorTemplates'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { adoptOverlayAverages } from '../components/chart/maAdoption'
import { instancesOf } from '../components/chart/builder/agentSeams'
import * as R from '../components/chart/engine/nativeRegistry'
import { setupPanel, ONE, TWO } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const FLAG = 'VITE_INDICATOR_TEMPLATES_ENABLED'
const KINDS = ['indicatorEdits', 'indicatorTemplates']
const load = (cs) => { const m = mergeChartSettings(JSON.stringify(cs || {})); return adoptOverlayAverages(m) || m }
const NO_AVERAGES = { overlays: [0, 1, 2, 3].map(() => ({ removed: true })) }
const RSI7 = { instanceId: 'inst:rsi:a', defId: 'rsi', inputs: { period: 7 }, group: null }
const withRsi = () => ({ ...NO_AVERAGES, indicatorInstances: [RSI7] })

// two charts on a board, written like the workspace writes them; the list in a preference the way setPrefMerged treats it
function board(stores = { a: withRsi(), b: NO_AVERAGES }, { prefList = [], refuse = false } = {}) {
  const store = JSON.parse(JSON.stringify(stores))
  const prefs = { indicator_templates: JSON.stringify(prefList) }
  const META = { a: 'Left chart (QQQ)', b: 'Right chart (SPY)', c: 'Third chart (IWM)' }
  const read = (ref) => (ref in store ? { ref, label: META[ref], symbol: 'QQQ', tf: 'D', stored: store[ref], cs: load(store[ref]), linkedCount: 0 } : null)
  return {
    store, prefs,
    list: () => JSON.parse(prefs.indicator_templates),
    host: {
      charts: { list: () => Object.keys(store).map(read), read, commit: (ref, p) => { store[ref] = JSON.parse(JSON.stringify(p.settings)); return true }, canManageIndicators: () => true, canCreateIndicator: () => true },
      persist: async () => ({ ok: true }), widgetInSync: async () => ({ ok: true }), otherWidgets: () => [],
      prefs: {
        read: () => prefs,
        merge: async (k, fn) => {
          const next = fn(JSON.parse(prefs[k]))
          if (next === undefined) return undefined
          if (refuse) return { ok: false }
          prefs[k] = JSON.stringify(next)
          return { ok: true }
        },
      },
    },
  }
}
const names = (b, ref) => instancesOf(load(b.store[ref]), R).filter(r => !r.setting).map(r => r.name).sort()
const saved = (cs, name) => captureIndicatorTemplate(load(cs), R, { name }).template
const swing = () => {
  const b = board({ src: { ...NO_AVERAGES, indicatorInstances: [RSI7, { instanceId: 'inst:macd:a', defId: 'macd', inputs: { fastPeriod: 8 } }] } })
  return saved(b.store.src, 'Swing Setup')
}
const op = (action, target, args) => ({ action, target, args })
async function plan(host, ops) {
  buildContext(host, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, KINDS), ops, env, CTX), env }
}
async function run(host, ops) {
  const { p, env } = await plan(host, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return { p, res: await commitPlan(host, p, { env, ctx: CTX }) }
}
const reason = async (host, ops) => (await plan(host, ops)).p.refusals?.[0]?.reason

beforeEach(() => { vi.stubEnv(FLAG, '1'); setOwnedDefinitionSource(() => []); _resetProposedPlans() })
afterEach(() => { vi.unstubAllEnvs(); cleanup() })

describe('indicatorTemplate.apply — a saved template onto a chart', () => {
  it('adds each indicator exactly as saved, removes nothing, and reads back from the stored chart', async () => {
    const b = board({ a: { ...NO_AVERAGES, indicatorInstances: [{ instanceId: 'inst:atr:x', defId: 'atr', inputs: {} }] } }, { prefList: [swing()] })
    const { res } = await run(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'swing setup' })])
    expect(res.ok).toBe(true)
    const live = load(b.store.a).indicatorInstances.filter(i => !i.deleted)
    expect(live.find(i => i.defId === 'rsi').inputs.period).toBe(7)
    expect(live.find(i => i.defId === 'macd').inputs.fastPeriod).toBe(8)
    expect(live.some(i => i.defId === 'atr')).toBe(true)
  })
  it('Undo removes exactly what it added', async () => {
    const b = board({ a: { ...NO_AVERAGES, indicatorInstances: [{ instanceId: 'inst:atr:x', defId: 'atr', inputs: {} }] } }, { prefList: [swing()] })
    const before = names(b, 'a')
    const { res } = await run(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing Setup' })])
    expect(names(b, 'a').length).toBe(before.length + 2)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(names(b, 'a')).toEqual(before)
  })
  it('applied twice adds nothing the second time (an identical indicator is already there)', async () => {
    const b = board({ a: NO_AVERAGES }, { prefList: [swing()] })
    await run(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing Setup' })])
    _resetProposedPlans()
    const after = JSON.stringify(b.store.a)
    const { p } = await plan(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing Setup' })])
    expect(p.changed).toBe(false)
    expect(JSON.stringify(b.store.a)).toBe(after)
  })
  it('a definition this browser no longer has is left out and the rest still land; the receipt names what is missing', async () => {
    const t = swing()
    t.instances.push({ key: 'k3', defId: 'u_000000000000', inputs: {}, label: 'Gone One' })
    const b = board({ a: NO_AVERAGES }, { prefList: [t] })
    const { res } = await run(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing Setup' })])
    expect(names(b, 'a').length).toBe(2)
    expect(res.lines.join(' ')).toMatch(/Gone One/)
  })
  it('a template whose every definition is gone is refused and the chart is untouched', async () => {
    const b = board({ a: NO_AVERAGES }, { prefList: [{ id: 't1', name: 'Dead', instances: [{ key: 'k1', defId: 'u_000000000000', inputs: {}, label: 'Gone' }], alerts: [] }] })
    expect(await reason(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Dead' })])).toMatch(/Gone/)
    expect(names(b, 'a')).toEqual([])
  })
  it('an unknown name is refused with the real names, never matched loosely', async () => {
    const b = board({ a: NO_AVERAGES }, { prefList: [swing()] })
    expect(await reason(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing' })])).toMatch(/Swing Setup/)
    expect(names(b, 'a')).toEqual([])
  })
  it('is not the chart-template capability: a chart template with the same name does not change what it applies', async () => {
    const b = board({ a: NO_AVERAGES }, { prefList: [swing()] })
    b.prefs.chart_templates = JSON.stringify([{ id: 'x', name: 'Swing Setup', settings: { background: '#000000' } }])
    await run(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing Setup' })])
    expect(load(b.store.a).background).not.toBe('#000000')
    expect(names(b, 'a').length).toBe(2)
  })
  it('with the feature off in this build it refuses, and nothing changes', async () => {
    vi.stubEnv(FLAG, '')
    const b = board({ a: NO_AVERAGES }, { prefList: [swing()] })
    expect(await reason(b.host, [op('indicatorTemplate.apply', 'ixe:a', { template: 'Swing Setup' })])).toMatch(/switched on/)
    expect(names(b, 'a')).toEqual([])
  })
})

describe('applied to several charts (real panel, scripted model)', () => {
  const P = setupPanel
  it('"apply my Swing Setup indicators to both charts": one op per chart, each chart ends up with the indicators', async () => {
    const p = P()
    const { say, board: fixture, h } = p.mount(...TWO())
    h.prefs = { read: () => ({ indicator_templates: JSON.stringify([swing()]) }), merge: async () => ({ ok: true }) }
    const ix = (body, sym) => body.context.indicatorEdits.find(e => e.symbol === sym).ref
    p.st.envelopes.push((body) => p.env('apply', [
      { action: 'indicatorTemplate.apply', target: ix(body, 'NVDA'), args: { template: 'Swing Setup' } },
      { action: 'indicatorTemplate.apply', target: ix(body, 'AMD'), args: { template: 'Swing Setup' } },
    ]))
    await say('apply my Swing Setup indicators to both charts')
    await waitFor(() => expect(p.brief(fixture, 'cr').filter(x => /rsi|macd/.test(x)).length).toBe(2))
    expect(p.brief(fixture, 'cl').filter(x => /rsi|macd/.test(x)).length).toBe(2)
    expect(screen.queryAllByTestId('agent-proposal')).toEqual([])
  })
})

describe('indicatorTemplate.save', () => {
  const save = (name = 'Momentum', chart = 'a') => op('indicatorTemplate.save', 'indicatorTemplates', { name, chart })
  it('stores the chart\'s indicators under that name, in the template shape the bar reads; Undo takes it out', async () => {
    const b = board()
    const { res } = await run(b.host, [save()])
    expect(b.list().map(t => t.name)).toEqual(['Momentum'])
    expect(b.list()[0].instances).toMatchObject([{ defId: 'rsi', inputs: { period: 7 } }])
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(b.list()).toEqual([])
  })
  it('a new name applies at once; an existing name (any case) must be approved', async () => {
    const b = board(undefined, { prefList: [swing()] })
    const fresh = (await plan(b.host, [save()])).p
    expect(decideMode('apply', fresh)).toBe('apply')
    const clash = (await plan(b.host, [save('SWING SETUP')])).p
    expect(decideMode('apply', clash)).toBe('propose')
    expect(b.list()[0].instances).toHaveLength(2)
  })
  it('an approved overwrite replaces it; Undo restores the old contents and position', async () => {
    const other = { ...swing(), id: 'other', name: 'Other' }
    const old = swing()
    const b = board(undefined, { prefList: [other, old] })
    const { res } = await run(b.host, [save('swing setup')])
    expect(b.list().map(t => t.name)).toEqual(['swing setup', 'Other'])
    expect(b.list()[0].instances).toHaveLength(1)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(b.list().map(t => t.id)).toEqual(['other', old.id])
    expect(b.list()[1].instances).toHaveLength(2)
  })
  it('an overwrite approved for one template cannot replace a different one that took the name meanwhile', () => {
    const seen = swing()
    const newer = { ...swing(), id: 'newer' }
    const m = mergedTemplates([newer], { put: { ...swing(), id: 'mine' }, drop: seen })
    expect(m.why).toBe('changed')
  })
  it('a new save cannot silently replace a same-named template another tab saved after the plan', async () => {
    const b = board()
    const { p, env } = await plan(b.host, [save()])
    b.prefs.indicator_templates = JSON.stringify([{ ...swing(), id: 'tab2', name: 'Momentum' }])
    const res = await commitPlan(b.host, p, { env, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(b.list().map(t => t.id)).toEqual(['tab2'])
  })
  it('a template another tab saved under another name survives the write (the list is merged, not replaced)', async () => {
    const b = board()
    const put = { ...swing(), id: 'mine', name: 'Momentum' }
    b.prefs.indicator_templates = JSON.stringify([{ ...swing(), id: 'tab2', name: 'Tab Two' }])
    await indicatorTemplatesKind.commit(b.host, 'indicatorTemplates', { put, drop: null })
    expect(b.list().map(t => t.name).sort()).toEqual(['Momentum', 'Tab Two'])
  })
  it('a chart with no indicators, a too-long name and a full list are refused; nothing is written', async () => {
    const b = board(undefined, { prefList: Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, instances: [], alerts: [] })) })
    expect(await reason(b.host, [save('X', 'b')])).toMatch(/no indicators/)
    expect(await reason(b.host, [save('x'.repeat(41))])).toMatch(/at most 40/)
    expect(await reason(b.host, [save('New One')])).toMatch(/most there can be/)
    expect(b.list()).toHaveLength(25)
  })
  it('a server refusal is not reported as saved', async () => {
    const b = board(undefined, { refuse: true })
    const { p, env } = await plan(b.host, [save()])
    const res = await commitPlan(b.host, p, { env, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(b.list()).toEqual([])
  })
})

describe('indicatorTemplate.delete', () => {
  const del = (name) => op('indicatorTemplate.delete', 'indicatorTemplates', { name })
  it('always needs approval, and nothing changes until it is approved', async () => {
    const b = board(undefined, { prefList: [swing()] })
    const { p } = await plan(b.host, [del('Swing Setup')])
    expect(decideMode('apply', p)).toBe('propose')
    expect(b.list()).toHaveLength(1)
  })
  it('removes that template and no other; Undo restores it in place; charts keep their indicators', async () => {
    const other = { ...swing(), id: 'other', name: 'Other' }
    const b = board(undefined, { prefList: [swing(), other] })
    const id = b.list()[0].id
    const chart = JSON.stringify(b.store.a)
    const { res } = await run(b.host, [del('swing setup')])
    expect(b.list().map(t => t.name)).toEqual(['Other'])
    expect(JSON.stringify(b.store.a)).toBe(chart)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(b.list().map(t => t.id)).toEqual([id, 'other'])
  })
  it('an unknown name is refused', async () => {
    const b = board(undefined, { prefList: [swing()] })
    expect(await reason(b.host, [del('Nope')])).toMatch(/Swing Setup/)
  })
})

describe('indicatorTemplate.list', () => {
  const list = async (b) => getCapability('indicatorTemplate.list').answer(indicatorTemplatesKind.read(b.host, 'indicatorTemplates'), {})
  it('names each template and what is in it, from the stored list', async () => {
    const a = await list(board(undefined, { prefList: [swing()] }))
    expect(a.table.rows).toMatchObject([{ name: 'Swing Setup', count: 2 }])
    expect(a.table.rows[0].what).toMatch(/RSI/)
  })
  it('an empty list says so', async () => {
    expect(await list(board())).toMatch(/no saved indicator templates/)
  })
})

describe('routing: no new phrase rule', () => {
  const manifest = manifestFor({ surface: 'charts', createIndicator: true })
  const routed = (msg, h) => routeManifest(manifest, msg, { limit: 60, budget: 45, names: routingNames(h) }).manifest.map(c => c.name)
  const h = { prefs: { read: () => ({ indicator_templates: JSON.stringify([{ id: 't', name: 'Swing Setup', instances: [] }]) }) } }
  it('every template capability rides in the chartSetup group', () => {
    for (const n of ['list', 'apply', 'save', 'delete']) expect(groupOfAction(`indicatorTemplate.${n}`)).toBe('chartSetup')
  })
  it('the word "template" and the member\'s saved NAME both bring it', () => {
    expect(routed('what indicator templates do i have', h)).toContain('indicatorTemplate.list')
    expect(routed('apply swing setup to this chart', h)).toContain('indicatorTemplate.apply')
  })
})

describe('approval through the real panel (scripted model)', () => {
  function mounted() {
    const p = setupPanel()
    const m = p.mount(...ONE())
    const prefs = { indicator_templates: JSON.stringify([swing()]) }
    m.h.prefs = { read: () => prefs, merge: async (k, fn) => { const n = fn(JSON.parse(prefs[k])); if (n !== undefined) prefs[k] = JSON.stringify(n); return { ok: n !== undefined } } }
    const lib = (body) => body.context.indicatorTemplateLibrary[0].ref
    const list = () => JSON.parse(prefs.indicator_templates)
    return { p, ...m, lib, list }
  }
  it('overwriting: a card first, nothing written; Apply replaces it', async () => {
    const { p, say, click, lib, list } = mounted()
    await say('add rsi')
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicatorTemplate.save', target: lib(body), args: { name: 'Swing Setup', chart: (body.context.charts || [])[0].ref } }]))
    await say('save these indicators as my Swing Setup template')
    expect(p.proposals()).toHaveLength(1)
    expect(list()[0].instances).toHaveLength(2)
    await click(/^Apply/)
    await waitFor(() => expect(list()[0].instances).toHaveLength(1))
  })
  it('deleting: a card first; Dismiss keeps it', async () => {
    const { p, say, click, lib, list } = mounted()
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicatorTemplate.delete', target: lib(body), args: { name: 'Swing Setup' } }]))
    await say('delete the swing setup template')
    expect(p.proposals()).toHaveLength(1)
    await click(/^Dismiss/)
    expect(list()).toHaveLength(1)
  })
  it('deleting: Apply removes it; "undo" puts it back', async () => {
    const { p, say, click, lib, list } = mounted()
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicatorTemplate.delete', target: lib(body), args: { name: 'Swing Setup' } }]))
    await say('delete the swing setup template')
    await click(/^Apply/)
    await waitFor(() => expect(list()).toEqual([]))
    await say('undo')
    await waitFor(() => expect(list().map(t => t.name)).toEqual(['Swing Setup']))
  })
})
