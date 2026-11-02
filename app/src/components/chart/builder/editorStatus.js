// app/src/components/chart/builder/editorStatus.js
//
// ─── THE PINE EDITOR'S STATUS PANEL, AS DATA ─────────────────────────────────
//
// Spec: `docs/pine/EDITOR-STATUS-PANEL-SPEC.md`. This module DECIDES NOTHING about
// translation, drawing or consumers. It folds facts other readers already own into
// one object the panel renders:
//
//   report    `PineBox.inspectSource` (refusals verbatim, `outcome` = importOutcome)
//   pane      `memberPaneDefinition({source})` (what a chart draws, which lane, and
//             the stamps the chart's bind reads: `meta.blockRuns`, `meta.periodReads`)
//   consumers `engine/evaluability.js::evaluability` over the pane document
//   tags      `closedTable.json::_requirement_tags[tag].refused_by`
//   saved     a served row: held when `savedScriptUpgrade.upgradeKindOf` says
//             `refused` (the browser's twin of `engine_withheld_reason`); any other
//             `scan_refusal` is the server's answer for screens, shown verbatim
//
// It adds two things of its own and only two: a plain-English FAMILY per guard
// (`familyOf`, section 4 of the spec) and the LINE MAPPING (`lineMarks`). The
// engine's sentence is carried verbatim beside the family's, never replaced.
//
// ⛔ PURE, NEVER THROWS, WRITES NOTHING. A throw becomes the engine-fault state.
// ⛔ No copy in this file contains an em dash (rail: editorStatus.families.test.js).

import { evaluability, LANES, STATUS } from '../engine/evaluability'
import { TABLE } from '../engine/ast/parse'
import { OUTCOME, importOutcome } from '../engine/ast/importOutcome'
import { BLOCK_RUNS_GUARD } from '../engine/blockRuns'
import { periodReadsRefusalFor, PERIOD_READS_GUARD } from '../engine/periodReads'
import { upgradeKindOf } from './memberPane/savedScriptUpgrade'

export const EDITOR_STATUS_CONTRACT = 'editor-status/1'

export const PANEL_STATE = Object.freeze({
  CHECKING: 'checking',
  ENGINE_ERROR: 'engine-error',
  NOT_YET: 'not-yet',
  RUNS_WITHHELD: 'runs-withheld',
  RUNS_WITH_NOTES: 'runs-with-notes',
  RUNS: 'runs',
})

export const SEVERITY = Object.freeze({
  WITHHELD: 'withheld',
  MAY_WITHHOLD: 'may-withhold',
  NOTE: 'note',
})
const SEVERITY_RANK = Object.freeze({ note: 0, 'may-withhold': 1, withheld: 2 })

/** The four consumers the panel answers for, in display order. `tag` is the
 *  consumer name `_requirement_tags[*].refused_by` uses. */
export const CONSUMERS = Object.freeze([
  { id: 'chart', label: 'Chart', tag: 'pane' },
  { id: 'alerts', label: 'Alerts', tag: 'alert' },
  { id: 'screener', label: 'Screener', tag: 'screener' },
  { id: 'scans', label: 'Scans', tag: 'sweep' },
])

/** ⭐ The report's top refusals that are facts about SCREENING, not about a chart.
 *  The report is the screener lane's translation: it refuses a strategy declaration
 *  (a backtest is not a screen) and a script with no plot or alert condition (there
 *  is nothing to filter on), while the chart door (`memberPaneDefinition`, the host
 *  lane) draws the strategy's plots and an objects-only script's drawings. While the
 *  chart door answers `ok`, one of these is shown on the Screener and Scans rows,
 *  verbatim, and is NOT listed as a withheld value. */
export const SCREENER_LANE_REFUSALS = Object.freeze(new Set([
  'pine:declaration-strategy', 'pine:no-output', 'pine:objects-only',
]))

/** The guard a held saved version carries on the panel (family `held`). */
const HELD_GUARD = 'engine:withheld'

// ─── FAMILIES ────────────────────────────────────────────────────────────────

