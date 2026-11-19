// app/src/components/chart/supportLoop/assistantPineReference.js
//
// ─── ⭐ THE ASSISTANT WRITES PINE: WHAT IT MAY WRITE, GENERATED FROM THE ENGINE (2026-11-18) ───
//
// Create Indicator's assistant wrote a formula and nothing else, so a table, a drawn line, a
// label with text or a list of levels was out of reach however a member worded it. The engine
// already runs all of those for a member who PASTES a script. So the assistant is to write Pine,
// and this module builds the one thing it writes from: a reference of exactly what this build's
// engine serves on the member's path TODAY.
//
// ⛔ ONLY WHAT THE ENGINE SERVES, AND FROM THE ENGINE'S OWN TABLES. Nothing below is a typed list
// of Pine names:
//   • the language features and drawing families are the ADMITTED capabilities of the runtime
//     lane (`api/data/pine_runtime_allowlist.json`, the server's own admission table);
//   • the drawing functions and their parameters are `runtime/objectStore.OBJECT_OPS`, kept only
//     for an admitted family; the constants are `objectEnums.OBJECT_ENUM_VALUES`;
//   • text, array and colour functions are the runtime's own function tables;
//   • the value functions (`ta.*`, `math.*`, series, calendar, inputs) are the names the door
//     itself PROVED reachable, each with the call that proved it (`doorNameCoverage.json`,
//     regenerated through the door by its own test);
//   • every output call and every worked example is RUN through the member's paste path here
//     (`verdictOf`, injected: `inspectSource` + `memberPaneDefinition` + `editorStatus`), and its
//     verdict is recorded. The document shows the assistant only what came back "runs".
//
// `assistantPineReference.test.js` regenerates the file and fails when the committed bytes
// differ, so a change to what the engine serves reds this until the reference is regenerated in
// the same change. The server reads the JSON (`api/services/pine_authoring.py`).

import { OBJECT_OPS } from '../engine/runtime/objectStore'
import { OBJECT_ENUM_VALUES } from '../engine/objectEnums'
import { TEXT_FNS, RUN_TEXT_FNS } from '../engine/runtime/text'
import { ARRAY_FNS } from '../engine/runtime/collections'
import { COLOUR_FNS } from '../engine/runtime/colours'
import { PINE_COLOUR_NAMES } from '../engine/pinePalette'
import {
  BUILTIN_BARSTATE_REFUSED, BUILTIN_SYMBOL_UNSERVED, BUILTIN_SYMBOL_SCOPED, BUILTIN_SYMBOL_NUMERIC,
  BUILTIN_BARSTATE_SERIES,
} from '../engine/ast/pine'
import { POOL_LIMITS } from '../engine/objectPool'

const keysOf = (o) => (o instanceof Set ? [...o] : Array.isArray(o) ? [...o] : Object.keys(o || {}))
const sorted = (xs) => [...new Set(xs)].sort()

/** The drawing families a script may use, in a fixed order. `obj:<family>` must be admitted. */
export const DRAWING_FAMILIES = Object.freeze(['line', 'label', 'box', 'table'])

/** The states of a verdict that mean "this runs for a member with nothing withheld". */
export const RUNS_STATES = Object.freeze(['runs', 'runs-with-notes'])

/** One small script per output call, so each is asked of the paste path itself. `fill` is not in
 *  the runtime's output table (it is decided in code), so it is asked the same way. */
export const OUTPUT_PROBES = Object.freeze({
  plot: 'plot(close, "Close")',
  plotshape: 'plotshape(close > open, "Up", shape.triangleup, location.belowbar, color.green)',
  plotchar: 'plotchar(close > open, "Up", "▲", location.abovebar, color.green)',
  plotarrow: 'plotarrow(close - open, "Move")',
  alertcondition: 'plot(close)\nalertcondition(close > open, "Up bar", "The bar closed up")',
  hline: 'plot(close)\nhline(0, "Zero")',
  bgcolor: 'bgcolor(close > open ? color.new(color.green, 90) : na)',
  barcolor: 'barcolor(close > open ? color.green : color.red)',
  fill: 'a = plot(high, "High")\nb = plot(low, "Low")\nfill(a, b, color=color.new(color.blue, 90))',
})

/**
 * ⭐ PITFALLS, EACH ASKED OF THE ENGINE. A way of writing Pine that TradingView accepts and this
 * engine does not draw. Each is a small script run through the paste path when the reference is
 * generated; the instructions warn about one ONLY while its script still does not run fully, so
 * the day the engine serves it the warning leaves the document with no hand edit.
 */
export const PITFALL_PROBES = Object.freeze({
  // two plots with no title, kept only to fill between: read as helper series the author hid,
  // so nothing is drawn (the same script with a title on each plot runs)
  'untitled-fill-anchor': '//@version=5\nindicator("probe", overlay=true)\na = plot(high)\nb = plot(low)\nfill(a, b, color=color.new(color.blue, 90))\n',
  // a horizontal level drawn with hline is withheld
  hline: '//@version=5\nindicator("probe")\nplot(ta.rsi(close, 14), "RSI")\nhline(70, "Overbought")\n',
})

