// app/src/components/chart/builder/memberPane/runtimeLaneDefinition.js
//
// ─── ⭐⭐ THE RUNTIME-LANE FALLBACK, AS A DEFINITION A PANE CAN BIND ─────────
//
// `memberPaneDefinition` calls this ONLY when the host lane refused a script with
// a guard the runtime lane is built to serve (`RUNTIME_FALLBACK_GUARDS`) and the
// build armed `VITE_PINE_RUNTIME_LANE_ENABLED`. It answers in the same shape
// `memberPaneDefinition` does, and the document it builds goes through the SAME
// `buildDefinition`, install door, binder, pane and object renderer as a host
// document. What differs is where the numbers come from:
//
//     host document     compute.kind 'ast'   — canonical trees, interpreted
//     runtime document  compute.kind 'pine'  — the member's Pine, rebuilt by the
//                                              runtime lane per chart
//                                              (`engine/pineRuntimeLane.js`)
//
// ⭐ PRESENTATION IS THE HOST LANE'S, VALUES ARE THE RUNTIME LANE'S. Every row's
// title, style, width, marker and static colour are read by the host lane's own
// readers (`translatePine(…, {drawPresentation: true})` → `_drawPresentation`),
// so both lanes describe one `plot()` the same way and colours go through
// `pinePalette.js` by the script's `@version`. A colour the host could not fold
// (read from `var` state, a ternary over state) is the runtime lane's own colour
// series for that plot, drawn per point (`colorMode: 'rgba:<key>'`).
//
// ⛔ EVERYTHING NOT DRAWN IS SAID. `hline`, `bgcolor`, `barcolor`, `plotarrow`,
// an alert condition, a colour neither lane carries, a row beyond the pane's
// ceiling, a setting that cannot be offered — each is a sentence on the
// document's disclosures, never a silent omission.
import { translatePine, lexPine } from '../../engine/ast/pine'
import { paneObjectsGate } from '../../engine/ast/paneGate'
import { objectLossNote } from '../../engine/ast/objectLoss'
import { alertNoteForOutput, KEY_RE } from '../../engine/ast/parse'
import {
  runtimeLaneBuild, runtimeLaneHandle, RUNTIME_DRAWN_CALLS, RUNTIME_LANE_KIND,
} from '../../engine/pineRuntimeLane'
import { buildDefinition } from '../BuilderSheet'
import { interpret } from '../../engine/ast/interpret'

const keyAt = (i) => (i === 0 ? 'value' : `out${i + 1}`)

/** The literal a runtime row's `ast` slot holds. ⛔ NEVER COMPUTED: a `pine`
 *  document's `compute` is replaced wholesale below, so no tree survives into
 *  it; `buildDefinition` only needs a well-formed node to assemble the plots. */
const PLACEHOLDER_AST = Object.freeze({ type: 'num', value: 0 })

/** Pine names that make a runtime program's newest bar able to change after
 *  the fact, or change what an earlier bar shows. Read off the LEX, so a name in
 *  a comment or a string cannot trip it (CODE-NEVER-PROSE). */
const REPAINT_NAMES = new Set([
  'barstate.isrealtime', 'barstate.isconfirmed', 'barstate.isnew', 'barstate.islast',
  'barstate.islastconfirmedhistory', 'barstate.ishistory', 'timenow', 'varip',
])
/** The Pine spellings of `_requirement_tags.window_dependent`'s rosters
 *  (`cum`, `isfirst`), for a program that has no host tree to walk. */
const WINDOW_DEPENDENT_NAMES = new Set(['ta.cum', 'cum', 'barstate.isfirst'])

/** Members of the drawing family a pane does not draw, with the sentence. */
const NOT_DRAWN = Object.freeze({
  hline: 'draws a horizontal guide line, which this pane does not draw yet',
  bgcolor: 'paints the chart background, which this pane does not draw yet',
  barcolor: 'recolours the price bars, which this pane does not draw yet',
  plotarrow: 'draws arrows, which this pane does not draw yet',
})

/** Did the HOST lane translate this row to a tree that reads no bar and is `na`?
 *  Such a plot draws nothing on any bar in either engine — `lastN == "1 to 9" ?
 *  buySet == 1 : na` with the input's default folded — and letting it hold one
 *  of the pane's visible slots would push a series that does draw past the
 *  ceiling. ⛔ Asked only of a row the host translated; a refused row is never
 *  guessed constant. */