/** Section 4 of the spec. `exact` guards first, then `prefix`es, first match wins. */
export const FAMILIES = Object.freeze([
  {
    id: 'block',
    exact: ['pine:block'],
    label: 'Code that does not run on every bar',
    why: 'On a chart where this code skips a bar and then runs again, TradingView\'s value depends on '
      + 'history we do not keep, so that value is withheld on that chart.',
  },
  {
    id: 'period',
    exact: ['bind:period-reads'],
    label: 'Values that depend on the chart\'s timeframe',
    why: 'This reads the chart\'s own timeframe. It was translated at one timeframe, so on a chart where '
      + 'that reading differs, the plot is withheld rather than drawn with the other timeframe\'s value.',
  },
  {
    id: 'request',
    exact: ['pine:request'],
    prefix: ['runtime:request', 'other-symbol:', 'lower-tf:'],
    label: 'Data from another symbol or timeframe',
    why: 'This asks for prices from another symbol or timeframe that we cannot supply exactly yet, '
      + 'so the value is withheld rather than guessed.',
  },
  {
    id: 'strategy',
    exact: ['pine:declaration-strategy'],
    prefix: ['pine:strategy-', 'runtime:strategy-'],
    label: 'Strategy orders and backtests',
    why: 'Strategy orders, fills and the backtest do not run here yet. The plots in a strategy can '
      + 'still be drawn.',
  },
  {
    id: 'shape',
    exact: ['pine:no-output', 'pine:objects-only', 'pine:hidden-only', 'pine:constant-only',
      'pine:presentation-only', 'runtime:no-output', 'runtime:object-tree-outputs',
      'runtime:withheld-all', 'runtime:nothing-drawn'],
    label: 'Nothing a chart can draw',
    why: 'The script has nothing a chart can draw: no visible plot, or only constant or hidden values.',
  },
  {
    id: 'fault',
    exact: ['import:internal-error', 'runtime:failed', 'runtime:build', 'runtime:unnamed-refusal',
      'runtime:not-from-listing', 'runtime:output-map', 'runtime:document'],
    prefix: ['runtime:worker-'],
    label: 'Engine fault',
    why: 'Our engine could not finish this script. That is on us, not your script.',
  },
  {
    id: 'unverified',
    exact: ['runtime:killed', 'runtime:not-yet-graded', 'runtime:repaint-unstated'],
    label: 'Switched off or not yet verified',
    why: 'The bar-by-bar engine that could draw this is switched off for this script, or has not yet '
      + 'been checked against TradingView for it, so it is not used.',
  },
  {
    id: 'drawing',
    exact: ['pine:drawing'],
    prefix: ['pine:object-', 'runtime:object'],
    label: 'Lines, labels, boxes and tables',
    why: 'We cannot yet make this drawing exactly the way TradingView does, so it is not drawn.',
  },
  {
    id: 'state',
    exact: ['pine:state', 'pine:reassign', 'pine:history-ref', 'pine:live-bar-state', 'pine:na',
      'runtime:conditional-history', 'runtime:varip', 'runtime:realtime-untold',
      'runtime:input-state', 'runtime:function-global-state', 'runtime:chart-clock',
      'runtime:clock-zone', 'runtime:history-variable', 'runtime:history-function-local',
      'runtime:history-expression', 'runtime:history-dynamic-offset', 'runtime:na-test'],
    prefix: ['runtime:call-'],
    label: 'Values carried from bar to bar',
    why: 'This value depends on what the script remembered on earlier bars, in a way we cannot '
      + 'reproduce exactly yet.',
  },
  {
    id: 'collection',
    exact: ['pine:collection', 'pine:type', 'pine:member', 'pine:tuple', 'runtime:array',
      'runtime:tuple', 'runtime:prop'],
    prefix: ['pine:vector', 'runtime:udt'],
    label: 'Arrays, maps and custom types',
    why: 'Collections and custom types are not computed here yet.',
  },
  {
    id: 'function',
    exact: ['pine:function', 'pine:function-def', 'runtime:function', 'runtime:recursion',
      'runtime:unbound', 'runtime:discarded-value'],
    label: 'Your own functions',
    why: 'This function is written in a way we cannot run exactly yet.',
  },
  {
    id: 'builtin',
    exact: ['pine:builtin', 'pine:arity', 'pine:named-argument', 'pine:undefined',
      'runtime:builtin-args'],
    label: 'A TradingView built-in we do not compute yet',
    why: 'This built-in is not computed here yet, so anything that reads it is withheld.',
  },
  {
    id: 'library',
    exact: ['pine:module', 'pine:declaration-library', 'runtime:library'],
    label: 'Imported libraries',
    why: 'This script imports a library we cannot load yet.',
  },
  {
    id: 'input',
    exact: ['pine:input-kind', 'runtime:member-inputs'],
    label: 'Inputs',
    why: 'This kind of input cannot be offered here yet.',
  },
  {
    id: 'presentation',
    exact: ['pine:colour-value', 'pine:text-value', 'pine:plot-offset', 'pine:alert-message',
      'pine:paint-pane', 'runtime:colour', 'runtime:presentation', 'runtime:plot-id'],
    prefix: ['pine:offset-negative', 'paint:', 'runtime:fill-'],
    label: 'How it is drawn',
    why: 'The value is computed, but this way of drawing it is not supported yet, so it is not drawn '
      + 'rather than drawn differently.',
  },
  {
    id: 'limits',
    exact: ['pine:window', 'pine:window-dependent', 'pine:budget', 'pine:timeout', 'runtime:limit',
      'runtime:time-budget', 'runtime:history-start', 'runtime:warmup-never-converges',
      'chart:scalar-current-only'],
    prefix: ['runtime:calc-bars-'],
    label: 'History and compute limits',
    why: 'This needs more history or more computing than a chart here allows, so it is withheld.',
  },
  {
    id: 'language',
    exact: ['pine:statement', 'pine:operator', 'pine:character', 'pine:cycle', 'pine:roundtrip',
      'pine:role-order', 'pine:empty', 'pine:declaration', 'pine:offset-literal', 'pine:chart-only',
      'runtime:statement', 'runtime:expression-statement', 'runtime:switch', 'runtime:block-value',
      'runtime:operator', 'runtime:directive', 'runtime:declaration', 'runtime:version',
      'runtime:lower', 'runtime:empty'],
    prefix: ['runtime:loop'],
    label: 'A Pine construct we do not run yet',
    why: 'This line uses a part of the Pine language we cannot run exactly yet.',
  },
  {
    id: 'held',
    exact: [HELD_GUARD],
    label: 'Held by the script engine',
    why: 'Today\'s script engine has not accepted this saved version, so alerts, screens and scans '
      + 'hold it until it is saved again from the Pine tab.',
  },
])

