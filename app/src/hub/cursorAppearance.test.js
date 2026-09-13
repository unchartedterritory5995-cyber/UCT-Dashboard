// The hub cursor has exactly ONE authority over how it looks (D-29).
//
// ⛔ THE DEFECT THIS EXISTS FOR. Phase 1 shipped `[data-hub-cursor="active"]` as a first guess,
// with "no real list rendering it yet — nothing to eyeball it against". Four real lists render it
// now (Screener, Notebook, Catalysts, Calendar) and the tune is the moment a second copy appears:
// the cheapest way to make the cursor read better on a dense Screener row is a second
// `[data-hub-cursor]` rule inside that page's own module, and the cheapest way to make it read
// better everywhere is to nudge `--hub-glass-tint-strong`, which is ALSO the pressed Actions
// button. Both are silent — the cursor still paints, it just disagrees with itself from one
// section to the next, and nobody diffs two stylesheets in different directories.
//
// ⭐ DERIVED, NEVER TYPED. The scan walks every .css under app/src each run, so a rule added
// tomorrow in a directory this file has never heard of is covered the day it lands.
//
// ⚠️ THIS IS A CSS-TEXT RAIL AND SAYS SO. jsdom does not resolve a custom property through an
// external stylesheet, so there is no computed-style assertion available here; what it proves is
// that the cursor's appearance has ONE place to be changed, which is the property D-29 asks for.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const TOKENS_REL = 'styles/tokens.css'

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function cssFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) cssFilesUnder(full, out)
    else if (entry.endsWith('.css')) out.push(full)
  }
  return out
}

/** [selector, body] for every rule. Token blocks and this one never nest. */
const blocks = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])

const CSS_FILES = cssFilesUnder(SRC)

/** Every rule anywhere under app/src whose SELECTOR mentions the cursor attribute. */
const CURSOR_RULES = CSS_FILES.flatMap((file) => blocks(stripComments(readFileSync(file, 'utf8')))
  .filter(([sel]) => sel.includes('data-hub-cursor'))
  .map(([sel, body]) => ({ file: rel(file), sel, body })))

/** Every `--hub-cursor-*` DECLARATION, wherever it lives. */
const CURSOR_TOKEN_DECLS = CSS_FILES.flatMap((file) => blocks(stripComments(readFileSync(file, 'utf8')))
  .flatMap(([sel, body]) => [...body.matchAll(/(--hub-cursor-[\w-]+)\s*:/g)]
    .map((m) => ({ file: rel(file), sel, token: m[1] }))))

describe('CONTROL — the scan actually read this repo', () => {
  // ⛔ An empty derivation satisfies every assertion below by returning nothing to object to.
  // Name expected MEMBERS, not counts: a count passes a scan that read the wrong tree.
  it('found the stylesheets it is walking', () => {
    const names = CSS_FILES.map(rel)
    expect(names).toContain(TOKENS_REL)
    expect(names).toContain('hub/hub.module.css')
  })

  it('found the cursor rule itself, and at least one --hub-cursor-* declaration', () => {
    expect(CURSOR_RULES.map((r) => r.file)).toContain(TOKENS_REL)
    expect(CURSOR_TOKEN_DECLS.map((d) => d.token)).toContain('--hub-cursor-outline')
  })
})

describe('⛔ ONE authority for the hub cursor\'s appearance (D-29)', () => {
  it('exactly ONE rule in the whole app selects [data-hub-cursor], and it is in tokens.css', () => {
    const where = CURSOR_RULES.map((r) => `${r.file} (${r.sel})`)
    expect(
      where,
      'a second [data-hub-cursor] rule appeared. Two rules means two answers to "what does the '
      + 'cursor look like" that only disagree on the surfaces one of them reaches. Change the '
      + '--hub-cursor-* tokens in tokens.css instead.',
    ).toEqual([`${TOKENS_REL} ([data-hub-cursor="active"])`])
  })

  it('that rule declares NO value of its own — every property reads a --hub-cursor-* token', () => {
    const body = CURSOR_RULES[0].body
    const decls = body.split(';').map((s) => s.trim()).filter(Boolean)
    expect(decls.length, 'the cursor rule is empty — it paints nothing').toBeGreaterThan(3)
    const literal = decls.filter((d) => !/:\s*(?:[\w-]+\s+solid\s+)?var\(--hub-cursor-[\w-]+\)\s*$/.test(d)
      && !/:\s*var\(--hub-cursor-[\w-]+\)\s+solid\s+var\(--hub-cursor-[\w-]+\)\s*$/.test(d))
    expect(
      literal,
      'a literal crept into the cursor rule. A value here is a SECOND dial beside the tokens: '
      + 'the high-contrast block can move a token and cannot move a literal, which is exactly how '
      + 'the cursor missed [data-hub-contrast="high"] for a whole phase.',
    ).toEqual([])
  })

  it('every --hub-cursor-* token the rule uses is defined, in tokens.css, once at :root', () => {
    const used = [...new Set([...CURSOR_RULES[0].body.matchAll(/var\((--hub-cursor-[\w-]+)\)/g)]
      .map((m) => m[1]))]
    expect(used.length, 'the rule references no cursor token').toBeGreaterThan(3)
    for (const token of used) {
      const roots = CURSOR_TOKEN_DECLS.filter((d) => d.token === token && d.sel === ':root')
      expect(roots.map((d) => d.file), `${token} must have exactly one :root definition`)
        .toEqual([TOKENS_REL])
    }
  })

  it('no file OUTSIDE tokens.css declares a --hub-cursor-* token', () => {
    const strays = CURSOR_TOKEN_DECLS.filter((d) => d.file !== TOKENS_REL)
      .map((d) => `${d.file} (${d.sel}) declares ${d.token}`)
    expect(
      strays,
      'a cursor token was redefined outside tokens.css. A theme island may pin a THEMED token; '
      + 'these are deliberately not themed — they compose from --text-heading, which every theme '
      + 'already redefines — so a copy elsewhere is a second authority, not a pin.',
    ).toEqual([])
  })

  it('high contrast moves the CURSOR, not only the chrome beside it', () => {
    // ⚰️ The regression this pins: the high-contrast block redefined --hub-rim while the cursor's
    // outline read --hub-rim-highlight, so the one surface that tells a low-vision member which
    // row they are on was the one surface high contrast never touched.
    const hc = CURSOR_TOKEN_DECLS.filter((d) => d.sel.includes('data-hub-contrast'))
    expect(hc.map((d) => d.token).sort()).toContain('--hub-cursor-outline')
    expect(hc.map((d) => d.token).sort()).toContain('--hub-cursor-fill')
  })
})
