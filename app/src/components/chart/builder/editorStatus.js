// app/src/components/chart/builder/editorStatus.js
//
// ─── THE PINE EDITOR'S STATUS PANEL, AS DATA ─────────────────────────────────
//
// Spec: `docs/pine/EDITOR-STATUS-PANEL-SPEC.md`. This module DECIDES NOTHING about
// translation, drawing or consumers. It folds facts other readers already own into
// one object the panel renders, and ⛔ EVERY ROW ANSWERS FROM THE LANE THAT
// CONSUMER ACTUALLY USES, through that lane's own function (one authority per value):
//
//   chart     the CHART DOOR, `memberPaneDefinition({source})`: the strict host lane,
//             or the runtime lane when it routes. The chart row and the per-line
//             withheld list are its answers and nothing else's.
//   screener  the REPORT, `PineBox.inspectSource`: the screener lane's translation,
//   scans     the one "Use this formula" (`PineBox.jsx::PasteBox.use`) hands the
//             Builder to save as a screen. Each output is asked
//             `evaluability(..., LANES.SCAN)`; its refusals are shown on these two
//             rows, named, verbatim, and never as a withheld chart value.
//   alerts    every stored definition the alert lane reads (`alert_user_series.py::
//             user_catalog`): one saved from the report through "Use this formula"
//             (the only door an `alertcondition` reaches: the chart door never
//             carries one), or the chart door's host document saved from the Pine
//             tab. Each asked `evaluability(..., LANES.ALERT)`; any yes is a yes.
//   saved     a served row: held when `isHeld` (the browser's twin of
//             `engine_withheld_reason`); its `scan_refusal` answers for screens only
//             while the editor holds that version's own script.
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
import { requirementTagsRaised } from './memberPane/memberPaneDefinition'

export const EDITOR_STATUS_CONTRACT = 'editor-status/1'

export const PANEL_STATE = Object.freeze({
  CHECKING: 'checking',
  ENGINE_ERROR: 'engine-error',
  NOT_YET: 'not-yet',
  RUNS_ELSEWHERE: 'runs-elsewhere',
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
    exact: ['pine:function-def', 'runtime:function', 'runtime:recursion', 'runtime:unbound',
      'runtime:discarded-value'],
    label: 'Your own functions',
    why: 'This function is written in a way we cannot run exactly yet.',
  },
  {
    id: 'builtin',
    // ⭐ `pine:function` IS A BUILT-IN REFUSAL at every one of its throw sites in
    // `pine.js` (`time_close`, the period anchors, `time(<tf>, <session>)`, a bare
    // pre-v5 name, a call whose tuple cannot be carried), and
    // `doorCoverage.js::UNKNOWN_NAME_GUARDS` groups it with `pine:builtin` and
    // `pine:undefined`. It is not about the author's own functions.
    exact: ['pine:builtin', 'pine:function', 'pine:arity', 'pine:named-argument', 'pine:undefined',
      'runtime:builtin-args', 'runtime:call-undeclared-builtin-state'],
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
      'runtime:lower', 'runtime:empty', 'runtime:udt-method', 'runtime:call-text-state'],
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

// ─── ITEMS (the CHART DOOR's per-line list) ──────────────────────────────────

const isInt = (n) => Number.isInteger(n)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const outName = (out, i) => (out && (out.title || out.handle)) || (out && isInt(out.line) ? `line ${out.line}` : `output ${i + 1}`)
/** Missing parts `importOutcome` names that are not outputs. */
const PART_RE = /^pine:(strategy-|object-removal-lost)/
const refusalKey = (r) => `${r && r.guard}::${r && r.token}::${r && r.line}`

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


/** ⭐ WHAT THE CHART DOOR REFUSED, when it draws nothing: its own translation's
 *  refusals, each on the line that causes it (a host-lane refusal of ONE plot
 *  refuses the whole script, so the chart withholds every plot because of it).
 *  ⛔ The translation's top refusal is listed only when it IS the door's refusal: a
 *  dirty objects-only program is refused for its lost removal, while its
 *  translation still carries `pine:objects-only`, a fact about screens. A door
 *  refusal with no line of its own (a paint-only pane, a lost removal) is ONE item;
 *  one with no guard ("nothing a chart can draw") is the chart row's alone. */
function chartDoorRefusals(pane) {
  if (!pane || pane.ok !== false) return []
  const t = isObj(pane.translation) ? pane.translation : null
  const items = []
  const carried = new Set()
  const outs = (t && Array.isArray(t.outputs)) ? t.outputs : []
  outs.forEach((out, i) => {
    if (!out || out.formula || !isObj(out.refusal)) return
    const r = out.refusal
    carried.add(refusalKey(r))
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'output', name: outName(out, i), guard: r.guard,
      reason: r.message,
      line: isInt(r.line) ? r.line : out.line,
      column: r.column,
    }))
  })
  const top = t && isObj(t.refusal) ? t.refusal : null
  if (top && top.message && pane.reason === top.message && !carried.has(refusalKey(top))) {
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'script', name: 'This script', guard: top.guard,
      reason: top.message, line: top.line, column: top.column,
    }))
  }
  if (!items.length && pane.guard) {
    items.push(item({ severity: SEVERITY.WITHHELD, kind: 'chart', name: 'On a chart', guard: pane.guard, reason: pane.reason }))
  }
  return items
}