export const UNKNOWN_FAMILY = Object.freeze({
  id: 'unknown',
  label: 'Not supported yet',
  why: 'This part is not supported yet, so its value is withheld rather than guessed.',
})

/** The family of a guard name. Never throws; an unmatched guard is `unknown`. */
export function familyOf(guard) {
  if (typeof guard !== 'string' || !guard) return UNKNOWN_FAMILY
  for (const f of FAMILIES) if ((f.exact || []).includes(guard)) return f
  for (const f of FAMILIES) if ((f.prefix || []).some((p) => guard.startsWith(p))) return f
  return UNKNOWN_FAMILY
}

// ─── ITEMS ───────────────────────────────────────────────────────────────────

const isInt = (n) => Number.isInteger(n)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const outName = (out, i) => (out && (out.title || out.handle)) || (out && isInt(out.line) ? `line ${out.line}` : `output ${i + 1}`)
/** Missing parts `importOutcome` names that are not outputs. */
const PART_RE = /^pine:(strategy-|object-removal-lost)/

function item({ severity, kind, name, guard, reason, line = null, column = null }) {
  const fam = familyOf(guard)
  return {
    severity,
    kind,
    name,
    guard: guard || null,
    family: fam.id,
    label: fam.label,
    why: fam.why,
    reason: typeof reason === 'string' && reason ? reason : null,
    line: isInt(line) && line >= 1 ? line : null,
    column: isInt(column) && column >= 1 ? column : null,
  }
}

/** The pane document's plot `key`, named the way the report names an output, with
 *  the line its `plot(...)` was written on. A row's tree IS its output's tree
 *  (`memberPaneDefinition` copies `ast` by reference), so the output is found by
 *  identity, never by a second walk. A derived colour column (`conditionFor`) is
 *  named by what it colours. */
