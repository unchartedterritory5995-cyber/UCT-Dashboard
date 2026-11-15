// app/src/components/chart/engine/ast/__tests__/licenceHeld.js
//
// ─── ⏭ LICENCE-HELD FIXTURES: READ WHEN ON THE MACHINE, SKIPPED BY NAME WHEN NOT ──
//
// Test support, not product code. On 2026-11-15 every committed fixture whose
// embedded third-party Pine source is NOT permitted by
// `tools/pine_survey/corpus_licence.py` left the tree (docs/pine/LICENSING.md §1:
// an explicit MPL-2.0 / MIT / Apache-2.0 header, nothing else; "no licence line is
// not permissive"). They are listed, by path and hash only, in
// `docs/pine/vendor-harness/licence-held.json`, and their bytes are kept OUT of git
// in the local capture store (`$UCT_VENDOR_CAPTURE_STORE`, default
// `%LOCALAPPDATA%/uct-vendor-batch/runs`, the store `evidence_engine.py regrade`
// reads):
//
//   <store>/<run>/captures/<file>.json     a vendor capture
//   <store>/<run>/sources/<repo path>      a .pine source
//
// A `.pine` that is a local-only `tests/fixtures/pine_oos` member is also found at
// its gitignored home there (see `oosLocalOnly.js`).
//
// ⛔ A FOUND FILE IS TRUSTED ONLY AT ITS RECORDED HASH. Bytes that do not hash to
// the entry's `fileSha256` throw: a wrong file would make every number lie.
//
// ⛔ A SKIP IS NEVER SILENT. A rail that needs an absent held file is skipped and its
// TITLE names the file, the licence finding, the LICENSING rule and the evidence-ledger
// verdict (or that no row is filed yet), so it can never read as verified.
//
// ⛔⛔ ONLY A REGISTERED FILE MAY BE ABSENT. A path that is neither in the tree nor in
// the registry is a deleted fixture, not a licence decision: `readFixture` throws.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { it } from 'vitest'

export const REPO = path.resolve(process.cwd(), '..')
export const REGISTRY_PATH = path.join(REPO, 'docs/pine/vendor-harness/licence-held.json')
const LEDGER_PATH = path.join(REPO, 'docs/pine/vendor-harness/evidence-ledger.jsonl')
const OOS_DIR = path.join(REPO, 'tests/fixtures/pine_oos')

export const STORE_ENV = 'UCT_VENDOR_CAPTURE_STORE'

/** The out-of-git store; the env var wins (the same rule as `evidence_ledger.capture_store`). */
export function storeRoot() {
  const v = (process.env[STORE_ENV] || '').trim()
  return v || path.join(os.homedir(), 'AppData', 'Local', 'uct-vendor-batch', 'runs')
}

const REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
const norm = (rel) => rel.replace(/\\/g, '/')
const BY_PATH = new Map(REGISTRY.entries.map((e) => [e.path, e]))

/** The registry entry for a repo-relative path, or undefined. */
export const heldEntry = (rel) => BY_PATH.get(norm(rel))

/** Every registered path under a repo directory, sorted. */
export const heldIn = (dir) => REGISTRY.entries
  .filter((e) => e.path.startsWith(`${norm(dir).replace(/\/$/, '')}/`)).map((e) => e.path).sort()

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

function candidates(entry) {
  const out = []
  const root = storeRoot()
  let runs = []
  try { runs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() } catch { runs = [] }
  for (const run of runs) {
    out.push(entry.kind === 'capture'
      ? path.join(root, run, 'captures', path.basename(entry.path))
      : path.join(root, run, 'sources', ...entry.path.split('/')))
  }
  if (entry.kind === 'source' && entry.recordStorage === 'local-only') out.push(path.join(OOS_DIR, path.basename(entry.path)))
  return out
}

const resolved = new Map()

/** Where a fixture's bytes are on this machine: the tree, else a held copy at its
 *  recorded hash, else null. Throws on a held copy whose bytes are wrong. */
export function fixturePath(rel) {
  const key = norm(rel)
  if (resolved.has(key)) return resolved.get(key)
  let found = null
  const inTree = path.join(REPO, ...key.split('/'))
  if (fs.existsSync(inTree)) found = inTree
  else {
    const entry = heldEntry(key)
    for (const p of entry ? candidates(entry) : []) {
      if (!fs.existsSync(p)) continue
      const got = sha256(fs.readFileSync(p))
      if (got !== entry.fileSha256) {
        throw new Error(`licence-held ${key}: the copy at ${p} hashes to ${got.slice(0, 12)}, `
          + `not the recorded ${entry.fileSha256.slice(0, 12)} — refusing to measure the wrong bytes`)
      }
      found = p
      break
    }
  }
  resolved.set(key, found)
  return found
}

