// app/src/components/chart/engine/runtime/__tests__/requestTimeframeReader.test.js
//
// ─── ⭐⭐ (request unit, TF-FOLD, engine 89) — THE RUNTIME LANE READS A REQUEST'S TIMEFRAME THE SCRIPT SETTLES ───
//
// A `request.security` timeframe the script settles before its first bar through a constant chain deeper than the
// plot lane's 4 hops was refused on the runtime lane (`pine:request`): cppivot-boss-floor-pivots'
// `floor_pivot_resolution = tf == "1H" ? '60' : tf == "2H" ? '120' : tf == "4H" ? '240' : tf`, six hops over an input's
// default. The runtime lane's request reader now follows `TF_READ_HOPS` (16) names and ternary arms, the object pass's
// reach (C10). A chain that settles IS the literal it settles to, so each rail compares the folded request with the same
// request WRITTEN with that literal (derived, never restated), on the runtime lane's own run.
// ⛔ The reach is the runtime lane's alone (`pine.js::requestTimeframeReach`): the plot lane keeps its 4 hops (C10: a plot
// that newly translates mints its parameters in a new order), held below by the plot lane's own refusal and by every
// request-reading corpus script's plot-lane translation, byte for byte, with the reach and without it.

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { computeRuntimeColumns, probeRuntimeProgram, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { translatePine, Resolver } from '../../ast/pine.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../../../..')
const LF = String.fromCharCode(10)

/** Weekday ISO dates from `from` (a Monday), `n` sessions: several weeks and months. */
function weekdays(n, from = '2026-01-05') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const CHART = weekdays(70).map((t, i) => {
  const c = 100 + i + (i % 3) * 0.5 - (i % 7) * 0.25
  return { t, o: c - 0.25, h: c + 1 + (i % 4) * 0.1, l: c - 1 - (i % 5) * 0.1, c, v: 1000 + i }
})
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const docOf = (source, outputs = { a: 0 }) => ({
  id: 'tf-fold', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:tf-fold', outputs, source },
})
const run = (source, outputs) => {
  resetRuntimeSessions()
  const out = computeRuntimeColumns(docOf(source, outputs), CHART, ctx)
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.from(v)]))
}
/** The plot lane's own answer (the host translator, as the member door asks it). */
const plotLane = (source) => translatePine(source, { strict: true, paramManifest: true })
const refusedGuards = (t) => (t.refusals || []).map((r) => r.guard)

// ── the cppivot shape: a six-hop chain over an input's default ─────────────────────────────────────
const chainSource = (def, tfExpr = 'res') => [
  '//@version=4',
  'study("tf chain", overlay=true)',
  `tfi = input("${def}", options=["1H", "2H", "4H", "D", "W", "M"])`,
  'res = tfi == "1H" ? \'60\' : tfi == "2H" ? \'120\' : tfi == "4H" ? \'240\' : tfi',
  `x = security(syminfo.tickerid, ${tfExpr}, close[1], barmerge.gaps_off, barmerge.lookahead_on)`,
  'plot(x)',
].join(LF)

describe('TF-FOLD: a timeframe settled through a chain deeper than the plot lane reads (cppivot)', () => {
  it('at the default "D" on a daily chart the request is the identity: the chain reads what `\'D\'` written out reads', () => {
    const folded = run(chainSource('D'))
    const literal = run(chainSource('D', "'D'"))
    expect(folded.a).toEqual(literal.a)
    expect(Number.isNaN(folded.a[0])).toBe(true)
    for (let i = 1; i < CHART.length; i += 1) expect(folded.a[i]).toBe(CHART[i - 1].c)
  })
  it('at "W" it is the weekly look-ahead read, exactly as `\'W\'` written out (and not the daily one)', () => {
    const folded = run(chainSource('W'))
    const literal = run(chainSource('W', "'W'"))
    expect(folded.a).toEqual(literal.a)
    expect(folded.a).not.toEqual(run(chainSource('D')).a)
    const p = probeRuntimeProgram(chainSource('W'))
    expect(p.ok, JSON.stringify(p.refusal)).toBe(true)
  })
  it('⛔ the plot lane keeps its reach: the same script still refuses there, by its own name', () => {
    expect(refusedGuards(plotLane(chainSource('D')))).toContain('pine:request')
    // control: the literal translates on the plot lane, so the refusal above is the chain's, not the request's
    expect(refusedGuards(plotLane(chainSource('D', "'D'")))).not.toContain('pine:request')
  })
  it('⛔ CONTROL: a chain past the bound is still refused (a binding cycle stays a refusal, never a hang)', () => {
    const deep = ['//@version=4', 'study("deep", overlay=true)', 'r0 = "W"']
    for (let k = 1; k <= 20; k += 1) deep.push(`r${k} = r${k - 1}`)
    deep.push('x = security(syminfo.tickerid, r20, close[1], barmerge.gaps_off, barmerge.lookahead_on)', 'plot(x)')
    const p = probeRuntimeProgram(deep.join(LF))
    expect(p.ok).toBe(false)
  })
})

// ── the confinement, over the corpus: every committed script that reads `security(`, translated on the plot lane
// with the runtime lane's reach handed to every reader and without it. They must be the same bytes. ──────────────
const CORPUS = path.join(REPO, 'corpus', 'committed')
const requestScripts = () => fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  .map((f) => ({ f, source: fs.readFileSync(path.join(CORPUS, f), 'utf8') }))
  .filter((s) => /\bsecurity\s*\(/.test(s.source))
const digest = (source) => {
  let t
  try { t = translatePine(source, { strict: true, paramManifest: true }) } catch (err) { return `threw:${String(err && err.message)}` }
  const view = { outputs: t.outputs, refusals: t.refusals, notes: t.notes, objects: t.objects, params: t.paramManifest }
  return createHash('sha256').update(JSON.stringify(view, (k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex')
}

describe('⛔ TF-FOLD is the runtime lane\'s alone: the plot lane is byte-identical over the corpus', () => {
  it('every request-reading committed script translates to the same plot lane whether the reach exists or not', () => {
    const scripts = requestScripts()
    expect(scripts.length).toBeGreaterThan(40)
    const withReach = scripts.map((s) => digest(s.source))
    const orig = Resolver.prototype.requestTimeframeReach
    Resolver.prototype.requestTimeframeReach = function () { return undefined }
    let without
    try { without = scripts.map((s) => digest(s.source)) } finally { Resolver.prototype.requestTimeframeReach = orig }
    const moved = scripts.filter((s, i) => withReach[i] !== without[i]).map((s) => s.f)
    expect(moved, `plot-lane translation moved for ${moved.join(', ')}`).toEqual([])
  }, 600000)
  it('the control CAN fail: the reach handed to the plot lane moves the cppivot chain\'s translation', () => {
    const src = chainSource('D')
    const before = digest(src)
    const orig = Resolver.prototype.requestTimeframeReach
    Resolver.prototype.requestTimeframeReach = function () { return Object.freeze({ hops: 16 }) }
    let after
    try { after = digest(src) } finally { Resolver.prototype.requestTimeframeReach = orig }
    expect(after).not.toBe(before)
  })
})
