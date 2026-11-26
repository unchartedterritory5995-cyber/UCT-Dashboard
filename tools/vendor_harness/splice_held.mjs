// tools/vendor_harness/splice_held.mjs <snapshot verdicts.json> <held run verdicts.json> <canonical path>...
//
// The licence-held captures (docs/pine/vendor-harness/licence-held.json) left the tree, so the corpus harness over
// tests/fixtures/vendor cannot grade them; they are graded from the local capture store in a run of their own and
// SPLICED into the snapshot under their CANONICAL fixture path (the path every rail resolves a held capture by,
// commit 53b3a790cb). Written by the harness's own serialiser (JSON.stringify, indent 1), so no number is respelled.
import fs from 'node:fs'
import path from 'node:path'

const [snapshotPath, heldPath, ...canonical] = process.argv.slice(2)
const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
const held = JSON.parse(fs.readFileSync(heldPath, 'utf8'))
// ⛔ e98 — a BOUNDED-WINDOW run (`VENDOR_HARNESS_WINDOW`) graded only the newest bars: never a committed snapshot row
if (held.boundedWindow || (held.results || []).some((r) => r && r.boundedWindow)) {
  throw new Error('the held run is a bounded-window grade (VENDOR_HARNESS_WINDOW): it is never spliced into a snapshot')
}
if (snap.lane !== held.lane) throw new Error(`lanes differ: snapshot ${snap.lane}, held run ${held.lane}`)
if (held.scriptEngineVersion !== snap.scriptEngineVersion) throw new Error('the held run was graded at another engine')
const byName = new Map(canonical.map((c) => [path.basename(c), c]))
for (const row of held.results) {
  const to = byName.get(path.basename(row.file))
  if (!to) throw new Error(`held row ${row.id} (${row.file}) has no canonical path`)
  snap.results = snap.results.filter((r) => r.id !== row.id)
  snap.results.push({ ...row, file: to })
  byName.delete(path.basename(row.file))
}
if (byName.size) throw new Error(`held capture(s) not graded: ${[...byName.values()].join(', ')}`)
fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 1) + '\n')
console.log(`spliced ${held.results.length} held row(s) into ${snapshotPath}`)
