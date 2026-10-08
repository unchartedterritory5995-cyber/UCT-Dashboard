// Theme islands must not go stale when someone adds a themed token.
//
// ⛔ THE DEFECT THIS EXISTS FOR — and it shipped. PR #100 added `--hub-glass-tint`,
// `--hub-glass-tint-strong` and `--hub-rim` to tokens.css with `[data-theme]` variants, and did
// not pin them in the research modal's theme island. A descendant of that modal therefore
// resolved the hub's glass tokens against the PAGE theme instead of the dark chrome the modal is
// actually drawn on. Nobody noticed, because the feature that added the tokens and the surface
// that broke are in different directories and neither team had reason to look at the other.
//
// An island is a block that re-declares the theme-variant tokens at their `:root` values, so
// everything inside it renders as one consistent surface whatever theme the page is wearing.
// That only works if the island's list is COMPLETE. It is a hand-maintained list guarding
// against a set that grows — the exact shape that rots.
//
// ⭐ DERIVED, NEVER TYPED. The required set is computed from tokens.css every run, so a token
// added tomorrow is required the day it lands. The island set is discovered from the stylesheets
// themselves. There is no list in this file to keep up to date, which is the whole point — a
// rail that needs hand-maintenance has the same disease as the thing it guards.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const TOKENS = path.join(SRC, 'styles/tokens.css')

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** [selector, body] for every rule. Good enough for token blocks, which never nest. */
function blocks(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
}

const declaredTokens = (body) => new Set(
  [...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
)

/**
 * The tokens an island MUST pin: every custom property that some `[data-theme=…]` block
 * overrides AND that `:root` gives a default. A token that exists only inside theme blocks has
 * no default to pin, so an island that omits it still matches the default theme.
 */
function requiredTokens(tokensCss) {
  const rootDefaults = new Set()
  const themed = new Set()
  for (const [sel, body] of blocks(stripComments(tokensCss))) {
    if (sel === ':root') for (const k of declaredTokens(body)) rootDefaults.add(k)
    else if (sel.includes('data-theme')) for (const k of declaredTokens(body)) themed.add(k)
  }
  return new Set([...themed].filter((t) => rootDefaults.has(t)))
}

function cssFilesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...cssFilesUnder(full))
    else if (entry.endsWith('.css')) out.push(full)
  }
  return out
}

/**
 * Every block that declares itself an island, via `--theme-island: <name>;`.
 *
 * ⭐ SELF-DECLARING, rather than guessed from a coverage threshold. Two blocks in this repo look
 * like islands to a naive scan and are NOT, which is why the marker exists rather than a
 * heuristic (`lesson_a_guard_that_tests_the_adjacent_thing`):
 *   • `floor2/standalone.css .floorx.standalone` pins 27/50 — but its own header says it exists
 *     because floor2.html "doesn't load the real tokens.css". It SUBSTITUTES for tokens, it does
 *     not pin against them, so it legitimately carries only what floor2 uses.
 *   • `ChartsWorkspace.module.css` pins 38/50 under `:global([data-theme='light']) …` — a
 *     theme-SPECIFIC re-assertion. Requiring it to carry the default-theme values would invert
 *     what it is for.
 * Both are excluded by construction: neither claims the marker, and the second is additionally
 * scoped by `data-theme`.
 */
function islandsInCss(file, css) {
  const found = []
  for (const [sel, body] of blocks(stripComments(css))) {
    const declared = declaredTokens(body)
    if (!declared.has('--theme-island')) continue
    found.push({ file: path.relative(SRC, file).split(path.sep).join('/'), sel, declared, body })
  }
  return found
}

function islands(files) {
  return files.flatMap((file) => islandsInCss(file, readFileSync(file, 'utf8')))
}

const missingFrom = (island, required) => [...required].filter((t) => !island.declared.has(t)).sort()
const norm = (v) => v.replace(/\s+/g, '').toLowerCase()

/** `${file} (${sel}) is missing: …` for every island that does not pin the whole required set. */
function pinningOffenders(found, required) {
  return found
    .map((i) => ({ i, missing: missingFrom(i, required) }))
    .filter(({ missing }) => missing.length)
    .map(({ i, missing }) => `${i.file} (${i.sel}) is missing: ${missing.join(', ')}`)
}

/** Island declarations of a required token whose value is not the one :root gives it. */
function driftOffenders(found, required, rootValues) {
  const drifted = []
  for (const island of found) {
    for (const [, name, raw] of island.body.matchAll(/(--[\w-]+)\s*:([^;]+);/g)) {
      if (!required.has(name) || !(name in rootValues)) continue
      if (norm(raw) !== norm(rootValues[name])) {
        drifted.push(`${island.file} (${island.sel}) ${name}: island ${norm(raw)} vs :root ${norm(rootValues[name])}`)
      }
    }
  }
  return drifted
}

