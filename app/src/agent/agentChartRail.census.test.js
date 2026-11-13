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
  { id: 'c1', type: 'chart', x: 0, y: 0, w: 10, h: 14, color: 'N', opts: settings() },
  { id: 'c2', type: 'chart', x: 10, y: 0, w: 10, h: 14, color: 'N', opts: settings() },
  { id: 'wl', type: 'watchlist', x: 20, y: 0, w: 4, h: 20, color: 'A', opts: {}, wtabs: [{ id: 'wt1', type: 'news' }], activeWtab: 0 },
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
// each chart reports a loaded VIEW (the date navigator's meta: frame, zoom limits), so the view controls can be planned too
const VIEW = { firstMs: 0, lastMs: 1, rightMs: 1, activeRange: null, atDefaultView: false, indicatorsHidden: false, priceAuto: true,
  zoomLimits: { minWidth: 1, maxWidth: 2000 }, frame: { fromRight: 100, toRight: 0, activeRange: null, locked: false, lock: null } }
function fixture() {
  const b = makeBoard(...BOARD(), { layouts: LAYOUTS })
  const base = b.host.charts
  const charts = { ...base, read: (r) => { const x = base.read(r); return x && { ...x, view: VIEW } }, list: () => base.list().map(x => ({ ...x, view: VIEW })),
    canManageIndicators: () => true, canCreateIndicator: () => true }
  const host = { ...b.host, charts, gridControl: gridControl() }
  return { b, host }
}

// ── arguments from the capability's own schema ──
const STRINGS = ['c1', 'c2', 'wl', 'AAPL', 'main', '1', 'Swing', 'Tech', 'Semis', 'grid', 'D', 'g0', '12', 'ovl:0', '#ff0000', '2026-01-02', '3M', 'W', 'in', 'companyOpen']
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
// the capability's own one-line example (its manifest `shape`), when it has one, is tried first
function shapeArgs(cap) {
  const m = /^\s*(\{.*?\})(?=\s+or\s|;|\s*$)/.exec(String(cap.shape || ''))
  try { return m ? JSON.parse(m[1]) : null } catch { return null }
}
function* argSets(cap) {
  const ex = shapeArgs(cap)
  if (ex) yield ex
  yield* combos(cap.args)
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
    let why = null
    for (const ref of refs.slice(0, 3)) {
      for (const args of argSets(cap)) {
        let plan
        try { plan = planOps(collectTargets(host, [cap.target]), [{ action: name, target: ref, args }], ENV, { surface: 'charts' }) } catch { continue }
        if (!plan.ok) { why = why || plan.refusals?.[0]?.reason; continue }
        planned++
        for (const e of chartEffects(plan, host)) seen.add(e.type)
      }
    }
    // ── not planned by the real planner from the fuzz arguments (its check refused every one) → two proofs instead ──
    // (1) a RAIL kind (chart / board / multiChart / layouts): the capability's own apply() is run WITHOUT its check, on the
    //     fixture's real state, for every argument set — any chart effect its plan builder can produce is seen here
    let applied = 0
    if (!planned && kind && RAIL_KINDS.includes(cap.target)) {
      for (const ref of refs.slice(0, 3)) {
        const snap = targets.get(ref)?.snap
        if (!snap) continue
        for (const args of argSets(cap)) {
          let after
          const before = kind.stateOf(snap)
          try { after = cap.apply(before, args, { ...ENV, target: snap, peer: () => null }) } catch { continue }
          if (!after) continue
          applied++
          for (const e of chartEffects({ ok: true, plans: [{ ref, kind: cap.target, snap, before, after, items: [], virtual: false }] }, host)) seen.add(e.type)
        }
      }
    }
    // (2) any OTHER kind: the planner never puts an op on a target of another kind (executor.planOps: "doesn't apply to that"),
    //     and the rail's effects are read only from the RAIL kinds' states. What such a kind WRITES is its patch: its apply()
    //     is run unchecked on the real state and every patch it makes is read — none may carry a symbol, a removal, a layout
    //     switch or a grid change (the keys the chart / board / grid / layout writers take)
    let patched = 0
    if (!planned && kind && !RAIL_KINDS.includes(cap.target)) {
      for (const ref of refs.slice(0, 3)) {
        const snap = targets.get(ref)?.snap
        if (!snap) continue
        for (const args of argSets(cap)) {
          let after, patch
          const before = kind.stateOf(snap)
          try { after = cap.apply(before, args, { ...ENV, target: snap, peer: () => null }); patch = after ? kind.patch(before, after) : null } catch { continue }
          if (!patch) continue
          patched++
          for (const k of Object.keys(patch)) if (FORBIDDEN_PATCH.has(k)) seen.add(`patch:${k}`)
        }
      }
    }
    //     …and a kind no argument set reaches: its own writer (commit) calls none of the host's chart / board / grid / layout
    //     writers — checked on its source
    const structural = !planned && !applied && !patched && !RAIL_KINDS.includes(cap.target) && !!kind && !CHART_WRITERS.test(writerSource(kind))
    rows.push({ name, kind: cap.target, reachable: refs.length > 0 && !!kind, planned, applied, patched, structural, effects: [...seen].sort(), why })
  }
  return rows
}
// the host writers that can re-symbol, remove or replace charts on screen
const FORBIDDEN_PATCH = new Set(['symbol', 'remove', 'grid', 'gridUndo', 'restore', 'do'])
// a kind's writer source, minus the one chart write that cannot re-symbol: the chart's own settings object, alone
// (indicatorEdits: host.charts.commit(chartRef, { settings: step.cs }))
const writerSource = (kind) => String(kind.commit || '').replace(/charts\.commit\(\s*[\w.]+\s*,\s*\{\s*settings:\s*[\w.]+\s*\}\s*\)/g, '')
const CHART_WRITERS = /charts\.commit|applyBoard|widgets\.remove|layouts\.open|enterGrid|applyGridTemplate|applyCustomLayout|restoreSnapshot|updateCellAt|setSymbol/

