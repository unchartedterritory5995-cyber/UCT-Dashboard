// app/src/components/chart/builder/authoring/tables.js
//
// ─── ⭐⭐ OVERNIGHT D — A CHART TABLE, AUTHORED, ON THE TABLE RENDERER THAT EXISTS ──
//
// UCT already draws tables on the chart: the C3B object program (`ast/objectProgram.js`
// — `create` a `table`, `cell` ops), evaluated by `objectRuntime.js` and drawn as a DOM
// `<table>` at one of nine anchors by `objectTableDom.js`. Until now only the Pine
// translator produced such a program. This module lets conversational authoring produce
// one from a small TABLE SPEC — no second renderer, no new output type, no new format:
//
//   spec = { position: 'top_right' | …nine anchors…,
//            cells: [{ row, col, text }                                    a label
//                  | { row, col, output, format?, prefix?, suffix? }       an output's
//                    … + { color?, background?, bold? } ]}                 latest value
//
// ⭐ A CELL NAMES AN OUTPUT, NOT A COPY OF ITS MATHS. The program (V1, unbound) needs
// its own `trees`, so the output's tree is placed there — and RECOGNISED back by its
// hash, so editing "ADR over 20 days → 10" re-derives the table in the same patch
// (`syncTableTrees`), exactly as the colour-rule helpers are kept in step.
//
// ⭐ "—" FOR AN UNKNOWN VALUE, with machinery that exists: a `{t:'if'}` text node whose
// condition is the closed table's own `na(x)`. A Pine dashboard keeps Pine's "NaN".
//
// ⛔ ONLY OUR OWN SHAPE IS EDITABLE. `tableSpecOf` returns a spec only for a program this
// module could have written; an imported Pine dashboard returns null and is carried
// untouched (Phase 4 fidelity).

import { sameTree } from './colorRules'
import { outputsOf, outputTreeOf } from '../../engine/outputType'

export const TABLE_POSITIONS = Object.freeze(['top_left', 'top_center', 'top_right', 'middle_left',
  'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'])

/** The number formats a cell may use → the `str.tostring` pattern the runtime reads. */
export const TABLE_FORMATS = Object.freeze({
  auto: '#.##', integer: '0', decimal1: '0.0', decimal2: '0.00', decimal3: '0.000',
})
export const TABLE_LIMITS = Object.freeze({ maxRows: 12, maxCols: 6, maxCells: 48, maxText: 40 })

const UNKNOWN_TEXT = '—'
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const colour = (hex) => ({ v: 'color', node: { c: 'lit', hex } })
const naCall = (tree) => ({ type: 'call', name: 'na', args: [tree] })

/**
 * The object program for a spec. `treeOf(outputKey)` gives each referenced output's
 * tree and `kindOf(outputKey)` its type ('series' | 'condition').
 */
export function tableProgram(spec, treeOf, kindOf) {
  const trees = []
  const treeIndex = (t) => {
    const at = trees.findIndex((x) => sameTree(x, t))
    if (at >= 0) return at
    trees.push(t)
    return trees.length - 1
  }
  const rows = Math.max(...spec.cells.map((c) => c.row)) + 1
  const columns = Math.max(...spec.cells.map((c) => c.col)) + 1
  const ops = [{
    k: 'create', family: 'table', site: 's1', into: 'r0', when: null, once: true,
    props: { position: { v: 'const', value: spec.position }, columns: { v: 'const', value: columns }, rows: { v: 'const', value: rows } },
  }]
  for (const c of spec.cells) {
    let text
    if (typeof c.output === 'string') {
      const t = treeOf(c.output)
      const known = kindOf(c.output) === 'condition'
        ? { t: 'if', cond: { v: 'tree', tree: treeIndex(t) }, then: { t: 'lit', s: 'Yes' }, else: { t: 'lit', s: 'No' } }
        : { t: 'num', tree: treeIndex(t), fmt: TABLE_FORMATS[c.format || 'auto'] }
      const shown = c.prefix || c.suffix
        ? { t: 'cat', args: [...(c.prefix ? [{ t: 'lit', s: c.prefix }] : []), known, ...(c.suffix ? [{ t: 'lit', s: c.suffix }] : [])] }
        : known
      text = { t: 'if', cond: { v: 'tree', tree: treeIndex(naCall(t)) }, then: { t: 'lit', s: UNKNOWN_TEXT }, else: shown }
    } else {
      text = { t: 'lit', s: String(c.text) }
    }
    ops.push({
      k: 'cell', target: { r: 'reg', id: 'r0' }, col: { v: 'const', value: c.col }, row: { v: 'const', value: c.row },
      when: null, lastBarOnly: true,
      props: {
        text: { v: 'text', node: text },
        ...(c.color ? { text_color: colour(c.color) } : {}),
        ...(c.background ? { bgcolor: colour(c.background) } : {}),
        ...(c.bold ? { text_formatting: { v: 'const', value: 'bold' } } : {}),
      },
    })
  }
  return { programVersion: 1, regs: [{ id: 'r0', family: 'table' }], colls: [], ops, trees }
}

/**
 * The spec a program says — ONLY for a program `tableProgram` could have written —
 * or null. `outputOfTree(tree)` names the output whose tree it is (by hash), or null.
 */
