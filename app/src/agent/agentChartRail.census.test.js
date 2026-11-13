// ⛔ CHART RAIL CENSUS (hotfix 2026-11-13) — BY TOOL, enumerated from the registry (never a hand list): every registered
// capability is planned by the REAL planner (executor.planOps) over a Charts fixture holding charts in every place a chart
// lives (the board's chart widgets, a Multi Chart grid's cells, a saved layout to switch to), with arguments generated from
// its own args schema. Every capability whose plan can re-symbol an existing chart, remove one (fewer panels) or switch the
// charts away is listed with what it can do — and the rail must refuse each of them for a KEPT chart and for an ADDITIVE
// request. A capability that gains such an effect without the rail seeing it fails here.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { planOps, collectTargets } from './executor'
import { chartEffects, chartRailRefusal, RAIL_KINDS } from './chartRail'

registerBuiltins()

const settings = () => ({ settings: mergeChartSettings(null) })
const BOARD = () => [[
  { id: 'c1', type: 'chart', x: 0, y: 0, w: 10, h: 20, color: 'N', opts: settings() },
  { id: 'c2', type: 'chart', x: 10, y: 0, w: 10, h: 20, color: 'N', opts: settings() },
  { id: 'wl', type: 'watchlist', x: 20, y: 0, w: 4, h: 20, color: 'A', opts: {} },
], { 'N:c1': 'SPY', 'N:c2': 'NVDA', A: 'SPY' }]
const LAYOUTS = { entries: [{ id: 11, name: 'Mine' }, { id: 12, name: 'Swing' }], boards: { 11: BOARD()[0], 12: [{ id: 'x1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: settings() }] }, active: 11 }
// a Multi Chart grid of 3×3 with five filled cells, a group loaded and two saved grids (the grid's own controller, stubbed)
function gridControl() {
  const cells = ['SPY', 'NVDA', 'AAPL', 'MSFT', 'AMD', null, null, null, null].map((sym, i) => ({ id: `g${i}`, sym, tf: 'D' }))
  const st = { mode: 'grid', layout: '3x3', cells, syncCrosshair: false, syncTimeRange: false, groupsMode: true, group: { id: 'semis', name: 'Semis', alsoIn: [] } }
  return {
    state: () => st, maxId: () => null, settingsOpen: () => false, snapshot: () => ({ st }),
    savedGrids: () => [{ id: 's1', name: 'Tech', scope: 'user', layout: { id: '2x2', cells: [] } }, { id: 's2', name: 'Prebuilt Megacaps', scope: 'global', layout: { id: '2x2', cells: [] } }],
  }
}
function fixture() {
  const b = makeBoard(...BOARD(), { layouts: LAYOUTS })
  const host = { ...b.host, gridControl: gridControl() }
  return { b, host }
}

// ── arguments from the capability's own schema ──
const STRINGS = ['c1', 'c2', 'wl', 'AAPL', 'main', '1', 'Swing', 'Tech', 'Semis', 'grid', 'D', 'g0', '12']
const ARRAYS = [['AAPL'], ['AAPL', 'MSFT'], ['SPY', 'NVDA', 'AAPL', 'MSFT'], ['c1'], ['c1', 'c2']]
function candidates(prop) {
  const types = [].concat(prop?.type || [])
  const out = []
  if (Array.isArray(prop?.enum)) out.push(...prop.enum)
  else {
    if (types.includes('string')) out.push(...STRINGS)
    if (types.includes('boolean')) out.push(true, false)
    if (types.includes('integer') || types.includes('number')) out.push(1, 2, 3)
    if (types.includes('array')) out.push(...ARRAYS)
    if (types.includes('object')) out.push({})
  }
  if (types.includes('null') && !out.includes(null)) out.push(null)
  return out.length ? out : [null]
}
function* combos(schema, cap = 4000) {
  // enum properties vary fastest (an op / mode enum reaches every value inside the cap)
  const keys = Object.keys(schema?.properties || {}).sort((a, b) => Number(Array.isArray(schema.properties[a]?.enum)) - Number(Array.isArray(schema.properties[b]?.enum)))
  const lists = keys.map(k => candidates(schema.properties[k]))
  let n = 0
  const idx = keys.map(() => 0)
  while (n++ < cap) {
    yield Object.fromEntries(keys.map((k, i) => [k, lists[i][idx[i]]]))
    let i = keys.length - 1
    while (i >= 0 && ++idx[i] >= lists[i].length) { idx[i] = 0; i-- }
    if (i < 0) return
  }
}
const ENV = { mcGroups: [{ id: 'semis', name: 'Semis' }, { id: 'soft', name: 'Software' }] }

function census() {
  const rows = []
  for (const name of allCapabilityNames().sort()) {
    const cap = getCapability(name)
    if (cap.query) continue
    const kind = getTargetKind(cap.target)
    const { host } = fixture()
    let targets
    try { targets = collectTargets(host, [cap.target]) } catch { targets = new Map() }
    const refs = [...targets.keys()]
    const seen = new Set()
    let planned = 0
    for (const ref of refs.slice(0, 3)) {
      for (const args of combos(cap.args)) {
        let plan
        try { plan = planOps(collectTargets(host, [cap.target]), [{ action: name, target: ref, args }], ENV, { surface: 'charts' }) } catch { continue }
        if (!plan.ok) continue
        planned++
        for (const e of chartEffects(plan, host)) seen.add(e.type)
      }
    }
    rows.push({ name, kind: cap.target, reachable: refs.length > 0 && !!kind, planned, effects: [...seen].sort() })
  }
  return rows
}

describe('CHART RAIL census — by tool, from the registry', () => {
  const rows = census()
  const hits = rows.filter(r => r.effects.length)
  it('prints the census (every capability that can re-symbol / remove / switch away an existing chart)', () => {
    // eslint-disable-next-line no-console
    console.log(`CHART RAIL CENSUS: ${rows.length} capabilities enumerated, ${rows.filter(r => r.reachable).length} reachable on the Charts fixture, ${rows.filter(r => r.planned).length} planned at least once\n`
      + hits.map(r => `  ${r.name.padEnd(24)} [${r.kind}] ${r.effects.join(', ')}`).join('\n'))
    expect(rows.length).toBeGreaterThan(150)
  })
  it('the set is exactly what the rail is tested against (a new tool with a chart effect fails here until it is covered)', () => {
    expect(Object.fromEntries(hits.map(r => [r.name, r.effects]))).toEqual({
      'chart.setSymbol': ['symbol'],
      'chartGrid.set': ['remove', 'symbol'],
      'layout.open': ['switch'],
      'multiChart.set': ['remove', 'symbol'],
      'widget.remove': ['remove'],
    })
  })
  it('every kind that holds an effect is one the rail reads', () => {
    for (const r of hits) expect(RAIL_KINDS, r.name).toContain(r.kind)
  })
  it('every capability with a chart effect is REFUSED by the rail for a kept chart and for an additive request — nothing planned survives', () => {
    for (const r of hits) {
      const cap = getCapability(r.name)
      const { host } = fixture()
      const targets = collectTargets(host, [cap.target])
      let checked = 0
      for (const ref of [...targets.keys()].slice(0, 3)) {
        for (const args of combos(cap.args)) {
          let plan
          try { plan = planOps(collectTargets(host, [cap.target]), [{ action: r.name, target: ref, args }], ENV, { surface: 'charts' }) } catch { continue }
          if (!plan.ok) continue
          const eff = chartEffects(plan, host)
          if (!eff.length) continue
          checked++
          const kept = eff[0].symbol
          expect(chartRailRefusal(plan, { words: `keep ${kept} and change the rest`, host, mode: 'apply' }), `${r.name} ${JSON.stringify(args)} kept ${kept}`).toMatch(/keep/i)
          expect(chartRailRefusal(plan, { words: 'add two more charts for AAPL and MSFT', host, mode: 'apply' }), `${r.name} ${JSON.stringify(args)} additive`).toBeTruthy()
        }
      }
      expect(checked, r.name).toBeGreaterThan(0)
    }
  })
})

