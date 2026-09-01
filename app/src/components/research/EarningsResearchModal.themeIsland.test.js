// app/src/components/research/EarningsResearchModal.themeIsland.test.js
//
// The modal's shell is pinned to `--menu-*`, which is theme-INVARIANT by
// design. Its CONTENT is not: IdentityBanner, all eleven panels, every
// research-kit component and every foreign widget they compose read `--text`,
// `--glass-*`, `--gain`/`--loss`… straight off `:root`, and the light theme
// flips those to near-black. Measured in a browser at `data-theme="light"`
// before the island existed: 20 of 20 sampled text nodes at contrast **1.00**
// — rgb(11,14,17) ink on the rgb(14,14,16) panel. Invisible.
//
// ⛔ THE LIST IS DERIVED, NEVER TYPED. A hand-maintained roster of "tokens the
// island must pin" is precisely the artifact this repo keeps watching go stale
// (the writer index's FOUR, the COT router's "4 routes", the setup catalog's
// "24"). This re-reads tokens.css every run: add a token to any [data-theme=…]
// block tomorrow and this names it today.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const ISLAND = join(process.cwd(), 'src', 'components', 'research', 'EarningsResearchModal.module.css')

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** [selector, body] for every top-level rule in a stylesheet.
 *
 *  ⛔ The selector is the WHOLE span since the previous rule closed, collapsed
 *  to one line — never `.split('\n').pop()`. A multi-line selector list is the
 *  norm in this repo, and taking only its last line made this very file's
 *  `.modal,\n.sheet` island read as `.sheet`, match a DIFFERENT rule, and
 *  report all 47 tokens missing. The parser was wrong, not the stylesheet. */
function blocks(css) {
  const out = []
  let i = 0
  for (;;) {
    const brace = css.indexOf('{', i)
    if (brace < 0) break
    const sel = css.slice(i, brace).replace(/\s+/g, ' ').trim()
    let depth = 1
    let j = brace + 1
    while (j < css.length && depth) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    out.push([sel, css.slice(brace + 1, j - 1)])
    i = j
  }
  return out
}

function decls(body) {
  const d = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) d[m[1]] = m[2].trim()
  return d
}

// `rgba(0,0,0,.5)` and `rgba(0, 0, 0, 0.5)` are the same colour; compare the
// token's MEANING, not its whitespace, or this rail fails on a reformat.
const norm = (v) => v.replace(/\s+/g, '').toLowerCase()

const tokensCss = stripComments(readFileSync(TOKENS, 'utf8'))
const islandCss = stripComments(readFileSync(ISLAND, 'utf8'))

const rootDefaults = {}
const themed = new Set()
for (const [sel, body] of blocks(tokensCss)) {
  if (sel === ':root') Object.assign(rootDefaults, decls(body))
  else if (sel.includes('data-theme')) for (const k of Object.keys(decls(body))) themed.add(k)
}

// The island block itself — the rule whose selector list carries `.modal`.
const islandBlock = blocks(islandCss).find(([sel]) => /(^|,)\s*\.modal\s*(,|$)/.test(sel))
const island = islandBlock ? decls(islandBlock[1]) : {}

describe('the modal is a self-contained theme island', () => {
  it('has a block that covers BOTH the desktop dialog and the phone sheet', () => {
    // `.sheet` is Sheet's panel root (Sheet.jsx: "className applied to the
    // panel"), so pinning it covers the phone path too. Losing either half
    // leaves that surface reading root tokens again.
    expect(islandBlock, 'no rule in the modal stylesheet selects .modal').toBeTruthy()
    expect(islandBlock[0]).toMatch(/\.modal/)
    expect(islandBlock[0]).toMatch(/\.sheet/)
  })

  it('pins EVERY theme-variant token that has a :root default', () => {
    const required = [...themed].filter((t) => t in rootDefaults).sort()
    // A control: if this set ever empties, the derivation broke and every
    // assertion below would pass VACUOUSLY.
    expect(required.length).toBeGreaterThan(20)
    const missing = required.filter((t) => !(t in island))
    expect(missing, `theme-variant tokens the island does not pin: ${missing.join(', ')}`).toEqual([])
  })

  it('pins them to the value :root actually gives them — no drift', () => {
    const required = [...themed].filter((t) => t in rootDefaults && t in island)
    const drifted = required
      .filter((t) => norm(island[t]) !== norm(rootDefaults[t]))
      .map((t) => `${t}: island ${island[t]} vs :root ${rootDefaults[t]}`)
    expect(drifted, `island values that no longer match :root:\n${drifted.join('\n')}`).toEqual([])
  })

  it('re-declares every bridge alias whose TARGET it re-points', () => {
    // tokens.css: "AN ALIAS DOES NOT FOLLOW A *NESTED* SCOPE." A descendant
    // reading var(--text-primary) gets the ROOT's resolved value — the light
    // theme's near-black — unless the alias is re-declared here too.
    const aliasDefs = {}
    for (const [sel, body] of blocks(tokensCss)) {
      if (sel !== ':root') continue
      for (const m of body.matchAll(/(--[\w-]+)\s*:\s*var\((--[\w-]+)\)\s*;/g)) aliasDefs[m[1]] = m[2]
    }
    const mustReDeclare = Object.entries(aliasDefs)
      .filter(([, target]) => target in island)
      .map(([alias]) => alias)
      .sort()
    expect(mustReDeclare.length).toBeGreaterThan(5)
    const missing = mustReDeclare.filter((a) => !(a in island))
    expect(missing, `aliases pointing at a re-pinned token but not re-declared: ${missing.join(', ')}`)
      .toEqual([])
  })

  it('does not USE a bridge alias — the rail in tokens.reachable.test.js', () => {
    // That suite fails any stylesheet that re-points an alias target AND reads
    // an alias. Asserted here too so the reason is visible at the island.
    const used = ['--text-primary', '--text-secondary', '--text-dim', '--text-faint',
      '--color-text', '--color-danger', '--color-warning', '--color-success', '--bg-base']
      .filter((a) => islandCss.includes(`var(${a})`) && !islandCss.includes(`${a}: var(`))
    expect(used).toEqual([])
  })
})
