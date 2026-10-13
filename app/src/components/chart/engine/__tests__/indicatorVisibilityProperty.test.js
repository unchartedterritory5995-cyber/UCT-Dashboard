// app/src/components/chart/engine/__tests__/indicatorVisibilityProperty.test.js — A1.1 property test
//
// ⭐ A1 (D3): "turning an indicator off" is a HIDE, never a delete. This drives seeded random
// sequences of every member-reachable visibility / edit / removal writer over a realistic chart
// (three RSIs — one hidden by the member — MACD, an MA reading RSI #1, a header info value on
// RSI #2, the four default averages) and checks, after EVERY step, round-tripped through the
// persisted read (`mergeChartSettings(JSON.stringify(x))`):
//   1. no silent loss — an instance not explicitly removed keeps its inputs, timeframe,
//      placement, presentation and display (only the step's own field may change);
//   2. no severed reference (`!@…` source, `severed` info value) points at a LIVE instance;
//   3. a definition hide then show is byte-identical, and member-hidden instances stay hidden;
//   4. a definition toggle never un-hides an instance the member hid by hand;
//   5. no duplicate instance id is ever drawn.
// The same run against the PRE-A1 door (OFF = delete) must break invariant 1 — the proof
// that this test can see the defect it guards.
import { describe, it, expect } from 'vitest'
import * as R from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import {
  setIndicatorEnabled, removeDefinition, ensureLegacyInstance, definitionVisibility, setInstanceHidden,
  setIndicatorInput, setInstanceInput, duplicateInstance, removeInstance, withInstances, groupMemberIds,
  HIDDEN_VIA_DEFINITION,
} from '../instanceControls'
import { normalizeInstances, migrateLegacyToInstances } from '../instances'
import { isInstanceTombstone } from '../../instanceShape'
import { adoptOverlayAverages } from '../../maAdoption'

const ENGINE = new Set(['rsi', 'macd', 'movingAverage'])
const norm = (cs) => mergeChartSettings(JSON.stringify(cs))
const isLive = (i) => !!i && typeof i === 'object' && !isInstanceTombstone(i) && typeof i.instanceId === 'string'
const liveList = (cs) => (cs.indicatorInstances || []).filter(isLive)
const byId = (cs) => new Map(liveList(cs).map((i) => [i.instanceId, i]))
const strip = (i, keys) => { const o = { ...i }; for (const k of keys) delete o[k]; return JSON.stringify(o, Object.keys(o).sort()) }

function fixture() {
  const base = mergeChartSettings(null)
  const raw = adoptOverlayAverages(mergeChartSettings(JSON.stringify({
    ...base,
    indicatorInstances: [
      ...(base.indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false, calcTimeframe: 'W' },
      { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 21 }, hidden: false },
      { instanceId: 'inst:rsi:3', defId: 'rsi', inputs: { period: 50 }, hidden: true },
      { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false },
      { instanceId: 'inst:movingAverage:9', defId: 'movingAverage', inputs: { source: '@inst:rsi:1::rsi', period: 9, maType: 'ema', color: '#ff9800' }, hidden: false },
    ],
    indicators: { ...(base.indicators || {}), rsi: { enabled: true }, macd: { enabled: true } },
    header: { ...(base.header || {}), infoValues: [{ instanceId: 'inst:rsi:2', plotKey: 'rsi', format: 'auto' }] },
  })))
  return norm(withInstances(raw, raw.indicatorInstances, R))
}

const NEW_DOOR = (cs, d) => setIndicatorEnabled(cs, d, definitionVisibility(cs, d, ENGINE).state !== 'shown', R)
// The door as it shipped before A1: direction from "exists", OFF deletes every instance.
const OLD_DOOR = (cs, d) => {
  const on = definitionVisibility(cs, d, ENGINE).state !== 'absent'
  return on ? removeDefinition(cs, d, R) : ensureLegacyInstance(cs, d, R)
}

function makeRng(seed) {
  let s = seed >>> 0 || 1
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
}

/** One random step. Returns { next, removed:Set, touched:Map<id,string[]>, defToggle?:defId }. */
function step(cs, rnd, door) {
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const live = liveList(cs)
  const op = pick(['def', 'def', 'def', 'hideOne', 'input', 'instInput', 'dup', 'remove', 'removeAll'])
  const none = { next: cs, removed: new Set(), touched: new Map() }
  if (op === 'def') {
    const d = pick(['rsi', 'macd', 'movingAverage'])
    const touched = new Map(live.filter((i) => i.defId === d).map((i) => [i.instanceId, ['hidden', 'hiddenVia']]))
    return { next: door(cs, d), removed: new Set(), touched, defToggle: d, op }
  }
  if (!live.length) return none
  const t = pick(live)
  if (op === 'hideOne') {
    const ids = groupMemberIds(cs, t.instanceId)
    return { next: setInstanceHidden(cs, t.instanceId, rnd() < 0.5, R), removed: new Set(), touched: new Map([...ids].map((id) => [id, ['hidden', 'hiddenVia']])), op }
  }
  if (op === 'input' && t.instanceId === `legacy:${t.defId}` && t.defId === 'rsi') {
    return { next: setIndicatorInput(cs, 'rsi', 'period', 2 + Math.floor(rnd() * 60), R), removed: new Set(), touched: new Map([[t.instanceId, ['inputs']]]), op }
  }
  if (op === 'instInput' && t.defId === 'rsi') {
    return { next: setInstanceInput(cs, t.instanceId, 'period', 2 + Math.floor(rnd() * 60), R), removed: new Set(), touched: new Map([[t.instanceId, ['inputs']]]), op }
  }
  if (op === 'dup') return { next: duplicateInstance(cs, t.instanceId, R), removed: new Set(), touched: new Map(), op }
  if (op === 'remove') return { next: removeInstance(cs, t.instanceId, R), removed: groupMemberIds(cs, t.instanceId), touched: new Map(), op, severs: true }
  if (op === 'removeAll') {
    const ids = new Set(live.filter((i) => i.defId === t.defId).map((i) => i.instanceId))
    return { next: removeDefinition(cs, t.defId, R), removed: ids, touched: new Map(), op, severs: true }
  }
  return none
}

