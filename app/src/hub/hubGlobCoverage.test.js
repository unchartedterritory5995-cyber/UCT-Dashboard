/**
 * ⛔⛔ A TEST THAT ASSERTS EXPOSURE MUST BE IN THE HUB SUBSET.
 *
 * ⚰️ THE INCIDENT THIS IS FOR, 2026-09-13. The stage-2 branch ran "the hub rails" — `src/hub`, 84
 * files, 1118 tests, all green — and that result was reported as though it settled the branch. The
 * six-shard gate then found **nine** failures in `src/pages/settings/`: tests asserting the
 * STAGE-1 exposure rule, which stage 2 deliberately reverses. They were never going to be caught,
 * because the subset could not see them. ⭐ The scoped run was not wrong; it was NARROW, and
 * narrowness is invisible from inside the subset.
 *
 * ⛔ SO THE LIST IS DERIVED, NOT TYPED. Any test file that imports the rollout/exposure authority
 * (`hub/rolloutStage`) is, by construction, a test about who can see the hub — and must be in
 * `vitest.hubGlob.js`. A future file gets covered the day it lands, not the day someone remembers.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { HUB_RAIL_GLOBS } from '../../vitest.hubGlob.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const APP = path.resolve(SRC, '..')

/** Every test file under app/src, as posix-relative paths from `app/`. */
function allTestFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      allTestFiles(full, out)
    } else if (/\.test\.(js|jsx)$/.test(entry.name)) {
      out.push(path.relative(APP, full).replace(/\\/g, '/'))
    }
  }
  return out
}

/**
 * Minimal glob match for the two shapes this list uses: `**` segments and exact paths.
 *
 * ⚰️ THE FIRST VERSION ESCAPED `{` AND `}` BEFORE EXPANDING `{js,jsx}`, so the alternation never
 * expanded and `src/hub/**\/*.test.{js,jsx}` matched NOTHING. Caught by this file's own "a typo
 * matches nothing" case on its first run — which is the whole argument for having that case.
 * Braces are therefore left unescaped and expanded last.
 */
function matches(glob, file) {
  const body = glob
    .replace(/[.+^$()|[\]\\]/g, '\\$&')          // regex specials, EXCEPT * { } ,
    .replace(/\*\*\//g, '@@DIRSTAR@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@DIRSTAR@@/g, '(?:.*/)?')
    .replace(/\{([^}]+)\}/g, (_m, alts) => `(?:${alts.split(',').join('|')})`)
  return new RegExp(`^${body}$`).test(file)
}

const inSubset = (file) => HUB_RAIL_GLOBS.some((g) => matches(g, file))

/**
 * Does this test file depend on the rollout/exposure authority?
 *
 * ⛔ CODE, NEVER PROSE. Several files discuss `rolloutStage` in comments; an IMPORT is the only
 * thing that makes a file's verdict depend on it, so this matches the import statement's shape.
 * ⚰️ And it must accept BOTH spellings: files inside `src/hub` import `'./rolloutStage'`, files
 * outside import `'../../hub/rolloutStage'`. The first version demanded the `hub/` prefix and so
 * found only the outsiders — under-counting by three and tripping its own non-vacuity floor.
 */
const dependsOnRollout = (file) => {
  const src = readFileSync(path.join(APP, file), 'utf8')
  return /^\s*import\s[^\n]*from\s+['"][^'"]*\brolloutStage(?:\.js)?['"]/m.test(src)
}

describe('⛔ the hub rail subset can see every test that asserts exposure', () => {
  const files = allTestFiles()

  it('the sweep found test files at all — the non-vacuity control', () => {
    expect(files.length, 'no test files were found under app/src, so every assertion below passes '
      + 'over an empty set').toBeGreaterThan(200)
    expect(files, 'the sweep cannot see this very file, so its paths are wrong')
      .toContain('src/hub/hubGlobCoverage.test.js')
  })

  it('every glob in the list matches at least one real file — a typo matches nothing', () => {
    for (const g of HUB_RAIL_GLOBS) {
      expect(files.some((f) => matches(g, f)),
        `vitest.hubGlob.js lists "${g}", which matches NO test file under app/src. Either it is a `
        + 'typo or the file moved; either way the subset silently stopped covering it.').toBe(true)
    }
  })

  it('⛔ every test that imports hub/rolloutStage is IN the subset', () => {
    const exposure = files.filter(dependsOnRollout)
    // The derivation must actually find things, or the assertion below is empty.
    expect(exposure.length, 'no test file imports hub/rolloutStage — the derivation is broken and '
      + 'this rail is asserting nothing').toBeGreaterThan(2)

    const missing = exposure.filter((f) => !inSubset(f))
    expect(missing, 'these tests decide WHO CAN SEE THE HUB and are not in the hub rail subset, so '
      + 'a stage change can pass the subset while failing the full gate — which is exactly what '
      + 'happened on 2026-09-13:\n  ' + missing.join('\n  ')).toEqual([])
  })

  it('⛔ the matcher DISCRIMINATES — it does not simply say yes', () => {
    // Without this, a `matches()` that always returned true would satisfy every case above.
    expect(matches('src/hub/**/*.test.{js,jsx}', 'src/hub/registry.test.js')).toBe(true)
    expect(matches('src/hub/**/*.test.{js,jsx}', 'src/hub/sections/homeSection.test.jsx')).toBe(true)
    expect(matches('src/hub/**/*.test.{js,jsx}', 'src/pages/Dashboard.test.jsx')).toBe(false)
    expect(inSubset('src/pages/settings/JoystickSettingsCard.test.jsx')).toBe(true)
    expect(inSubset('src/pages/MorningWire.test.jsx'), 'an unrelated page test counted as a hub '
      + 'rail — the subset would swallow the whole suite').toBe(false)
  })

  it('the subset file itself is present and non-empty', () => {
    expect(existsSync(path.join(APP, 'vitest.hubGlob.js'))).toBe(true)
    expect(statSync(path.join(APP, 'vitest.hubGlob.js')).size).toBeGreaterThan(100)
    expect(HUB_RAIL_GLOBS.length).toBeGreaterThan(3)
  })
})
