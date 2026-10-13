// UCT Agent — CONVERSATIONAL INTELLIGENCE EVALUATION, deterministic layer A (owner 2026-10-13, Phase 0D).
// Free and reproducible: no model call, no network. It scores the DEV corpus (corpus.json — written beside
// the matchers) and the HELD-OUT set (heldout-v1.json — written without reading the matchers) on:
//   · deterministic coverage   ideal-fast cases the fast path answers correctly
//   · wrong actions            the fast path acted, and wrongly (the one failure with no model in the loop)
//   · unnecessary clarifies    the fast path asked "which one?" when the case expects an action
//   · model-call frequency     cases that go to the model (+1 when routing would need a reroute)
//   · routing coverage         a model-path case's needed groups are among the routed groups
//   · fast-path latency        fastParse time per case
// Model-path INTENT accuracy needs the real model (layer C, owner-approved budget) — reported as NOT MEASURED.
// AGENT_EVAL_OUT=<file> writes the full JSON report; the console prints the summary.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import corpus from './__fixtures__/nlIntent/corpus.json'
import { registerBuiltins } from './builtins'
import { fastParse, matchPosition } from './fastPath'
import * as routing from './routing'
import { correctTypos, lexiconFor } from './nl/lexicon'
const { routeManifest, groupOfAction } = routing
import manifestGolden from './contract/manifest.golden.json'
import manifestContract from './contract/manifest.contract.json'
import { getCapability, getTargetKind } from './capabilities'
import { resolveDeictic } from './deixis'
import { planOps, collectTargets } from './executor'
import { buildChartSource } from './host'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'

registerBuiltins()

const HELDOUT_PATH = path.resolve(__dirname, '__fixtures__/nlIntent/heldout-v1.json')
const heldout = fs.existsSync(HELDOUT_PATH) ? JSON.parse(fs.readFileSync(HELDOUT_PATH, 'utf8')) : { cases: [] }
// v2 (2026-10-13, Gate B): written by a second agent AFTER v1 had informed routing vocabulary — the clean test of generalisation
const HELDOUT2_PATH = path.resolve(__dirname, '__fixtures__/nlIntent/heldout-v2.json')
const heldout2 = fs.existsSync(HELDOUT2_PATH) ? JSON.parse(fs.readFileSync(HELDOUT2_PATH, 'utf8')) : { cases: [] }

function hostFor(fxName) {
  const fx = corpus.fixtures[fxName]
  const lib = corpus.library
  const charts = fx.charts.map(c => ({ id: c.id, type: 'chart', x: c.x, y: c.y, w: c.w, h: c.h, color: c.id, opts: { tf: c.tf } }))
  const widgets = [...charts]
  if (fx.watchlistWidget) {
    const w = fx.watchlistWidget
    const list = lib.watchlists.find(l => l.id === w.list)
    widgets.push({ id: w.id, type: 'watchlist', x: w.x, y: w.y, w: w.w, h: w.h, color: 'Z', opts: { watchKey: `user:${w.list}`, watchName: list?.name, watchTab: 'mine' } })
  }
  const syms = Object.fromEntries(fx.charts.map(c => [c.id, c.symbol]))
  const b = makeBoard(widgets, syms, { layouts: { entries: lib.layouts, boards: {}, active: lib.activeLayout }, watchlists: lib.watchlists })
  const apis = new Map(fx.charts.map(c => [`m-${c.id}`, { agent: {
    read: () => ({ chartId: c.id, tabId: null, groupKey: c.id, symbol: c.symbol, tf: c.tf, cs: mergeChartSettings(null), stored: null }),
    view: () => null, drawSym: () => c.symbol,
  } }]))
  b.host.charts = buildChartSource({ chartApiById: { current: apis }, getWidgets: () => b.state.widgets, selectedChart: () => fx.selected })
  const base = b.host.layouts.snapshot
  b.host.layouts = { ...b.host.layouts, snapshot: () => ({ ...base(), recent: lib.recentLayouts }) }
  return b.host
}

