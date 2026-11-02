// SC-2 §7/§8 (owner: agent-sc) — the deterministic intent layer, MEASURED on both scan corpora, plus its safety rails.
//
// Expected answers are the Screener grammar's own reading of each corpus (api/services/uct_agent/scan/eval/
// expected_leaves.json, generated in Python by grammar.compile_text), never a second parser. The measurement is pinned in
// api/services/uct_agent/scan/eval/intent-measure.json: it changes only with UPDATE_SCAN_INTENT=1, so a rule change can
// never move the number unreviewed. ⛔ FALSE RESOLVES (a spec that differs from the expectation, or a spec where the
// corpus expects ask / planner / refuse) must be zero, except the ones listed in KNOWN_CONFLICTS with a reason.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { intent, argsToLeaves } from './capabilities/scanIntent'

const REPO = path.resolve(__dirname, '../../..')
const EVAL = path.join(REPO, 'api/services/uct_agent/scan/eval')
const EXP = JSON.parse(fs.readFileSync(path.join(EVAL, 'expected_leaves.json'), 'utf8'))
const META = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/agent/__fixtures__/program/scores/screener-fields.json'), 'utf8'))
const FIELDS = new Set(META.fields.map(f => f.key))
const OUT = path.join(EVAL, 'intent-measure.json')
//: corpus expectations that contradict a written rule; the intent layer follows the rule, and the conflict is reported
const KNOWN_CONFLICTS = {
  d08: 'discovery d08 expects dollar_vol_30d for "over $50M a day"; the screener.run hint and SC-2 §4 say a daily figure is dollar_vol_1d (latest session). Raised with agent-lead / agent-qa.',
}

// ── scoring (the semantics of agent-qa's scorer: one-to-one leaves, bounds within tolerance, no extras) ──
const bounds = (leaves) => leaves.flatMap((l) => {
  if (l.op === 'gt' || l.op === 'gte') return [['lo', l.key, Number(l.min)]]
  if (l.op === 'lt' || l.op === 'lte') return [['hi', l.key, Number(l.max)]]
  if (l.op === 'between') return [['lo', l.key, Number(l.min)], ['hi', l.key, Number(l.max)]]
  if (l.op === 'eq') return [['eq', l.key, Number(l.value)]]
  return [[l.op, l.key, JSON.stringify([...(l.values || [])].map(String).sort())]]
})
const within = (tol, want, got) => (!tol ? want === got : 'abs' in tol ? Math.abs(got - want) <= tol.abs : 'pct' in tol ? Math.abs(got - want) <= Math.abs(want) * tol.pct / 100 : want === got)
function sameSpec(want, gotLeaves, gotSort, { tolerance = {}, checkSort = true } = {}) {
  const w = bounds(want.leaves), g = bounds(gotLeaves)
  const free = [...g]
  for (const x of w) {
    const i = free.findIndex(y => y[0] === x[0] && y[1] === x[1] && ((x[0] === 'lo' || x[0] === 'hi') ? within(tolerance[x[1]], x[2], y[2]) : x[2] === y[2]))
    if (i < 0) return false
    free.splice(i, 1)
  }
  if (free.length) return false
  if (!checkSort) return true
  const ws = want.sort || null
  return JSON.stringify(ws) === JSON.stringify(gotSort || null)
}
function grade(want, got, opts) {
  if (got.kind === 'spec') {
    if (want.kind !== 'spec') return 'false_resolve'
    const sort = got.args.sort_field ? { key: got.args.sort_field, dir: got.args.sort_dir } : null
    return sameSpec(want, argsToLeaves(got.args), sort, opts) ? 'pass' : 'false_resolve'
  }
  if (got.kind === want.kind) return 'pass'
  if (got.kind === 'refuse') return 'wrong_refusal'
  return 'safe_miss'                                   // ask / planner where a spec (or another exit) was expected
}

function measure() {
  const rows = {}
  for (const [id, want] of Object.entries(EXP.discovery)) {
    const got = intent(want.text, { fields: FIELDS })
    rows[`discovery.${id}`] = { got: got.kind, grade: grade(want, got, { tolerance: want.tolerance || {}, checkSort: false }) }
  }
  for (const [id, want] of Object.entries(EXP.sc2)) {
    const got = intent(want.text, { fields: FIELDS })
    rows[`sc2.${id}`] = { got: got.kind, grade: grade(want, got) }
  }
  for (const chain of EXP.sc2_chains) {
    let last = null
    chain.steps.forEach((step, n) => {
      const got = intent(step.text, { fields: FIELDS, last })
      rows[`sc2.${chain.id}.${n + 1}`] = { got: got.kind, grade: grade(step, got) }
      // the chain continues from the EXPECTED state, so one miss is scored once, never cascaded
      if (step.kind === 'spec') last = expectedArgs(step)
    })
  }
  const total = (pfx) => {
    const r = Object.entries(rows).filter(([k]) => k.startsWith(pfx)).map(([, v]) => v.grade)
    const c = (g) => r.filter(x => x === g).length
    return { items: r.length, pass: c('pass'), safe_miss: c('safe_miss'), false_resolve: c('false_resolve'), wrong_refusal: c('wrong_refusal') }
  }
  return { about: 'measured by app/src/agent/agentScanIntent.test.js (UPDATE_SCAN_INTENT=1 rewrites); deterministic, no model',
    discovery: total('discovery.'), sc2: total('sc2.'), rows }
}
function expectedArgs(step) {
  const filters = step.leaves.map(l => (l.op === 'in' || l.op === 'not_in') ? { field: l.key, op: l.op, value: null, max: null, values: l.values }
    : { field: l.key, op: l.op, value: l.min ?? l.max ?? l.value, max: null, values: null })
  return { filters, sort_field: step.sort?.key || null, sort_dir: step.sort?.dir || null, mode: 'new', show: null, as: null, within: null }
}

