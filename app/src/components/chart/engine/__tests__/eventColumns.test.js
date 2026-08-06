/**
 * EVENTS ARE COLUMNS — the registration gate, and SAR's two.
 *
 * Spec §3.1: *"Events are columns. `events[].key` MUST match a returned column
 * valued {0, 1, NaN}."* That sentence was in the schema from B1 and was checked
 * by NOTHING. `defSchema.validateEvent` guarded the key's SHAPE, its uniqueness
 * and its non-collision with a plot; `nativeRegistry.columnKeys` read
 * `def.plots` only. So an event has been **declarable and inert since B1**: a
 * definition could name three events, return a column for none of them, and
 * register cleanly.
 *
 * Two claims live here and they are two different kinds of claim:
 *
 *   1. THE GATE — `registerDefinitions` runs a definition's compute over a canned
 *      probe series and REFUSES it when an event names no column, or when the
 *      column it names holds anything but 0, 1 or NaN. Both directions are
 *      asserted, because a gate that only fails one way is half a gate.
 *   2. THE FIRST CITIZEN — `sar` declares `priceCrossedSar` and `trendFlipped`,
 *      and they really compute. The NUMBERS are pinned in
 *      `tests/fixtures/indicators/sar_events_*.json` and asserted by BOTH lanes
 *      at rel-tol 1e-9; what is asserted here is the wiring.
 *
 * ⛔ THE GATE CANNOT LIVE IN `defSchema`. `validateDefinition` is a pure function
 * of ONE definition that never runs a compute lane — it has to accept a `server`
 * or `ast` definition this client cannot execute at all. "Does a column come
 * back?" is a question only a registry with a compute can ask, which is why the
 * check is at registration and why `defSchema.test.js` still (correctly) accepts
 * a definition whose event names nothing.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  registerDefinitions,
  columnKeys,
  computeFor,
  getDefinition,
  listDefinitions,
  hasAnyFinite,
} from '../nativeRegistry'
import { EVENT_COLUMN_DOMAIN, isEventColumnValue } from '../defSchema'
import { computeParabolicSAR, computeParabolicSAREvents } from '../../indicators'
import { stripComments } from './sourceScan'

const HERE = dirname(fileURLToPath(import.meta.url))

/** A minimal, VALID definition on a real native. Every case below starts here
 *  and breaks exactly one thing, so a failure names the thing it broke. */
const probeDef = () => ({
  schemaVersion: 1,
  id: 'probe',
  version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Probe', shortName: 'PRB', tier: 'free', repaint: 'non-repainting' },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [{ key: 'period', type: 'int', label: 'Period', default: 14, min: 2, max: 100 }],
  plots: [{ key: 'rsi', label: 'RSI', style: 'line', color: '#7b68ee', width: 1 }],
})

/** The probe with an event whose key IS a returned column — but a column of
 *  RSI values, i.e. floats, i.e. not a `{0, 1, NaN}` domain. `plots` is emptied
 *  so the key does not collide (plots and events share one namespace). */
const defWhoseEventColumnIsFloat = () => {
  const d = probeDef()
  d.id = 'probeFloatEvent'
  d.plots = []
  d.events = [{ key: 'rsi', label: 'not a maybe' }]
  return d
}

// ─── 1. THE GATE, BOTH WAYS ──────────────────────────────────────────────────

