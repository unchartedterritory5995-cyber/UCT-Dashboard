// app/src/components/chart/builder/inspect/barInspection.js
//
// INSPECT A BAR (Studio lane R5; member job J6: "see why it shows what it shows on one bar").
//
// For one pinned bar, the value of every named top-level variable of the member's script, and for
// an empty one, why it is empty and the line it is written on.
//
// HOW, AND WHAT THIS FILE IS. No new engine internals: the page derives a PROBE COPY of the script
// that also plots each named variable, runs it through the same door the script itself goes
// through, and reads the columns at the pinned bar. This file is the part that needs no engine:
//
//   probeSource(source, names)   the probe copy, and which variable each added plot stands for
//   readBar(run, probes, index)  the value of each at one bar, with the reason when it is empty
//
// The two things that DO need the engine are handed in by the caller, by the names the engine
// exports them under: the script's top-level names with their lines, and "definition to columns
// for these bars" (backlog 44).
//
// ⛔ STATED LIMITS, shown to the member and not hidden: a variable declared inside a block (an
// `if`, a loop, a function) is not listed; a variable that is not a number on each bar (text, a
// colour, a drawing) cannot be plotted and so cannot be inspected; and if the probe copy's own
// verdict differs from the script's, the member is told, because then the probe is a different
// program in some respect.

/** The kinds of top-level name that hold a value on each bar. A `function` does not. */
export const INSPECTABLE_KINDS = Object.freeze(['series', 'simple', 'input'])

/** How many variables one probe copy plots. Pine caps a script's plots (64); the script has its own. */
export const PROBE_BATCH = 24

/** The title of the plot a probe adds for `name`: what ties a column back to its variable. */
export const probeTitle = (name) => `uct probe ${name}`

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The probe copies of `source`: the script, unchanged, plus one `plot()` per inspectable name at
 * the end. More names than `PROBE_BATCH` become several copies, so no copy exceeds Pine's plot cap.
 * @param {string} source
 * @param {{name: string, line: number, kind: string}[]} names  the engine's top-level names
 * @returns {{ batches: {source: string, probes: {name, line, kind, title}[]}[],
 *             skipped: {name, line, kind, why: string}[] }}
 */
export function probeSource(source, names, { constant = false } = {}) {
  const text = typeof source === 'string' ? source : ''
  const probes = []
  const skipped = []
  const seen = new Set()
  for (const n of Array.isArray(names) ? names : []) {
    if (!n || typeof n.name !== 'string' || !IDENT.test(n.name)) continue
    if (seen.has(n.name)) continue           // a name assigned twice is one variable; its first line is its line
    seen.add(n.name)
    // the engine's `topLevelNames` answers `{ name, line }` and leaves functions out itself, so a
    // name with no kind is a value; a caller that does send a kind is still held to the three
    const kind = typeof n.kind === 'string' && n.kind ? n.kind : 'series'
    const row = { name: n.name, line: Number.isInteger(n.line) ? n.line : null, kind }
    if (!INSPECTABLE_KINDS.includes(kind)) {
      skipped.push({ ...row, why: kind === 'function' ? 'A function, not a value: it has no value of its own on a bar.' : 'Not a value on each bar.' })
      continue
    }
    probes.push({ ...row, title: probeTitle(n.name) })
  }
  const batches = []
  const body = text.replace(/\s+$/, '')
  for (let i = 0; i < probes.length; i += PROBE_BATCH) {
    const part = probes.slice(i, i + PROBE_BATCH)
    // ⭐ `constant`: the engine does not draw a plot of a value that never changes (an input, a
    // literal) as a series, so it gives no column for one. Adding `0 * close` makes it a value on
    // each bar without changing it; only the names the plain form gave nothing for are asked this way.
    const lines = part.map((p) => (constant
      ? `plot(${p.name} + 0 * close, title="${p.title}")`
      : `plot(${p.name}, title="${p.title}")`))
    batches.push({ source: `${body}\n// --- added by Inspect a bar: one plot per named variable ---\n${lines.join('\n')}\n`, probes: part })
  }
  return { batches, skipped }
}

