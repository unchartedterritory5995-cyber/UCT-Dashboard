// app/src/components/chart/builder/editorStatus.js
//
// ─── THE PINE EDITOR'S STATUS PANEL, AS DATA ─────────────────────────────────
//
// Spec: `docs/pine/EDITOR-STATUS-PANEL-SPEC.md`. This module DECIDES NOTHING about
// translation, drawing or consumers. It folds facts other readers already own into
// one object the panel renders:
//
//   report    `PineBox.inspectSource` (refusals verbatim, `outcome` = importOutcome)
//   pane      `memberPaneDefinition({source})` (what a chart draws, which lane)
//   consumers `engine/evaluability.js::evaluability` over the pane document
//   tags      `closedTable.json::_requirement_tags[tag].refused_by`
//   saved     a served row's `scan_refusal` (gate `withheld` = engine_withheld_reason)
//
// It adds two things of its own and only two: a plain-English FAMILY per guard
// (`familyOf`, section 4 of the spec) and the LINE MAPPING (`lineMarks`). The
// engine's sentence is carried verbatim beside the family's, never replaced.
//
// ⛔ PURE, NEVER THROWS, WRITES NOTHING. A throw becomes the engine-fault state.
// ⛔ No copy in this file contains an em dash (rail: editorStatus.families.test.js).

import { evaluability, LANES, STATUS } from '../engine/evaluability'
import { TABLE } from '../engine/ast/parse'
import { OUTCOME } from '../engine/ast/importOutcome'

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

// ─── FAMILIES ────────────────────────────────────────────────────────────────

/** Section 4 of the spec. `exact` guards first, then `prefix`es, first match wins. */
export const FAMILIES = Object.freeze([
  {
    id: 'block',
    exact: ['pine:block'],
    label: 'Code that does not run on every bar',
    why: 'On a chart where this code skips a bar and then runs again, TradingView\'s value depends on '
      + 'history we do not keep, so the plot is withheld on that chart.',
  },
  {
    id: 'request',
    exact: ['pine:request', 'bind:period-reads'],
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
    exact: ['pine:no-output', 'pine:hidden-only', 'pine:constant-only', 'pine:presentation-only',
      'runtime:no-output', 'runtime:object-tree-outputs'],
    label: 'Nothing a chart can draw',
    why: 'The script has nothing a chart can draw: no visible plot, or only constant or hidden values.',
  },
  {
    id: 'fault',
    exact: ['import:internal-error', 'runtime:failed', 'runtime:build', 'runtime:unnamed-refusal',
      'runtime:not-from-listing'],
    prefix: ['runtime:worker-'],
    label: 'Engine fault',
    why: 'Our engine could not finish this script. That is on us, not your script.',
  },
  {
    id: 'drawing',
    exact: ['pine:drawing', 'pine:objects-only'],
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
      'runtime:history-expression', 'runtime:history-dynamic-offset'],
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
      'runtime:colour', 'runtime:presentation', 'runtime:plot-id'],
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
    exact: ['engine:withheld'],
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
const outName = (out, i) => (out && (out.title || out.handle)) || (out && isInt(out.line) ? `line ${out.line}` : `output ${i + 1}`)

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

/** Every withheld / may-withhold / note item the report and the pane name.
 *  ⭐ A refusal's own `line` wins over its output's `line`: the refusal points at
 *  the construct, the output at the `plot(...)` that reads it. */
export function statusItems(report, pane = null) {
  const items = []
  if (!report) return items
  const outputs = Array.isArray(report.outputs) ? report.outputs : []
  const carried = new Set()
  outputs.forEach((out, i) => {
    if (!out) return
    if (!out.formula) {
      const r = out.refusal || {}
      carried.add(`${r.guard}::${r.token}::${r.line}`)
      items.push(item({
        severity: SEVERITY.WITHHELD, kind: 'output', name: outName(out, i), guard: r.guard,
        reason: r.message || 'not translated', line: isInt(r.line) ? r.line : out.line, column: r.column,
      }))
      return
    }
    if (out.hidden) return
    if (out.downstream && out.downstream.ok === false) {
      items.push(item({
        severity: SEVERITY.WITHHELD, kind: 'output', name: outName(out, i),
        guard: out.downstream.guard, reason: out.downstream.error || 'does not evaluate', line: out.line,
      }))
      return
    }
    for (const g of (Array.isArray(out._blockRuns) ? out._blockRuns : [])) {
      if (!g) continue
      items.push(item({
        severity: SEVERITY.MAY_WITHHOLD, kind: 'block-runs', name: outName(out, i),
        guard: 'pine:block', reason: g.why, line: out.line,
      }))
    }
  })
  const top = report.refusal
  if (top && !carried.has(`${top.guard}::${top.token}::${top.line}`)) {
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'script', name: 'This script', guard: top.guard,
      reason: top.message, line: top.line, column: top.column,
    }))
  }
  // Missing parts `importOutcome` names that are not outputs (strategy orders, a
  // drawing program that lost a removal). Their line, where a note gives one.
  const outcome = report.outcome || {}
  const ignored = Array.isArray(report.ignored) ? report.ignored : []
  for (const m of (outcome.missing || [])) {
    if (!m || !m.guard) continue
    if (items.some((x) => x.guard === m.guard && x.reason === m.message)) continue
    if (!/^pine:(strategy-|object-removal-lost)/.test(m.guard)) continue
    const note = ignored.find((n) => n && n.code === m.guard)
    items.push(item({
      severity: SEVERITY.WITHHELD, kind: 'part', name: m.name, guard: m.guard,
      reason: m.message, line: note ? note.line : null,
    }))
  }
  const paints = (report.presentation && Array.isArray(report.presentation.paints)) ? report.presentation.paints : []
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
  if (pane && pane.ok && Array.isArray(pane.notes)) {
    for (const n of pane.notes) {
      if (n && n.note) items.push(item({ severity: SEVERITY.NOTE, kind: 'pane-note', name: n.name, guard: null, reason: n.note }))
    }
  }
  return items
}

