// app/src/components/chart/engine/__tests__/serverLaneTfSwitch.test.js
//
// ─── THE SERVER LANE ACROSS A TIMEFRAME SWITCH (2026-11-11) ─────────────────
//
// Reported once on the live site: UCT RS Line added on a 1-MINUTE chart (dotted legend,
// no line, as expected on intraday), then the chart switched to 1D: the entry stayed
// dotted and no line drew for 12+ seconds, until a reload.
//
// StockChart changes `tf` (and `sym`) a render BEFORE the new bars land: it keeps the old
// series on screen meanwhile. The binder's compute memo was keyed on (bars, inputs) only,
// so that render was answered from the memo and the lane asked for NOTHING at the new
// timeframe until the new bars arrived. `rsLine` was spared only because its live-tail
// signature moves with the timeframe; `rsRating`, `rsPhases` and `rsVsEma` carry none.
//
// This drives the REAL binder, registry and lane (`serverCompute`) with a stubbed `fetch`
// and walks the exact sequence: add on 1m, land the intraday answer, switch the timeframe
// with the OLD bars still in hand, then land the new bars.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import * as registry from '../nativeRegistry'
import { RS_LINE_SLIM_RAW, registerDefinitions } from '../nativeRegistry'
import { clearServerColumns } from '../serverCompute'
import { _resetBenchmarkTailsForTests } from '../liveTail'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'

const INTRADAY = Array.from({ length: 40 }, (_, i) => ({ t: 1_700_000_000 + i * 60, o: 10, h: 11, l: 9, c: 10 + i * 0.01, v: 100 }))
const DAILY = Array.from({ length: 40 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 2 + i))
  return { t: d.toISOString().slice(0, 10), o: 10, h: 11, l: 9, c: 10 + i * 0.01, v: 100 }
})
const dayKey = (t) => Number(String(t).replace(/-/g, ''))
const tick = () => new Promise((r) => setTimeout(r, 10))