export const EMPTY = Object.freeze({
  NOT_RUN: 'not-run',          // the probe gave no column for it (it could not be plotted)
  NEVER: 'never',              // no value on any bar that was loaded
  STARTS_LATER: 'starts-later', // its first value is on a later bar: it needs history first
  GAP: 'gap',                  // it has values on other bars, not on this one
})

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Why `column` is empty at `index`, or null when it holds a number there. */
export function whyEmpty(column, index) {
  if (!Array.isArray(column) && !ArrayBuffer.isView(column)) return { code: EMPTY.NOT_RUN, firstAt: null }
  if (finite(column[index])) return null
  let first = -1
  for (let i = 0; i < column.length; i += 1) { if (finite(column[i])) { first = i; break } }
  if (first === -1) return { code: EMPTY.NEVER, firstAt: null }
  if (first > index) return { code: EMPTY.STARTS_LATER, firstAt: first }
  return { code: EMPTY.GAP, firstAt: first }
}

/** The member's sentence for an empty variable. `dateOf(i)` words a bar; without it bars are counted. */
export function emptyWords(why, { dateOf = null, index = null } = {}) {
  if (!why) return ''
  const at = (i) => (typeof dateOf === 'function' && dateOf(i)) || `bar ${i + 1}`
  switch (why.code) {
    case EMPTY.NOT_RUN:
      return 'It is not a number on each bar (text, a colour or a drawing), so it cannot be read here.'
    case EMPTY.NEVER:
      return 'It has no value on any bar that is loaded.'
    case EMPTY.STARTS_LATER: {
      const need = Number.isInteger(index) ? why.firstAt - index : null
      return `Its first value is on ${at(why.firstAt)}${need && need > 0 ? `, ${need} ${need === 1 ? 'bar' : 'bars'} after this one` : ''}: it needs that much history first.`
    }
    case EMPTY.GAP:
      return 'It has a value on other bars, but the script gives it none on this one.'
    default:
      return ''
  }
}

/**
 * The inspected variables at one bar.
 * @param {{columns: Object<string, ArrayLike<number>>}} run  the probe's columns, keyed by plot title
 * @param {{name, line, kind, title}[]} probes
 * @param {number} index  the pinned bar's position in the columns
 * @returns {{name, line, kind, value: number|null, empty: null|{code, firstAt}}[]}
 */
export function readBar(run, probes, index) {
  const columns = (run && run.columns) || {}
  return (Array.isArray(probes) ? probes : []).map((p) => {
    const column = columns[p.title]
    const empty = whyEmpty(column, index)
    return { name: p.name, line: p.line, kind: p.kind, value: empty ? null : column[index], empty }
  })
}

/**
 * The engine's headless answer as columns keyed by plot title. Its `outputs` are an ORDERED list of
 * `{ key, title, values }` (the definition's own plots first, in order; a probe's plots are the
 * ones appended at the end). A probe's titles are unique by construction; if a member's own plot
 * happens to carry the same title, the LAST one is the probe's, so the last wins.
 */
export function columnsByTitle(outputs) {
  const columns = {}
  for (const o of Array.isArray(outputs) ? outputs : []) {
    if (o && typeof o.title === 'string' && o.title) columns[o.title] = o.values
  }
  return { columns }
}