function plotWhere(pane, key) {
  const def = (pane && pane.definition) || {}
  const plots = Array.isArray(def.plots) ? def.plots : []
  const rows = Array.isArray(pane && pane.rows) ? pane.rows : plots
  const outs = (pane && pane.translation && Array.isArray(pane.translation.outputs)) ? pane.translation.outputs : []
  const rowOf = (k) => rows.find((r) => r && r.key === k) || plots.find((p) => p && p.key === k) || null
  const outOf = (row) => {
    const i = row && row.ast ? outs.findIndex((o) => o && o.ast === row.ast) : -1
    return i >= 0 ? { name: outName(outs[i], i), line: isInt(outs[i].line) ? outs[i].line : null } : null
  }
  const row = rowOf(key)
  if (row && row.conditionFor != null) {
    const column = `column:${key}`
    const named = []
    for (const p of plots) {
      if (!p) continue
      const own = outOf(rowOf(p.key)) || { name: p.label || p.key, line: null }
      if (p.colorMode === column) named.push(own)
      if (p.fill && p.fill.colorMode === column) named.push({ name: `fill of ${own.name}`, line: own.line })
    }
    for (const p of (Array.isArray(def.paints) ? def.paints : [])) {
      if (p && p.colorMode === column) named.push({ name: `\`${p.kind}\``, line: isInt(p.line) ? p.line : null })
    }
    const line = (named.find((n) => isInt(n.line)) || {}).line
    return { name: named.length ? `colour of ${named.map((n) => n.name).join(', ')}` : key, line: isInt(line) ? line : null }
  }
  return outOf(row) || { name: (row && row.label) || key, line: null }
}

/** C45/C48: the plots the chart's bind may refuse where their block (or arm) runs
 *  after a bar it skipped (`engine/blockRuns.js`). Read from the stamp the bind
 *  reads, `meta.blockRuns.keys`: data-dependent, so "may be withheld". */
function blockRunItems(pane) {
  const def = pane && pane.ok ? pane.definition : null
  const keys = (def && def.meta && def.meta.blockRuns && Array.isArray(def.meta.blockRuns.keys)) ? def.meta.blockRuns.keys : []
  const out = []
  for (const entry of keys) {
    if (!entry || !Array.isArray(entry.gates)) continue
    const where = plotWhere(pane, entry.key)
    const seen = new Set()
    for (const g of entry.gates) {
      if (!g || seen.has(g.why)) continue
      seen.add(g.why)
      out.push(item({
        severity: SEVERITY.MAY_WITHHOLD, kind: 'block-runs', name: where.name, guard: BLOCK_RUNS_GUARD,
        reason: g.why, line: where.line,
      }))
    }
  }
  return out
}

/** C29: the plots that folded a chart-period value (`meta.periodReads.keys`). The
 *  bind refuses them on a chart whose period gives a different value
 *  (`engine/periodReads.js`), so they may be withheld on some charts. The reason is
 *  that module's own sentence, on the first period of the stamp's ladder it refuses. */
function periodReadItems(pane) {
  const def = pane && pane.ok ? pane.definition : null
  const pr = def && def.meta && def.meta.periodReads
  const keys = (pr && Array.isArray(pr.keys)) ? pr.keys : []
  const rungs = (pr && isObj(pr.byTf)) ? Object.keys(pr.byTf) : []
  return keys.filter((k) => k && typeof k.key === 'string').map((entry) => {
    const where = plotWhere(pane, entry.key)
    let reason = null
    for (const tf of rungs) {
      reason = periodReadsRefusalFor(def, entry.key, tf)
      if (reason) break
    }
    return item({
      severity: SEVERITY.MAY_WITHHOLD, kind: 'period-reads', name: where.name, guard: PERIOD_READS_GUARD,
      reason, line: where.line,
    })
  })
}

/** The missing parts (a strategy's orders and backtest) the CHART door's own
 *  translation records, classified by the same `importOutcome` the report uses.
 *  ⭐ The report's lane refuses a strategy outright, so its outcome names no parts;
 *  the chart door reads the strategy and notes what it leaves out. */
function chartDoorParts(pane) {
  const t = pane && pane.ok ? pane.translation : null
  const notes = (t && Array.isArray(t.notes)) ? t.notes : []
  if (!notes.length) return []
  const o = importOutcome({ ok: true, dialect: 'pine', outputs: [], ignored: notes })
  return (o.missing || []).filter((m) => m && typeof m.guard === 'string' && PART_RE.test(m.guard))
    .map((m) => {
      const n = notes.find((x) => x && x.code === m.guard)
      return { ...m, line: n ? n.line : null }
    })
}