/** A wire envelope for `def` on `bars`: every declared plot key, finite on daily, all null on 1m. */
function wireFor(def, tf, benchmark) {
  const daily = tf === 'D'
  const series = daily ? DAILY : INTRADAY
  const columns = {}
  for (const p of def.plots) columns[p.key] = series.map((_, i) => (daily ? 1 + i * 0.01 : null))
  return { defId: def.id, sym: 'CRWV', tf, rev: def.compute.rev, times: series.map((b) => (daily ? dayKey(b.t) : b.t)), columns,
    payload: benchmark ? { benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500' } } : {} }
}

let pending
function stubFetch(def, benchmark) {
  pending = []
  vi.stubGlobal('fetch', (url) => new Promise((res) => {
    const tf = /tf=([^&]+)/.exec(url)[1]
    pending.push({ tf, land: () => res({ ok: true, json: () => Promise.resolve(wireFor(def, tf, benchmark)) }) })
  }))
}
beforeEach(() => { clearServerColumns(); _resetBenchmarkTailsForTests() })
afterEach(() => { vi.unstubAllGlobals(); clearServerColumns() })

const SLIM = registerDefinitions([RS_LINE_SLIM_RAW]).defs[0]

/** Walks add-on-1m → switch to D (tf first, old bars) → D bars arrive. Returns what was asked and drawn. */
async function walk(def, reg, { benchmark }) {
  stubFetch(def, benchmark)
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings(null), def.id, reg)
  const instances = cs.indicatorInstances.filter((i) => i.defId === def.id)
  const ctx = (bars, tf) => ({ enabled: true, instances, registry: reg, bars, sym: 'CRWV', tf, adjustTime: (t) => t, plan: { fresh: true },
    applyData: (s, d) => s.setData(d), resolvePlacement: () => ({ paneIndex: 0, scaleId: `own:${def.id}`, scaleOptions: {} }) })
  const land = async () => { const p = pending.splice(0); p.forEach((x) => x.land()); await tick(); return p.map((x) => x.tf) }
  const asked = (label) => ({ label, tfs: pending.map((x) => x.tf) })
  const log = []

  binder.sync(ctx(INTRADAY, '1')); await tick(); log.push(asked('add on 1m'))
  await land(); binder.sync(ctx(INTRADAY, '1')); await tick(); log.push(asked('1m answer in hand'))
  const onOneMinute = binder.bindings().length
  // the timeframe switch: the new `tf`, the OLD bars still on screen
  binder.sync(ctx(INTRADAY, 'D')); await tick(); log.push(asked('tf = D, old bars'))
  const askedAtSwitch = pending.map((x) => x.tf)
  await land()
  binder.sync(ctx(DAILY, 'D')); await tick()
  return { log, onOneMinute, askedAtSwitch, drawn: binder.bindings().length }
}

describe('a timeframe switch asks the server lane for the NEW timeframe at once, and the line draws', () => {
  // The three split definitions carry no live tail, so nothing but the memo key could move.
  for (const id of ['rsRating', 'rsPhases', 'rsVsEma']) {
    it(`${id}: the D request goes out on the switch render (old bars still in hand), and the line draws when the D bars land`, async () => {
      const def = registry.getDefinition(id)
      expect(def, `${id} is registered`).toBeTruthy()
      expect(def.compute.kind).toBe('server')
      const r = await walk(def, registry, { benchmark: false })
      expect(r.onOneMinute, 'nothing draws on a 1m chart').toBe(0)
      expect(r.askedAtSwitch, JSON.stringify(r.log)).toEqual(['D'])
      expect(r.drawn).toBeGreaterThan(0)
    })
  }

  it('rsLine (v5, no live tail): the same', async () => {
    const def = registry.getDefinition('rsLine')
    expect(def.compute.kind).toBe('server')
    const r = await walk(def, registry, { benchmark: false })
    expect(r.askedAtSwitch, JSON.stringify(r.log)).toEqual(['D'])
    expect(r.drawn).toBeGreaterThan(0)
  })

  it('rsLine (the slim UCT RS Line) whose live-tail signature already moved with the timeframe: unchanged', async () => {
    const reg = { ...registry, getDefinition: (id) => (id === 'rsLine' ? SLIM : registry.getDefinition(id)) }
    const r = await walk(SLIM, reg, { benchmark: true })
    expect(r.askedAtSwitch, JSON.stringify(r.log)).toEqual(['D'])
    expect(r.drawn).toBeGreaterThan(0)
  })

  it('a SYMBOL switch with the old bars still in hand re-asks too', async () => {
    const def = registry.getDefinition('rsRating')
    stubFetch(def, false)
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings(null), def.id, registry)
    const instances = cs.indicatorInstances.filter((i) => i.defId === def.id)
    const ctx = (sym) => ({ enabled: true, instances, registry, bars: DAILY, sym, tf: 'D', adjustTime: (t) => t, plan: { fresh: true },
      applyData: (s, d) => s.setData(d), resolvePlacement: () => ({ paneIndex: 0, scaleId: `own:${def.id}`, scaleOptions: {} }) })
    binder.sync(ctx('CRWV')); await tick()
    pending.splice(0).forEach((x) => x.land()); await tick()
    binder.sync(ctx('CRWV')); await tick()
    expect(pending.length).toBe(0)
    const urls = []
    vi.stubGlobal('fetch', (url) => { urls.push(url); return new Promise(() => {}) })
    binder.sync(ctx('NVDA')); await tick()
    expect(urls.some((u) => u.includes('sym=NVDA'))).toBe(true)
  })

  it('an unchanged chart re-asks nothing (the memo still holds between identical syncs)', async () => {
    const def = registry.getDefinition('rsRating')
    stubFetch(def, false)
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings(null), def.id, registry)
    const instances = cs.indicatorInstances.filter((i) => i.defId === def.id)
    const ctx = { enabled: true, instances, registry, bars: DAILY, sym: 'CRWV', tf: 'D', adjustTime: (t) => t, plan: { fresh: true },
      applyData: (s, d) => s.setData(d), resolvePlacement: () => ({ paneIndex: 0, scaleId: `own:${def.id}`, scaleOptions: {} }) }
    binder.sync(ctx); await tick()
    pending.splice(0).forEach((x) => x.land()); await tick()
    binder.sync(ctx); binder.sync(ctx); await tick()
    expect(pending.length).toBe(0)
    expect(binder.bindings().length).toBeGreaterThan(0)
  })
})