/** The missing parts the CHART door leaves out (a strategy's orders and backtest, a
 *  drawing program that lost a removal), classified by the same `importOutcome` the
 *  report uses, over the chart door's own translation.
 *  ⭐ The report's lane refuses a strategy outright, so its outcome names no parts;
 *  the chart door reads the strategy and notes what it leaves out.
 *  ⛔ The host program's drawings are the HOST lane's: a runtime document draws its
 *  own (or names them in its own disclosures). */
function chartDoorParts(pane) {
  const t = pane && pane.ok && isObj(pane.translation) ? pane.translation : null
  if (!t) return []
  const notes = Array.isArray(t.notes) ? t.notes : []
  const host = pane.lane !== 'runtime'
  const o = importOutcome({
    ok: true, dialect: 'pine', outputs: [], ignored: notes,
    ...(host ? { objects: t.objects || null, objectDiagnostics: t.objectDiagnostics || null } : {}),
  })
  return (o.missing || []).filter((m) => m && typeof m.guard === 'string' && PART_RE.test(m.guard))
    .map((m) => {
      const n = notes.find((x) => x && x.code === m.guard)
      return { ...m, line: n ? n.line : null }
    })
}

/** A paint's name the way the chart door's own disclosures write it. */
const paintName = (p) => '`' + p.kind + '`'
const paintNameAt = (p) => paintName(p) + (isInt(p.line) ? ' (line ' + p.line + ')' : '')

/** ⭐ The paints (`bgcolor` / `barcolor`) the chart door does not draw, on their lines.
 *  HOST lane: the translator's own verdict on each record (`pine.js::resolvePaints`).
 *  RUNTIME lane: the runtime document is the authority for what it draws. A host
 *  record it colours from its own run (`RUNTIME_PAINT_COLOUR_CODES`) is drawn, so it
 *  is not withheld; one it does not draw is named by the runtime document's own
 *  disclosure (`<paint> (line N) is not drawn: ...`), which is the reason, verbatim. */
function chartDoorPaints(pane) {
  const t = pane && pane.ok && isObj(pane.translation) ? pane.translation : null
  const records = (t && isObj(t.presentation) && Array.isArray(t.presentation.paints)) ? t.presentation.paints.filter(Boolean) : []
  const out = []
  if (pane && pane.lane === 'runtime') {
    const notes = Array.isArray(pane.notes) ? pane.notes : []
    for (const p of records) {
      const said = notes.find((n) => n && n.name === paintNameAt(p) && typeof n.note === 'string')
      if (!said) continue
      out.push(item({
        severity: SEVERITY.WITHHELD, kind: 'paint', name: paintName(p),
        guard: (p.withheld && p.withheld.code) || 'paint:withheld', reason: said.note, line: p.line,
      }))
    }
    return out
  }
  for (const p of records) {
    if (!p.withheld) continue
    out.push(item({
      severity: SEVERITY.WITHHELD, kind: 'paint', name: paintName(p),
      guard: p.withheld.code || 'paint:withheld', reason: p.withheld.reason, line: p.line,
    }))
  }
  return out
}

