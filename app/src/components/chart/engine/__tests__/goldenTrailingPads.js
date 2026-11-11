// app/src/components/chart/engine/__tests__/goldenTrailingPads.js
//
// ─── THE TRAILING-PAD MEASUREMENT, ONE COPY FOR BOTH OF ITS READERS ──────────
//
// `"<compute.fn>.<plotKey>" → trailing pad length`, MEASURED off the committed
// golden fixtures (`tests/fixtures/indicators/*.json`) rather than typed. Two
// rails read it: `ast/lint.test.js` hands it to `lintCatalogue` as
// `declaredForwardFacts` (the only fact the linter has about a hand-written
// compute), and `perPlotRepaintBadge.test.jsx` ties `ichimoku.chikou`'s declared
// `forward` to it. They carried two hand-copied loops until 2026-11-07; one fact,
// one measurement.
//
// ⛔ WHAT A "TRAILING PAD" IS — and the two conditions that make a null run one.
//
//   1. THE FACT IS ABOUT A PLOT. Its address is `<compute.fn>.<plotKey>` —
//      exactly what `lint.lintDefinition` looks up — and the badge it feeds is
//      PER PLOT (decision record §4). A fixture column no shipped definition
//      draws under that address is not a fact about anything a member sees; it
//      is measured by nothing and read by nothing.
//
//   2. THE PLOT IS A CONTINUOUS SERIES. A pad is defined against the alignment
//      rule of record (`_schema.md`): *"`null` means NOT COMPUTABLE HERE"* — pad,
//      then values. Chikou's tail is null because bar i's close is written to
//      i − 26, so the last 26 slots have nothing written to them: a FORWARD READ,
//      which is what the repaint badge is about. A plot that is BLANK BY DESIGN
//      (`style: 'markers'` / a `marker` glyph — the dot rule
//      `defSchema.dotPlotKeysOf` applies — or `plots[].sparse: true`) uses null
//      for "no event on this bar". Its trailing nulls are SILENCE, not a shift,
//      and the length of that silence is whatever the bars happened to do.
//      `hlines` returns no column at all.
//
// ⚰️ WHY THIS EXISTS. The loop used to count the trailing null run of EVERY
// column of every fixture. That held while every column was a continuous series;
// the UCT RS fixtures (`rs_events_default.json`, `rs_mansfield.json`) added
// sparse event/dot columns — `dotNL`, `dotNHred`, `dotMansfieldCross`, … null
// wherever no event fired — and both census rails went red on six "pads" that
// were event columns ending without an event. ⛔ The fix is the rule above, NEVER
// an exclusion list: a list of RS names would hide the next sparse column's
// author's mistake and a genuine pad that landed in an excluded fixture alike.
//
// ⚠️ The selection reads only the definition's ADDRESS and STYLE — never its
// `forward` — so the length is still the artefact's and the comparison in the
// badge rail stays a declaration checked against a measurement, not against itself.

import fs from 'node:fs'
import path from 'node:path'

/** Every fixture document under `dir` that carries a column-map `expected`. */
export function readGoldenFixtureDocs(dir) {
  const docs = []
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const expected = doc && doc.expected
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) continue
    docs.push({ file, doc })
  }
  return docs
}

/** A plot whose nulls mean "nothing here BY DESIGN", not "not computable yet". */
export function isBlankByDesign(plot) {
  if (!plot || typeof plot !== 'object') return true
  if (plot.style === 'markers' || plot.style === 'hlines') return true
  if (plot.marker && typeof plot.marker === 'object') return true
  return plot.sparse === true
}

/** `"<compute.fn>.<plotKey>" → plot` over the CONTINUOUS plots of `defs`. */
function continuousPlotAddresses(defs) {
  const out = new Map()
  for (const def of defs || []) {
    const fn = def && def.compute && def.compute.fn
    if (!fn || !Array.isArray(def.plots)) continue
    for (const plot of def.plots) {
      if (!plot || !plot.key || isBlankByDesign(plot)) continue
      out.set(`${fn}.${plot.key}`, plot)
    }
  }
  return out
}

/**
 * The measurement. `docs` is `readGoldenFixtureDocs`' shape (`[{file, doc}]`),
 * `defs` the definitions whose plots the facts are about.
 * @returns {Record<string, number>}
 */
export function measureTrailingPads(docs, defs) {
  const plots = continuousPlotAddresses(defs)
  const facts = {}
  for (const { file, doc } of docs) {
    for (const [col, values] of Object.entries(doc.expected)) {
      const address = `${doc.kind}.${col}`
      if (!plots.has(address)) continue
      if (!Array.isArray(values) || !values.length) continue
      let trailing = 0
      for (let i = values.length - 1; i >= 0 && values[i] === null; i--) trailing++
      if (!trailing) continue
      if (trailing === values.length) {
        throw new Error(`${file}.${col} is entirely null — that is not a trailing pad, it is an empty column`)
      }
      facts[address] = trailing
    }
  }
  return facts
}
