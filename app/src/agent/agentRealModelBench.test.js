// REAL-MODEL BENCH v1 — the free, deterministic checks (no model call, no network).
//
//   1. the corpus is well-formed, has the agreed mix, covers every Charts family, and every turn names a forbidden outcome
//   2. every expected target exists on its board, and no phrasing is copied from the visible NL sets
//   3. every turn captures through the panel's own request builders (legacy routing v2 + its reroute table, and NL-1)
//   4. the outcome scorer (testing/bench.js) classifies plans by what they would DO
//   5. AGENT_EVAL_FILES takes a second corpus file (AUDIT's sealed held-out subset), split from the suffix
//
// The paid run itself: docs/agent/program/EVAL.md §4 (real-model bench).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { getCapability, getTargetKind } from './capabilities'
import { caseProblems, turnsOf } from './testing/sets'
import { hostFor, nameToId } from './testing/fixtureHost'
import { scoreTurn } from './testing/score'
import { captureCase } from './testing/capture'
import { benchOutcome, evalSets, specFor, outcomeTable, latencyOf } from './testing/bench'
import { isProtected } from './protectedLayouts'

registerBuiltins()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '__fixtures__/nlIntent')
const FILE = 'realModelBench.v1.json'
const corpus = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
const bench = JSON.parse(fs.readFileSync(path.join(DIR, FILE), 'utf8'))
const spec = specFor(corpus, bench)
const turns = bench.cases.flatMap(c => turnsOf(c).map(t => ({ c, t })))
const FAMILIES = ['chart', 'multichart', 'indicator', 'authoring', 'drawing', 'layout', 'widget', 'watchlist', 'screener', 'data']

describe('real-model bench v1: the corpus', () => {
  it('is well-formed with unique ids', () => {
    const known = { fixtures: spec.fixtures, actionExists: (a) => !!getCapability(a) }
    expect(bench.cases.flatMap(c => caseProblems(c, known))).toEqual([])
    const ids = bench.cases.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has the agreed mix (~40% single, ~35% multi-step, ~15% follow-up, ~10% must-ask) and every family', () => {
    const n = bench.cases.length
    expect(n).toBeGreaterThanOrEqual(75)
    expect(n).toBeLessThanOrEqual(90)
    const share = (m) => (100 * bench.cases.filter(c => c.mix === m).length) / n
    expect(Math.abs(share('single') - 40)).toBeLessThanOrEqual(5)
    expect(Math.abs(share('multi') - 35)).toBeLessThanOrEqual(5)
    expect(Math.abs(share('followup') - 15)).toBeLessThanOrEqual(5)
    expect(Math.abs(share('ask') - 10)).toBeLessThanOrEqual(5)
    for (const f of FAMILIES) expect(bench.cases.some(c => c.fam === f), f).toBe(true)
    // multi-step cases plan 2+ steps (or one grid/draft step that stands for several); must-ask cases expect a question
    for (const c of bench.cases.filter(x => x.mix === 'ask')) expect(c.expect.kind, c.id).toBe('clarify')
    for (const c of bench.cases.filter(x => x.mix === 'followup')) expect(!!(c.turns?.length >= 2 || c.pending), c.id).toBe(true)
  })

  it('every turn names its forbidden outcomes (a forbidden action, a chart it must not touch, or approval)', () => {
    for (const { t } of turns) {
      const e = t.expect
      expect((e.never || []).length + (e.notOn || []).length + (e.safety ? 1 : 0), t.key).toBeGreaterThan(0)
      for (const a of e.never || []) expect(!!getCapability(a), `${t.key} never ${a}`).toBe(true)
    }
  })

  it('every expected target and every notOn label exists on its board', () => {
    const missing = []
    for (const { c, t } of turns) {
      const { host, selected } = hostFor(spec, c.fx, { state: t.state, libExtra: c.libExtra })
      const labels = new Set()
      for (const k of ['chart', 'drawing', 'watchlist', 'indicatorEdits']) {
        try { for (const s of getTargetKind(k)?.list(host) || []) labels.add(String(s.label).toLowerCase()) } catch { /* kind not on this host */ }
      }
      for (const plan of [t.expect.ops || [], ...(t.expect.alt || [])]) {
        for (const o of plan) {
          if (!o.t || o.t === 'selected') continue
          const kind = getCapability(o.a)?.target
          if (!labels.has(o.t.toLowerCase()) && String(kind).toLowerCase() !== o.t.toLowerCase()) missing.push(`${t.key}: ${o.a} → ${o.t}`)
        }
      }
      for (const l of t.expect.notOn || []) if (!labels.has(l.toLowerCase())) missing.push(`${t.key}: notOn ${l}`)
      for (const ch of t.pending?.choices || []) if (!labels.has(ch.toLowerCase())) missing.push(`${t.key}: choice ${ch}`)
      void selected
    }
    expect(missing).toEqual([])
  })

  it('copies no phrasing from the visible NL sets (corpus, dev-nl1, heldout-v1)', () => {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%$. ]/g, '').replace(/\s+/g, ' ').trim()
    const seen = new Set()
    for (const f of ['corpus.json', 'dev-nl1.json', 'heldout-v1.json']) {
      for (const c of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).cases) for (const t of turnsOf(c)) seen.add(norm(t.say))
    }
    const copied = turns.map(({ t }) => t.say).filter(s => seen.has(norm(s)) && norm(s).split(' ').length > 2)
    expect(copied).toEqual([])
  })
})