function constantNa(row) {
  if (!row || row.refusal || row.hiddenReason !== 'constant' || !row.ast) return false
  try {
    const v = interpret(row.ast, [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }], {})
    const x = typeof v === 'number' ? v : (v && v.length ? v[0] : NaN)
    return !Number.isFinite(x)
  } catch {
    return false
  }
}

/** Line numbers each identifier is read on, from the LEX (never the text). */
function identLines(source) {
  const out = new Map()
  try {
    for (const t of lexPine(source).tokens) {
      if (!t || t.kind !== 'ident') continue
      const k = String(t.value)
      if (!out.has(k)) out.set(k, new Set())
      out.get(k).add(t.line)
    }
  } catch { /* an unlexable source reads nothing; the caller offers nothing it cannot see */ }
  return out
}

function identsOf(source) {
  try {
    return new Set(lexPine(source).tokens
      .filter((t) => t && t.kind === 'ident').map((t) => String(t.value)))
  } catch {
    return new Set()
  }
}

/**
 * @param {object} arg
 * @param {string} arg.source
 * @param {string} arg.id
 * @param {string} [arg.name]
 * @param {number} arg.carryMax     the visible-row ceiling (the host door's)
 * @param {number} arg.docCarryMax  the document-row ceiling (the host door's)
 * @param {number} arg.paneHeight   the sub-pane fraction (the host door's)
 * @returns {{ok: boolean, definition: object|null, reason: string|null,
 *            guard: string|null, rows: object[], notes: object[],
 *            requirementTags: string[], lane: 'runtime'}}
 */
