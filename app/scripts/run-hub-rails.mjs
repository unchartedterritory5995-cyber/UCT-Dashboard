/**
 * Run the hub rail subset — `npm run test:hub` from `app/`.
 *
 * ⛔ A NODE RUNNER, NOT A SHELL ONE-LINER. The first attempt was
 * `node -e … > .hubglob.tmp && vitest run $(cat .hubglob.tmp)`, which needs POSIX command
 * substitution and a temp file: it fails outright in cmd.exe, and this is a Windows box.
 *
 * ⚰️⚰️ AND THE SECOND ATTEMPT PASSED THE GLOBS STRAIGHT TO VITEST, WHICH SILENTLY RAN FIVE FILES.
 * Vitest's positional arguments are FILENAME FILTERS (substring/regex), not globs — so
 * `src/hub/**\/*.test.{js,jsx}` matched nothing at all, the run reported "4 passed" and exited 0.
 * A subset runner that quietly runs a twentieth of the subset is the exact failure the subset was
 * created to prevent: a green line standing in for coverage that never happened. This expands the
 * globs itself and passes CONCRETE FILE PATHS.
 *
 * ⛔ THE FLOOR IS THE GUARD. If expansion yields implausibly few files the run is refused rather
 * than reported — an empty or near-empty subset exits 0 and reads as a pass.
 *
 * ⛔ AND PASSING THE SUBSET IS NOT PASSING THE BRANCH. `scripts/gate_shards.py` is the only thing
 * that can say the second — see `vitest.hubGlob.js` for the incident behind that sentence.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HUB_RAIL_GLOBS } from '../vitest.hubGlob.js'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIN_FILES = 60 // the subset was 84 files on 2026-09-13; far below that means expansion broke

function allTestFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      allTestFiles(path.join(dir, e.name), out)
    } else if (/\.test\.(js|jsx)$/.test(e.name)) {
      out.push(path.relative(APP, path.join(dir, e.name)).replace(/\\/g, '/'))
    }
  }
  return out
}

/** Same matcher shape as `src/hub/hubGlobCoverage.test.js`, which rails this list. */
function matches(glob, file) {
  const body = glob
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '@@DIRSTAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DIRSTAR@@/g, '(?:.*/)?')
    .replace(/\{([^}]+)\}/g, (_m, alts) => `(?:${alts.split(',').join('|')})`)
  return new RegExp(`^${body}$`).test(file)
}

if (!Array.isArray(HUB_RAIL_GLOBS) || HUB_RAIL_GLOBS.length === 0) {
  console.error('⛔ vitest.hubGlob.js exported no globs — refusing to run an empty subset.')
  process.exit(2)
}

const every = allTestFiles(path.join(APP, 'src'))
const files = every.filter((f) => HUB_RAIL_GLOBS.some((g) => matches(g, f)))

console.log(`hub rail subset — ${HUB_RAIL_GLOBS.length} patterns -> ${files.length} files`)

const dead = HUB_RAIL_GLOBS.filter((g) => !every.some((f) => matches(g, f)))
if (dead.length) {
  console.error(`⛔ these patterns match NO file, so the subset is smaller than it reads:\n  ${dead.join('\n  ')}`)
  process.exit(2)
}
if (files.length < MIN_FILES) {
  console.error(`⛔ expansion produced ${files.length} files, below the floor of ${MIN_FILES}. `
    + 'Refusing to run: a near-empty subset exits 0 and reads as a pass.')
  process.exit(2)
}

const r = spawnSync('npx', ['vitest', 'run', ...files, ...process.argv.slice(2)],
  { stdio: 'inherit', shell: true })
process.exit(r.status ?? 1)