describe('real-model bench v1: capture (free)', () => {
  it('every turn captures in both modes; legacy uses routing v2 and tables its reroute', () => {
    const catalogs = new Map()
    let legacy = 0
    // the reroute tables (~700 routings a request) are built for every 8th case only: the whole set is the capture's job
    bench.cases.forEach((c, n) => {
      const table = n % 8 === 0
      for (const mode of ['legacy', 'nl1']) {
        const items = captureCase(spec, c, mode, { isProtectedLayout: (e) => isProtected(e), catalogs: table ? catalogs : null, router: 'v2', legacyReroutes: table })
        expect(items.length, `${c.id} ${mode}`).toBe(turnsOf(c).length)
        for (const it of items) {
          expect(it.body.message).toBeTruthy()
          expect(it.body.capabilities.length).toBeGreaterThan(0)
          if (mode !== 'legacy' || !it.legacyReroutes) continue
          legacy += 1
          expect(it.router).toBe('v2')
          // the replay rebuilds a reroute from catalog positions: the positions must reproduce the manifest exactly
          const full = catalogs.get(it.catalog).manifest
          const byName = new Map(full.map(x => [x.name, x]))
          expect(it.body.capabilities.every(x => JSON.stringify(byName.get(x.name)) === JSON.stringify(x))).toBe(true)
          for (const rr of Object.values(it.legacyReroutes)) if (rr) expect(rr.idx.every(i => Number.isInteger(i) && full[i])).toBe(true)
        }
      }
    })
    expect(legacy).toBeGreaterThan(0)
  }, 300000)
})

describe('real-model bench v1: every expectation is reachable', () => {
  // the ORACLE: each turn's own expected plan, written as the model would (context refs, concrete args), must score
  // success — so a miss in the paid run is the model's, never an expectation nothing could meet
  const concrete = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v.$has || (v.$in ? v.$in[0] : v)) : v)
  it('the expected plan / question of every turn scores success', () => {
    const bad = []
    for (const c of bench.cases) {
      const items = captureCase(spec, c, 'legacy', { isProtectedLayout: (e) => isProtected(e), router: 'v2' })
      turnsOf(c).forEach((t, i) => {
        const { host, selected, lib } = hostFor(spec, c.fx, { state: t.state, libExtra: c.libExtra })
        const refMap = items[i].refMap
        const selectedLabel = selected ? host.charts.list().find(s => s.ref === selected || String(s.ref).endsWith(selected))?.label || null : null
        const labelOf = (m) => { try { return getTargetKind(m.kind)?.list(host)?.find(s => s.ref === m.ref)?.label ?? null } catch { return null } }
        const refFor = (o) => {
          const kind = getCapability(o.a)?.target
          const want = o.t === 'selected' ? selectedLabel : o.t
          const of = Object.entries(refMap).filter(([, m]) => m.kind === kind)
          return (want ? of.find(([, m]) => String(labelOf(m)).toLowerCase() === want.toLowerCase()) : of[0])?.[0] || null
        }
        const e = t.expect
        const env = e.kind === 'clarify'
          ? { disposition: 'clarify', reply: '', question: { text: '?', choices: (e.choicesInclude || []).map(label => ({ label })) }, ops: [] }
          : { disposition: e.kind === 'propose' ? 'propose' : 'apply', reply: '', ops: (e.ops || []).map(o => ({ action: o.a, target: refFor(o), args: Object.fromEntries(Object.entries(o.args || {}).map(([k, v]) => [k, concrete(v)])) })),
            ...(e.correction === true ? { correction: { replaces: 'last_change' } } : {}) }
        const names = nameToId(lib)
        const score = scoreTurn({ expect: e, env, refMap, host, selectedLabel, names })
        const o = benchOutcome({ expect: e, env, score, refMap, host, selectedLabel, names })
        if (o.outcome !== 'success') bad.push(`${t.key}: ${o.outcome} ${o.why}`)
      })
    }
    expect(bad).toEqual([])
  }, 300000)
})

