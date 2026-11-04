// ── UCT Agent MULTI-STEP REQUESTS (Phase 2 — natural-language intelligence, 2026-10-29) ─────────────────
//
// "Create four daily charts for SPY, QQQ, NVDA and TSLA, put the 9 and 20 EMA on all of them, make the 9 green and
// 20 yellow, and put RSI in its own pane." — one sentence, several steps, each step about what an EARLIER step
// made. Read deterministically, in two phases:
//
//   1. PLAN (before anything runs)   the sentence is cut at its commas / "and" / "then" into the FEWEST clauses
//                                    that EACH read as one step a layer the panel already has understands — the
//                                    chart grid (multiChart), an instant command (fastPath), a follow-up about the
//                                    conversation's indicators (conversation.js, read for its shape: its referents
//                                    do not exist yet), or "put RSI under price / in its own pane" (an indicator
//                                    the chart does not show yet is ADDED where it was asked to go). One clause
//                                    nothing reads → null: the whole request goes to the model, exactly as before.
//                                    Nothing is ever half-understood and partly run.
//   2. RUN (useAgent.runCompound)    clause by clause, each re-read against the LIVE board (what the step before
//                                    created is there now), each through the ordinary execute — same planner,
//                                    policy, runtime, receipts and Undo. A step that does not fully land, asks, or
//                                    needs an approval STOPS the request: what was done, what was not, said plainly.
//
// THE WORKING SET. The charts a request is working on carry forward: after "four charts for …" a later clause with no
// chart of its own ("make the 9 green") — or "all of them" — means those charts. A clause that names a chart
// ("on the top left one") narrows to it.
//
// LIMITS (preserved, never raised): each step is one request's worth of changes (MAX_STEP_OPS = the manifest's
// maxOps), at most MAX_STEPS steps. A larger step stops the request before it runs, with the reason.