describe('events are columns — the registration gate fails CLOSED', () => {
  it('the probe itself registers cleanly — otherwise the two cases below prove nothing', () => {
    const res = registerDefinitions([probeDef()])
    expect(res.errors).toEqual([])
    expect(res.defs.map(d => d.id)).toEqual(['probe'])
  })

  it('an event whose key names NO returned column REFUSES to register', () => {
    // The whole defect this task closes: `columnKeys` read `def.plots` only, so
    // this definition registered happily and its event was a signal that could
    // never fire — invisibly, because nothing draws an event.
    const def = { ...probeDef(), events: [{ key: 'neverComputed', label: 'x' }] }
    const res = registerDefinitions([def])
    expect(res.errors.join('\n')).toMatch(/neverComputed.*returned no column/)
    expect(res.defs, 'a definition that lies about its events must not register').toEqual([])
  })

  it('an event column OUTSIDE {0, 1, NaN} REFUSES to register', () => {
    // A float column wearing an event's name would be read as a signal by the
    // alert grammar, the screener and the D-phase AST alike — all three consume
    // this one shape.
    const res = registerDefinitions([defWhoseEventColumnIsFloat()])
    expect(res.errors.join('\n')).toMatch(/must be 0, 1 or NaN/)
    expect(res.defs).toEqual([])
  })

  it('…and the refusal NAMES the offending value, which is the real RSI at that bar', () => {
    // An error that says "some value was wrong" is an error nobody debugs with.
    // Asserting the NUMBER also makes the case non-vacuous in a way a regex on
    // the sentence is not: it can only pass if the gate really read the column.
    const res = registerDefinitions([defWhoseEventColumnIsFloat()])
    const m = /got (-?\d+(?:\.\d+)?)/.exec(res.errors.join('\n'))
    expect(m, `no value in: ${res.errors.join('\n')}`).not.toBeNull()
    const named = Number(m[1])
    expect(Number.isFinite(named)).toBe(true)
    expect(isEventColumnValue(named), 'the gate flagged a value that IS in the domain').toBe(false)
  })

  it('a definition that declares NO events pays no probe compute and registers as before', () => {
    // The gate is scoped to event-declaring definitions on purpose: thirteen of
    // the fourteen natives declare none, so there is nothing to check. A gate
    // that ran a probe compute for all fourteen at import would be a cost with
    // no claim behind it.
    const res = registerDefinitions([probeDef()])
    expect(res.errors).toEqual([])
    expect('events' in res.defs[0], 'the validator invented an events key').toBe(false)
  })

  it('an event on a definition whose compute cannot run is an ERROR, not a skip', () => {
    const d = { ...probeDef(), compute: { kind: 'native', fn: 'notANative', rev: 1 } }
    d.events = [{ key: 'whatever', label: 'x' }]
    const res = registerDefinitions([d])
    expect(res.errors.join('\n')).toMatch(/compute could not be run/)
    expect(res.defs).toEqual([])
  })
})

// ─── 2. THE DOMAIN ITSELF ────────────────────────────────────────────────────

describe('EVENT_COLUMN_DOMAIN — a domain, not a null test', () => {
  it('is exactly 0, 1 and NaN, frozen', () => {
    expect(Object.isFrozen(EVENT_COLUMN_DOMAIN)).toBe(true)
    expect(EVENT_COLUMN_DOMAIN.length).toBe(3)
    expect(EVENT_COLUMN_DOMAIN[0]).toBe(0)
    expect(EVENT_COLUMN_DOMAIN[1]).toBe(1)
    expect(Number.isNaN(EVENT_COLUMN_DOMAIN[2])).toBe(true)
  })

  it('accepts the three, and NOTHING else', () => {
    expect(isEventColumnValue(0)).toBe(true)
    expect(isEventColumnValue(1)).toBe(true)
    expect(isEventColumnValue(NaN)).toBe(true)
    // ⚠️ 0.5 IS NOT A "MAYBE". This is the case the whole domain exists for.
    for (const bad of [0.5, -1, 2, 1.0000001, Infinity, -Infinity, null, undefined, '1', true, {}]) {
      expect(isEventColumnValue(bad), `${String(bad)} must be refused`).toBe(false)
    }
  })

  it('⛔ NaN is IN the domain and it is NOT "no event" — 0 is', () => {
    // Collapsing the two would make a 200-bar indicator's first 199 bars read as
    // 199 non-events. They are different facts and both are legal.
    expect(isEventColumnValue(NaN)).toBe(true)
    expect(isEventColumnValue(0)).toBe(true)
    expect(Number.isNaN(0)).toBe(false)
  })
})

// ─── 3. columnKeys — the seam, and what it must NOT have moved ───────────────

/**
 * The column list of every shipped definition, WRITTEN DOWN.
 *
 * ⭐ THE NON-MEASUREMENT ASSERTION. Widening `columnKeys` from "plots" to "plots
 * ∪ events" must move exactly one definition — `sar`, which is the one that
 * grew events — and nothing else. A frozen table is the only way to say that:
 * a check derived from `def.plots` plus `def.events` would be true by
 * construction and could never fail, which is the vacuous-gate shape this repo
 * has had to repair before.
 *
 * ⚠️ The brief for this task asked for "columnKeys unchanged for all 14, because
 * none declares events today". That was true when it was written and is false
 * the moment this task lands: `sar` declares two. Asserting "unchanged for 14"
 * would have been a red test on the very change it was guarding.
 */
const SHIPPED_COLUMNS = Object.freeze({
  rsi: ['rsi'],
  macd: ['macd', 'signal', 'histogram'],
  bb: ['upper', 'middle', 'lower'],
  vwap: ['vwap'],
  stoch: ['k', 'd'],
  atr: ['atr'],
  sar: ['sar', 'priceCrossedSar', 'trendFlipped'],
  ichimoku: ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'],
  mfi: ['mfi'],
  cci: ['cci'],
  williamsR: ['williams_r'],
  adx: ['adx', 'plusDI', 'minusDI'],
  obv: ['obv'],
  donchian: ['upper', 'middle', 'lower'],
  // ── Phase C Task 14. Neither declares an EVENT, which is the point of listing
  // them: the widening moved `sar` and nothing else, and two definitions added
  // afterwards still have plots-only column sets.
  avwap: ['avwap'],
  atrBands: ['upper', 'middle', 'lower'],
})

