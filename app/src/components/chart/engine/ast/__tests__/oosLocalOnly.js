// app/src/components/chart/engine/ast/oosLocalOnly.js
//
// ─── ⏭ THE LOCAL-ONLY HALF OF `pine_oos`, SKIPPED BY NAME — NEVER BY SILENCE ──
//
// Test support, not product code. `tests/fixtures/pine_oos` is a frozen 59-script
// corpus, and 29 of its members are `storage: "local-only"` in MANIFEST.json:
// their recorded licence does not contemplate redistribution (owner ruling
// 2026-09-09, docs/pine/LICENSING.md), so #145 (e855f62cd) gitignored their
// source and it has NEVER been in git history. A fresh checkout — every new
// worktree, and CI — has the other 30 and none of these.
//
// ⚰️ WHAT THAT DID: every rail that needed one of them died on `ENOENT` or on a
// population floor ("expected 30 to be 59") and master carried ~20 reds that
// said nothing about the product. A red that is always red is a red nobody
// reads, and the next real one hides among them.
//
// ⛔ AND THE FIX MAY NOT BE A SILENT PASS EITHER. So a rail that needs an absent
// local-only member is SKIPPED, and its TITLE says so: which members, why they
// are not here, and how to put them back. A skipped rail must never read as a
// verified one — the name in the report is the whole defence.
//
// ⛔⛔ ONLY LOCAL-ONLY MEMBERS MAY BE ABSENT. A committed (`storage: "git"`)
// member that is missing is a deleted fixture, not a licence decision, and
// `COMMITTED_ABSENT` stays a hard red in `oosMeasuredBaseline.test.js`. That is
// the one place it is asserted — a guard repeated in twelve files is twelve
// guards nobody can mutation-prove.
//
// To run the skipped rails: re-fetch each absent member from its MANIFEST
// `source_url` into tests/fixtures/pine_oos/ and verify it against its recorded
// `sha256_source` before trusting a single number it produces.
import fs from 'node:fs'
import path from 'node:path'
import { it } from 'vitest'

export const OOS_DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_oos')

const MANIFEST = JSON.parse(fs.readFileSync(path.join(OOS_DIR, 'MANIFEST.json'), 'utf8'))
const nameOf = (e) => `${e.tier}__${e.file}`
const here = (n) => fs.existsSync(path.join(OOS_DIR, n))

/** Every member whose source is held locally only, by file name, sorted. */
export const LOCAL_ONLY = MANIFEST.entries
  .filter((e) => e.storage === 'local-only').map(nameOf).sort()

/** The local-only members NOT on this machine. Empty on a complete rig. */
export const OOS_ABSENT = LOCAL_ONLY.filter((n) => !here(n))

/** Committed members that are missing. Must be empty everywhere. */
export const COMMITTED_ABSENT = MANIFEST.entries
  .filter((e) => e.storage === 'git').map(nameOf).filter((n) => !here(n)).sort()

const withExt = (n) => (n.endsWith('.pine') ? n : `${n}.pine`)

/** Which of `names` (with or without `.pine`) are absent local-only members.
 *  `'ALL'` asks about the whole corpus. */
export function absentOf(names) {
  if (names === 'ALL') return OOS_ABSENT
  return names.map(withExt).filter((n) => OOS_ABSENT.includes(n))
}

/** The sentence a skipped rail carries in its title. */
export function skipNote(absent) {
  const shown = absent.slice(0, 3).map((n) => n.replace(/\.pine$/, '')).join(', ')
  const more = absent.length > 3 ? ` +${absent.length - 3} more` : ''
  return `⏭ SKIPPED, NOT VERIFIED — ${absent.length} local-only pine_oos member(s) absent `
    + `on this machine (${shown}${more}). Licence-held, never committed: `
    + 'docs/pine/LICENSING.md, tests/fixtures/pine_oos/.gitignore. Re-fetch from '
    + 'MANIFEST.json source_url and verify sha256_source to run it.'
}

/** A title suffix for a rail that still runs over the members that ARE here:
 *  empty on a complete rig, otherwise a loud note that it measured without the
 *  absentees — so a partial population never reads as the whole one. */
export function partialNote() {
  if (!OOS_ABSENT.length) return ''
  return ` — ⚠ PARTIAL: measured WITHOUT ${OOS_ABSENT.length} absent local-only `
    + 'pine_oos member(s) (docs/pine/LICENSING.md)'
}

/** `it`, unless a local-only member it needs is absent — then a skip that says
 *  so in its own name. `names` is a list of corpus members, or `'ALL'`. */
export function itNeedsLocalOnly(names, title, fn, timeout) {
  const absent = absentOf(names)
  if (absent.length) return it.skip(`${title} — ${skipNote(absent)}`, fn)
  return it(title, fn, timeout)
}