// ─── RUNS ON ─────────────────────────────────────────────────────────────────

const dataPlotKeys = (def) => (Array.isArray(def && def.plots) ? def.plots : [])
  .filter((p) => p && p.style !== 'hlines' && typeof p.key === 'string').map((p) => p.key)

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
const NO_CONDITION = 'A screen needs a yes/no plot (for example `close > ta.sma(close, 50) ? 1 : 0`).'
const SERVER_RECHECKS = 'the server re-checks when you save or arm it'

function tagSentence(refusing, consumerLabel) {
  const calls = [...new Set(refusing.flatMap((r) => r.calls))].map((c) => `\`${c}\``).join(', ')
  return `It uses ${calls || 'a value'} whose value depends on how much history is loaded, so `
    + `${consumerLabel.toLowerCase()} refuse it.`
}

/**
 * The four "Runs on" rows. `ok`: true / false / 'partial'.
 * @param {object|null} pane  memberPaneDefinition's result
 * @param {object|null} savedRow  the served row being edited, if any
 * @param {{withheldCount?: number, evaluate?: Function}} [opts]
 */
export function runsOn(pane, savedRow = null, opts = {}) {
  const evaluate = opts.evaluate || evaluability
  const rows = []
  const def = pane && pane.ok ? pane.definition : null
  const runtime = !!(pane && pane.lane === 'runtime')
  const keys = def ? dataPlotKeys(def) : []
  const drawsMore = !!(def && ((def.objects && (def.objects.ops || []).length) || (Array.isArray(def.paints) && def.paints.length)))
  const tags = (pane && pane.requirementTags) || []

  // chart
  if (!def) {
    rows.push({ id: 'chart', label: 'Chart', ok: false, guard: pane ? pane.guard : null,
      family: familyOf(pane && pane.guard).id, why: (pane && pane.reason) || 'Nothing to draw yet.' })
  } else {
    const drawn = keys.filter((k) => evaluate(def, k, LANES.CHART, {}).status !== STATUS.REFUSED)
    const ok = drawn.length > 0 || drawsMore
    const partial = ok && ((opts.withheldCount || 0) > 0 || drawn.length < keys.length)
    rows.push({ id: 'chart', label: 'Chart', ok: ok ? (partial ? 'partial' : true) : false, guard: null, family: null,
      why: ok ? null : 'No plot of this script can be drawn on a chart.' })
  }

  for (const c of CONSUMERS.slice(1)) {
    const lane = c.id === 'alerts' ? LANES.ALERT : LANES.SCAN
    let row
    if (!def) {
      row = { ok: false, why: 'It does not run on a chart yet, so it cannot run here either.' }
    } else if (runtime) {
      row = { ok: false, why: RUNTIME_SERVER[c.id] }
    } else {
      const refusing = tagsRefusing(tags, c.tag)
      if (refusing.length) {
        row = { ok: false, why: tagSentence(refusing, c.label) }
      } else {
        const answers = keys.map((k) => evaluate(def, k, lane, {}))
        const yes = answers.filter((a) => a.status !== STATUS.REFUSED)
        if (yes.length) {
          row = { ok: true, why: null, note: SERVER_RECHECKS, count: yes.length }
        } else {
          const first = answers[0]
          row = { ok: false, guard: first ? first.guard : null,
            why: c.id === 'alerts' ? ((first && first.reason) || 'No plot can be watched by an alert.') : NO_CONDITION,
            detail: c.id === 'alerts' ? null : (first && first.reason) || null }
        }
      }
    }
    const sr = savedRow && savedRow.scan_refusal
    if (sr && sr.gate === 'withheld' && typeof sr.detail === 'string') {
      row = { ok: false, guard: 'engine:withheld', family: 'held', why: familyOf('engine:withheld').why, detail: sr.detail }
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
    const items = statusItems(report, pane)
    const withheld = items.filter((x) => x.severity === SEVERITY.WITHHELD)
    const others = items.filter((x) => x.severity !== SEVERITY.WITHHELD)
    const consumers = runsOn(pane, savedRow, { withheldCount: withheld.length, evaluate })
    const anyRuns = consumers.some((r) => r.ok)
    const outputs = Array.isArray(report.outputs) ? report.outputs : []
    const usable = outputs.filter((o) => o && o.formula && !o.hidden && !(o.downstream && o.downstream.ok === false)).length
    const def = pane && pane.ok ? pane.definition : null
    const drawings = !!(def && def.objects && (def.objects.ops || []).length)
    let state
    let headline
    if (!anyRuns) {
      state = PANEL_STATE.NOT_YET
      const blocker = withheld[0] || items[0]
      const fam = blocker ? familyOf(blocker.guard) : familyOf(pane && pane.guard)
      headline = `Not yet: needs ${fam.id === 'unknown' ? 'something we do not support yet' : fam.label.toLowerCase()}`
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
      stillWorks: anyRuns ? { plots: usable, drawings } : null,
    }
  } catch (e) {
    return {
      contract: EDITOR_STATUS_CONTRACT, state: PANEL_STATE.ENGINE_ERROR,
      headline: familyOf('import:internal-error').why, lane: null, runsOn: [], items: [],
      stillWorks: null, error: String((e && e.message) || e),
    }
  }
}

/** "What still works" in words. */
export function stillWorksText(sw) {
  if (!sw) return 'Nothing else runs yet.'
  const parts = []
  if (sw.plots > 0) parts.push(plural(sw.plots, 'plot', 'plots'))
  if (sw.drawings) parts.push(sw.plots > 0 ? 'its drawings' : 'its drawings')
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