describe('columnKeys — plots ∪ events', () => {
  it('every shipped definition returns exactly the columns written down above', () => {
    const defs = listDefinitions()
    expect(defs.length, 'the registry changed size — re-read SHIPPED_COLUMNS').toBe(16)
    expect(Object.keys(SHIPPED_COLUMNS).sort()).toEqual(defs.map(d => d.id).sort())
    for (const def of defs) {
      expect(columnKeys(def), def.id).toEqual(SHIPPED_COLUMNS[def.id])
    }
  })

  it('THIRTEEN of the fourteen are the plot list alone — the union aliased nothing', () => {
    // If the union had collided with a plot key anywhere, that definition's
    // column list would be SHORT (a Set-like collapse) or DUPLICATED. Both show
    // up as an inequality here, and `defSchema.validateEvent` is what makes the
    // collision impossible in the first place.
    let withEvents = 0
    for (const def of listDefinitions()) {
      const plotsOnly = def.plots.filter(p => p.style !== 'hlines').map(p => p.key)
      const events = (def.events || []).map(e => e.key)
      if (events.length) withEvents += 1
      else expect(columnKeys(def), def.id).toEqual(plotsOnly)
      expect(new Set(columnKeys(def)).size, `${def.id}: a duplicate column key`)
        .toBe(columnKeys(def).length)
    }
    expect(withEvents, 'no definition declares events — this whole file is vacuous').toBe(1)
  })

  it('an event key and a plot key can never both exist — the namespace is one', () => {
    const d = probeDef()
    d.events = [{ key: 'rsi', label: 'collides' }]
    const res = registerDefinitions([d])
    expect(res.errors.join('\n')).toMatch(/one column namespace/)
  })
})

// ─── 4. SAR'S TWO EVENTS ─────────────────────────────────────────────────────

const BARS = (() => {
  const out = []
  for (let i = 0; i < 240; i++) {
    const mid = 100 + 6 * Math.sin(i / 5.5) + 2.5 * Math.sin(i / 1.7)
    out.push({ t: 1780272000 + i * 300, o: mid - 0.15, h: mid + 0.7, l: mid - 0.7, c: mid, v: 100000 + i })
  }
  return out
})()