const TOKENS_CSS = readFileSync(TOKENS, 'utf8')
const REQUIRED = requiredTokens(TOKENS_CSS)
const ROOT_VALUES = Object.fromEntries(
  [...blocks(stripComments(TOKENS_CSS)).find(([sel]) => sel === ':root')[1].matchAll(/(--[\w-]+)\s*:([^;]+);/g)]
    .map((m) => [m[1], m[2].trim()]),
)
const CSS_FILES = cssFilesUnder(SRC)
const FOUND = islands(CSS_FILES)

/**
 * A COMPLETE island, built from tokens.css every run. There are no real islands today (the
 * earnings research modal was the last, and now follows the theme — owner ruling 2026-10-07),
 * so every check below over FOUND passes over an empty set. The fixture is what keeps those
 * checks honest: each one is also run against an island that exists, and must be able to fail.
 */
const FIXTURE_FILE = path.join(SRC, 'styles', '__island_fixture__.css')
const fixtureCss = (overrides = {}, omit = []) => `.fixture {\n  --theme-island: fixture;\n${
  [...REQUIRED].filter((t) => !omit.includes(t))
    .map((t) => `  ${t}: ${overrides[t] ?? ROOT_VALUES[t]};`).join('\n')}\n}\n`
const FIXTURE = islandsInCss(FIXTURE_FILE, fixtureCss())

describe('theme islands stay complete as tokens.css grows', () => {
  it('CONTROL: the required set is real, so nothing below can pass vacuously', () => {
    // If the tokens.css parse ever breaks, `required` empties and every coverage assertion
    // becomes trivially true. This is the assertion that notices.
    expect(REQUIRED.size, 'derived no themed tokens from tokens.css — the parse broke').toBeGreaterThan(20)
  })

  it('CONTROL: the discovery scan is live — a declared island is found, so "zero islands" means zero', () => {
    // "Found nothing" is today's expected answer — and it is also exactly what a broken walk or a
    // renamed marker would answer. The same discovery code, fed a stylesheet that DOES declare the
    // marker, must find it; and the real walk must have read the repo's stylesheets.
    expect(FIXTURE.map((i) => i.sel), 'the discovery scan cannot see a declared island').toEqual(['.fixture'])
    expect(CSS_FILES.length, 'the stylesheet walk found almost nothing — it broke').toBeGreaterThan(100)
  })

  it('there is no theme island today: the research modal follows the member\'s theme', () => {
    // Owner ruling 2026-10-07. A new island is allowed — it must then pass every check below — but
    // the modal must never become one again (EarningsResearchModal.followsTheme.test.js).
    expect(FOUND.map((i) => i.file)).not.toContain('components/research/EarningsResearchModal.module.css')
  })

  it('⛔ every island pins EVERY theme-variant token that has a :root default', () => {
    expect(
      pinningOffenders(FOUND, REQUIRED),
      'a themed token was added to tokens.css and these islands were not updated. Add each '
      + 'token to the island at the value :root gives it — do NOT delete the marker.',
    ).toEqual([])
  })

  it('CONTROL: the pinning check passes a complete island and names a missing token', () => {
    expect(pinningOffenders(FIXTURE, REQUIRED)).toEqual([])
    const dropped = '--text'
    expect(REQUIRED.has(dropped)).toBe(true)
    const partial = islandsInCss(FIXTURE_FILE, fixtureCss({}, [dropped]))
    expect(pinningOffenders(partial, REQUIRED).join('\n')).toMatch(/is missing: --text$/)
  })

  it('⛔ MUTATION PROOF: a newly themed token is reported missing from every island', () => {
    // Adding a throwaway token with a :root default and a theme variant must make every island
    // incomplete — the real ones and the fixture. If this passes silently, the rail cannot see
    // new tokens at all, which is precisely the state the repo was in when #100 shipped.
    const mutated = `${TOKENS_CSS}\n:root { --zz-throwaway-island-probe: #000; }\n`
      + `[data-theme="light"] { --zz-throwaway-island-probe: #fff; }\n`
    const mutatedRequired = requiredTokens(mutated)

    expect(mutatedRequired.has('--zz-throwaway-island-probe'), 'the probe token was not derived as required').toBe(true)
    for (const island of [...FOUND, ...FIXTURE]) {
      expect(
        missingFrom(island, mutatedRequired),
        `${island.file} did not report the probe token as missing`,
      ).toContain('--zz-throwaway-island-probe')
    }
  })

  it('an island pins each token to the value :root actually gives it — no drift', () => {
    // Completeness is not enough: an island holding a stale VALUE renders the wrong colour while
    // passing every coverage check above.
    const drifted = driftOffenders(FOUND, REQUIRED, ROOT_VALUES)
    expect(drifted, `island values that no longer match :root:\n${drifted.join('\n')}`).toEqual([])
  })

  it('CONTROL: the drift check passes a faithful island and names a stale value', () => {
    expect(driftOffenders(FIXTURE, REQUIRED, ROOT_VALUES)).toEqual([])
    const stale = islandsInCss(FIXTURE_FILE, fixtureCss({ '--text': '#123456' }))
    expect(driftOffenders(stale, REQUIRED, ROOT_VALUES).join('\n')).toMatch(/--text: island #123456 vs :root/)
  })
})