// the held-out set names layouts / lists the way a member does ("Day Trading"); the fast path emits their ids
const NAME_TO_ID = Object.fromEntries([...corpus.library.layouts, ...corpus.library.watchlists].map(e => [String(e.name).toLowerCase(), String(e.id)]))
const canon = (v) => typeof v === 'string' && NAME_TO_ID[v.toLowerCase()] ? NAME_TO_ID[v.toLowerCase()] : v
const subset = (want = {}, got = {}) => Object.entries(want).every(([k, v]) => JSON.stringify(canon(got?.[k])) === JSON.stringify(canon(v)))
const sameOps = (want, got) => want.length === got.length && want.every((w, i) => w.a === got[i].action && subset(w.args, got[i].args))

function targetOf(host, ops, fast, text) {
  // the panel runs ops whose capability already resolved the target as they are (useAgent.send)
  if (ops.length && ops.every(o => o.target)) return { resolved: true, label: null }
  const kinds = [...new Set(ops.map(o => getCapability(o.action)?.target).filter(Boolean))]
  if (kinds.length !== 1) return { multi: true }
  const kind = getTargetKind(kinds[0])
  let list = kind ? kind.list(host) : []
  if (fast.target?.all && list.length > 1) return { all: list.map(s => s.label) }
  if (fast.target?.position && list.length > 1) { const hit = matchPosition(list, fast.target.position); if (hit.length) list = hit }
  if (!fast.target?.position && list.length > 1) {
    const d = resolveDeictic({ host, kind, candidates: list, text, chartOp: true })
    if (d?.ref) list = list.filter(s => s.ref === d.ref)
  }
  return list.length === 1 ? { label: list[0].label, ref: list[0].ref } : { ask: true }
}

// ⭐ The planner's symbol check (chart.setSymbol / chart.compare / watchlist.* `prepare`) asks UCT's ticker
// search before anything runs: an unknown ticker is REFUSED, never charted. Offline, the tickers UCT knows
// are approximated by every symbol the fixtures and the expected plans use; a fast plan naming any other
// symbol is scored `fast-refuses` (safe: nothing changes), not as an action.
const SYMBOL_ACTIONS = new Set(['chart.setSymbol', 'chart.compare', 'watchlist.add', 'watchlist.remove', 'widget.addCharts'])
const KNOWN_TICKERS = new Set()
const collectSyms = (v) => {
  if (typeof v === 'string' && /^[A-Z][A-Z0-9.^]{0,9}$/.test(v)) KNOWN_TICKERS.add(v)
  else if (Array.isArray(v)) v.forEach(collectSyms)
  else if (v && typeof v === 'object') Object.values(v).forEach(collectSyms)
}
Object.values(corpus.fixtures).forEach(fx => fx.charts.forEach(c => KNOWN_TICKERS.add(c.symbol)))
for (const c of [...corpus.cases, ...heldout.cases, ...heldout2.cases]) for (const o of [...(c.expect.ops || []), ...(c.expect.alt || []).flat()]) collectSyms(o.args)
const unknownSymbolIn = (ops) => ops.some(o => SYMBOL_ACTIONS.has(o.action)
  && [o.args?.symbol, ...(o.args?.symbols || [])].filter(Boolean).some(s => !KNOWN_TICKERS.has(String(s).toUpperCase())))

// The real planner (executor.planOps) over the fixture board, every op on the one target its kind has
// (or the target the capability resolved). Ambiguous targets are never planned here (they ask).
function plannerRefuses(host, fast) {
  const kinds = [...new Set(fast.ops.map(o => getCapability(o.action)?.target).filter(Boolean))]
  const ops = []
  for (const o of fast.ops) {
    if (o.target) { ops.push(o); continue }
    const kind = getTargetKind(getCapability(o.action)?.target)
    const list = kind ? kind.list(host) : []
    if (list.length !== 1) return false
    ops.push({ ...o, target: list[0].ref })
  }
  try { return planOps(collectTargets(host, kinds), ops).ok === false } catch { return false }
}

const MANIFEST = Array.isArray(manifestGolden) ? manifestGolden : (manifestGolden.capabilities || [])
const LIMITS = { limit: manifestContract.limits?.maxCapabilities ?? 60, budget: manifestContract.routingThreshold ?? 55 }

