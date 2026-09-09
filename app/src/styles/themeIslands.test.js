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
function islands(files) {
  const found = []
  for (const file of files) {
    for (const [sel, body] of blocks(stripComments(readFileSync(file, 'utf8')))) {
      const declared = declaredTokens(body)
      if (!declared.has('--theme-island')) continue
      found.push({ file: path.relative(SRC, file).replace(/\\/g, '/'), sel, declared })
    }
  }
  return found
}

const missingFrom = (island, required) => [...required].filter((t) => !island.declared.has(t)).sort()

const TOKENS_CSS = readFileSync(TOKENS, 'utf8')
const REQUIRED = requiredTokens(TOKENS_CSS)
const FOUND = islands(cssFilesUnder(SRC))

describe('theme islands stay complete as tokens.css grows', () => {
  it('CONTROL: the required set is real, so nothing below can pass vacuously', () => {
    // If the tokens.css parse ever breaks, `required` empties and every coverage assertion
    // becomes trivially true. This is the assertion that notices.
    expect(REQUIRED.size, 'derived no themed tokens from tokens.css — the parse broke').toBeGreaterThan(20)
  })

  it('CONTROL: at least one island was discovered, so the scan is not silently empty', () => {
    // Same failure in the other direction: a marker rename or a broken walk finds zero islands
    // and this file reports success while checking nothing.
    expect(FOUND.length, 'no block declares `--theme-island` — the discovery scan found nothing').toBeGreaterThan(0)
  })

  it('⛔ every island pins EVERY theme-variant token that has a :root default', () => {
    const offenders = FOUND
      .map((i) => ({ i, missing: missingFrom(i, REQUIRED) }))
      .filter(({ missing }) => missing.length)
      .map(({ i, missing }) => `${i.file} (${i.sel}) is missing: ${missing.join(', ')}`)
    expect(
      offenders,
      'a themed token was added to tokens.css and these islands were not updated. Add each '
      + 'token to the island at the value :root gives it — do NOT delete the marker.',
    ).toEqual([])
  })

  it('⛔ MUTATION PROOF: a newly themed token is reported missing from a real island', () => {
    // Adding a throwaway token with a :root default and a theme variant must make every existing
    // island incomplete. If this passes silently, the rail cannot see new tokens at all — which
    // is precisely the state the repo was in when #100 shipped.
    const mutated = `${TOKENS_CSS}\n:root { --zz-throwaway-island-probe: #000; }\n`
      + `[data-theme="light"] { --zz-throwaway-island-probe: #fff; }\n`
    const mutatedRequired = requiredTokens(mutated)

    expect(mutatedRequired.has('--zz-throwaway-island-probe'), 'the probe token was not derived as required').toBe(true)
    for (const island of FOUND) {
      expect(
        missingFrom(island, mutatedRequired),
        `${island.file} did not report the probe token as missing`,
      ).toContain('--zz-throwaway-island-probe')
    }
  })

  it('an island pins each token to the value :root actually gives it — no drift', () => {
    // Completeness is not enough: an island holding a stale VALUE renders the wrong colour while
    // passing every coverage check above.
    const rootBlock = blocks(stripComments(TOKENS_CSS)).find(([sel]) => sel === ':root')
    const rootValues = Object.fromEntries(
      [...rootBlock[1].matchAll(/(--[\w-]+)\s*:([^;]+);/g)].map((m) => [m[1], m[2].replace(/\s+/g, '').toLowerCase()]),
    )
    const drifted = []
    for (const file of new Set(FOUND.map((i) => i.file))) {
      const css = stripComments(readFileSync(path.join(SRC, file), 'utf8'))
      for (const [sel, body] of blocks(css)) {
        if (!declaredTokens(body).has('--theme-island')) continue
        for (const m of body.matchAll(/(--[\w-]+)\s*:([^;]+);/g)) {
          const [, name, raw] = m
          if (!REQUIRED.has(name)) continue
          const value = raw.replace(/\s+/g, '').toLowerCase()
          if (rootValues[name] && value !== rootValues[name]) {
            drifted.push(`${file} (${sel}) ${name}: island ${value} vs :root ${rootValues[name]}`)
          }
        }
      }
    }
    expect(drifted, `island values that no longer match :root:\n${drifted.join('\n')}`).toEqual([])
  })
})