/** A fixture's text. ⛔ Throws for an unregistered missing path (a deleted fixture),
 *  and for a held one that is absent (the caller should have gated on `itNeedsHeld`). */
export function readFixture(rel) {
  const p = fixturePath(rel)
  if (p) return fs.readFileSync(p, 'utf8')
  if (!heldEntry(rel)) throw new Error(`${norm(rel)}: missing, and not a registered licence-held file — a deleted fixture`)
  throw new Error(`${norm(rel)}: ${heldNote([norm(rel)])}`)
}

/** Which of `rels` are registered held files absent from this machine. */
export const absentHeld = (rels) => rels.map(norm).filter((r) => heldEntry(r) && !fixturePath(r))

let ledgerRows = null
function ledger() {
  if (ledgerRows) return ledgerRows
  ledgerRows = []
  try {
    for (const ln of fs.readFileSync(LEDGER_PATH, 'utf8').split(/\r?\n/)) {
      if (!ln.trim()) continue
      try { ledgerRows.push(JSON.parse(ln)) } catch { /* a bad line is not evidence */ }
    }
  } catch { /* no ledger: every verdict reads "no row" */ }
  return ledgerRows
}

/** The evidence-ledger verdict for a held file, in one phrase. */
export function ledgerVerdict(entry) {
  const rows = ledger().filter((r) => r.schema === 'uct.evidence-ledger/v2'
    && ((entry.captureId && r.captureId === entry.captureId) || r.sourceSha256 === entry.sourceSha256))
  if (!rows.length) {
    return entry.kind === 'capture' ? 'evidence ledger: NO ROW FILED YET'
      : 'evidence ledger: no row (not a vendor capture; licence verdict per the record)'
  }
  const r = rows[rows.length - 1]
  const v = r.verdicts || {}
  return `evidence ledger: ${r.captureId} production ${(v.production || {}).verdict || '?'} / `
    + `runtime-on ${(v['runtime-on'] || {}).verdict || '?'} (engine ${r.scriptEngineVersion}, ${String(r.gradedAtUTC).slice(0, 10)})`
}

/** The sentence a skipped rail carries in its title. */
export function heldNote(absent) {
  const parts = absent.slice(0, 3).map((r) => {
    const e = heldEntry(r)
    return `${path.basename(r)} [licence ${e.licenceInSource}; ${ledgerVerdict(e)}]`
  })
  const more = absent.length > 3 ? ` +${absent.length - 3} more` : ''
  return `⏭ SKIPPED, NOT VERIFIED — ${absent.length} licence-held fixture(s) absent on this machine: `
    + `${parts.join(', ')}${more}. Not committed (docs/pine/LICENSING.md §1, §2c; `
    + 'docs/pine/vendor-harness/licence-held.json). Put the file in the capture store '
    + `($${STORE_ENV}) at its recorded hash to run it.`
}

/** `it`, unless a held file it needs is absent — then a skip that says so in its own name. */
export function itNeedsHeld(rels, title, fn, timeout) {
  const absent = absentHeld(rels)
  if (absent.length) return it.skip(`${title} — ${heldNote(absent)}`, fn)
  return it(title, fn, timeout)
}

/** A `.pine` fixture directory some of whose members are licence-held (e.g.
 *  `tools/c0_oos_fixtures`). Names may be given with or without `.pine`.
 *  `population()` is the WHOLE roster: the committed files plus every registered
 *  held one, so a rail over the directory never quietly measures a smaller set. */
export function pineFixtureDir(dir) {
  const d = norm(dir).replace(/\/$/, '')
  const rel = (n) => {
    const f = norm(n).startsWith(`${d}/`) ? norm(n).slice(d.length + 1) : n
    return `${d}/${f.endsWith('.pine') ? f : `${f}.pine`}`
  }
  return {
    rel,
    read: (n) => readFixture(rel(n)),
    it: (names, title, fn, timeout) => itNeedsHeld(names.map(rel), title, fn, timeout),
    held: () => heldIn(d),
    population: () => [...new Set([
      ...fs.readdirSync(path.join(REPO, ...d.split('/'))).filter((f) => f.endsWith('.pine')),
      ...heldIn(d).filter((p) => p.endsWith('.pine')).map((p) => path.basename(p)),
    ])].sort(),
  }
}