/** Every withheld / may-withhold / note item the report and the pane name.
 *  ⭐ A refusal's own `line` wins over its output's `line`: the refusal points at
 *  the construct, the output at the `plot(...)` that reads it.
 *  ⛔ ONE FACT, ONE ITEM: a sentence already listed is not listed again (a fold
 *  note reaches both the report's outcome and the pane's disclosures; a withheld
 *  paint's disclosure wraps the paint's own reason). */
export function statusItems(report, pane = null, opts = {}) {
  const items = []
  if (!report) return items
  const screenFact = (opts && opts.screenFact) || null
  const said = (text) => items.some((x) => x.reason === text)
  const outputs = Array.isArray(report.outputs) ? report.outputs : []
  const carried = new Set()
  outputs.forEach((out, i) => {
    if (!out) return
    if (!out.formula) {
      const r = out.refusal || {}
      carried.add(`${r.guard}::${r.token}::${r.line}`)
      items.push(item({
        severity: SEVERITY.WITHHELD, kind: 'output', name: outName(out, i), guard: r.guard,
        reason: r.message || 'not translated',
        line: isInt(r.line) ? r.line : out.line,
        column: r.column,
      }))
      return
    }
    if (out.hidden) return
    if (out.downstream && out.downstream.ok === false) {
      items.push(item({
        severity: SEVERITY.WITHHELD, kind: 'output', name: outName(out, i),
        guard: out.downstream.guard, reason: out.downstream.error || 'does not evaluate', line: out.line,
      }))
    }
  })
  const top = report.refusal
  const screenOnly = !!(screenFact && top && top.guard === screenFact.guard)
  if (top && !screenOnly && !carried.has(`${top.guard}::${top.token}::${top.line}`)) {
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'script', name: 'This script', guard: top.guard,
      reason: top.message, line: top.line, column: top.column,
    }))
  }
  // Missing parts `importOutcome` names that are not outputs (strategy orders, a
  // drawing program that lost a removal), from the report and from the chart door.
  // Their line, where a note gives one.
  const outcome = report.outcome || {}
  const ignored = Array.isArray(report.ignored) ? report.ignored : []
  const parts = [
    ...(outcome.missing || []).filter((m) => m && m.guard && PART_RE.test(m.guard)).map((m) => {
      const note = ignored.find((n) => n && n.code === m.guard)
      return { ...m, line: note ? note.line : null }
    }),
    ...chartDoorParts(pane),
  ]
  for (const m of parts) {
    if (items.some((x) => x.kind === 'part' && (x.guard === m.guard || x.name === m.name))) continue
    if (items.some((x) => x.guard === m.guard && x.reason === m.message)) continue
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'part', name: m.name, guard: m.guard,
      reason: m.message, line: m.line,
    }))
  }
  // ⭐ Withheld paints (`bgcolor` / `barcolor`). Paints are carried on the HOST lane
  // only (`pine.js::resolvePaints`), so the chart door's translation is the one
  // that has them; the report's are read when there is no such translation.
  const paintsFrom = (pane && pane.translation && pane.translation.presentation) || report.presentation
  const paints = (paintsFrom && Array.isArray(paintsFrom.paints)) ? paintsFrom.paints : []
  for (const p of paints) {
    if (!p || !p.withheld) continue
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'paint', name: `\`${p.kind}\``,
      guard: p.withheld.code || 'paint:withheld', reason: p.withheld.reason, line: p.line,
    }))
  }
  // Disclosed differences (values that can differ in a NAMED way): notes.
  for (const s of (outcome.semantic || [])) {
    if (!s) continue
    items.push(item({ severity: SEVERITY.NOTE, kind: 'difference', name: s.name, guard: null, reason: s.note, line: s.line }))
  }
  // A chart refusal the report did not already explain (the pane is stricter).
  if (pane && pane.ok === false && pane.reason && report.ok
    && !items.some((x) => x.severity === SEVERITY.WITHHELD && x.reason === pane.reason)) {
    items.push(item({ severity: SEVERITY.WITHHELD, kind: 'chart', name: 'On a chart', guard: pane.guard, reason: pane.reason }))
  }
  // What the chart's bind may refuse on some charts (data or period dependent).
  for (const it of [...blockRunItems(pane), ...periodReadItems(pane)]) items.push(it)
  if (pane && pane.ok && Array.isArray(pane.notes)) {
    for (const n of pane.notes) {
      if (!n || !n.note || said(n.note)) continue
      if (items.some((x) => x.kind === 'paint' && x.reason && n.note.includes(x.reason))) continue
      items.push(item({ severity: SEVERITY.NOTE, kind: 'pane-note', name: n.name, guard: null, reason: n.note }))
    }
  }
  return items
}

