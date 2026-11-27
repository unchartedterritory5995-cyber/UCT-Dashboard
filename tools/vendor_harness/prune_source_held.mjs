// tools/vendor_harness/prune_source_held.mjs <snapshot verdicts.json> <master's verdicts.json>
//
// ⛔ A snapshot's `sourceHeldStore` names the built-in sources the run HELD. The corpus harness lists every file of
// this machine's licence-held built-in source store (`builtinSource.js::builtinSourceStorePins`), so a source staged
// on one PC for a capture that is not committed yet (#2848: STD;Bollinger%1Bars) reached the committed snapshot.
// Twice it was removed by hand (f48dbba66c, e28249cde8). Coordinator ruling (b) makes it the rule:
// an entry stays when master's committed snapshot of the same lane already carries it (same id AND sha256), or when
// a row of this snapshot was graded on it (its `sourceHeld` names `source/<id>@<sha256>`). Every other entry is this
// machine's local listing, and it is dropped. When none stays, the key is dropped.
// Written by the harness's own serialiser (JSON.stringify, indent 1), as splice_held.mjs, so no number is respelled.
import fs from 'node:fs'

export const SOURCE_STORE = 'sourceHeldStore'

const pinOf = (e) => (e && typeof e.id === 'string' && typeof e.sha256 === 'string' ? `source/${e.id}@${e.sha256}` : null)

/** `{doc, dropped}`: the snapshot whose `sourceHeldStore` keeps only master's entries and the ones its rows cite.
 *  `master` is master's committed snapshot of the same lane (null: master carries none). Pure: no I/O. */
export function pruneSourceHeld(doc, master) {
  const listed = Array.isArray(doc[SOURCE_STORE]) ? doc[SOURCE_STORE] : null
  if (!listed) return { doc, dropped: [] }
  const keep = new Set()
  for (const e of (master && Array.isArray(master[SOURCE_STORE]) ? master[SOURCE_STORE] : [])) keep.add(pinOf(e))
  for (const r of doc.results || []) for (const pin of (r && r.sourceHeld) || []) keep.add(String(pin))
  keep.delete(null)
  const kept = []
  const dropped = []
  for (const e of listed) {
    const pin = pinOf(e)
    ;(pin && keep.has(pin) ? kept : dropped).push(e)
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
  const [snapshotPath, masterPath] = argv
  if (!snapshotPath || !masterPath) {
    console.log('usage: node tools/vendor_harness/prune_source_held.mjs <verdicts.json> <master verdicts.json>')
    return 2
  }
  const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'))
  const { doc, dropped } = pruneSourceHeld(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')), master)
  if (dropped.length) {
    fs.writeFileSync(`${snapshotPath}.tmp`, JSON.stringify(doc, null, 1) + '\n', 'utf8')
    fs.renameSync(`${snapshotPath}.tmp`, snapshotPath)
  }
  console.log(`sourceHeldStore: dropped ${dropped.length} machine-local pin(s) master does not carry and no row cites` +
    (dropped.length ? ` (${dropped.map((e) => (e && e.id) || '?').join(', ')})` : '') + ` in ${snapshotPath}`)
  return 0
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('prune_source_held.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}