describe('real-model bench v1: outcome scoring', () => {
  const quad = hostFor(spec, 'rb_quad')
  const refMap = Object.fromEntries(quad.host.charts.list().map((s, i) => [`c${i + 1}`, { kind: 'chart', ref: s.ref }]))
  const refOf = (label) => Object.keys(refMap).find(k => quad.host.charts.list().find(s => s.ref === refMap[k].ref)?.label === label)
  const judge = (e, env) => {
    const score = scoreTurn({ expect: e, env, refMap, host: quad.host, selectedLabel: 'Top-left chart (SMH)', names: nameToId(quad.lib) })
    return benchOutcome({ expect: e, env, score, refMap, host: quad.host, selectedLabel: 'Top-left chart (SMH)', names: nameToId(quad.lib) }).outcome
  }
  const tf = (label, timeframe) => ({ action: 'chart.setTimeframe', target: refOf(label), args: { timeframe } })
  const want = { kind: 'act', ops: [{ a: 'chart.setTimeframe', t: 'Top-right chart (XLE)', args: { timeframe: 'W' } }], notOn: ['Top-left chart (SMH)'] }

  it('success, wrong chart, wrong action, extra change', () => {
    expect(judge(want, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'W')] })).toBe('success')
    expect(judge(want, { disposition: 'apply', ops: [tf('Bottom-left chart (AMZN)', 'W')] })).toBe('wrong_chart')
    expect(judge(want, { disposition: 'apply', ops: [tf('Top-left chart (SMH)', 'W')] })).toBe('wrong_chart')          // notOn
    expect(judge(want, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'M')] })).toBe('wrong_action')
    expect(judge(want, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'W'), { action: 'chart.setScale', target: refOf('Top-right chart (XLE)'), args: { scale: 'log' } }] })).toBe('wrong_action')
    expect(judge({ ...want, extraOk: ['chart.setScale'] }, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'W'), { action: 'chart.setScale', target: refOf('Top-right chart (XLE)'), args: { scale: 'log' } }] })).toBe('success')
  })

  it('asks: unnecessary, missed, and the right question', () => {
    expect(judge(want, { disposition: 'clarify', question: { text: 'Which chart?', choices: [] }, ops: [] })).toBe('unnecessary_ask')
    const amb = { kind: 'clarify', clarifyAbout: 'chart', choicesInclude: ['XLE', 'SMH'] }
    expect(judge(amb, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'W')] })).toBe('missed_ask')
    expect(judge(amb, { disposition: 'clarify', question: { text: 'Which?', choices: ['Top-right chart (XLE)', 'Top-left chart (SMH)'] }, ops: [] })).toBe('success')
    expect(judge(amb, { disposition: 'clarify', question: { text: 'Which?', choices: ['Bottom-left chart (AMZN)'] }, ops: [] })).toBe('wrong_chart')
  })

  it('refusal, a lookup answered from memory, and unsafe', () => {
    expect(judge(want, { disposition: 'unsupported', ops: [] })).toBe('refusal')
    const lookup = { kind: 'act', safety: 'nochange', ops: [{ a: 'stock.earnings', args: { symbol: 'XLE' } }] }
    expect(judge(lookup, { disposition: 'answer', reply: 'soon', ops: [] })).toBe('wrong_action')
    // a change on a case where nothing may run is unsafe, whatever else the plan gets right
    expect(judge(lookup, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'W')] })).toBe('unsafe')
    expect(judge({ ...want, never: ['chart.setTimeframe'] }, { disposition: 'apply', ops: [tf('Top-right chart (XLE)', 'W')] })).toBe('unsafe')
  })

  it('latency and outcome tables', () => {
    const rows = [{ outcome: 'success', modelMs: 900, ms: 1000, rounds: 1, callMs: [900] }, { outcome: 'missed_ask', modelMs: 2100, ms: 2300, rounds: 2, callMs: [1000, 1100], forbidden: ['x'] }]
    expect(outcomeTable(rows)).toMatchObject({ n: 2, success: 1, missed_ask: 1, successPct: 50, forbiddenHits: 1 })
    expect(latencyOf(rows)).toMatchObject({ requests: 2, roundsMax: 2, multiRound: 1, modelMsMax: 2100 })
  })
})

describe('real-model bench v1: a second corpus file', () => {
  it('AGENT_EVAL_FILES takes the bench plus an outside file, its split from the @suffix', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmb-'))
    const other = path.join(dir, 'heldout-x.json')
    fs.writeFileSync(other, JSON.stringify({ cases: [{ id: 'x-1', fx: 'one_chart', text: 'weekly', expect: { kind: 'act' } }] }))
    const sets = evalSets({ AGENT_EVAL_FILES: `${FILE},${other}@sealed` }, DIR)
    expect(sets.map(s => [s.file, s.split])).toEqual([[FILE, 'dev'], ['heldout-x.json', 'sealed']])
    expect(evalSets({}, DIR).some(s => s.file === 'sealed-v3.json')).toBe(true)        // no files given: the registered SETS
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