// ─── RUNS ON ─────────────────────────────────────────────────────────────────

/** The plots a member SEES and can pick on the pane document: data plots (not an
 *  `hlines` guide, the `evaluability.dataPlotKeys` predicate) that are not hidden.
 *  ⛔ A hidden row is a `fill` anchor, an objects-only script's anchor `0`, or a
 *  derived colour column: no alert watches it and no screen filters on it, so it
 *  never answers for a consumer. */
const shownPlotKeys = (def) => (Array.isArray(def && def.plots) ? def.plots : [])
  .filter((p) => p && p.style !== 'hlines' && typeof p.key === 'string' && !p.hidden).map((p) => p.key)

/** Does the document draw anything besides plots (an object program, or paints)? */
const drawsBeyondPlots = (def) => !!(def && ((def.objects && (def.objects.ops || []).length)
  || (Array.isArray(def.paints) && def.paints.length)))

/** Requirement tags whose manifest roster refuses `consumerTag`. */
function tagsRefusing(tags, consumerTag, table = TABLE) {
  const spec = (table && table._requirement_tags) || {}
  return (tags || []).filter((t) => {
    const s = spec[t]
    if (!s || typeof s !== 'object') return true // undeclared tag: fail closed, as the server does
    return !(s.accepted_by || []).includes(consumerTag)
  }).map((t) => ({ tag: t, calls: ((spec[t] && spec[t].calls) || []) }))
}

const RUNTIME_SERVER = Object.freeze({
  alerts: 'Alerts run on the server, which cannot run the bar-by-bar engine yet.',
  screener: 'Screens run on the server, which cannot run the bar-by-bar engine yet.',
  scans: 'Scans run on the server, which cannot run the bar-by-bar engine yet.',
})
const SERVER_RECHECKS = 'the server re-checks when you save or arm it'
const TAG_REFUSERS = Object.freeze({
  alerts: 'alerts refuse it', screener: 'the screener refuses it', scans: 'scans refuse it',
})

function tagSentence(refusing, consumerId) {
  const calls = [...new Set(refusing.flatMap((r) => r.calls))].map((c) => `\`${c}\``).join(', ')
  return `It uses ${calls || 'a value'}, whose value depends on how much history is loaded, so `
    + `${TAG_REFUSERS[consumerId]}.`
}

/** ⭐ Is the saved version held by the script engine? The browser's own answer,
 *  `upgradeKindOf` (`refused`), which the server's `engine_withheld_reason` is held
 *  equal to. ⛔ NOT `scan_refusal.gate === 'withheld'`: the sweep's C45 check
 *  (`scan_definition.assert_scannable`) refuses under that same gate. */
function isHeld(row) {
  if (!isObj(row)) return false
  try {
    return upgradeKindOf(row) === 'refused'
  } catch {
    return false
  }
}

/** The engine's own reason for the hold, verbatim, or null. */
const heldReason = (row) => {
  const st = isObj(row) ? row.engine_status : null
  return isObj(st) && typeof st.reason === 'string' && st.reason ? st.reason : null
}

/**
 * The four "Runs on" rows. `ok`: true / false / 'partial'.
 * @param {object|null} pane  memberPaneDefinition's result
 * @param {object|null} savedRow  the served row being edited, if any
 * @param {{withheldCount?: number, evaluate?: Function, screenFact?: {guard, message}}} [opts]
 */
