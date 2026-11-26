// tools/vendor_harness/splice_rows.mjs [--check] <snapshot verdicts.json> <subset run verdicts.json>
//
// ⭐ SPLICE A SUBSET RUN'S ROWS INTO A COMMITTED SNAPSHOT, IN PLACE (coordinator ruling 2026-11-19, the GATE-BLIND
// follow-up (a)), on the `splice_held.mjs` precedent: the corpus harness grades a SUBSET of the committed captures
// (copied to a scratch directory, so `VENDOR_HARNESS_DIR` can name exactly them) and its rows REPLACE the
// snapshot's rows for the same capture FILE, at the same position. Written by the harness's own serialiser
// (JSON.stringify, indent 1), so no number is respelled and nothing is hand-edited.
//
// ⛔ Rows are matched by the capture's FILE NAME, never its id (two committed captures share an id: the 1D and
//    1W vw-object-gc-* captures), and the snapshot's own `file` path is kept.
// ⛔ Refused: a lane or script engine version that differs; another library store (and, run without one, any row
//    whose script imports a library); a subset row with no snapshot row; a snapshot row matched twice.
// ⭐ `--check` writes nothing: it exits 1 unless EVERY subset row already equals the snapshot's row, field for
//    field. Run it on a FRESH subset run after a splice: the committed rows are then exactly what the harness
//    produces for them, which is the proof that no row was edited by hand.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const check = args[0] === '--check'
const [snapshotPath, subsetPath] = check ? args.slice(1) : args
const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
const sub = JSON.parse(fs.readFileSync(subsetPath, 'utf8'))
if (snap.lane !== sub.lane) throw new Error(`lanes differ: snapshot ${snap.lane}, subset run ${sub.lane}`)
// ⛔ e98 — a BOUNDED-WINDOW run (`VENDOR_HARNESS_WINDOW`) graded only the newest bars: never a committed snapshot row
if (sub.boundedWindow || (sub.results || []).some((r) => r && r.boundedWindow)) {
  throw new Error('the subset run is a bounded-window grade (VENDOR_HARNESS_WINDOW): it is never spliced into a snapshot')
}
if (sub.scriptEngineVersion !== snap.scriptEngineVersion) throw new Error('the subset run was graded at another engine')
// ⛔ THE LIBRARY STORE. A subset run with the snapshot's store is always comparable. One WITHOUT it (the store is a
// scratch directory the libraries chain holds) is accepted only for rows whose script imports NOTHING: a script with
// no `import` statement cannot reach a library, so the store cannot change its grade. Every row is checked by its
// committed capture's own source, and a snapshot row marked `storeHeld` is refused outright.
const storeDiffers = JSON.stringify(sub.libraryStore || null) !== JSON.stringify(snap.libraryStore || null)
if (storeDiffers && sub.libraryStore) throw new Error('the subset run was graded with ANOTHER library store')
const importsNothing = (file) => {
  const cap = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  const text = cap && cap.source && typeof cap.source.text === 'string' ? cap.source.text : ''
  return !/^\s*import\s/m.test(text)
}
const at = new Map()
snap.results.forEach((r, i) => {
  const name = path.basename(r.file)
  if (at.has(name)) throw new Error(`two snapshot rows for one capture file: ${name}`)
  at.set(name, i)
})
const differ = []
const used = new Set()
for (const row of sub.results) {
  const name = path.basename(row.file)
  if (!at.has(name)) throw new Error(`subset row ${row.id} (${name}) has no row in the snapshot`)
  if (used.has(name)) throw new Error(`subset run graded ${name} twice`)
  used.add(name)
  const i = at.get(name)
  if (storeDiffers && (snap.results[i].storeHeld || !importsNothing(snap.results[i].file))) {
    throw new Error(`${row.id}: graded without the snapshot's library store, and its script imports a library (or the row is storeHeld)`)
  }
  const next = { ...row, file: snap.results[i].file }
  if (JSON.stringify(next) !== JSON.stringify(snap.results[i])) differ.push(`${row.id} (${name})`)
  if (!check) snap.results[i] = next
}
if (check) {
  if (differ.length) {
    console.log(`CHECK FAILED: ${differ.length} of ${sub.results.length} row(s) differ from the snapshot:\n  ${differ.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`check: all ${sub.results.length} subset row(s) equal the snapshot's`)
} else {
  fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 1) + '\n')
  console.log(`spliced ${sub.results.length} row(s) into ${snapshotPath} (${differ.length} changed)`)
}