/** ⭐ RUNTIME lane: the rows its document does not draw (`withheld`, by label), each
 *  with the document's own disclosure as the reason, on its plot's line where the
 *  plot is titled. */
function runtimeRows(pane) {
  if (!pane || !pane.ok || pane.lane !== 'runtime' || !Array.isArray(pane.withheld)) return []
  const notes = Array.isArray(pane.notes) ? pane.notes : []
  const outs = (isObj(pane.translation) && Array.isArray(pane.translation.outputs)) ? pane.translation.outputs : []
  return pane.withheld.filter((l) => typeof l === 'string' && l).map((label) => {
    const said = notes.find((n) => n && n.name === label && typeof n.note === 'string')
    const out = outs.find((o) => o && o.title === label)
    return item({
      severity: SEVERITY.WITHHELD, kind: 'output', name: label, guard: null,
      reason: said ? said.note : null, line: out && isInt(out.line) ? out.line : null,
    })
  })
}

/** Every withheld / may-withhold / note item, from the CHART door (its per-line
 *  withheld list) and the report's disclosed differences (notes).
 *  ⛔ A plot is withheld here ONLY if the chart door withholds it. A screener-lane
 *  refusal of a plot the chart draws is a fact about SCREENS: it is on the Screener
 *  and Scans rows (`runsOn`), never on a line, never counted, never "Tell us".
 *  ⭐ A refusal's own `line` wins over its output's `line`: the refusal points at
 *  the construct, the output at the `plot(...)` that reads it.
 *  ⛔ ONE FACT, ONE ITEM: a sentence already listed is not listed again (a fold
 *  note reaches both the report's outcome and the pane's disclosures; a withheld
 *  paint's disclosure wraps the paint's own reason). */