export function runsOn(pane, savedRow = null, opts = {}) {
  const evaluate = opts.evaluate || evaluability
  const screenFact = opts.screenFact || null
  const rows = []
  const def = pane && pane.ok ? pane.definition : null
  const runtime = !!(pane && pane.lane === 'runtime')
  const shown = def ? shownPlotKeys(def) : []
  const drawsMore = drawsBeyondPlots(def)
  const tags = (pane && pane.requirementTags) || []
  // The chart door's own refusal, verbatim: no document, so nothing can run it.
  const paneWhy = {
    guard: (pane && pane.guard) || null, family: familyOf(pane && pane.guard).id, why: (pane && pane.reason) || null,
  }

  // chart
  if (!def) {
    rows.push({ id: 'chart', label: 'Chart', ok: false, count: 0, ...paneWhy })
  } else {
    const answers = shown.map((k) => evaluate(def, k, LANES.CHART, {}))
    const refused = answers.filter((a) => a && a.status === STATUS.REFUSED)
    const drawn = answers.length - refused.length
    const ok = drawn > 0 || drawsMore
    const partial = ok && ((opts.withheldCount || 0) > 0 || refused.length > 0)
    const first = refused[0] || null
    rows.push({
      id: 'chart', label: 'Chart', ok: ok ? (partial ? 'partial' : true) : false, count: drawn,
      guard: ok ? null : (first && first.guard) || null,
      family: ok ? null : familyOf(first && first.guard).id,
      why: ok ? null : (first && first.reason) || null,
    })
  }

  const held = isHeld(savedRow)
  const sr = !held && isObj(savedRow) && isObj(savedRow.scan_refusal) ? savedRow.scan_refusal : null
  const served = sr && typeof sr.detail === 'string' && sr.detail ? sr : null
  for (const c of CONSUMERS.slice(1)) {
    const screens = c.id !== 'alerts'
    const lane = screens ? LANES.SCAN : LANES.ALERT
    let row
    if (held) {
      // the server lanes hold that stored version whatever the editor shows
      row = { ok: false, guard: HELD_GUARD, family: 'held', why: familyOf(HELD_GUARD).why, detail: heldReason(savedRow) }
    } else if (screens && served) {
      // the server's own answer for screening this saved version, verbatim
      row = { ok: false, guard: `scan:${served.gate}`, family: null, why: served.detail, server: true }
    } else if (!def) {
      row = { ok: false, ...paneWhy }
    } else if (runtime) {
      row = { ok: false, why: RUNTIME_SERVER[c.id] }
    } else if (screens && screenFact) {
      row = { ok: false, guard: screenFact.guard, family: familyOf(screenFact.guard).id, why: screenFact.message }
    } else {
      const refusing = tagsRefusing(tags, c.tag)
      if (refusing.length) {
        row = { ok: false, why: tagSentence(refusing, c.id) }
      } else if (!shown.length) {
        row = screenFact
          ? { ok: false, guard: screenFact.guard, family: familyOf(screenFact.guard).id, why: screenFact.message }
          : { ok: false, why: null }
      } else {
        const answers = shown.map((k) => evaluate(def, k, lane, {}))
        const yes = answers.filter((a) => a && a.status !== STATUS.REFUSED)
        if (yes.length) {
          row = { ok: true, why: null, note: SERVER_RECHECKS, count: yes.length }
        } else {
          const first = answers[0] || null
          row = { ok: false, guard: (first && first.guard) || null, why: (first && first.reason) || null }
        }
      }
    }
    rows.push({ id: c.id, label: c.label, guard: null, family: null, ...row })
  }
  return rows
}

// ─── STATUS ──────────────────────────────────────────────────────────────────

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * The whole panel's data.
 * @param {{report, pane, savedRow, evaluate}} arg
 */