describe('scanIntent: measured on the discovery and SC-2 corpora', () => {
  const m = measure()

  it('the measurement is current (UPDATE_SCAN_INTENT=1 rewrites it)', () => {
    const text = JSON.stringify(m, null, 1) + '\n'
    if (process.env.UPDATE_SCAN_INTENT === '1') { fs.writeFileSync(OUT, text); return }
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : ''
    expect(have).toBe(text)
  })

  it('⛔ ZERO false resolves outside the listed corpus conflicts, and no wrong refusals', () => {
    const bad = Object.entries(m.rows).filter(([, v]) => v.grade === 'false_resolve' || v.grade === 'wrong_refusal').map(([k]) => k.split('.').slice(1).join('.'))
    expect(bad.filter(id => !KNOWN_CONFLICTS[id])).toEqual([])
  })

  it('every listed conflict is still real (an item that now passes must leave the list)', () => {
    for (const id of Object.keys(KNOWN_CONFLICTS)) {
      expect(['false_resolve']).toContain((m.rows[`discovery.${id}`] || m.rows[`sc2.${id}`]).grade)
    }
  })
})

describe('scanIntent: safety rails', () => {
  it('one unknown word sends the message to the planner, never a partial screen', () => {
    expect(intent('liquid semis that look ready to break out', { fields: FIELDS }).kind).toBe('planner')
    expect(intent('movers with real range, ADR 4 to 8 percent', { fields: FIELDS }).kind).toBe('planner')
  })
  it('a field the catalog does not hold is never applied', () => {
    const noStage = new Set([...FIELDS].filter(k => k !== 'stage2'))
    expect(intent('stage 2 software names', { fields: noStage }).kind).toBe('planner')
    expect(intent('stage 2 software names', { fields: FIELDS }).kind).toBe('spec')
  })
  it('SC-1 §2c: a time word reads rvol_live (sorted); none reads vol_ratio; never one for the other', () => {
    const now = intent('semis with volume picking up today', { fields: FIELDS })
    expect(argsToLeaves(now.args)).toContainEqual({ key: 'rvol_live', op: 'gte', min: 1.5 })
    expect(now.args.sort_field).toBe('rvol_live')
    const full = intent('semis with volume picking up', { fields: FIELDS })
    expect(argsToLeaves(full.args)).toContainEqual({ key: 'vol_ratio', op: 'gte', min: 1.5 })
    expect(JSON.stringify(full.args)).not.toContain('rvol_live')
    expect(intent('stocks with volume up', { fields: FIELDS }).kind).toBe('ask')
  })
  it('refusals: indicator conditions, a measure the Screener lacks, flow fields (SC-2 §6)', () => {
    expect(intent('EMA 9 crossing above EMA 20').reason).toBe('indicator-condition scans')
    expect(intent('put/call ratio above 1.5').reason).toBe('the Screener has no field')
    expect(intent('dark pool prints over $10M').reason).toBe('flow fields need owner approval')
  })
  it('a follow-up with no last screen is asked about, never guessed', () => {
    for (const t of ['only the ones near highs', 'sort by relative volume', 'now just tech', 'forget the RS filter']) {
      expect(intent(t, { fields: FIELDS }).kind).toBe('ask')
    }
  })
  it('a follow-up refines the last screen by key (refine semantics), and remove of an absent filter is a local sentence', () => {
    const last = intent('stocks with RS rank above 80', { fields: FIELDS }).args
    const r = intent('make that 90', { fields: FIELDS, last })
    expect(argsToLeaves(r.args)).toEqual([{ key: 'rs_rank', op: 'gt', min: 90 }])
    const a = intent('without the price limit', { fields: FIELDS, last })
    expect(a.kind).toBe('ask')
    expect(a.question).toMatch(/no price filter/)
  })
  it('units: $ amounts become dollars, never the bare number', () => {
    expect(argsToLeaves(intent('names trading over $100M a day', { fields: FIELDS }).args)).toEqual([{ key: 'dollar_vol_1d', op: 'gt', min: 100000000 }])
    expect(argsToLeaves(intent('small caps under $2B', { fields: FIELDS }).args)).toEqual([{ key: 'market_cap', op: 'lt', max: 2000000000 }])
  })
})