/** The invariants after one step. Returns the first violation, or null. */
function violation(before, after, s) {
  const b = byId(before)
  const a = byId(after)
  // 1 · no silent loss
  for (const [id, inst] of b) {
    if (s.removed.has(id)) continue
    const now = a.get(id)
    if (!now) return `1: ${id} vanished (${s.op})`
    // a dependent's source may be severed only by an explicit removal step
    const keys = [...(s.touched.get(id) || [])]
    if (s.severs) keys.push('inputs')
    if (strip(inst, keys) !== strip(now, keys)) return `1: ${id} changed beyond ${keys.join('/') || 'nothing'} (${s.op})`
  }
  // 2 · no severed reference to a live instance
  for (const inst of liveList(after)) {
    for (const v of Object.values(inst.inputs || {})) {
      if (typeof v === 'string' && v.startsWith('!@')) {
        const target = v.slice(2).split('::')[0]
        if (a.has(target)) return `2: ${inst.instanceId} holds a severed source to LIVE ${target}`
      }
    }
  }
  for (const iv of (after.header?.infoValues || [])) {
    if (iv && iv.severed && a.has(iv.instanceId)) return `2: a severed info value points at LIVE ${iv.instanceId}`
  }
  // 4 · a definition toggle never un-hides a member's own hide
  if (s.defToggle) {
    for (const [id, inst] of b) {
      if (inst.defId !== s.defToggle || inst.hidden !== true || inst.hiddenVia === HIDDEN_VIA_DEFINITION) continue
      const allHidden = liveList(before).filter((i) => i.defId === s.defToggle).every((i) => i.hidden === true)
      const anyMarked = liveList(before).some((i) => i.defId === s.defToggle && i.hiddenVia === HIDDEN_VIA_DEFINITION)
      // "show" over an all-hand-hidden definition legitimately shows them all
      if (allHidden && !anyMarked) continue
      if (a.get(id) && a.get(id).hidden !== true) return `4: the ${s.defToggle} toggle un-hid member-hidden ${id}`
    }
  }
  // 5 · no duplicate id drawn
  const drawn = normalizeInstances(migrateLegacyToInstances(after, R), R).kept.map((i) => i.instanceId)
  if (new Set(drawn).size !== drawn.length) return '5: a duplicate instance id is drawn'
  return null
}

/** 3 · hide-then-show of every shown definition is byte-identical (instances, mirror, header).
 *  The one permitted difference: a STALE marker (left by an earlier definition hide on a copy
 *  the member then kept hidden while showing its siblings) is dropped by the next hide, so
 *  that copy stays hidden as the member's own. With no stale marker it is exact, byte for byte. */
function hideShowViolation(cs) {
  for (const d of ['rsi', 'macd', 'movingAverage']) {
    if (definitionVisibility(cs, d, ENGINE).state !== 'shown') continue
    const back = norm(NEW_DOOR(norm(NEW_DOOR(cs, d)), d))
    const stale = new Set(liveList(cs).filter((i) => i.defId === d && i.hidden === true && i.hiddenVia === HIDDEN_VIA_DEFINITION).map((i) => i.instanceId))
    const unmark = (x) => ({ ...x, indicatorInstances: (x.indicatorInstances || []).map((i) => (isLive(i) && stale.has(i.instanceId) ? (({ hiddenVia: _v, ...r }) => r)(i) : i)) })
    const snap = (x) => JSON.stringify([x.indicatorInstances, x.indicators, x.header])
    if (snap(stale.size ? unmark(back) : back) !== snap(stale.size ? unmark(cs) : cs)) return `3: hide→show of ${d} is not byte-identical`
    for (const id of stale) if (byId(back).get(id)?.hidden !== true) return `3: hide→show of ${d} un-hid ${id}, which the member had kept hidden`
  }
  return null
}

function run(seed, door, steps) {
  const rnd = makeRng(seed)
  let cs = fixture()
  for (let k = 0; k < steps; k++) {
    const s = step(cs, rnd, door)
    const next = norm(s.next)
    const v = violation(cs, next, s) || (door === NEW_DOOR ? hideShowViolation(next) : null)
    if (v) return `seed ${seed} step ${k}: ${v}`
    cs = next
  }
  return null
}

const SEEDS = Number(globalThis.process?.env?.INDICATOR_PROPERTY_SEEDS) || 1000

describe('A1.1 — indicator visibility property test', () => {
  it(`${SEEDS} seeded sequences: every invariant holds after every step`, () => {
    const fails = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const v = run(seed, NEW_DOOR, 25 + (seed % 36))
      if (v) fails.push(v)
      if (fails.length >= 5) break
    }
    expect(fails).toEqual([])
  }, 120_000)

  it('the PRE-A1 door (OFF = delete) breaks invariant 1 — this test can see the defect', () => {
    let broken = 0
    for (let seed = 1; seed <= 200; seed++) {
      const v = run(seed, OLD_DOOR, 40)
      if (v && v.includes(': 1:')) broken++
    }
    expect(broken, 'the old delete-all door should lose instances on most seeds').toBeGreaterThan(150)
  }, 120_000)
})
