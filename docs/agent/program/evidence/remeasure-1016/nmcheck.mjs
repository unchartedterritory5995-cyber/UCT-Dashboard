// Install check: every package app/package-lock.json pins is installed at that version under app/node_modules.
//   node nmcheck.mjs <app dir> [node_modules dir, default <app dir>/node_modules]
// Prints one summary line (and every mismatch). Exit 1 if a non-optional package is missing or at another version.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const app = process.argv[2], nm = process.argv[3] || join(app, "node_modules")
const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'))
let ok = 0, optMissing = 0; const bad = []
for (const [p, e] of Object.entries(lock.packages || {})) {
  if (!p.startsWith('node_modules/') || e.link) continue
  const pj = join(nm, p.slice("node_modules/".length), "package.json")
  if (!existsSync(pj)) { if (e.optional || e.devOptional && e.optional) optMissing++; else bad.push(`MISSING ${p}@${e.version}`); continue }
  const v = JSON.parse(readFileSync(pj, 'utf8')).version
  if (v === e.version) ok++; else bad.push(`VERSION ${p} lock=${e.version} installed=${v}`)
}
for (const b of bad) console.log(b)
console.log(`nmcheck: lockfileVersion=${lock.lockfileVersion} match=${ok} optionalAbsent=${optMissing} mismatched=${bad.length}`)
process.exit(bad.length ? 1 : 0)