export function statusItems(report, pane = null) {
  const items = []
  const said = (text) => items.some((x) => x.reason === text)
  for (const it of chartDoorRefusals(pane)) items.push(it)
  for (const m of chartDoorParts(pane)) {
    if (items.some((x) => x.kind === 'part' && (x.guard === m.guard || x.name === m.name))) continue
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'part', name: m.name, guard: m.guard,
      reason: m.message, line: m.line,
    }))
  }
  for (const it of chartDoorPaints(pane)) items.push(it)
  for (const it of runtimeRows(pane)) items.push(it)
  // Disclosed differences (values that can differ in a NAMED way): notes.
  const outcome = (report && report.outcome) || {}
  for (const s of (outcome.semantic || [])) {
    if (!s) continue
    items.push(item({ severity: SEVERITY.NOTE, kind: 'difference', name: s.name, guard: null, reason: s.note, line: s.line }))
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

const SERVER_RECHECKS = 'the server re-checks when you save or arm it'
const TAG_REFUSERS = Object.freeze({
  alerts: 'alerts refuse it', screener: 'the screener refuses it', scans: 'scans refuse it',
})

/** ⛔ PANEL-WRITTEN (spec section 4): the engine's sentence for this refusal
 *  (`user_definitions.consumer_refusal`) is written on the server at save or arm
 *  time and has no browser twin, so the panel states the roster fact itself. */
function tagSentence(refusing, consumerId) {
  const calls = [...new Set(refusing.flatMap((r) => r.calls))].map((c) => '`' + c + '`').join(', ')
  return 'It uses ' + (calls || 'a value') + ', whose value depends on how much history is loaded, so '
    + TAG_REFUSERS[consumerId] + '.'
}

/** ⭐ Is the saved version held by the script engine? The browser's own answers,
 *  each the twin of one branch of `user_definitions.py::engine_withheld_reason`:
 *  `upgradeKindOf` says `refused` (today's engine refused it, or an older engine
 *  refused the very maths it still carries), or an older engine refused it and it
 *  waits for today's engine to translate its script again (`_awaits_retranslation`,
 *  the browser's `retranslate`).
 *  ⛔ NOT `scan_refusal.gate === 'withheld'`: the sweep's C45 check
 *  (`scan_definition.assert_scannable`) refuses under that same gate. */
function isHeld(row) {
  if (!isObj(row)) return false
  try {
    const kind = upgradeKindOf(row)
    if (kind === 'refused') return true
    return kind === 'retranslate' && isObj(row.engine_status) && row.engine_status.status === 'refused'
  } catch {
    return false
  }
}

/** The engine's own reason for the hold, verbatim, or null. */
const heldReason = (row) => {
  const st = isObj(row) ? row.engine_status : null
  return isObj(st) && typeof st.reason === 'string' && st.reason ? st.reason : null
}

/** ⭐ The server's answer for screening the SAVED version (its `scan_refusal`, any
 *  gate), or null. ⛔ It describes that version's script, so it answers only while the
 *  editor holds exactly that script (`pine_source`, or a runtime document's
 *  `compute.source`); for any other text the rows answer live. */
function servedRefusal(row, inspected) {
  if (!isObj(row) || !isObj(row.scan_refusal)) return null
  const sr = row.scan_refusal
  if (typeof sr.detail !== 'string' || !sr.detail || typeof inspected !== 'string' || !inspected) return null
  const compute = isObj(row.definition) && isObj(row.definition.compute) ? row.definition.compute : null
  const own = row.pine_source === inspected
    || !!(compute && compute.kind === 'runtime' && compute.source === inspected)
  return own ? sr : null
}

/** ⭐⭐ THE REPORT LANE: what "Use this formula" (`PineBox.jsx::PasteBox.use`) can hand
 *  the Builder to save as a screen or an alert. The box offers the report's outputs
 *  only while the report is `ok`, and offers exactly its `usable` set (a formula, not
 *  hidden); the saved document carries each one's own tree (C2D.1: one translation
 *  result). `evaluability` reads only `compute.kind`, the plot keys and each plot's
 *  own tree, so `doc` asks it exactly what it would ask of that saved document.
 *  ⛔ A refused output, or one the formula lane cannot evaluate (`downstream`), is
 *  NAMED with its own sentence (`refused`), never guessed into a yes.
 *  ⭐ A refused row carries no title of its own (`pine.js`: `title: out.role`), so it
 *  is named by the title the CHART door's translation gives the same `plot(...)` (same
 *  kind, same line, exactly one), else by its line, as the paste box names it. */
function reportLane(report, pane = null) {
  const lane = { entries: [], refused: [], top: null, doc: null, tags: [] }
  if (!report) return lane
  const outputs = Array.isArray(report.outputs) ? report.outputs : []
  const doorOuts = (pane && isObj(pane.translation) && Array.isArray(pane.translation.outputs)) ? pane.translation.outputs : []
  const refusedName = (out, i) => {
    const same = doorOuts.filter((o) => o && o.kind === out.kind && isInt(o.line) && o.line === out.line)
    return same.length === 1 && same[0].title ? same[0].title : outName(out, i)
  }
  outputs.forEach((out, i) => {
    if (!out) return
    if (!out.formula) {
      const r = out.refusal || {}
      lane.refused.push({ name: refusedName(out, i), guard: r.guard || null, family: familyOf(r.guard).id, why: r.message || null, key: refusalKey(r) })
      return
    }
    if (out.hidden) return
    if (out.downstream && out.downstream.ok === false) {
      const g = out.downstream.guard || null
      lane.refused.push({ name: outName(out, i), guard: g, family: familyOf(g).id, why: out.downstream.error || null, key: 'downstream::' + i })
      return
    }
    if (report.ok && isObj(out.ast)) lane.entries.push({ key: 'o' + i, name: outName(out, i), ast: out.ast })
  })
  const top = isObj(report.refusal) ? report.refusal : null
  if (!report.ok && top && top.message) {
    const own = lane.refused.find((r) => r.key === refusalKey(top))
    lane.top = { guard: top.guard || null, family: familyOf(top.guard).id, why: top.message, subject: own ? own.name : null, key: own ? own.key : null }
  }
  if (lane.entries.length) {
    lane.doc = {
      compute: { kind: 'ast', trees: Object.fromEntries(lane.entries.map((e) => [e.key, e.ast])) },
      plots: lane.entries.map((e) => ({ key: e.key })),
    }
    lane.tags = requirementTagsRaised({ outputs: lane.entries })
  }
  return lane
}

const yesOf = (a) => !!a && a.status !== STATUS.REFUSED

/** The report lane's answer for one consumer: the names it can run, or why not
 *  (`own`: the refused output the reason already names, so it is not listed twice). */
function laneAnswer(lane, laneId, consumer, evaluate) {
  if (lane.top) {
    return { works: [], why: { guard: lane.top.guard, family: lane.top.family, why: lane.top.why, subject: lane.top.subject }, own: lane.top.key }
  }
  if (!lane.doc) return { works: [], why: null, own: null }
  const refusing = tagsRefusing(lane.tags, consumer.tag)
  if (refusing.length) return { works: [], why: { why: tagSentence(refusing, consumer.id) }, own: null }
  const answers = lane.entries.map((e) => ({ e, a: evaluate(lane.doc, e.key, laneId, {}) }))
  const works = answers.filter((x) => yesOf(x.a)).map((x) => x.e.name)
  const first = answers.find((x) => !yesOf(x.a))
  return {
    works,
    why: first ? {
      guard: (first.a && first.a.guard) || null,
      family: first.a && first.a.guard ? familyOf(first.a.guard).id : null,
      why: (first.a && first.a.reason) || null,
      subject: answers.length === 1 ? first.e.name : null,
    } : null,
    own: null,
  }
}

const unique = (xs) => [...new Set(xs.filter((x) => typeof x === 'string' && x))]

/**
 * The four "Runs on" rows. `ok`: true / false / 'partial'. Each row answers from the
 * lane that consumer uses (see the file header).
 * @param {object|null} pane  memberPaneDefinition's result (the chart door)
 * @param {object|null} savedRow  the served row being edited, if any
 * @param {{report?: object, inspectedSource?: string, withheldCount?: number, evaluate?: Function}} [opts]
 */
export function runsOn(pane, savedRow = null, opts = {}) {
  const evaluate = opts.evaluate || evaluability
  const rows = []
  const def = pane && pane.ok ? pane.definition : null
  const shown = def ? shownPlotKeys(def) : []
  const drawsMore = drawsBeyondPlots(def)
  // The chart door's own refusal, verbatim: no document, so nothing can run it.
  const paneWhy = {
    guard: (pane && pane.guard) || null, family: familyOf(pane && pane.guard).id, why: (pane && pane.reason) || null,
  }

  // chart: the chart door
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

  const lane = reportLane(opts.report || null, pane)
  const held = isHeld(savedRow)
  const heldRow = () => ({ ok: false, guard: HELD_GUARD, family: 'held', why: familyOf(HELD_GUARD).why, detail: heldReason(savedRow) })

  // alerts: every stored definition the alert lane reads, the report's ("Use this
  // formula") and the chart door's host document; any yes is a yes.
  let alerts
  if (held) {
    // the server lanes hold that stored version whatever the editor shows
    alerts = heldRow()
  } else {
    const viaReport = laneAnswer(lane, LANES.ALERT, CONSUMERS[1], evaluate)
    const chartTags = def ? tagsRefusing(pane.requirementTags || [], CONSUMERS[1].tag) : []
    const chartAnswers = def && !chartTags.length ? shown.map((k) => ({ k, a: evaluate(def, k, LANES.ALERT, {}) })) : []
    const viaChart = chartAnswers.filter((x) => yesOf(x.a)).map((x) => plotWhere(pane, x.k).name)
    const works = unique([...viaReport.works, ...viaChart])
    if (works.length) {
      alerts = { ok: true, why: null, note: SERVER_RECHECKS, count: works.length, works }
    } else {
      const chartFirst = chartAnswers.find((x) => !yesOf(x.a))
      const why = viaReport.why
        || (chartTags.length ? { why: tagSentence(chartTags, 'alerts') } : null)
        || (chartFirst ? { guard: (chartFirst.a && chartFirst.a.guard) || null, why: (chartFirst.a && chartFirst.a.reason) || null } : null)
        || (!def && pane ? paneWhy : null)
        || { why: null }
      alerts = { ok: false, works: [], ...why }
    }
  }
  rows.push({ id: 'alerts', label: 'Alerts', guard: null, family: null, ...alerts })

  // screener and scans: the report lane, the one the screener and the sweep save from
  const served = held ? null : servedRefusal(savedRow, opts.inspectedSource)
  for (const c of CONSUMERS.slice(2)) {
    let row
    if (held) {
      row = heldRow()
    } else if (served) {
      // the server's own answer for screening this saved version, verbatim
      row = { ok: false, guard: 'scan:' + served.gate, family: null, why: served.detail, server: true }
    } else {
      const ans = laneAnswer(lane, LANES.SCAN, c, evaluate)
      row = ans.works.length
        ? { ok: true, why: null, note: SERVER_RECHECKS, count: ans.works.length, works: ans.works }
        : { ok: false, works: [], ...(ans.why || { why: null }) }
      // ⭐ the screener lane's refusals of single plots, named, verbatim (the one the
      // row's own reason already names is not repeated)
      row.refused = lane.refused.filter((r) => r.key !== ans.own)
        .map((r) => ({ name: r.name, guard: r.guard, family: r.family, why: r.why }))
    }
    rows.push({ id: c.id, label: c.label, guard: null, family: null, ...row })
  }
  return rows
}

// ─── STATUS ──────────────────────────────────────────────────────────────────

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
const listJoin = (xs, word) => (xs.length <= 1 ? (xs[0] || '')
  : xs.slice(0, -1).join(', ') + ' ' + word + ' ' + xs[xs.length - 1])
const nameList = (names) => {
  const xs = unique(names)
  return xs.length > 3 ? xs.slice(0, 3).join(', ') + ' and ' + (xs.length - 3) + ' more' : listJoin(xs, 'and')
}
/** How the headline and "What still works" name each server consumer. */
const WHERE = Object.freeze({ alerts: 'alerts', screener: 'screens', scans: 'scans' })

/** "Runs" / "Runs on the chart and in alerts" / "Runs in alerts and screens". */
function runsWhere(consumers) {
  const [chart, ...rest] = consumers
  if (chart.ok && rest.every((r) => r.ok)) return 'Runs'
  const others = rest.filter((r) => r.ok).map((r) => WHERE[r.id])
  if (chart.ok) return others.length ? 'Runs on the chart and in ' + listJoin(others, 'and') : 'Runs on the chart'
  return 'Runs in ' + listJoin(others, 'and')
}

/** "What still works": what each consumer row says runs, each from its own lane. */
function stillWorksOf(consumers, def) {
  const by = Object.fromEntries(consumers.map((r) => [r.id, r]))
  const listOf = (r) => (r && r.ok && Array.isArray(r.works) ? r.works : [])
  return {
    plots: by.chart && by.chart.ok ? (by.chart.count || 0) : 0,
    drawings: !!(by.chart && by.chart.ok) && drawsBeyondPlots(def),
    alerts: listOf(by.alerts),
    screener: listOf(by.screener),
    scans: listOf(by.scans),
  }
}

/**
 * The whole panel's data.
 * @param {{report, pane, savedRow, inspectedSource, evaluate}} arg
 */
export function editorStatus({ report, pane = null, savedRow = null, inspectedSource = null, evaluate } = {}) {
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
    const items = statusItems(report, pane)
    const withheld = items.filter((x) => x.severity === SEVERITY.WITHHELD)
    const others = items.filter((x) => x.severity !== SEVERITY.WITHHELD)
    const consumers = runsOn(pane, savedRow, { report, inspectedSource, withheldCount: withheld.length, evaluate })
    const anyRuns = consumers.some((r) => r.ok)
    const def = pane && pane.ok ? pane.definition : null
    let state
    let headline
    if (!anyRuns) {
      state = PANEL_STATE.NOT_YET
      // The chart door's own refusal names the blocker when it has a guard.
      const blocker = (pane && pane.ok === false && pane.guard) ? pane.guard
        : ((withheld[0] || items[0] || {}).guard || (isObj(report.refusal) && report.refusal.guard) || (pane && pane.guard) || null)
      headline = `Not yet: ${familyOf(blocker).label}`
    } else if (!consumers[0].ok) {
      // ⛔ NEVER "Not yet" WHILE A CONSUMER RUNS: where it runs, and why the chart does not.
      state = PANEL_STATE.RUNS_ELSEWHERE
      const why = pane && pane.guard ? familyOf(pane.guard).label : ((pane && pane.reason) || UNKNOWN_FAMILY.label)
      headline = runsWhere(consumers) + '; the chart cannot draw it yet: ' + why
    } else if (withheld.length) {
      state = PANEL_STATE.RUNS_WITHHELD
      headline = runsWhere(consumers) + ', ' + plural(withheld.length, 'value', 'values') + ' withheld (not guessed)'
    } else if (others.length) {
      state = PANEL_STATE.RUNS_WITH_NOTES
      headline = runsWhere(consumers) + ', with ' + plural(others.length, 'note', 'notes')
    } else {
      state = PANEL_STATE.RUNS
      // ⛔ "Runs fully" only when EVERY consumer row runs; otherwise say what does not.
      const missing = consumers.slice(1).filter((r) => !r.ok).map((r) => WHERE[r.id])
      headline = missing.length ? runsWhere(consumers) + '; not in ' + listJoin(missing, 'or') : 'Runs fully'
    }
    return {
      contract: EDITOR_STATUS_CONTRACT,
      state,
      headline,
      lane: def ? (pane.lane === 'runtime' ? 'runtime' : 'host') : null,
      runsOn: consumers,
      items,
      stillWorks: anyRuns ? stillWorksOf(consumers, def) : null,
    }
  } catch (e) {
    return {
      contract: EDITOR_STATUS_CONTRACT, state: PANEL_STATE.ENGINE_ERROR,
      headline: familyOf('import:internal-error').why, lane: null, runsOn: [], items: [],
      stillWorks: null, error: String((e && e.message) || e),
    }
  }
}

/** "What still works" in words: what the chart draws, then each server consumer's
 *  own list (`What still works: 2 plots on the chart; RSI and OB in alerts; OB in
 *  screens and scans.`). Consumers with the same list share one clause. */
export function stillWorksText(sw) {
  if (!sw) return 'Nothing else runs yet.'
  const parts = []
  if (sw.plots > 0) parts.push(plural(sw.plots, 'plot', 'plots') + (sw.drawings ? ' and its drawings' : '') + ' on the chart')
  else if (sw.drawings) parts.push('its drawings on the chart')
  const groups = []
  for (const id of ['alerts', 'screener', 'scans']) {
    const names = unique(Array.isArray(sw[id]) ? sw[id] : [])
    if (!names.length) continue
    const key = JSON.stringify(names)
    const g = groups.find((x) => x.key === key)
    if (g) g.where.push(WHERE[id])
    else groups.push({ key, names, where: [WHERE[id]] })
  }
  for (const g of groups) parts.push(nameList(g.names) + ' in ' + listJoin(g.where, 'and'))
  return parts.length ? 'What still works: ' + parts.join('; ') + '.' : 'Nothing else runs yet.'
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