export function runtimeLaneDefinition({ source, id, name, carryMax, docCarryMax, paneHeight }) {
  const no = (reason, guard, line = null) => ({
    ok: false, definition: null, reason, guard, line, rows: [], notes: [], lane: 'runtime',
  })

  // ⭐ ONE TRANSLATION FOR PRESENTATION AND FOR THE OBJECT PROGRAM. Strict, and
  // WITHOUT `declareInputs`: every input folds to the author's default in the
  // object trees, which is what they draw with (see the knob rule below).
  let tp
  try {
    tp = translatePine(source, { strict: true, drawPresentation: true })
  } catch (err) {
    return no(`the translator threw: ${String((err && err.message) || err)}`, 'runtime-door:threw')
  }

  // ─── the object program: the HOST pass's, under the same partial rule ────
  //
  // ⛔ THE SAME `paneObjectsGate` THE HOST DOOR ASKS. A program that lost a
  // removal is withheld (the plots still draw) and says so; any other loss is
  // drawn and disclosed "N of M". The runtime lane then treats the script's
  // drawing calls as the object program's (`ownsDrawing`) — ONLY when the object
  // pass actually saw them, so a drawing call it never read is still a refusal
  // (`runtime:object-op`), not a silent skip.
  const diag = tp.objectDiagnostics || {}
  const hasProgram = !!(tp.objects && Array.isArray(tp.objects.ops) && tp.objects.ops.length)
  const sawDrawing = hasProgram || (diag.collectedOps || 0) > 0
    || (diag.unsupported || []).length > 0 || (diag.loopBlocked || 0) > 0
  const objectsGate = paneObjectsGate(tp)
  const drawObjects = hasProgram && objectsGate.draw
  const withheld = sawDrawing && !objectsGate.draw

  const built = runtimeLaneBuild(source, { ownsDrawing: sawDrawing })
  if (!built.ok) {
    const r = built.refusal || {}
    return no(String(r.message || 'the runtime lane refused this script'), r.guard || null,
      Number.isInteger(r.line) ? r.line : null)
  }
  if (built.requests > 0) {
    return no('this script reads another symbol or timeframe (`request.security`), and the '
      + 'runtime lane has no second symbol\'s bars to hand it — every value would draw as `na`, '
      + 'which reads as a quiet market rather than as missing data', 'runtime-door:request')
  }

  // ─── pair each runtime output with the host's presentation of that call ──
  const presentations = new Map()
  for (const o of (tp.outputs || [])) {
    const dp = o && o._drawPresentation
    if (!dp) continue
    const k = `${dp.kind}@${dp.line}`
    if (!presentations.has(k)) presentations.set(k, [])
    presentations.get(k).push(constantNa(o) ? { ...dp, constantNa: true } : dp)
  }
  const takePresentation = (call, line) => {
    const q = presentations.get(`${call}@${line}`)
    return q && q.length ? q.shift() : null
  }

  const notes = []
  const seen = new Set()
  const note = (n) => {
    const key = `${n.name} :: ${n.note}`
    if (seen.has(key)) return
    seen.add(key)
    notes.push(n)
  }

  const outs = built.outputs
  /** Lines of the output statements this pane does NOT draw (`hline`, `bgcolor`,
   *  an alert condition…) — an input read ONLY there moves nothing on the pane. */
  const undrawnLines = new Set(outs
    .filter((o) => !RUNTIME_DRAWN_CALLS.has(o.call) && o.call !== 'fill' && o.call !== 'plotcolor'
      && Number.isInteger(o.line))
    .map((o) => o.line))
  const colourOf = new Map()   // runtime output index → its `plotcolor` output index
  outs.forEach((o, i) => { if (o.call === 'plotcolor' && Number.isInteger(o.of)) colourOf.set(o.of, i) })

  const candidates = []
  for (let i = 0; i < outs.length; i += 1) {
    const o = outs[i]
    if (!RUNTIME_DRAWN_CALLS.has(o.call)) {
      if (o.call === 'alertcondition') {
        const dp = takePresentation('alertcondition', o.line)
        for (const n of alertNoteForOutput({ kind: 'alertcondition', title: dp && dp.title })) note(n)
      } else if (NOT_DRAWN[o.call]) {
        note({ name: `\`${o.call}\``, note: `This script's \`${o.call}\`${Number.isInteger(o.line)
          ? ` (line ${o.line})` : ''} ${NOT_DRAWN[o.call]}.` })
      }
      continue
    }
    const dp = takePresentation(o.call, o.line)
    if (!dp || dp.unreadable) {
      return no(`the \`${o.call}\` on line ${o.line} could not be read for its presentation`
        + `${dp && dp.unreadable ? ` (${dp.unreadable})` : ''}, so it is not drawn as a guess`,
      'runtime-door:presentation', o.line)
    }
    if (dp.displace && dp.displace.unreadable) {
      return no(`the \`offset\` of the \`${o.call}\` on line ${o.line} does not reduce to a whole `
        + 'number of bars before the script runs, so where it is drawn is not known', 'pine:plot-offset', o.line)
    }
    candidates.push({ index: i, call: o.call, line: o.line, dp })
  }

  // ─── the rows, under the host door's own ceilings ─────────────────────────
  // ⭐ HIDDEN = what the author hid (`display.none`, an untitled fill edge).
  // ⛔ NOT the host's wider "constant" rule: `plot(0)` is a line TradingView
  // draws, and hiding it would take a visible zero line off the pane.
  const hiddenOf = (c) => !!(c.dp.authorHidden || c.dp.fillAnchor)
  // ⭐ A ROW THE HOST LANE PROVED IS `na` AT THE SCRIPT'S DEFAULT SETTINGS IS
  // CARRIED, VISIBLE, AND NOT COUNTED against the pane's visible ceiling. It
  // draws nothing at those settings, so it must not push a series that does
  // past the ceiling (cc-yata's `lastN == "1 to 9" ? … : na` rows) — and it is
  // NOT hidden, because a member who changes the setting it depends on turns it
  // on, and a hidden row would then be a knob that moves nothing.
  const counted = (c) => !hiddenOf(c) && !c.dp.constantNa
  const visible = candidates.filter(counted)
  const visibleKept = new Set(visible.slice(0, carryMax))
  const drawable = candidates
    .filter((c) => (counted(c) ? visibleKept.has(c) : true))
    .slice(0, docCarryMax)
  if (!drawable.some((c) => !hiddenOf(c))) {
    return no('this script declares nothing a chart can draw', null)
  }
  if (visible.length > visibleKept.size || candidates.length > drawable.length) {
    note({ name: 'Plots', note: `This script draws ${visible.length} series; this pane carries the `
      + `first ${Math.min(visible.length, carryMax)}, so the rest are not shown.` })
  }

  const repaint = [...identsOf(source)].some((n) => REPAINT_NAMES.has(n))
    ? 'repaints' : 'non-repainting'
  const rows = []
  const columns = {}
  const keyOfOutput = new Map()
  const displacementNames = new Set()
  drawable.forEach((c, i) => {
    const key = keyAt(i)
    keyOfOutput.set(c.index, key)
    const p = c.dp.presentation || {}
    const row = {
      key,
      label: c.dp.title || '',
      source: `${c.call} @ line ${c.line}`,
      ast: PLACEHOLDER_AST,
      mode: repaint,
      readback: '',
      style: typeof p.style === 'string' ? p.style : 'line',
      color: typeof p.color === 'string' ? p.color : undefined,
      hidden: hiddenOf(c),
      // ⚠️ CLAMPED TO THE CHROME CONTROL'S OWN RANGE (`chromeInputsFor`: 1..4),
      // or a Pine `linewidth = 5` becomes an input default outside its bounds.
      ...(Number.isFinite(p.width) ? { width: Math.min(4, Math.max(1, Math.round(p.width))) } : {}),
      ...(p.opacity !== undefined ? { opacity: p.opacity } : {}),
      ...(p.marker && p.marker.shape ? { marker: p.marker } : {}),
    }
    const spec = { output: c.index, call: c.call, line: Number.isInteger(c.line) ? c.line : null }
    const d = c.dp.displace || {}
    if (Number.isInteger(d.shift) && d.shift < 0) row.displace = d.shift
    if (Number.isInteger(d.shift) && d.shift > 0) spec.shift = d.shift
    for (const n of (d.names || [])) displacementNames.add(n)
    rows.push(row)
    columns[key] = spec
    if (p.styleUncarried) {
      note({ name: row.label || key, note: `\`${row.label || c.call}\` asks for \`${p.styleUncarried}\`, `
        + 'which this pane does not draw yet, so it is drawn as a line.' })
    }
  })

  // ─── colours the host could not fold: the runtime lane's own series ───────
  const colourRows = []
  const colourRow = (outputIndex, call, line, forLabel) => {
    const key = keyAt(drawable.length + colourRows.length)
    colourRows.push({
      key, label: '', source: `${call} colour @ line ${line}`, ast: PLACEHOLDER_AST,
      mode: repaint, readback: '', style: 'line', hidden: true, colourFor: forLabel,
    })
    columns[key] = { output: outputIndex, call, line: Number.isInteger(line) ? line : null }
    return key
  }
  drawable.forEach((c, i) => {
    const row = rows[i]
    const p = c.dp.presentation || {}
    if (typeof p.color === 'string') return
    const ci = colourOf.get(c.index)
    if (ci !== undefined) {
      row.colorMode = `rgba:${colourRow(ci, 'plotcolor', c.line, row.key)}`
      return
    }
    if (p.colorDynamic || p.colorUp || p.colorCondition) {
      note({ name: row.label || row.key, note: `The colour of \`${row.label || c.call}\` (line ${c.line}) `
        + 'changes from bar to bar in a way this chart cannot draw yet, so it is drawn in one colour.' })
    }
  })

  // ─── fills: the runtime lane's `fill` output IS the band's colour series ──
  for (let i = 0; i < outs.length; i += 1) {
    const o = outs[i]
    if (o.call !== 'fill') continue
    const ka = keyOfOutput.get(o.upper)
    const kb = keyOfOutput.get(o.lower)
    const row = ka ? rows.find((r) => r.key === ka) : null
    if (!ka || !kb || ka === kb || !row || row.fill) {
      note({ name: '`fill`', note: `The band on line ${o.line} joins a plot this pane does not carry, `
        + 'so it is not drawn.' })
      continue
    }
    row.fill = { with: kb, colorMode: `rgba:${colourRow(i, 'fill', o.line, ka)}` }
  }

  // ─── the member's settings ────────────────────────────────────────────────
  //
  // ⭐ Every numeric input the program READS, as a real per-instance input —
  // the runtime lane rebuilds with the member's value everywhere it is folded,
  // lengths included. ⛔ Not when the document carries a host object program:
  // those trees were translated with every input at its default, and a knob that
  // moved the plots and left the drawings behind is the half-applied trap. And
  // never an input that sets where a plot is drawn (`offset =`).
  const knobs = []
  const inputMap = {}
  const params = built.inputParams || []
  if (params.length) {
    if (drawObjects) {
      note({ name: 'Settings', note: 'This script also draws lines, labels, boxes or tables, and '
        + 'those are drawn with its own default settings — so its settings are fixed at those '
        + 'defaults here. Change them in the script and paste it again.' })
    } else {
      const readOn = identLines(source)
      for (const prm of params) {
        const pineName = prm && prm.sourceName
        if (!pineName || !['int', 'float', 'bool'].includes(prm.type)) continue
        const key = `pine_${pineName}`
        if (!KEY_RE.test(key) || inputMap[key]) continue
        const label = String(prm.title || pineName)
        // ⛔ A KNOB THAT MOVES NOTHING ON THE PANE IS NOT OFFERED. An input read
        // ONLY on the lines of outputs this pane does not draw (`hline(th)` in
        // adx-and-di) is withheld and said. ⚠️ CONSERVATIVE BY CONSTRUCTION: a
        // read through another variable, or on a continuation line, counts as a
        // read the pane may draw, so this only ever withholds a knob it can prove
        // is inert — never one that works.
        const reads = [...(readOn.get(pineName) || [])].filter((ln) => ln !== prm.line)
        if (reads.length && reads.every((ln) => undrawnLines.has(ln))) {
          note({ name: label, note: `\`${label}\` only sets something this pane does not draw `
            + `(line ${reads.join(', ')}), so it is not offered as a setting here.` })
          continue
        }
        if (displacementNames.has(pineName)) {
          note({ name: label, note: `\`${label}\` also sets where a plot is drawn (its \`offset\`), `
            + 'which this document cannot move with it — so it is not offered as an adjustable '
            + 'setting here. Change it in the script and paste it again.' })
          continue
        }
        const spec = prm.type === 'bool'
          ? { key, type: 'bool', label, default: !!prm.default }
          : { key, type: prm.type, label, default: prm.default,
            ...(Number.isFinite(prm.min) ? { min: prm.min } : {}),
            ...(Number.isFinite(prm.max) ? { max: prm.max } : {}),
            ...(Number.isFinite(prm.step) && prm.step > 0 ? { step: prm.step } : {}) }
        knobs.push(spec)
        inputMap[key] = pineName
      }
    }
  }

  const allRows = [...rows, ...colourRows]
  const declaredName = String(name || tp.title || 'Pine script').slice(0, 40)
  let definition
  try {
    definition = buildDefinition({
      defId: id,
      name: declaredName,
      source: allRows[0].source,
      ast: PLACEHOLDER_AST,
      mode: repaint,
      readback: '',
      inputs: knobs.length ? knobs : undefined,
      plots: allRows,
      placement: (tp.presentation && tp.presentation.overlay === true)
        ? { target: 'price' }
        : { target: 'pane', pane: { height: paneHeight } },
      paramManifest: null,
      objects: drawObjects ? tp.objects : null,
    })
  } catch (err) {
    return no(`the document could not be built: ${String((err && err.message) || err)}`, 'runtime-door:document')
  }
  // ⭐⭐ THE COMPUTE IS REPLACED WHOLESALE: the member's script and the map from
  // each plot key to the runtime output it reads. No tree survives — there is
  // none that is this document's maths.
  const handleText = JSON.stringify([source, columns, inputMap, built.plotColours, sawDrawing])
  definition.compute = {
    kind: RUNTIME_LANE_KIND,
    fn: runtimeLaneHandle(handleText),
    rev: 1,
    source,
    lane: { plotColours: built.plotColours, ownsDrawing: sawDrawing },
    columns,
    ...(Object.keys(inputMap).length ? { inputs: inputMap } : {}),
  }

  const drawingNote = sawDrawing ? objectLossNote(objectsGate.loss, { withheld }) : null
  if (drawingNote) notes.unshift(drawingNote)
  const requirementTags = [...identsOf(source)].some((n) => WINDOW_DEPENDENT_NAMES.has(n))
    ? ['window_dependent'] : []
  definition.meta = {
    ...(definition.meta || {}),
    freshness: 'live',
    repaint,
    // ⭐ WHICH ENGINE DREW THIS, carried on the document so a surface (and the
    // census) can tell a runtime-lane pane from a host one without re-deriving.
    pineLane: 'runtime',
    disclosures: notes.map((n) => ({ name: n.name, note: n.note })),
    requirementTags,
  }
  return {
    ok: true,
    definition,
    reason: null,
    guard: null,
    rows: allRows,
    notes,
    requirementTags,
    lane: 'runtime',
    presentationTranslation: tp,
  }
}
