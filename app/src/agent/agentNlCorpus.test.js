// UCT Agent — Natural Language & Intent Intelligence: the EVALUATION CORPUS harness (architecture
// phase, 2026-10-12). STANDALONE: it changes no runtime code and makes no model call.
//
// __fixtures__/nlIntent/corpus.json holds realistic member requests with the CORRECT outcome and the
// IDEAL path (fast = no model call; model; local-clarify). This file measures today's DETERMINISTIC
// layers against it — the fast path (fastParse), the target rules the panel applies to a fast op
// (position words, "both/all", deixis), and capability routing (selectGroups) — and prints a
// per-category table. Model-dependent expectations are not judged here: they are replayed later
// through the capture → tools/agent_live_batch.py pipeline, which needs owner authorization.
//
// It FAILS only when (a) the corpus is malformed (unknown fixture, action or group), or (b) the fast
// path deterministically does something WRONG that is not already in KNOWN_WRONG — a deterministic
// misfire is the one NL failure that runs without the model ever seeing the request.
// `AGENT_NL_OUT=<file>` writes every row as JSON.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import corpus from './__fixtures__/nlIntent/corpus.json'
import { registerBuiltins } from './builtins'
import { fastParse, matchPosition } from './fastPath'
import { selectGroups, GROUPS } from './routing'
import { getCapability, getTargetKind } from './capabilities'
import { resolveDeictic } from './deixis'
import { buildChartSource } from './host'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'

registerBuiltins()

// Deterministic misfires present at the corpus baseline (2026-10-12, master 8179ab21be). Each is a
// finding in docs/agent/nl-intent/ARCHITECTURE.md; removing one here once fixed keeps it fixed.
const KNOWN_WRONG = new Set([
  'ticker-09', // “add it to momentum” → watchlist.add ["IT"]: the pronoun parsed as the ticker IT (watchlist.js parseTickers)
])

const KINDS = new Set(['act', 'propose', 'clarify', 'answer', 'unsupported', 'refuse', 'undo', 'dismiss', 'research'])
const IDEALS = new Set(['fast', 'model', 'local-clarify'])
const GROUP_IDS = new Set(GROUPS.map(g => g.id))

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
  // charts as the workspace builds them (positions, labels, the clicked chart) — buildChartSource
  const apis = new Map(fx.charts.map(c => [`m-${c.id}`, { agent: {
    read: () => ({ chartId: c.id, tabId: null, groupKey: c.id, symbol: c.symbol, tf: c.tf, cs: mergeChartSettings(null), stored: null }),
    view: () => null, drawSym: () => c.symbol,
  } }]))
  b.host.charts = buildChartSource({ chartApiById: { current: apis }, getWidgets: () => b.state.widgets, selectedChart: () => fx.selected })
  const base = b.host.layouts.snapshot
  b.host.layouts = { ...b.host.layouts, snapshot: () => ({ ...base(), recent: lib.recentLayouts }) }
  return b.host
}

const subset = (want = {}, got = {}) => Object.entries(want).every(([k, v]) => JSON.stringify(got?.[k]) === JSON.stringify(v))
const sameOps = (want, got) => want.length === got.length && want.every((w, i) => w.a === got[i].action && subset(w.args, got[i].args))