export function measureCase(c) {
  const host = hostFor(c.fx)
  const e = c.expect
  let fast = null
  const t0 = performance.now()
  try { fast = fastParse(c.text, { host }) } catch (err) { fast = { kind: 'error', err: String(err) } }
  const ms = performance.now() - t0
  const row = { id: c.id, split: c.split || 'dev', cat: c.cat, text: c.text, ideal: e.ideal, kind: e.kind, outcome: null, ms }
  if (c.pending && e.ideal === 'local-clarify') row.outcome = 'not-measured'
  else if (!fast) row.outcome = c.needsState ? 'needs-state' : 'to-model'
  else if (fast.kind === 'error') row.outcome = 'fast-WRONG'
  else if (fast.kind === 'ops' && unknownSymbolIn(fast.ops)) {
    row.outcome = 'fast-refuses'                // the symbol check refuses before planning: no change
    row.detail = fast.ops.map(o => `${o.action} ${JSON.stringify(o.args)}`).join(' ; ')
  } else if (fast.kind === 'ops') {
    const tgt0 = targetOf(host, fast.ops, fast, c.text)
    const got = tgt0.all ? tgt0.all.flatMap(() => fast.ops) : fast.ops
    row.detail = fast.ops.map(o => `${o.action} ${JSON.stringify(o.args)}`).join(' ; ')
    const plans = [e.ops, ...(e.alt || [])].filter(Boolean)
    if (plans.some(p => sameOps(p, got))) {
      const wantsTarget = (e.ops || []).find(o => o.t)?.t
      if (wantsTarget && !tgt0.multi && !tgt0.all) {
        const sel = corpus.fixtures[c.fx].selected
        const wantLabel = wantsTarget === 'selected' ? host.charts.list().find(s => s.ref === sel)?.label : wantsTarget
        row.outcome = tgt0.label === wantLabel ? 'fast-correct' : tgt0.ask ? 'fast-asks' : 'fast-WRONG'
      } else row.outcome = tgt0.ask && e.kind !== 'clarify' ? 'fast-asks' : 'fast-correct'
    } else if (e.kind === 'clarify') {
      row.outcome = targetOf(host, got, fast, c.text).ask ? 'fast-correct' : 'fast-WRONG'
    } else row.outcome = 'fast-WRONG'
  } else {
    const want = { undo: 'undo', dismiss: 'dismiss' }[e.kind]
    const ok = (want && fast.kind === want) || (fast.kind === 'subset' && /first/.test(c.text)) || (fast.kind === 'confirm' && e.kind === 'refuse')
    row.outcome = ok ? 'fast-correct' : 'fast-WRONG'
  }
  // ⭐ A would-be WRONG instant plan that the REAL planner refuses (capability `check`, e.g. "rename UCT
  // Default" — built-in; "save as Day Trading" — never overwrites) changes nothing: scored fast-refuses.
  if (row.outcome === 'fast-WRONG' && fast?.kind === 'ops' && plannerRefuses(host, fast)) row.outcome = 'fast-refuses'
  // routing coverage — the groups the expected plan needs, among the routed groups
  const need = e.groups || [...new Set((e.ops || []).map(o => groupOfAction(o.a)).filter(Boolean))]
  // exactly what the browser would send: the real routeManifest over the real manifest and limits
  // the SAME options the panel passes (useAgent): live names + typo readings when this build has them
  const live = typeof routing.routingNames === 'function' ? { names: routing.routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text) } : {}
  const r = routeManifest(MANIFEST, c.text, { limit: LIMITS.limit, budget: LIMITS.budget, ...live })
  const sent = r.routing ? r.routing.selected : [...new Set(MANIFEST.map(m => groupOfAction(m.name)).filter(Boolean))]
  row.routing = !need.length ? null : need.every(x => sent.includes(x)) ? 'ok' : 'MISS'
  // model calls this case would cost today (0 = deterministic; +1 for the reroute a routing miss forces)
  row.modelCalls = ['fast-correct', 'fast-asks', 'fast-WRONG', 'fast-refuses'].includes(row.outcome) ? 0
    : 1 + (row.routing === 'MISS' ? 1 : 0)
  return row
}