describe('CHART RAIL census — by tool, from the registry', () => {
  const rows = census()
  const hits = rows.filter(r => r.effects.length)
  it('prints the census (every capability that can re-symbol / remove / switch away an existing chart)', () => {
    // eslint-disable-next-line no-console
    console.log(`CHART RAIL CENSUS: ${rows.length} capabilities enumerated, ${rows.filter(r => r.reachable).length} reachable on the Charts fixture, ${rows.filter(r => r.planned).length} planned at least once\n`
      + hits.map(r => `  ${r.name.padEnd(24)} [${r.kind}] ${r.effects.join(', ')}`).join('\n'))
    const reach = rows.filter(r => r.reachable)
    // eslint-disable-next-line no-console
    console.log(`CENSUS PROOF (reachable ${reach.length}): planned by the real planner ${reach.filter(r => r.planned).length} · apply() run unchecked on the real state ${reach.filter(r => !r.planned && r.applied).length} · another kind, every patch read ${reach.filter(r => !r.planned && r.patched).length} · structural (another kind, no chart writer) ${reach.filter(r => !r.planned && !r.applied && !r.patched && r.structural).length} · UNPROVEN ${reach.filter(r => !r.planned && !r.applied && !r.patched && !r.structural).length}\n`
      + reach.filter(r => !r.planned).map(r => `  ${r.name.padEnd(30)} [${r.kind}] ${r.applied ? `apply ×${r.applied}` : r.patched ? `patch ×${r.patched}` : r.structural ? 'structural' : 'UNPROVEN'} — check: ${r.why}`).join('\n'))
    expect(rows.length).toBeGreaterThan(150)
  })
  it('EXHAUSTIVE: every reachable capability is proven — planned, its apply() run, or structurally unable to touch a chart', () => {
    const open = rows.filter(r => r.reachable && !r.planned && !r.applied && !r.patched && !r.structural).map(r => r.name)
    expect(open).toEqual([])
  })
  it('every capability that is NOT reachable on the fixture is structural (another kind, no chart writer) — or listed', () => {
    const open = rows.filter(r => !r.reachable && !r.structural && !RAIL_KINDS.includes(r.kind)).map(r => `${r.name} [${r.kind}]`)
    const railUnreached = rows.filter(r => !r.reachable && RAIL_KINDS.includes(r.kind)).map(r => r.name)
    // eslint-disable-next-line no-console
    console.log(`UNREACHABLE on the fixture: ${rows.filter(r => !r.reachable).length} (structural ${rows.filter(r => !r.reachable && r.structural).length}); rail kinds unreached: ${JSON.stringify(railUnreached)}; open: ${JSON.stringify(open)}`)
    expect(open).toEqual([])
    expect(railUnreached).toEqual([])
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
        for (const args of argSets(cap)) {
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

