import { describe, it, expect } from 'vitest'
import {
  allCapabilityNames, manifestFor, buildContext, shapeError, getCapability,
  registerCapability, registerTargetKind, registerContextProvider,
} from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { normalizeColor } from './capabilities/chart'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { CHART_THEMES } from '../components/chart/chartThemes'

registerBuiltins()
const CTX = { surface: 'charts' }

// A host whose chart source behaves like ChartWidget's agent adapter: a stored
// blob (null = inherits the seed), tf and symbol per chart; reads always fresh.
function makeHost(defs) {
  const st = new Map(defs.map(d => [d.ref, { stored: d.stored ?? null, tf: d.tf || 'D', symbol: d.symbol || 'SPY', label: d.label || d.ref, linkedCount: d.linkedCount || 0 }]))
  const commits = []
  const read = (ref) => {
    const s = st.get(ref)
    if (!s) return null
    return { ref, label: s.label, symbol: s.symbol, tf: s.tf, stored: s.stored, cs: mergeChartSettings(s.stored || { chartType: 'candles' }), linkedCount: s.linkedCount }
  }
  const host = {
    commits,
    charts: {
      list: () => [...st.keys()].map(read),
      read,
      commit(ref, patch) {
        commits.push({ ref, patch })
        const s = st.get(ref)
        if ('settings' in patch) s.stored = patch.settings
        if ('tf' in patch) s.tf = patch.tf
        if ('symbol' in patch) s.symbol = patch.symbol
        return true
      },
    },
    otherWidgets: () => ['Watchlist'],
    manual(ref, patch) { Object.assign(st.get(ref), patch) },
    raw: (ref) => st.get(ref),
  }
  return host
}
const op = (action, args, target = 'c1') => ({ action, target, args })
const plan = (host, ops, env = {}) => planOps(collectTargets(host, ['chart']), ops, env, CTX)