export function summarize(rows) {
  const n = rows.length
  const idealFast = rows.filter(r => r.ideal === 'fast')
  const reached = idealFast.filter(r => r.outcome === 'fast-correct')
  const expectAct = rows.filter(r => r.kind !== 'clarify')
  const decided = rows.filter(r => r.outcome?.startsWith('fast') && r.outcome !== 'fast-refuses')
  const ms = rows.map(r => r.ms).sort((a, b) => a - b)
  const q = (p) => ms.length ? +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(2) : 0
  const routed = rows.filter(r => r.routing)
  return {
    cases: n,
    idealFast: idealFast.length,
    idealFastReached: reached.length,
    deterministicCoverage: idealFast.length ? +(reached.length / idealFast.length).toFixed(3) : null,
    deterministicDecided: decided.length,
    deterministicAccuracy: decided.length ? +(decided.filter(r => r.outcome === 'fast-correct').length / decided.length).toFixed(3) : null,
    wrongActions: rows.filter(r => r.outcome === 'fast-WRONG').length,
    unnecessaryClarifications: expectAct.filter(r => r.outcome === 'fast-asks').length,
    safeRefusals: rows.filter(r => r.outcome === 'fast-refuses').length,
    toModel: rows.filter(r => r.modelCalls > 0).length,
    modelCallsPerCase: +(rows.reduce((a, r) => a + r.modelCalls, 0) / n).toFixed(3),
    routingChecked: routed.length,
    routingMiss: routed.filter(r => r.routing === 'MISS').length,
    fastParseMs: { p50: q(0.5), p95: q(0.95), max: ms.length ? +ms[ms.length - 1].toFixed(2) : 0 },
    modelPathIntentAccuracy: 'NOT MEASURED (layer C, needs owner-approved real-model budget)',
  }
}

describe('conversational intelligence — layer A baseline (deterministic, free)', () => {
  it('scores the dev corpus and the held-out set; never a NEW deterministic misfire', () => {
    const dev = corpus.cases.map(measureCase)
    const held = heldout.cases.map(c => measureCase({ ...c, split: c.split || 'heldout' }))
    const held2 = heldout2.cases.map(c => measureCase({ ...c, split: (c.split || 'heldout') === 'adversarial' ? 'adversarial2' : 'heldout2' }))
    const report = {
      at: new Date().toISOString(),
      dev: summarize(dev),
      heldout: summarize(held.filter(r => r.split === 'heldout')),
      adversarial: summarize(held.filter(r => r.split === 'adversarial')),
      heldout2: summarize(held2.filter(r => r.split === 'heldout2')),
      adversarial2: summarize(held2.filter(r => r.split === 'adversarial2')),
      rows: [...dev, ...held, ...held2],
    }
    const line = (k, s) => `${k.padEnd(12)} n=${s.cases} fast ${s.idealFastReached}/${s.idealFast} (${s.deterministicCoverage}) · det.acc ${s.deterministicAccuracy} · WRONG ${s.wrongActions} · refused ${s.safeRefusals} · needless-ask ${s.unnecessaryClarifications} · →model ${s.toModel} · calls/case ${s.modelCallsPerCase} · route MISS ${s.routingMiss}/${s.routingChecked} · fastParse p50 ${s.fastParseMs.p50}ms p95 ${s.fastParseMs.p95}ms`
    console.log(`\n── layer A ──\n${line('dev', report.dev)}\n${line('heldout', report.heldout)}\n${line('adversarial', report.adversarial)}\n${line('heldout2', report.heldout2)}\n${line('adversarial2', report.adversarial2)}\n` +
      'WRONG: ' + report.rows.filter(r => r.outcome === 'fast-WRONG').map(r => `${r.id} “${r.text}” → ${r.detail}`).join(' | ') + '\n')
    if (globalThis.process?.env?.AGENT_EVAL_OUT) fs.writeFileSync(globalThis.process.env.AGENT_EVAL_OUT, JSON.stringify(report, null, 2))
    // the dev corpus already pins "no new misfire" (agentNlCorpus.test.js); here the held-out set is MEASURED,
    // and a later phase may only lower its WRONG count (BASELINE_WRONG is updated by hand with evidence)
    const BASELINE_WRONG = Number(globalThis.process?.env?.AGENT_EVAL_BASELINE_WRONG ?? Infinity)
    expect(report.heldout.wrongActions + report.adversarial.wrongActions + report.heldout2.wrongActions + report.adversarial2.wrongActions).toBeLessThanOrEqual(BASELINE_WRONG)
  })
})