// The panel's deterministic target rule for a single-kind fast op (useAgent.send): all → every
// target; a position hint narrows; deixis narrows to the clicked chart; one left → it; else a question.
function targetOf(host, ops, fast, text) {
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

function measure(c) {
  const host = hostFor(c.fx)
  const e = c.expect
  let fast = null
  try { fast = fastParse(c.text, { host }) } catch (err) { fast = { kind: 'error', err: String(err) } }
  const row = { id: c.id, cat: c.cat, text: c.text, ideal: e.ideal, kind: e.kind, fast: fast ? fast.kind : null, outcome: null, detail: null }
  // ── fast path ──
  if (c.pending && e.ideal === 'local-clarify') {
    row.outcome = 'not-measured'                     // needs a stored local question (pendingRef)
  } else if (!fast) {
    // needsState: the fast phrase needs session state this fixture does not load (Screener catalog,
    // saved screens, the list made earlier in the session) — reported apart from language gaps
    row.outcome = c.needsState ? 'needs-state' : 'to-model'
  } else if (fast.kind === 'ops') {
    const tgt0 = targetOf(host, fast.ops, fast, c.text)
    // "both / all": the panel runs the op set once per target
    const got = tgt0.all ? tgt0.all.flatMap(() => fast.ops) : fast.ops
    row.detail = fast.ops.map(o => `${o.action} ${JSON.stringify(o.args)}`).join(' ; ') + (tgt0.all ? ` ×${tgt0.all.length}` : '')
    const plans = [e.ops, ...(e.alt || [])].filter(Boolean)
    if (plans.some(p => sameOps(p, got))) {
      const wantsTarget = (e.ops || []).find(o => o.t)?.t
      if (wantsTarget && !tgt0.multi && !tgt0.all) {
        const sel = corpus.fixtures[c.fx].selected
        const wantLabel = wantsTarget === 'selected' ? host.charts.list().find(s => s.ref === sel)?.label : wantsTarget
        row.outcome = tgt0.label === wantLabel ? 'fast-correct' : tgt0.ask ? 'fast-asks' : 'fast-WRONG'
        row.detail += ` → ${tgt0.label || (tgt0.ask ? 'asks' : JSON.stringify(tgt0))}`
      } else row.outcome = 'fast-correct'
    } else if (e.kind === 'clarify' && e.clarifyAbout === 'chart') {
      const tgt = targetOf(host, got, fast, c.text)
      row.outcome = tgt.ask ? 'fast-correct' : 'fast-WRONG'
      row.detail += ` → ${tgt.label || (tgt.ask ? 'asks' : JSON.stringify(tgt))}`
    } else {
      row.outcome = 'fast-WRONG'
    }
  } else {
    // undo / confirm / subset / dismiss
    const want = { undo: 'undo', dismiss: 'dismiss' }[e.kind]
    const okSubset = fast.kind === 'subset' && /first/.test(c.text)
    const okConfirm = fast.kind === 'confirm' && e.kind === 'refuse'
    row.outcome = (want && fast.kind === want) || okSubset || okConfirm ? 'fast-correct' : 'fast-WRONG'
    row.detail = fast.kind
  }
  // ── routing (model path only matters; recall of the groups the right plan needs) ──
  const g = selectGroups(c.text)
  row.groups = g.matched ? g.selected.filter(x => x !== 'agent') : 'ALL'
  row.routing = !e.groups ? null : (!g.matched || e.groups.every(x => g.selected.includes(x))) ? 'ok' : 'MISS'
  return row
}

describe('NL intent corpus', () => {
  it('is well-formed: every fixture, action, group, kind and ideal exists', () => {
    const ids = new Set()
    for (const c of corpus.cases) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false)
      ids.add(c.id)
      expect(corpus.fixtures[c.fx], `${c.id}: fixture ${c.fx}`).toBeTruthy()
      expect(corpus.categories[c.cat], `${c.id}: category ${c.cat}`).toBeTruthy()
      expect(KINDS.has(c.expect.kind), `${c.id}: kind ${c.expect.kind}`).toBe(true)
      expect(IDEALS.has(c.expect.ideal), `${c.id}: ideal ${c.expect.ideal}`).toBe(true)
      for (const o of c.expect.ops || []) expect(getCapability(o.a), `${c.id}: action ${o.a}`).toBeTruthy()
      for (const gid of c.expect.groups || []) expect(GROUP_IDS.has(gid), `${c.id}: group ${gid}`).toBe(true)
    }
    expect(corpus.cases.length).toBeGreaterThanOrEqual(150)
  })

  it('measures the deterministic layers (report) and allows no NEW deterministic misfire', () => {
    const rows = corpus.cases.map(measure)
    const by = {}
    for (const r of rows) {
      const b = by[r.cat] || (by[r.cat] = { n: 0, idealFast: 0, fastCorrect: 0, fastAsks: 0, toModel: 0, wrong: 0, routeMiss: 0, routeChecked: 0, notMeasured: 0 })
      b.n++
      if (r.ideal === 'fast') b.idealFast++
      if (r.outcome === 'fast-correct') b.fastCorrect++
      if (r.outcome === 'fast-asks') b.fastAsks++
      if (r.outcome === 'to-model') b.toModel++
      if (r.outcome === 'fast-WRONG') b.wrong++
      if (r.outcome === 'not-measured') b.notMeasured++
      if (r.routing) { b.routeChecked++; if (r.routing === 'MISS') b.routeMiss++ }
    }
    const tot = Object.values(by).reduce((a, b) => { for (const k of Object.keys(b)) a[k] = (a[k] || 0) + b[k]; return a }, {})
    const idealFastRows = rows.filter(r => r.ideal === 'fast')
    const fastGap = idealFastRows.filter(r => r.outcome !== 'fast-correct')
    const lines = [
      'cat      n  idealFast fastOK asks toModel WRONG routeMiss/checked',
      ...Object.entries(by).map(([k, b]) => `${k.padEnd(8)} ${String(b.n).padStart(2)} ${String(b.idealFast).padStart(9)} ${String(b.fastCorrect).padStart(6)} ${String(b.fastAsks).padStart(4)} ${String(b.toModel).padStart(7)} ${String(b.wrong).padStart(5)} ${String(b.routeMiss).padStart(5)}/${b.routeChecked}`),
      `TOTAL    ${tot.n}  idealFast ${tot.idealFast} · fast-correct ${tot.fastCorrect} · ideal-fast reached ${idealFastRows.length - fastGap.length}/${idealFastRows.length} · WRONG ${tot.wrong} · routing misses ${tot.routeMiss}/${tot.routeChecked}`,
      'IDEAL-FAST NOT REACHED: ' + fastGap.map(r => `${r.id}(${r.outcome})`).join(', '),
      'WRONG: ' + rows.filter(r => r.outcome === 'fast-WRONG').map(r => `${r.id} [${r.detail}]`).join(' | '),
      'ROUTING MISSES: ' + rows.filter(r => r.routing === 'MISS').map(r => `${r.id} [${Array.isArray(r.groups) ? r.groups.join(',') : r.groups}]`).join(' | '),
    ]
    console.log(`\n── NL intent corpus (deterministic layers) ──\n${lines.join('\n')}\n`)
    if (process.env.AGENT_NL_OUT) fs.writeFileSync(process.env.AGENT_NL_OUT, JSON.stringify({ rows, by, tot }, null, 2))
    const newWrong = rows.filter(r => r.outcome === 'fast-WRONG' && !KNOWN_WRONG.has(r.id)).map(r => `${r.id}: “${r.text}” → ${r.detail}`)
    expect(newWrong, 'a NEW deterministic misfire (the fast path acted wrongly with no model involved)').toEqual([])
  })
})
