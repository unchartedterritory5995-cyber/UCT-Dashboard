// tools/vendor_harness/prune_source_held.mjs <snapshot verdicts.json>
//
// ⛔ A snapshot's `sourceHeldStore` names the built-in sources the run HELD. The corpus harness lists every file of
// this machine's licence-held built-in source store (`builtinSource.js::builtinSourceStorePins`), so a source staged
// on one PC for a capture that is not committed yet (coordinator ruling (b), #2848: STD;Bollinger%1Bars) reached the
// committed snapshot. Twice it was taken out by hand (f48dbba66c, #2848). This tool is the rule:
// a `sourceHeldStore` entry stays only when some row of the SAME snapshot was graded on it, that is, a row's
// `sourceHeld` names `source/<id>@<sha256>`. An entry no row cites is machine-local, and it is dropped. When none
// stays, the key is dropped.
// Written by the harness's own serialiser (JSON.stringify, indent 1), as splice_held.mjs, so no number is respelled.
import fs from 'node:fs'

export const SOURCE_STORE = 'sourceHeldStore'

/** `{doc, dropped}`: the snapshot with only the `sourceHeldStore` entries its rows cite. Pure: no I/O. */
export function pruneSourceHeld(doc) {
  const listed = Array.isArray(doc[SOURCE_STORE]) ? doc[SOURCE_STORE] : null
  if (!listed) return { doc, dropped: [] }
  const cited = new Set()
  for (const r of doc.results || []) for (const pin of (r && r.sourceHeld) || []) cited.add(String(pin))
  const kept = []
  const dropped = []
  for (const e of listed) {
    const pin = e && typeof e.id === 'string' && typeof e.sha256 === 'string' ? `source/${e.id}@${e.sha256}` : null
    ;(pin && cited.has(pin) ? kept : dropped).push(e)
  }
  if (!dropped.length) return { doc, dropped }
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    if (k !== SOURCE_STORE) out[k] = v
    else if (kept.length) out[k] = kept
  }
  return { doc: out, dropped }
}

function main(argv) {
  const [snapshotPath] = argv
  if (!snapshotPath) { console.log('usage: node tools/vendor_harness/prune_source_held.mjs <verdicts.json>'); return 2 }
  const { doc, dropped } = pruneSourceHeld(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')))
  if (dropped.length) {
    fs.writeFileSync(`${snapshotPath}.tmp`, JSON.stringify(doc, null, 1) + '\n', 'utf8')
    fs.renameSync(`${snapshotPath}.tmp`, snapshotPath)
  }
  console.log(`sourceHeldStore: dropped ${dropped.length} machine-local pin(s) no row cites` +
    (dropped.length ? ` (${dropped.map((e) => (e && e.id) || '?').join(', ')})` : '') + ` in ${snapshotPath}`)
  return 0
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('prune_source_held.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}