export function outputProbeScript(call) {
  return `//@version=5\nindicator("probe", overlay=true)\n${OUTPUT_PROBES[call]}\n`
}

const verdictRow = (v) => ({
  ok: !!(v && v.ok), lane: (v && v.lane) || 'host', state: (v && v.state) || 'unknown', headline: (v && v.headline) || '',
})

/**
 * The whole reference, deterministic (sorted, no clock) so the committed file compares byte for byte.
 * @param {object} args
 * @param {object} args.allowlist   `api/data/pine_runtime_allowlist.json`
 * @param {object} args.doorNames   `doorNameCoverage.json`
 * @param {Array<{id,title,shows,source}>} args.examples
 * @param {(source: string) => {ok, lane, state, headline}} args.verdictOf   the member's paste path
 * @param {object|string[]} args.outputCalls   the runtime front end's own output-call table
 *   (`RUNTIME_OUTPUT_CALLS`). HANDED IN, never imported here: a live file that imports the runtime
 *   front end must also wire its clock producer (`pineRuntimeFrontendGate.test.js`), and this
 *   module wires nothing. The generator test imports the table and passes it.
 */
export function buildAssistantPineReference({ allowlist, doorNames, examples = [], verdictOf, outputCalls = [] }) {
  const caps = (allowlist && allowlist.capabilities) || {}
  const admitted = sorted(Object.keys(caps).filter((id) => caps[id] && caps[id].admitted === true))
  const has = (id) => admitted.includes(id)
  const families = DRAWING_FAMILIES.filter((f) => has(`obj:${f}`))

  const drawing = {}
  for (const family of families) {
    drawing[family] = Object.entries(OBJECT_OPS)
      .filter(([, op]) => op && op.family === family)
      .filter(([name]) => !name.endsWith('.delete') || has('obj:delete'))
      .filter(([name]) => !/\.get_/.test(name) || has('obj:getter'))
      .filter(([name]) => !name.endsWith('.all') || has('obj:collection'))
      .map(([name, op]) => ({ name, params: Array.isArray(op.params) ? [...op.params] : [] }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  }
  const constants = sorted(keysOf(OBJECT_ENUM_VALUES)
    .filter((k) => !/^(line|label|box|table|linefill|polyline)\./.test(k) || families.includes(k.split('.')[0])))

  const values = Object.entries((doorNames && doorNames.names) || {})
    .filter(([, v]) => v && v.status === 'reachable' && typeof v.probe === 'string')
    .map(([name, v]) => ({ name, call: v.probe }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))

  const arrays = has('collections:array')
    ? sorted(keysOf(ARRAY_FNS).filter((k) => k.startsWith('array.') || k === 'str.split')) : []
  const text = sorted([...keysOf(TEXT_FNS), ...keysOf(RUN_TEXT_FNS).filter((k) => !k.includes('/'))])

  const outputs = sorted([...keysOf(outputCalls), 'fill'])
    .filter((call) => OUTPUT_PROBES[call])
    .map((call) => ({ name: call, ...verdictRow(verdictOf(outputProbeScript(call))) }))

  const limits = {}
  for (const family of families) {
    const p = POOL_LIMITS[family]
    if (p) limits[family] = { default: p.fallback, most: p.ceiling, declare: p.param }
  }

  return {
    _comment: 'GENERATED by app/src/components/chart/supportLoop/assistantPineReference.test.js '
      + '(WRITE_ASSISTANT_PINE_REFERENCE=1). Do not edit by hand. What this build\'s engine serves on a member\'s '
      + 'path, from the engine\'s own tables and its own verdicts. Read by api/services/pine_authoring.py to write '
      + 'the instructions of the assistant that writes Pine.',
    version: 1,
    admitted,
    families,
    drawing,
    constants,
    values,
    text,
    arrays,
    colours: sorted(keysOf(COLOUR_FNS)),
    colourNames: sorted(keysOf(PINE_COLOUR_NAMES).map((n) => `color.${n}`)),
    symbol: sorted([...keysOf(BUILTIN_SYMBOL_SCOPED), ...keysOf(BUILTIN_SYMBOL_NUMERIC)]),
    barstate: sorted(keysOf(BUILTIN_BARSTATE_SERIES)),
    refusedNames: sorted([...keysOf(BUILTIN_BARSTATE_REFUSED), ...keysOf(BUILTIN_SYMBOL_UNSERVED)]),
    outputs,
    limits,
    pitfalls: Object.keys(PITFALL_PROBES).sort().map((id) => {
      const v = verdictRow(verdictOf(PITFALL_PROBES[id]))
      return { id, state: v.state, standing: !(v.ok && RUNS_STATES.includes(v.state)) }
    }),
    examples: examples.map((e) => ({ id: e.id, title: e.title, shows: e.shows, source: e.source, ...verdictRow(verdictOf(e.source)) })),
  }
}

/** The names of a reference the assistant may be told to use: nothing that did not run. */
export function servedOutputs(reference) {
  return (reference.outputs || []).filter((o) => o.ok && RUNS_STATES.includes(o.state)).map((o) => o.name)
}