import { fastParse, matchPosition, canon } from './fastPath'
import { multiChartPlan, gridTickers, isWorkspaceRequest, asksForWatchlistRail } from './multiChart'
import { labelMap } from '../widgets/registry'
import { followUpShape, resolveFollowUp } from './conversation'
import { getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { subjectChart } from './references'
import { settingsOfWords, defIdOfWords, indicatorRowsOf, indicatorEditsRef } from './capabilities/indicatorEdits'
import * as nativeRegistry from '../components/chart/engine/nativeRegistry'
import MANIFEST_CONTRACT from './contract/manifest.contract.json'

export const MAX_STEPS = 6
export const MAX_STEP_OPS = MANIFEST_CONTRACT.limits.maxOps

// segments: cut at ", and", ",", " and ", " then ", ";" and between sentences (". ", "! ", "? " — a decimal such as
// "1.5" has no space after its point) — the separators are kept so a span reads as typed
const SEP = /(\s*,\s*(?:and\s+|then\s+)?|\s+and then\s+|\s+and\s+|\s+then\s+|\s*;\s*|[.!?]\s+)/i

// ⭐ acceptance 2026-10-29: "…, each with a 50sma" / "with RSI on each" / "all with the 9 and 20 ema" after a step that
// set up charts — the same add as "add a 50 sma to all of them" (the fast path reads it; the working set is "them")
const EACH_WITH = /^(?:(?:and )?(?:each|every one|all|both)(?: of them| one| chart| of the charts)? (?:with|having|getting|gets|get)|(?:and )?with) (.+?)(?: (?:on|for|to) (?:each|all|every one|both)(?: of them| one| chart| of the charts)?)?$/i
/** "each with X" → "add X to all of them" (then read by the fast path, like any other clause), else the words. */
export function eachWith(text) {
  const m = EACH_WITH.exec(String(text || '').trim().replace(/[.!?]+$/, ''))
  return m ? `add ${m[1]} to all of them` : text
}

// ── "put RSI under price", "put the 20 ema in its own pane", "add MACD in a separate pane" (⭐ PHASE 3: "put rsi underneath") ──
const NEW_PANE = /^(?:put|add|place|stick|throw|slap|give me|load|plot) (.+?) (?:in (?:its own|a separate|a seperate|a new|a different|their own) (?:pane|window)|in (?:a )?(?:separate|seperate|own) panes?|(?:under|below|beneath|underneath)(?: (?:the )?(?:price|price chart|chart|candles|main chart)| it)?)$/
/** The indicator to add and where, from words → { defId, inputs, pane: bool } | null. */
// ⭐ PHASE 3: "…, and RSI beneath each chart" (a multi-step request's last part, no verb of its own) — the indicator below
// price on each of the request's charts: read exactly as "put RSI below price" on the working set
const EACH_PANE = /^(?:and\s+|with\s+|plus\s+)?(?:an?\s+|the\s+)?(.+?)\s+(?:beneath|below|under|underneath)\s+(?:each|every|all(?: of)?(?: the)?|both(?: of)?(?: the)?)\s+(?:one|charts?|of them)$/
const eachPane = (t) => { const m = EACH_PANE.exec(t); return m ? `put ${m[1]} below price` : t }
function newPaneIndicator(t0) {
  const t = eachPane(t0)
  const m = NEW_PANE.exec(t)
  if (!m) return null
  const words = m[1].replace(/^(?:an? |the |my )/, '')
  const defId = defIdOfWords(words)
  if (defId) return { defId, inputs: null }
  const s = settingsOfWords(words)
  return s ? { defId: s.defId, inputs: s.inputs } : null
}
const defaultPlacement = (defId) => { try { return nativeRegistry.getDefinition(defId)?.placement?.target || null } catch { return null } }

/** Does ONE clause read as one step? → 'grid' | 'fast' | 'follow' | 'pane' | null. Board-aware, side-effect free. */
function clauseKind(text, host) {
  const t = String(text || '').trim()
  if (!t) return null
  const g = multiChartPlan(t, { host })
  if (g?.kind === 'ops' && g.ops.some(o => o.action === 'chartGrid.set' || o.action === 'widget.addCharts')) return 'grid'
  if (newPaneIndicator(canon(t).replace(/[.!?]+$/, ''))) return 'pane'
  const f = fastParse(eachWith(t), { host })
  if (f?.kind === 'ops') return 'fast'
  if (followUpShape(t)) return 'follow'
  return null
}

/**
 * The fewest clauses that each read as one step. → { steps: [{ text, kind }] } | null. A one-clause request is
 * returned only when it needs this module ('pane': nothing else adds an indicator where it was asked to go).
 */
export function planCompound(text, { host } = {}) {
  const raw = String(text || '').trim().replace(/[.!]+$/, '')
  if (!raw || raw.length > 400) return null
  const parts = raw.split(SEP)
  const segs = []                                     // [{ text, sep }] — sep = the separator BEFORE it
  for (let i = 0; i < parts.length; i += 2) segs.push({ text: parts[i], sep: i ? parts[i - 1] : '' })
  if (segs.length > 14) return null
  const n = segs.length
  const spanText = (a, b) => segs.slice(a, b).map((s, i) => (i ? s.sep : '') + s.text).join('').trim()
  const kinds = new Map()
  const kindOf = (a, b) => { const k = `${a}:${b}`; if (!kinds.has(k)) kinds.set(k, clauseKind(spanText(a, b), host)); return kinds.get(k) }
  // best[i] = the fewest clauses covering segs[0..i)
  const best = Array(n + 1).fill(null)
  best[0] = []
  for (let b = 1; b <= n; b++) {
    for (let a = 0; a < b; a++) {
      if (!best[a]) continue
      // the WHOLE request as one step is the panel's own layers' to read (they already tried) — except 'pane'
      if (a === 0 && b === n && n > 1 && kindOf(a, b) !== 'pane') continue
      const k = kindOf(a, b)
      if (!k) continue
      const cand = [...best[a], { text: spanText(a, b), kind: k }]
      if (!best[b] || cand.length < best[b].length) best[b] = cand
    }
  }
  const steps = best[n]
  if (!steps) return null
  if (steps.length === 1 && steps[0].kind !== 'pane') return null      // one step: the panel's own layers read it
  if (steps.length > MAX_STEPS) return { say: `That's ${steps.length} steps in one message — UCT does at most ${MAX_STEPS} at a time. Ask for the first few, then the rest. Nothing has changed.` }
  return { steps }
}

// ── ⭐ PHASE 3 acceptance (live 2026-10-31): a WHOLE workspace on a board that already holds other things ─────────────────
// "make me a workspace with four daily charts for NVDA AMD AVGO and MU, a watchlist, and RSI beneath each chart" describes
// the board the member wants. On a board of only (at most that many) charts it is built in place, as before. On a board
// that also holds widgets the request does not include (a News feed, a Screener, more charts, a Watchlist that is not the
// right-hand rail), building in place would squeeze the request into whatever space the charts happen to have — so the
// member is asked ONCE: replace the current board (a proposal naming what goes; Undo restores it) or build it in a new
// layout (the current board untouched). Either way the WHOLE request then runs, step by step, through the same execute.
const LABELS = (() => { try { return labelMap('menu') } catch { return {} } })()
const widgetName = (t) => LABELS[t] || t
export const WORKSPACE_CHOICES = [{ ref: 'workspace:replace', label: 'Replace current board' }, { ref: 'workspace:new', label: 'New layout' }]
/** The first step is a whole workspace and the board holds widgets it does not include → { names } (what's there), else null. */
export function workspaceConflict(host, steps) {
  const first = steps?.[0]
  if (first?.kind !== 'grid' || !isWorkspaceRequest(first.text)) return null
  let s = null
  try { s = host?.widgets?.snapshot?.() || null } catch { s = null }
  if (!s) return null
  const raw = s.raw || []
  const cols = s.grid?.cols ?? 24
  const rows = s.grid?.rows ?? 20
  const n = gridTickers(first.text, host).length
  const charts = raw.filter(w => w.type === 'chart')
  const lists = raw.filter(w => w.type === 'watchlist')
  // a Watchlist already standing as the right-hand rail IS the one asked for
  const railHere = asksForWatchlistRail(first.text) && lists.length === 1 && lists[0].x + lists[0].w === cols && lists[0].y === 0 && lists[0].h === rows
  const others = raw.filter(w => w.type !== 'chart' && !(railHere && w === lists[0]))
  if (!others.length && charts.length <= n) return null
  const counts = new Map()
  for (const w of [...others, ...(charts.length > n ? charts.slice(n) : [])]) counts.set(w.type, (counts.get(w.type) || 0) + 1)
  const names = [...counts].map(([t, k]) => (k === 1 ? `a ${widgetName(t)}` : `${k} ${widgetName(t)}s`))
  if (charts.length > n) names.unshift(`${charts.length} charts`)
  return { names: [...new Set(names)] }
}
const andWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
export function workspaceQuestion(conflict) {
  return `Your board already has ${andWords(conflict.names)} on it. Should I replace the current board with this workspace (you approve it first, and Undo puts everything back), or build it in a new layout and leave this board as it is?`
}
/** The member's pick → the steps to run: the same request, its grid replacing the board, or after a new layout is made and opened. */
export function workspaceSteps(steps, pick, host, entries = []) {
  if (pick === 'workspace:replace') return [{ ...steps[0], replace: true, resume: true }, ...steps.slice(1).map(s => ({ ...s, resume: true }))]
  const syms = gridTickers(steps[0].text, host)
  const base = `${syms.join(' ')} workspace`.slice(0, 60)
  const taken = new Set((entries || []).map(e => String(e.name || '').trim().toLowerCase()))
  let name = base
  for (let i = 2; taken.has(name.toLowerCase()) && i < 50; i++) name = `${base} ${i}`
  return [{ text: `create a new layout called ${name}`, kind: 'newLayout', name, resume: true },
    { text: `open ${name}`, kind: 'openLayout', name, resume: true },
    ...steps.map(s => ({ ...s, resume: true }))]
}

// ── RUN: one step against the live board ────────────────────────────────────────────────────────────
function chartsOf(host) { try { return host?.charts?.list?.() || [] } catch { return [] } }

/** The charts a target-less step means: the working set, else the one chart in front of the member. */
function defaultCharts(host, memory, epoch, working) {
  if (working?.length) return working
  const c = subjectChart(host, memory, epoch)
  return c ? [c.ref] : null
}
/** A fast parse's target hint → chart refs | null (not one this module can resolve without asking). */
function chartsForHint(hint, host, working) {
  const charts = chartsOf(host)
  if (hint.all) {
    const set = working?.length ? working : charts.map(c => c.ref)
    if (hint.count && hint.count !== set.length) return null
    return set
  }
  if (hint.chart) return [hint.chart]
  if (hint.position) {
    const hit = matchPosition(charts, hint.position)
    return hit.length === 1 ? [hit[0].ref] : null
  }
  if (hint.qualifier) {
    const hit = charts.filter(c => String(c.symbol || '').toLowerCase() === String(hint.qualifier).toLowerCase())
    return hit.length === 1 ? [hit[0].ref] : null
  }
  return null
}
// one op per chart, aimed at that chart's entry of the op's target kind
function aim(ops, charts, host) {
  const out = []
  for (const o of ops) {
    if (o.target) { out.push(o); continue }
    const cap = getCapability(o.action)
    const kind = cap ? getTargetKind(cap.target) : null
    if (!kind) return null
    const list = kind.list(host) || []
    for (const ref of charts) {
      const snap = list.find(s => chartRefOf(kind, s) === ref)
      if (!snap) return null
      out.push({ ...o, target: snap.ref })
    }
  }
  return out
}

/**
 * One clause, read against the board as it is NOW. → { ops, charts? } | { say }.
 * `charts`: the charts this step set up (a grid) — the next steps' working set.
 */
export function resolveStep(step, { host, memory, epoch = null, working = null } = {}) {
  const t = step.text
  // a step already planned (the model's plan, screened — screenChartGrid): the grid as planned, then each change aimed at
  // the chart that NOW shows its ticker (one of the working set's)
  if (step.kind === 'planned') {
    if (step.grid) return { ops: step.ops, grid: step.grid }
    const ops = []
    for (const { symbol, op } of step.each || []) {
      const refs = chartsShowing(host, [symbol]).filter(r => !working?.length || working.includes(r))
      if (refs.length !== 1) return { say: `I couldn't tell which ${symbol} chart to change` }
      const { target, ...rest } = op                                      // eslint-disable-line no-unused-vars
      const aimed = aim([rest], refs, host)
      if (!aimed) return { say: `that change doesn't apply to the ${symbol} chart` }
      ops.push(...aimed)
    }
    return { ops }
  }
  if (step.kind === 'newLayout') return { ops: [{ action: 'layout.create', target: 'layouts', args: { name: step.name } }] }
  if (step.kind === 'openLayout') return { ops: [{ action: 'layout.open', target: 'layouts', args: { layout: step.name } }] }
  if (step.kind === 'grid') {
    const g = multiChartPlan(t, { host })
    if (g?.kind !== 'ops') return { say: g?.text || `I couldn't read “${t}” any more.` }
    const symbols = gridTickers(t, host)
    if (!step.replace) return { ops: g.ops, grid: symbols }
    // the member chose to replace the board: the same grid, replacing it (chartGrid.set `replace` — always a proposal)
    const grid = g.ops.find(o => o.action === 'chartGrid.set')
    if (!grid || g.ops.length !== 1) return { say: `I couldn't build “${t}” as a whole board` }
    return { ops: [{ ...grid, args: { ...grid.args, replace: true, new_charts: null } }], grid: symbols }
  }
  if (step.kind === 'pane') {
    const want = newPaneIndicator(canon(t).replace(/[.!?]+$/, ''))
    const charts = defaultCharts(host, memory, epoch, working)
    if (!want) return { say: `I couldn't read “${t}”.` }
    if (!charts) return { say: `Which chart should “${t}” go on? Name it (“on the top left chart”) and ask again.` }
    const ops = []
    const already = []
    for (const ref of charts) {
      const target = indicatorEditsRef(ref)
      const c = (() => { try { return host.charts.read(ref) } catch { return null } })()
      const rows = c ? indicatorRowsOf(c.cs) : []
      const have = rows.find(r => r.defId === want.defId && (!want.inputs || want.inputs.every(i => String(r.inputs?.[i.key] ?? '') === String(i.value))))
      if (!have) ops.push({ action: 'indicator.add', target, args: { defId: want.defId, inputs: want.inputs } })
      // drawn on the price chart by default (an EMA): put in its own pane once it is there — a step of its own
      const onPrice = have ? (have.displayTarget || have.placement) === 'price' : defaultPlacement(want.defId) === 'price'
      if (onPrice) ops.push({ action: 'indicatorStyle.placeIn', target, args: { instance: have ? have.instanceId : placeWordFor(want), place: 'pane' } })
      if (have && !onPrice) already.push(`${have.name} is already in its own pane on ${c?.label || 'that chart'}`)
    }
    // nothing to do on any chart: said, and the step counts as done (it is)
    return ops.length ? { ops, note: already.length ? `${already.join('; ')}.` : null } : { noop: true, note: `${already.join('; ')}.` }
  }
  if (step.kind === 'follow') {
    const r = resolveFollowUp(t, { host, memory, epoch, working })
    if (r?.kind === 'ops') return { ops: r.ops, pick: r.pick }
    if (r?.kind === 'say') return { say: r.text }
    // its referents are not in the conversation (an add that was a no-op): the instant reading, on the working set
  }
  const f = fastParse(eachWith(t), { host })
  if (f?.kind !== 'ops') return { say: `I couldn't read “${t}” on the board as it is now.` }
  if (f.ops.every(o => o.target)) return { ops: f.ops }
  const charts = f.target ? chartsForHint(f.target, host, working) : defaultCharts(host, memory, epoch, working)
  if (!charts) return { say: `Which chart should “${t}” apply to? Name it and ask again.` }
  const ops = aim(f.ops, charts, host)
  return ops ? { ops } : { say: `“${t}” doesn't apply to those charts.` }
}
// the instance an EMA added a step earlier will be found by (`#20:ema`) — indicatorEdits' own length lookup
function placeWordFor(want) {
  const p = want.inputs?.find(i => i.key === 'period')?.value
  const t = want.inputs?.find(i => i.key === 'maType')?.value
  return p ? `#${p}${t ? `:${t}` : ''}` : want.defId
}

/** The charts a grid step set up (its tickers, on the board now) — the working set for the steps after it. */
export function chartsShowing(host, symbols) {
  const want = new Set((symbols || []).map(s => String(s).toUpperCase()))
  return chartsOf(host).filter(c => want.has(String(c.symbol || '').toUpperCase())).map(c => c.ref)
}