describe('SAR is addressed by EVENT, because it cannot be addressed by level', () => {
  it('declares exactly priceCrossedSar and trendFlipped', () => {
    const def = getDefinition('sar')
    expect((def.events || []).map(e => e.key)).toEqual(['priceCrossedSar', 'trendFlipped'])
    for (const e of def.events) expect(typeof e.label).toBe('string')
  })

  it('computes both, in the domain, NaN only at bar 0', () => {
    const cols = computeFor(getDefinition('sar'), BARS, {})
    for (const key of ['priceCrossedSar', 'trendFlipped']) {
      const col = cols[key]
      expect(col.length, key).toBe(BARS.length)
      expect(Number.isNaN(col[0]), `${key}[0] must be the warmup pad`).toBe(true)
      for (let i = 0; i < col.length; i++) {
        expect(isEventColumnValue(col[i]), `${key}[${i}] = ${col[i]}`).toBe(true)
      }
      for (let i = 1; i < col.length; i++) {
        expect(Number.isNaN(col[i]), `${key}[${i}] is a hole after bar 0`).toBe(false)
      }
      // …and it is a real signal, not a constant. A column of all zeros is a
      // legal event column and pins nothing.
      const seen = new Set(Array.from(col.slice(1)))
      expect(seen, `${key} never fires on these bars`).toEqual(new Set([0, 1]))
      expect(hasAnyFinite(col)).toBe(true)
    }
  })

  it('bar 1 is 0 in both — computable, with no PRIOR to have moved away from', () => {
    // The one place the {0, 1, NaN} distinction is a judgement rather than an
    // arithmetic fact, so it is written down: bar 0 has no SAR at all (the trend
    // seed consumes it) and is the pad; bar 1 has a SAR and a trend but no prior
    // of either, and "nothing happened" is the honest answer.
    const cols = computeFor(getDefinition('sar'), BARS, {})
    expect(cols.priceCrossedSar[1]).toBe(0)
    expect(cols.trendFlipped[1]).toBe(0)
  })

  it('⭐ trendFlipped IS the isUptrend flag changing — derived, never re-derived', () => {
    // The value has always been there; only the NAME is new. Asserting it
    // against `computeParabolicSAR`'s own points is what makes "derived" a
    // measurement rather than a comment.
    const points = computeParabolicSAR(BARS, 0.02, 0.2)
    const cols = computeFor(getDefinition('sar'), BARS, {})
    for (let i = 2; i < BARS.length; i++) {
      const want = points[i].isUptrend === points[i - 1].isUptrend ? 0 : 1
      expect(cols.trendFlipped[i], `bar ${i}`).toBe(want)
    }
  })

  it('priceCrossedSar IS (close > sar) changing', () => {
    const points = computeParabolicSAR(BARS, 0.02, 0.2)
    const cols = computeFor(getDefinition('sar'), BARS, {})
    const above = (i) => BARS[i].c > points[i].value
    for (let i = 2; i < BARS.length; i++) {
      expect(cols.priceCrossedSar[i], `bar ${i}`).toBe(above(i) === above(i - 1) ? 0 : 1)
    }
  })

  it('a series too short for SAR yields all-NaN event columns, not zeros', () => {
    // `0` would be a lie: it says "computed, did not happen" about a bar where
    // nothing was computed at all.
    for (const n of [0, 1]) {
      const cols = computeFor(getDefinition('sar'), BARS.slice(0, n), {})
      for (const key of ['sar', 'priceCrossedSar', 'trendFlipped']) {
        expect(cols[key].length, `${key} @ ${n}`).toBe(n)
        expect(hasAnyFinite(cols[key]), `${key} @ ${n}`).toBe(false)
      }
    }
  })

  it('still does not leak isUptrend into any column', () => {
    const cols = computeFor(getDefinition('sar'), BARS, {})
    expect(JSON.stringify(Object.keys(cols))).not.toMatch(/isUptrend/)
    const raw = computeParabolicSAR(BARS, 0.02, 0.2)
    expect(raw.some(p => 'isUptrend' in p), 'it IS there upstream').toBe(true)
  })
})

// ─── 5. THE TWIN REFUSAL ─────────────────────────────────────────────────────

describe('the events are DERIVED from the SAR pass, never a second SAR loop', () => {
  it('⛔ computeParabolicSAREvents CALLS computeParabolicSAR', () => {
    // ⚠️ THIS IS A SOURCE PROBE ON PURPOSE, AND IT IS THE ONLY THING THAT CAN
    // KILL THE MUTATION IT GUARDS. An exact re-implementation of the SAR loop
    // inside this function is an EQUIVALENT MUTANT against every value
    // comparison in this file and in both golden lanes: the numbers would be
    // identical, and the second copy would drift the first time somebody edits
    // one of them. So the claim has to be structural.
    //
    // Comments are stripped first (`sourceScan.stripComments`) so a mention in
    // prose cannot satisfy it — the exact defeat a source probe suffered earlier
    // in this programme.
    const body = stripComments(computeParabolicSAREvents.toString())
    expect(body).toMatch(/computeParabolicSAR\(/)
    // …and the probe is not satisfied by its own name, which CONTAINS the
    // string it is looking for.
    const withoutOwnName = body.replace(/computeParabolicSAREvents/g, '_self_')
    expect(withoutOwnName).toMatch(/computeParabolicSAR\(/)
  })

  it('⛔ …and the stripper really does remove a mention in a comment', () => {
    // The control for the control. Without this, a `stripComments` that returned
    // its input unchanged would make the probe above pass on a body that only
    // TALKED about the call.
    const fake = 'function f() { /* computeParabolicSAR( */ return 1 // computeParabolicSAR(\n}'
    expect(stripComments(fake)).not.toMatch(/computeParabolicSAR\(/)
  })

  it('the two lanes name the events identically — one vocabulary, not two', () => {
    // `_CASE_COLUMNS["sar_events"]` in `api/services/indicator_compute.py` is the
    // other half. Read as TEXT rather than imported, because this is a vitest
    // process: what matters is that the Python source names the same two columns
    // in the same order, so a rename on either side is a red test and not a
    // silent divergence at rel-tol 1e-9.
    const py = readFileSync(join(HERE, '..', '..', '..', '..', '..', '..',
      'api', 'services', 'indicator_compute.py'), 'utf8')
    expect(py).toMatch(/"sar_events":\s*\("priceCrossedSar",\s*"trendFlipped"\)/)
    expect(getDefinition('sar').events.map(e => e.key)).toEqual(['priceCrossedSar', 'trendFlipped'])
  })
})