export function tableSpecOf(program, outputOfTree) {
  if (!isObj(program) || program.programVersion !== 1 || program.pineVersion !== undefined) return null
  if (!Array.isArray(program.regs) || program.regs.length !== 1 || program.regs[0].family !== 'table') return null
  if ((program.colls || []).length || !Array.isArray(program.ops) || !Array.isArray(program.trees)) return null
  const [create, ...cells] = program.ops
  if (!create || create.k !== 'create' || create.family !== 'table' || !create.once) return null
  const pos = create.props && create.props.position && create.props.position.value
  if (!TABLE_POSITIONS.includes(pos) || !cells.length) return null
  const out = { position: pos, cells: [] }
  const hexOf = (p) => (p && p.v === 'color' && p.node && p.node.c === 'lit' ? p.node.hex : undefined)
  for (const op of cells) {
    if (op.k !== 'cell' || !op.lastBarOnly || op.when !== null) return null
    const cell = { row: op.row && op.row.value, col: op.col && op.col.value }
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col)) return null
    const t = op.props && op.props.text && op.props.text.v === 'text' ? op.props.text.node : null
    if (t && t.t === 'lit') cell.text = t.s
    else if (t && t.t === 'if' && t.then && t.then.s === UNKNOWN_TEXT && t.cond && t.cond.v === 'tree') {
      let shown = t.else
      if (shown && shown.t === 'cat') {
        const parts = shown.args
        const mid = parts.findIndex((a) => a.t !== 'lit')
        if (mid < 0) return null
        if (mid > 0) cell.prefix = parts[0].s
        if (mid < parts.length - 1) cell.suffix = parts[parts.length - 1].s
        shown = parts[mid]
      }
      const idx = shown && shown.t === 'num' ? shown.tree : shown && shown.t === 'if' && shown.cond ? shown.cond.tree : null
      const key = Number.isInteger(idx) ? outputOfTree(program.trees[idx]) : null
      if (!key) return null
      cell.output = key
      if (shown.t === 'num') {
        const fmt = Object.entries(TABLE_FORMATS).find(([, f]) => f === shown.fmt)
        if (!fmt) return null
        if (fmt[0] !== 'auto') cell.format = fmt[0]
      }
    } else return null
    const c = hexOf(op.props.text_color)
    const b = hexOf(op.props.bgcolor)
    if (c) cell.color = c
    if (b) cell.background = b
    if (op.props.text_formatting && op.props.text_formatting.value === 'bold') cell.bold = true
    out.cells.push(cell)
  }
  return out
}

/** A spec's problems in member words, or null. `outputs` maps key → type. */
export function tableSpecProblem(spec, outputs) {
  if (!TABLE_POSITIONS.includes(spec.position)) return `"${spec.position}" is not a table position.`
  if (!spec.cells.length) return 'A table needs at least one cell.'
  if (spec.cells.length > TABLE_LIMITS.maxCells) return `At most ${TABLE_LIMITS.maxCells} cells.`
  const seen = new Set()
  for (const c of spec.cells) {
    if (c.row >= TABLE_LIMITS.maxRows || c.col >= TABLE_LIMITS.maxCols) return `A table may have at most ${TABLE_LIMITS.maxRows} rows and ${TABLE_LIMITS.maxCols} columns.`
    const at = `${c.row},${c.col}`
    if (seen.has(at)) return `Two cells sit at row ${c.row + 1}, column ${c.col + 1}.`
    seen.add(at)
    if (typeof c.output === 'string') {
      const t = outputs.get(c.output)
      if (!t) return `There is no output "${c.output}" for a table cell to show.`
      if (t !== 'series' && t !== 'condition') return `"${c.output}" has no per-bar value a table cell can show.`
      if (t === 'condition' && c.format) return `"${c.output}" is a yes/no; it shows as Yes or No, not as a number.`
    } else if (typeof c.text !== 'string' || !c.text.trim()) {
      return 'Every cell shows either an output or some text.'
    }
  }
  return null
}

/** The table spec of a stored DEFINITION (`objects` + its outputs), or null / 'imported'. */
export function tableSpecOfDefinition(def) {
  if (!def || !isObj(def.objects)) return null
  const outs = outputsOf(def).map((o) => ({ key: o.key, tree: outputTreeOf(def, o.key) })).filter((o) => o.tree)
  return tableSpecOf(def.objects, (t) => {
    const o = outs.find((x) => sameTree(x.tree, t))
    return o ? o.key : null
  }) || 'imported'
}

const POSITION_WORDS = Object.freeze({
  top_left: 'top left', top_center: 'top centre', top_right: 'top right', middle_left: 'middle left',
  middle_center: 'centre', middle_right: 'middle right', bottom_left: 'bottom left',
  bottom_center: 'bottom centre', bottom_right: 'bottom right',
})
const FORMAT_WORDS = Object.freeze({ integer: 'whole number', decimal1: '1 decimal', decimal2: '2 decimals', decimal3: '3 decimals' })

/** Deterministic read-back lines for a table spec. `nameOf(key)` names an output. */
export function tableLines(spec, nameOf) {
  if (spec === 'imported') return ['a chart table / objects carried from an import (kept as imported)']
  if (!spec) return []
  const rows = new Map()
  for (const c of spec.cells) {
    if (!rows.has(c.row)) rows.set(c.row, [])
    rows.get(c.row).push(c)
  }
  const out = [`a table in the ${POSITION_WORDS[spec.position]} of the chart (a value with no answer yet shows as a dash)`]
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(r).sort((a, b) => a.col - b.col).map((c) => {
      if (typeof c.output !== 'string') return `"${c.text}"`
      const fmt = c.format && FORMAT_WORDS[c.format] ? `, ${FORMAT_WORDS[c.format]}` : ''
      return `${c.prefix || ''}[latest ${nameOf(c.output)}${fmt}]${c.suffix || ''}`
    })
    out.push(`table row ${r + 1}: ${cells.join(' | ')}`)
  }
  return out
}