export function editorStatus({ report, pane = null, savedRow = null, evaluate } = {}) {
  try {
    const outcome = (report && report.outcome) || {}
    if (!report) return null
    if (outcome.verdict === OUTCOME.ERROR) {
      const items = statusItems(report, null)
      return {
        contract: EDITOR_STATUS_CONTRACT, state: PANEL_STATE.ENGINE_ERROR,
        headline: familyOf('import:internal-error').why, lane: null, runsOn: runsOn(null, savedRow, { evaluate }),
        items, stillWorks: null,
      }
    }
    // A screening fact the report's lane raised while the chart door draws the script.
    const top = report.refusal
    const screenFact = (pane && pane.ok && top && SCREENER_LANE_REFUSALS.has(top.guard) && typeof top.message === 'string')
      ? { guard: top.guard, message: top.message } : null
    const items = statusItems(report, pane, { screenFact })
    const withheld = items.filter((x) => x.severity === SEVERITY.WITHHELD)
    const others = items.filter((x) => x.severity !== SEVERITY.WITHHELD)
    const consumers = runsOn(pane, savedRow, { withheldCount: withheld.length, evaluate, screenFact })
    const anyRuns = consumers.some((r) => r.ok)
    const def = pane && pane.ok ? pane.definition : null
    let state
    let headline
    if (!anyRuns) {
      state = PANEL_STATE.NOT_YET
      // The chart door's own refusal names the blocker when it has a guard.
      const blocker = (pane && pane.ok === false && pane.guard) ? pane.guard
        : ((withheld[0] || items[0] || {}).guard || (pane && pane.guard) || null)
      headline = `Not yet: ${familyOf(blocker).label}`
    } else if (withheld.length) {
      state = PANEL_STATE.RUNS_WITHHELD
      headline = `Runs, ${plural(withheld.length, 'value', 'values')} withheld (not guessed)`
    } else if (others.length) {
      state = PANEL_STATE.RUNS_WITH_NOTES
      headline = `Runs, with ${plural(others.length, 'note', 'notes')}`
    } else {
      state = PANEL_STATE.RUNS
      headline = 'Runs fully'
    }
    return {
      contract: EDITOR_STATUS_CONTRACT,
      state,
      headline,
      lane: def ? (pane.lane === 'runtime' ? 'runtime' : 'host') : null,
      runsOn: consumers,
      items,
      stillWorks: anyRuns ? { plots: consumers[0].count || 0, drawings: drawsBeyondPlots(def) } : null,
    }
  } catch (e) {
    return {
      contract: EDITOR_STATUS_CONTRACT, state: PANEL_STATE.ENGINE_ERROR,
      headline: familyOf('import:internal-error').why, lane: null, runsOn: [], items: [],
      stillWorks: null, error: String((e && e.message) || e),
    }
  }
}

/** "What still works" in words: the plots the chart draws, and its drawings
 *  (an object program or paints). */
export function stillWorksText(sw) {
  if (!sw) return 'Nothing else runs yet.'
  const parts = []
  if (sw.plots > 0) parts.push(plural(sw.plots, 'plot', 'plots'))
  if (sw.drawings) parts.push('its drawings')
  return parts.length ? `What still works: ${parts.join(' and ')}.` : 'Nothing else runs yet.'
}

// ─── LINE MAPPING ────────────────────────────────────────────────────────────

/** How many lines `text` has, the way CodeMirror counts (an empty doc has one). */
export function lineCount(text) {
  if (typeof text !== 'string') return 0
  let n = 1
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1
  return n
}

/**
 * Status items -> one mark per source line.
 * ⛔ A line outside 1..lineCount is DROPPED, never clamped: a clamped mark sits on
 * the wrong line. ⛔ The worst severity on a line wins. ⛔ `source` is the text
 * the report was computed on; the editor applies the marks only while its own
 * document equals it (the X13 stale-text contract).
 *
 * @returns {{source: string, marks: Array<{line, severity, message, guards: string[]}>}}
 */
export function lineMarks(status, source) {
  const out = { source: typeof source === 'string' ? source : '', marks: [] }
  if (!status || !Array.isArray(status.items) || typeof source !== 'string') return out
  const max = lineCount(source)
  const byLine = new Map()
  for (const it of status.items) {
    if (!it || !isInt(it.line) || it.line < 1 || it.line > max) continue
    const msg = `${it.label}: ${it.reason || it.why}`
    const prev = byLine.get(it.line)
    if (!prev) {
      byLine.set(it.line, { line: it.line, severity: it.severity, message: msg, guards: it.guard ? [it.guard] : [] })
      continue
    }
    if (SEVERITY_RANK[it.severity] > SEVERITY_RANK[prev.severity]) prev.severity = it.severity
    if (!prev.message.split('\n').includes(msg)) prev.message = `${prev.message}\n${msg}`
    if (it.guard && !prev.guards.includes(it.guard)) prev.guards.push(it.guard)
  }
  out.marks = [...byLine.values()].sort((a, b) => a.line - b.line)
  return out
}

/** The text of line `n` of `source` (1-based), trimmed, or null. */
export function sourceLine(source, n) {
  if (typeof source !== 'string' || !isInt(n) || n < 1) return null
  const lines = source.split('\n')
  return n <= lines.length ? lines[n - 1].trim() : null
}