describe('capability registry', () => {
  it('chart capabilities are registered through the seam, none indicator-owned', () => {
    const names = allCapabilityNames()
    expect(names).toEqual(expect.arrayContaining(['chart.setType', 'chart.setTimeframe', 'chart.setSymbol', 'chart.setSession',
      'chart.applyTheme', 'chart.setBackground', 'chart.setCandleColors', 'volume.setState', 'chart.setScale']))
    for (const n of names) expect(n).not.toMatch(/^(indicator|pane)\./)
  })
  it('the manifest is metadata only, gated by surface', () => {
    const m = manifestFor(CTX)
    expect(m.length).toBeGreaterThanOrEqual(8)
    for (const c of m) {
      expect(Object.keys(c).sort()).toEqual(['args', 'domain', 'hints', 'name', 'reversible', 'risk', 'summary', 'target'])
      expect(c.args.additionalProperties).toBe(false)
      expect([...c.args.required].sort()).toEqual(Object.keys(c.args.properties).sort())
    }
    expect(manifestFor({ surface: 'journal' })).toEqual([])          // not offered off-surface
  })
  it('theme enum is exactly the shipped chart themes', () => {
    expect(getCapability('chart.applyTheme').args.properties.theme.enum).toEqual(CHART_THEMES.map(t => t.id))
  })
  it('a malformed registration is refused at registration time', () => {
    expect(() => registerCapability({ name: 'Bad', summary: 'x', target: 'chart', args: {}, check() {}, apply() {}, describe() {} })).toThrow()
    expect(() => registerCapability({ name: 'x.open', summary: 'x', target: 'chart',
      args: { type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false },
      check() {}, apply() {}, describe() {} })).toThrow(/closed/)
  })
  it('shape check refuses unknown / unavailable actions, extra keys, bad enums, wrong types', () => {
    expect(shapeError('indicator.add', {}, CTX)).toMatch(/can't/)
    expect(shapeError('chart.setType', { type: 'bars' }, { surface: 'journal' })).toMatch(/can't/)
    expect(shapeError('chart.setType', { type: 'bars', extra: 1 }, CTX)).toMatch(/Unexpected/)
    expect(shapeError('chart.setType', { type: 'renko' }, CTX)).toMatch(/isn't an option/)
    expect(shapeError('chart.setType', {}, CTX)).toMatch(/Missing/)
    expect(shapeError('chart.setCandleColors', { up: 3, down: null }, CTX)).toMatch(/wrong kind/)
    expect(shapeError('chart.setCandleColors', { up: null, down: '#fff' }, CTX)).toBeNull()
  })
  it('context comes from registered providers with short refs mapped back', () => {
    const host = makeHost([{ ref: 'w-chart-1' }, { ref: 'w-chart-2', symbol: 'NVDA' }])
    const { context, refMap } = buildContext(host, CTX)
    expect(context.charts.map(c => c.ref)).toEqual(['c1', 'c2'])
    expect(refMap.c2).toEqual({ kind: 'chart', ref: 'w-chart-2' })
    expect(context.otherWidgets).toEqual(['Watchlist'])
    expect(context.charts[1]).toMatchObject({ symbol: 'NVDA', chartType: 'candles', volume: 'visible' })
  })
  it('normalizes colors and refuses non-colors', () => {
    expect(normalizeColor('#FFF')).toBe('#ffffff')
    expect(normalizeColor('cream')).toBe('#f3efe4')
    expect(normalizeColor('a nice sunset')).toBeNull()
  })
})

describe('compound plan → single write → ACK → receipt → undo', () => {
  it('validates the whole plan, composes, commits ONE write per chart, and reads it back', async () => {
    const host = makeHost([{ ref: 'c1' }])
    const p = plan(host, [
      op('chart.setType', { type: 'bars' }),
      op('chart.setTimeframe', { timeframe: 'W' }),
      op('volume.setState', { state: 'hidden' }),
      op('chart.setBackground', { color: '#f3efe4' }),
    ])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Changed chart to Bars', 'Switched timeframe to Weekly', 'Hid Volume', 'Changed background to #f3efe4'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(host.commits).toHaveLength(1)
    expect(Object.keys(host.commits[0].patch).sort()).toEqual(['settings', 'tf'])
    const s = host.raw('c1')
    expect(s.tf).toBe('W')
    expect(s.stored.chartType).toBe('bars')
    expect(s.stored.volume.visible).toBe(false)
    expect(s.stored.background).toBe('#f3efe4')
    expect(res.lines).toEqual(p.lines)

    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(host.raw('c1').stored).toBeNull()
    expect(host.raw('c1').tf).toBe('D')
    expect(u.lines[0]).toMatch(/^Undid: Changed chart to Bars · Switched timeframe to Weekly/)
  })
  it('ZERO partial mutation: one refused op refuses the whole plan', async () => {
    const host = makeHost([{ ref: 'c1' }])
    const p = plan(host, [op('chart.setType', { type: 'bars' }), op('chart.setBackground', { color: 'a sunset' })])
    expect(p.ok).toBe(false)
    expect(p.refusals).toHaveLength(1)
    expect(p.refusals[0].index).toBe(1)
    expect(host.commits).toHaveLength(0)
  })
  it('refuses ops against a target that is not on the workspace', () => {
    expect(plan(makeHost([{ ref: 'c1' }]), [op('chart.setType', { type: 'bars' }, 'c9')]).ok).toBe(false)
  })
  it('the receipt reflects what CHANGED, not what was asked', () => {
    const p = plan(makeHost([{ ref: 'c1', tf: 'W' }]), [op('chart.setTimeframe', { timeframe: 'W' }), op('chart.setType', { type: 'line' })])
    expect(p.lines).toEqual(['Changed chart to Line'])
    expect(p.noops).toEqual(['Already Weekly'])
  })
  it('session writes the key the manual toggle for the RESULTING timeframe writes', () => {
    const p = plan(makeHost([{ ref: 'c1', tf: 'D' }]), [op('chart.setTimeframe', { timeframe: '5' }), op('chart.setSession', { mode: 'regular' })])
    expect(p.ok).toBe(true)
    expect(p.plans[0].after.cs.extendedHoursShading).toBe(false)
    expect(p.plans[0].after.cs.sessionView).toBe(p.plans[0].before.cs.sessionView)
  })
  it('chart.setScale writes exactly the keys the A/L/% toggle writes, with receipt + undo', async () => {
    const host = makeHost([{ ref: 'c1' }])
    const p = plan(host, [op('chart.setScale', { scale: 'log' })])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Changed scale to Logarithmic'])
    expect(p.plans[0].after.cs.logScale).toBe(true)
    expect(p.plans[0].after.cs.percentScale).toBe(false)
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(plan(host, [op('chart.setScale', { scale: 'log' })]).noops).toEqual(['Already on a logarithmic scale'])
    const pct = plan(host, [op('chart.setScale', { scale: 'percent' })])
    expect(pct.plans[0].after.cs).toMatchObject({ percentScale: true, logScale: false })
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.raw('c1').stored).toBeNull()
  })
  it('chart.setScale refuses a non-percent scale while Compare forces percent (no false receipt)', () => {
    const host = makeHost([{ ref: 'c1', stored: { comparisonSymbols: [{ sym: 'QQQ', enabled: true }] } }])
    const p = plan(host, [op('chart.setScale', { scale: 'log' })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/Compare overlays/)
    expect(plan(host, [op('chart.setScale', { scale: 'percent' })]).ok).toBe(true)
  })
  it('symbol change carries the linked-widget count into the receipt', () => {
    const p = plan(makeHost([{ ref: 'c1', linkedCount: 2 }]), [op('chart.setSymbol', { symbol: 'nvda' })])
    expect(p.lines).toEqual(['Changed symbol to NVDA (and 2 linked widgets)'])
  })
  it('refuses an unknown ticker the capability prepare step flagged', () => {
    const p = plan(makeHost([{ ref: 'c1' }]), [op('chart.setSymbol', { symbol: 'ZZZZQ' })], { unknownSymbols: new Set(['ZZZZQ']) })
    expect(p.ok).toBe(false)
  })
})

describe('stale protection', () => {
  it('refuses to undo over a manual edit made after the Agent wrote', async () => {
    const host = makeHost([{ ref: 'c1' }])
    const res = await commitPlan(host, plan(host, [op('chart.setType', { type: 'bars' })]))
    host.manual('c1', { tf: '60' })
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/changed since/)
    expect(host.raw('c1').stored.chartType).toBe('bars')
    expect(host.raw('c1').tf).toBe('60')
  })
  it('refuses to commit a plan composed against state that moved underneath it', async () => {
    const host = makeHost([{ ref: 'c1' }])
    const p = plan(host, [op('chart.setType', { type: 'bars' })])
    host.manual('c1', { tf: 'W' })
    expect((await commitPlan(host, p)).ok).toBe(false)
    expect(host.commits).toHaveLength(0)
  })
  it('ACK fails when the write does not land', async () => {
    const host = makeHost([{ ref: 'c1' }])
    host.charts.commit = () => true
    const res = await commitPlan(host, plan(host, [op('chart.setType', { type: 'bars' })]))
    expect(res.ok).toBe(false)
    expect(res.lines).toEqual([])
    expect(res.undo).toBeNull()
  })
})

describe('policy', () => {
  it('a multi-target plan is always a proposal even if apply was suggested', () => {
    const host = makeHost([{ ref: 'c1' }, { ref: 'c2' }])
    expect(decideMode('apply', plan(host, [op('chart.setType', { type: 'bars' }, 'c1'), op('chart.setType', { type: 'bars' }, 'c2')]))).toBe('propose')
  })
  it('a small single-target request applies; a propose stays a propose', () => {
    const p = plan(makeHost([{ ref: 'c1' }]), [op('chart.setType', { type: 'bars' })])
    expect(decideMode('apply', p)).toBe('apply')
    expect(decideMode('propose', p)).toBe('propose')
  })
})

describe('fast path (capability-contributed phrases)', () => {
  it('parses obvious commands into the SAME registry ops', () => {
    expect(fastParse('bars')).toEqual({ kind: 'ops', ops: [{ action: 'chart.setType', args: { type: 'bars' } }], target: null })
    expect(fastParse('5m')).toEqual({ kind: 'ops', ops: [{ action: 'chart.setTimeframe', args: { timeframe: '5' } }], target: null })
    expect(fastParse('Daily').ops[0].args).toEqual({ timeframe: 'D' })
    expect(fastParse('hide volume').ops[0]).toEqual({ action: 'volume.setState', args: { state: 'hidden' } })
    expect(fastParse('switch to weekly and candles').ops.map(o => o.action)).toEqual(['chart.setTimeframe', 'chart.setType'])
    expect(fastParse('chart NVDA').ops[0]).toEqual({ action: 'chart.setSymbol', args: { symbol: 'NVDA' } })
    expect(fastParse('extended hours').ops[0]).toEqual({ action: 'chart.setSession', args: { mode: 'extended' } })
  })
  it('control words', () => {
    expect(fastParse('Undo that')).toEqual({ kind: 'undo' })
    expect(fastParse('do it')).toEqual({ kind: 'confirm' })
    expect(fastParse('just apply the first two')).toEqual({ kind: 'subset', count: 2 })
    expect(fastParse('never mind')).toEqual({ kind: 'dismiss' })
  })
  it('target qualifiers are stripped and returned as a HINT (the parser never resolves a target)', () => {
    expect(fastParse('make the left chart weekly')).toEqual({ kind: 'ops', ops: [{ action: 'chart.setTimeframe', args: { timeframe: 'W' } }], target: { position: 'left' } })
    expect(fastParse('change the right chart to bars').target).toEqual({ position: 'right' })
    expect(fastParse('switch the right chart to extended hours').ops[0]).toEqual({ action: 'chart.setSession', args: { mode: 'extended' } })
    expect(fastParse('hide volume on both charts')).toEqual({ kind: 'ops', ops: [{ action: 'volume.setState', args: { state: 'hidden' } }], target: { all: true } })
    expect(fastParse('make all charts weekly').target).toEqual({ all: true })
    expect(fastParse('put NVDA on the left')).toEqual({ kind: 'ops', ops: [{ action: 'chart.setSymbol', args: { symbol: 'NVDA' } }], target: { position: 'left' } })
    expect(fastParse('change symbol to tsla').ops[0]).toEqual({ action: 'chart.setSymbol', args: { symbol: 'TSLA' } })
    expect(fastParse('top-left chart daily').target).toEqual({ position: 'top-left' })
    expect(fastParse('log scale').ops[0]).toEqual({ action: 'chart.setScale', args: { scale: 'log' } })
    expect(fastParse('make the left chart linear')).toEqual({ kind: 'ops', ops: [{ action: 'chart.setScale', args: { scale: 'linear' } }], target: { position: 'left' } })
    expect(fastParse('percent scale').ops[0].args).toEqual({ scale: 'percent' })
    expect(fastParse('change the left chart background to black')).toEqual({ kind: 'ops', ops: [{ action: 'chart.setBackground', args: { color: 'black' } }], target: { position: 'left' } })
    expect(fastParse('background #f3efe4').ops[0].args).toEqual({ color: '#f3efe4' })
    expect(fastParse('background to sunset orange-ish')).toBeNull()
    expect(fastParse('cream theme').ops[0]).toEqual({ action: 'chart.applyTheme', args: { theme: 'cream' } })
    expect(fastParse('apply the midnight navy theme').ops[0].args).toEqual({ theme: 'midnight-navy' })
    expect(fastParse('a cleaner theme')).toBeNull()
    expect(fastParse('weekly').target).toBeNull()
  })
  it('all-or-nothing: any unrecognised clause goes to the model', () => {
    expect(fastParse('bars and make it look like TradingView')).toBeNull()
    expect(fastParse('what is an EMA?')).toBeNull()
    expect(fastParse('show volume profile')).toBeNull()
    expect(fastParse('make the left chart look like TradingView')).toBeNull()
    expect(fastParse('show me apple')).toBeNull()
    expect(fastParse('add RSI 21')).toBeNull()
  })
})

// ── ACCEPTANCE: a future capability joins by REGISTRATION, not core surgery ──
//
// `example.setSomething` on a brand-new target kind, registered here exactly as
// a future feature module would. Nothing in capabilities.js, executor.js,
// policy.js, runtime.js, fastPath.js or useAgent.js knows it exists; the test
// proves discovery, context, planning, policy, commit/ACK, undo and the fast
// path all reach it, then unregisters it.
describe('EXTENSIBILITY: example.setSomething', () => {
  it('is discovered, planned, executed, read back, undone and fast-pathed through the same mechanism', async () => {
    const store = { ex1: { level: 'low' } }
    const host = { examples: store }
    const off = [
      registerTargetKind({
        name: 'example',
        list: (h) => Object.keys(h.examples).map(ref => ({ ref, label: `Example ${ref}`, level: h.examples[ref].level })),
        read: (h, ref) => (h.examples[ref] ? { ref, label: `Example ${ref}`, level: h.examples[ref].level } : null),
        stateOf: (s) => ({ level: s.level }),
        patch: (b, a) => (b.level === a.level ? null : { level: a.level }),
        commit: (h, ref, p) => { h.examples[ref] = { ...h.examples[ref], ...p }; return true },
        landed: (s, p) => !!s && s.level === p.level,
        undoPatch: (it) => ({ level: it.before.level }),
        fingerprint: (s) => s.level,
      }),
      registerContextProvider({ key: 'examples', build: (h, refFor) => Object.keys(h.examples || {}).map(r => ({ ref: refFor('example', r), level: h.examples[r].level })) }),
      registerCapability({
        name: 'example.setSomething', target: 'example', summary: 'Set the example level.', risk: 'confirm',
        surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
        args: { type: 'object', properties: { level: { type: 'string', enum: ['low', 'high'] } }, required: ['level'], additionalProperties: false },
        fast: ({ lower }) => (lower === 'example high' ? { level: 'high' } : null),
        check: () => null,
        apply: (st, { level }) => (st.level === level ? st : { ...st, level }),
        describe: (b, a) => (b.level === a.level ? null : `Set example to ${a.level}`),
      }),
    ]
    try {
      // discovery
      expect(manifestFor(CTX).map(c => c.name)).toContain('example.setSomething')
      expect(buildContext(host, CTX).context.examples).toEqual([{ ref: 'e1', level: 'low' }])
      // fast path
      expect(fastParse('example high')).toEqual({ kind: 'ops', ops: [{ action: 'example.setSomething', args: { level: 'high' } }], target: null })
      // plan + policy (its metadata says confirm → always a proposal)
      const ops = [{ action: 'example.setSomething', target: 'ex1', args: { level: 'high' } }]
      expect(await prepareOps(ops)).toEqual({})
      const p = planOps(collectTargets(host, ['example']), ops, {}, CTX)
      expect(p.ok).toBe(true)
      expect(p.lines).toEqual(['Set example to high'])
      expect(decideMode('apply', p)).toBe('propose')
      // execute → ACK → undo through the same runtime
      const res = await commitPlan(host, p)
      expect(res.ok).toBe(true)
      expect(store.ex1.level).toBe('high')
      expect((await undoEntry(host, res.undo)).ok).toBe(true)
      expect(store.ex1.level).toBe('low')
    } finally {
      off.forEach(f => f())
    }
    expect(manifestFor(CTX).map(c => c.name)).not.toContain('example.setSomething')
  })
})

// ── widget.add (workspace target kind) over the REAL widget source ───────────
import { buildWidgetSource } from './host'
import { planPlacement } from '../pages/charts/placement/place'

function makeBoard(widgets) {
  const state = { widgets: widgets.map(w => ({ ...w })) }
  let n = 0
  const widgetOps = {
    layout: () => state,
    // what handleAddWidget does when the type fits in empty space
    add: (type) => {
      const plan = planPlacement(state.widgets, type)
      state.widgets = [...state.widgets, { id: `w-${type}-${++n}`, type, ...plan.place }]
    },
    remove: (id) => { state.widgets = state.widgets.filter(w => w.id !== id) },
  }
  const host = { widgets: buildWidgetSource({ widgetOps, getWidgets: () => state.widgets }) }
  return { host, state }
}
const wsPlan = (host, ops) => planOps(collectTargets(host, ['workspace']), ops, {}, CTX)
const addOp = (type) => ({ action: 'widget.add', target: 'workspace', args: { type } })

describe('widget.add', () => {
  it('is discovered through the manifest and the workspace context', () => {
    expect(manifestFor(CTX).map(c => c.name)).toContain('widget.add')
    const { host } = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    const { context, refMap } = buildContext(host, CTX)
    expect(context.workspace[0]).toMatchObject({ ref: 'w1', widgetCount: 1, widgetLimit: 16 })
    expect(refMap.w1).toEqual({ kind: 'workspace', ref: 'workspace' })
  })
  it('adds into empty space through the board writer, ACKs the new widget, and Undo closes exactly it', async () => {
    const { host, state } = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    const p = wsPlan(host, [addOp('watchlist')])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Added a Watchlist'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(state.widgets.map(w => w.type)).toEqual(['chart', 'watchlist'])
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(state.widgets.map(w => w.id)).toEqual(['c'])
  })
  it('refuses when there is no empty space (never resizes other widgets), and when the board is full', () => {
    const full = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20 }])
    const p = wsPlan(full.host, [addOp('watchlist')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/no empty space/)
    const sixteen = makeBoard(Array.from({ length: 16 }, (_, i) => ({ id: `x${i}`, type: 'chart', x: (i % 4) * 6, y: Math.floor(i / 4) * 5, w: 6, h: 5 })))
    expect(wsPlan(sixteen.host, [addOp('watchlist')]).refusals[0].reason).toMatch(/most it holds/)
  })
  it('one widget per turn', () => {
    const { host } = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 6, h: 20 }])
    const p = wsPlan(host, [addOp('watchlist'), addOp('news')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/one widget at a time/)
  })
  it('stale undo: a board changed by hand after the add is never overwritten', async () => {
    const { host, state } = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
    const res = await commitPlan(host, wsPlan(host, [addOp('watchlist')]))
    state.widgets = state.widgets.map(w => (w.id === 'c' ? { ...w, w: 10 } : w))   // member resized the chart
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(state.widgets).toHaveLength(2)
  })
  it('fast path: "add a watchlist" / "add another chart" → widget.add, ambiguous phrasing → model', () => {
    expect(fastParse('add a watchlist').ops[0]).toEqual({ action: 'widget.add', args: { type: 'watchlist' } })
    expect(fastParse('add another chart').ops[0]).toEqual({ action: 'widget.add', args: { type: 'chart' } })
    expect(fastParse('add a watchlist with my tech stocks')).toBeNull()
  })
})