/** A value as the legend would print it: up to four decimals, no trailing zeros, thousands kept plain. */
export function valueText(v) {
  if (!finite(v)) return ''
  const a = Math.abs(v)
  const s = a >= 1000 ? v.toFixed(2) : a >= 1 ? v.toFixed(4) : v.toPrecision(4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * Why a whole script is not computed in this panel, in a member's words. The engine names the
 * reason by a code; its own sentence is written for engineers and is not shown.
 * @param {{code?: string|null, reason?: string}|null} run  the compute door's answer for the script itself
 */
export function notComputedWords(run) {
  const code = run && typeof run.code === 'string' ? run.code : ''
  const only = "Inspect a bar reads this chart's own bars only, so it cannot show this script's values yet."
  if (code.startsWith('other-symbol:')) return `This script reads another symbol. ${only}`
  if (code.startsWith('request:') || code.startsWith('lower-tf')) return `This script reads another timeframe. ${only}`
  return 'This script is not computed here, so there is nothing to read.'
}

/** The most names one inspection reads. A script with more says so and reads the first ones. */
export const INSPECT_MAX_NAMES = 96

/**
 * Inspect a script: derive the probe copies, run each through the caller's doors, and gather one
 * column per variable. The doors are the engine's own, handed in:
 *   names(source)              -> [{ name, line, kind }]      the top-level names
 *   build(source)              -> { ok, definition, reason }  the door a pasted script goes through (may be a promise)
 *   compute(definition, bars)  -> { lane, outputs: [{ key, title, values }] }  (may be a promise)
 *
 * A copy that the door refuses is retried ONE NAME AT A TIME, so one variable that cannot be
 * plotted (text, a colour) costs that variable and not the other twenty-three.
 * @returns {Promise<{ ok: boolean, reason?: string, lane?: string, probes: object[], columns: object,
 *   skipped: object[], failed: {name, line, kind, reason}[], truncated: number, laneDiffers: boolean }>}
 */
export async function inspectScript({ source, bars, names, build, compute }) {
  const none = (reason) => ({ ok: false, reason, probes: [], columns: {}, skipped: [], failed: [], truncated: 0, laneDiffers: false })
  if (typeof source !== 'string' || !source.trim()) return none('There is no script to inspect.')
  // the script itself first: a script the door refuses has nothing to read, and its lane is the
  // one every probe copy is compared with
  const own = await build(source)
  if (!own || !own.ok) return none((own && own.reason) || 'This script is not drawn, so there is nothing to read.')
  const ownRun = await compute(own.definition, bars)
  // ⛔ the script ITSELF is not computed here (it reads another symbol, or a weekly value this
  // panel is not handed): said once, for the whole script. Without this every variable was listed
  // as "not a number on each bar", which is not why (seen on production, 2026-11-17).
  if (!ownRun || !Array.isArray(ownRun.outputs)) return none(notComputedWords(ownRun))
  const lane = ownRun && typeof ownRun.lane === 'string' ? ownRun.lane : null

  const all = (names(source) || [])
  const { batches, skipped } = probeSource(source, all.slice(0, INSPECT_MAX_NAMES))
  const columns = {}
  const failed = []
  let laneDiffers = false
  const run = async (src) => {
    const built = await build(src)
    if (!built || !built.ok) return { ok: false, reason: (built && built.reason) || 'it could not be read' }
    const out = await compute(built.definition, bars)
    if (!out || !Array.isArray(out.outputs)) return { ok: false, reason: (out && out.reason) || 'it could not be computed' }
    if (lane && typeof out.lane === 'string' && out.lane !== lane) laneDiffers = true
    return { ok: true, columns: columnsByTitle(out.outputs).columns }
  }
  for (const batch of batches) {
    const got = await run(batch.source)
    if (got.ok) { Object.assign(columns, got.columns); continue }
    for (const p of batch.probes) {
      const one = probeSource(source, [p]).batches[0]
      const r = await run(one.source)
      if (r.ok) Object.assign(columns, r.columns)
      else failed.push({ name: p.name, line: p.line, kind: p.kind, reason: r.reason })
    }
  }
  // a name the plain form gave NO column for (not an empty one: none) is asked once more as a
  // value that is the same on every bar; if that gives none either, it is not a number
  const failedSoFar = new Set(failed.map((f) => f.name))
  for (const p of batches.flatMap((b) => b.probes)) {
    if (failedSoFar.has(p.name) || columns[p.title] !== undefined) continue
    const one = probeSource(source, [p], { constant: true }).batches[0]
    const r = await run(one.source)
    if (r.ok && r.columns[p.title] !== undefined) columns[p.title] = r.columns[p.title]
    else failed.push({ name: p.name, line: p.line, kind: p.kind, reason: r.ok ? 'it gave no value' : r.reason })
  }
  const failedNames = new Set(failed.map((f) => f.name))
  return {
    ok: true, lane,
    probes: batches.flatMap((b) => b.probes).filter((p) => !failedNames.has(p.name)),
    columns, skipped, failed, truncated: Math.max(0, all.length - INSPECT_MAX_NAMES), laneDiffers,
  }
}
