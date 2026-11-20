// app/src/components/chart/engine/heldWithholds.js
//
// ─── ⭐⭐ THE NARROW WITHHOLDS LICENCE-HELD CAPTURES ASK FOR (coordinator rulings 2026-11-19) ─────────────────────
//
// THE GOVERNING RULE: never take away a correct picture. When a licence-held capture (its text never in git) grades a
// script DIVERGE, the door withholds the NARROWEST thing that removes exactly the wrong element and keeps the correct
// ones: one drawn row by title, one row's colour, one paint, one drawing family. A whole-script kill only where the
// wrong element cannot be isolated (the runtime kill list / the host known-divergence list, not this file).
//
// `heldWithholds.json` is DERIVED (`tools/vendor_harness/held_evidence.py --write`) from the committed evidence
// ledger's rows, by source hash, and never hand-typed (`--check` is its CI rail). Each withhold names the DOOR that drew
// the element (`host` / `runtime`), so it is honoured only on the document the comparison was taken on.
import DOC from './heldWithholds.json'
import { sha256Hex } from './ast/parse.js'

/** The stable code a row's withheld colour, a withheld row's or paint's sentence, and a fail-closed refusal carry. */
export const HELD_DIVERGENCE_GUARD = 'pine:held-divergence'
export const HELD_SCOPES = Object.freeze(['output', 'outputColour', 'paint', 'objectFamily'])

const HASH_RE = /^[0-9a-f]{64}$/

function entriesOf(doc) {
  const m = new Map()
  for (const s of (doc && Array.isArray(doc.scripts) ? doc.scripts : [])) {
    if (s && typeof s.sha256 === 'string' && HASH_RE.test(s.sha256) && Array.isArray(s.withholds)) m.set(s.sha256, s)
  }
  return m
}

const COMMITTED = entriesOf(DOC)
let _entries = COMMITTED
let _ignored = false

/** How many captured charts ask for it, in the member's words. */
function chartsWord(w) {
  const n = Array.isArray(w.evidence) ? w.evidence.length : 0
  return n === 1 ? 'one captured chart' : `${n} captured charts`
}

/** The member's sentence for one withhold: what differs, and that it comes back once a comparison matches. */
export function heldWithholdSentence(w) {
  const what = w.scope === 'outputColour' ? 'its colour differs from TradingView’s'
    : w.scope === 'objectFamily' ? 'they differ from TradingView’s'
      : 'it differs from TradingView’s'
  return `${what} on ${chartsWord(w)}, so it is withheld until that is fixed, and comes back once a new comparison `
    + 'against TradingView matches'
}

const FAMILY_PLURAL = Object.freeze({ line: 'lines', label: 'labels', box: 'boxes', table: 'tables',
  linefill: 'fills between lines', polyline: 'polylines' })
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The drawing families an object program draws (its registers' families), in a stable order. */
export function objectFamiliesOf(program) {
  const regs = (program && Array.isArray(program.regs)) ? program.regs : []
  return [...new Set(regs.map((r) => r && r.family).filter(Boolean))].sort()
}

/** The drawing note for withheld drawing families. The document draws NONE of its drawings (this chart cannot hold
 *  back one kind of drawing alone yet): the families asked for are named with their reason, and any OTHER family the
 *  program draws is named as held back with them, so nothing leaves the chart unsaid. */
export function heldDrawingsNote(ws, drawnFamilies = []) {
  const fams = [...new Set(ws.map((w) => w.family).filter(Boolean))].sort()
  const evidence = [...new Set(ws.flatMap((w) => (Array.isArray(w.evidence) ? w.evidence : [])))]
  const others = (drawnFamilies || []).filter((f) => !fams.includes(f))
  return {
    name: 'Drawings',
    note: `Its ${listOf(fams.map((f) => FAMILY_PLURAL[f] || f))} are not drawn: `
      + `${heldWithholdSentence({ scope: 'objectFamily', evidence })}.`
      + (others.length ? ` Its ${listOf(others.map((f) => FAMILY_PLURAL[f] || f))} are held back with them: this chart `
        + 'cannot hold back one kind of drawing alone yet.' : ''),
  }
}

/** ⭐ A withhold's stable key (`<door>:<scope>:<target>`): what a minted document stamps it honoured
 *  (`meta.heldWithholds`, sorted), so the server can tell a saved copy that honours today's withholds from one minted
 *  before them (`api/services/held_withholds.py`, the same key). */
export const HELD_WITHHOLDS_STAMP = 'heldWithholds'
export function heldWithholdKey(w) {
  const target = w.scope === 'paint' ? `${w.kind}@${w.line}` : w.scope === 'objectFamily' ? w.family : w.title
  return `${w.door}:${w.scope}:${target}`
}
export const heldWithholdsStamp = (ws) => [...new Set((ws || []).map(heldWithholdKey))].sort()

/** The withholds this Pine source carries for `door` (`host` / `runtime`), or []. */
export function heldWithholdsOf(source, door) {
  if (_ignored || typeof source !== 'string' || !source || !_entries.size) return []
  let e = _entries.get(sha256Hex(source))
  if (!e && source.includes('\r\n')) e = _entries.get(sha256Hex(source.replace(/\r\n/g, '\n')))
  if (!e) return []
  return e.withholds.filter((w) => w && w.door === door)
}

/** Rails only (`src/test-setup.js` may opt the measuring suites out): the grade measures the engine, not this list. */
export function __ignoreHeldWithholdsForTests() { _ignored = true }
/** Rails only: back to the app's state (the committed file, ON). */
export function __resetHeldWithholds() { _ignored = false; _entries = COMMITTED }
/** Rails only: a synthetic document (`{scripts: [...]}`), ON. */
export function __setHeldWithholdsForTests(doc) { _ignored = false; _entries = entriesOf(doc) }
