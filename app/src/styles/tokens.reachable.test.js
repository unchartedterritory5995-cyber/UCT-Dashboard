// app/src/styles/tokens.reachable.test.js
//
// Every `var(--x)` in the app's CSS must resolve to a custom property that is
// actually DEFINED somewhere — in a stylesheet, or set from JS at runtime.
//
// WHY THIS EXISTS: nine names (--text-primary, --color-danger, --text-dim,
// --color-text, --text-secondary, --color-warning, --color-success, --bg-base,
// --text-faint) were referenced across ~212 declarations and defined nowhere.
// A `var(--x)` with no fallback and no definition makes the declaration
// INVALID: the browser drops it and the property falls back to inherited or
// initial. `color: var(--color-danger)` therefore did NOT make an error red —
// it inherited its parent's colour. There is no console warning, no test
// failure, and the rule reads as if it works. The only way to see it is to ask
// a running browser for the computed value, which is how it was finally found.
//
// ⛔ THE NAME LIST IS DERIVED, NEVER TYPED. A hand-maintained roster of "known
// bad vars" is the artifact that goes stale (this repo has several). This walks
// the real files every run, so a variable introduced tomorrow is covered today.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// vitest's root is `app/`, so this resolves to app/src regardless of how the
// suite is invoked. (`new URL('..', import.meta.url)` is not reliably a file:
// URL for a DIRECTORY under this transform, unlike the single-file form
// tokens.test.js uses.)
const SRC = join(process.cwd(), 'src')

/** The nine bridge aliases and the canonical tokens they point at. */
const ALIASES = {
  '--text-primary': '--text-bright',
  '--text-secondary': '--text-muted',
  '--text-dim': '--text-muted',
  '--text-faint': '--text-muted',
  '--color-text': '--text',
  '--color-danger': '--loss',
  '--color-warning': '--warn',
  '--color-success': '--gain',
  '--bg-base': '--bg',
}
const TARGETS = [...new Set(Object.values(ALIASES))]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const FILES = walk(SRC)
const CSS = FILES.filter((f) => f.endsWith('.css'))
// ⛔ TEST FILES ARE EXCLUDED FROM THE 'defined' SCAN. This file's own ALIASES
// map matches the object-literal definition pattern, so including tests let
// THIS FILE satisfy the check it performs: deleting every alias from tokens.css
// left the sweep green. Caught by mutation, not by reading. A fixture must
// never be the reason a production variable counts as defined.
const CODE = FILES.filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\.|__tests__/.test(f))

const rel = (f) => f.slice(SRC.length).split('\\').join('/')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every custom property defined anywhere: CSS declarations, object literals
 *  (`{ '--x': v }`), and imperative `setProperty('--x', v)`. Missing any of
 *  those three forms is what made a first pass report 213 phantom names when
 *  the real number was nine — the widget-theming families are all set from JS,
 *  so a CSS-only scan calls every one of them undefined. A sweep that flags
 *  200 names when 9 are defects gets muted, and then the 9 ship. */
function definedNames() {
  const defined = new Set()
  const add = (src, re) => { for (const m of src.matchAll(re)) defined.add(m[1]) }
  for (const f of CSS) add(readFileSync(f, 'utf8'), /(--[a-zA-Z0-9_-]+)\s*:/g)
  for (const f of CODE) {
    const s = readFileSync(f, 'utf8')
    add(s, /['"`](--[a-zA-Z0-9_-]+)['"`]\s*:/g)
    add(s, /setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)/g)
    add(s, /['"`](--[a-zA-Z0-9_-]+)['"`]\s*,/g)
    // ⛔ BRACKET ASSIGNMENT — `vars['--wl-text'] = chrome.text`. This is how
    // the watchlist/widget theming families are actually defined, and the
    // three patterns above all miss it (no `:`, no `,`, no setProperty).
    // Without it this rail FALSELY reports --wl-text and its siblings as
    // undefined the moment anyone drops their fallback. Proven by probe:
    // rewriting one `var(--wl-text, …)` to a bare `var(--wl-text)` made
    // this suite red against a variable that is defined. A guard that
    // cries wolf gets muted, and then the real ones ship.
    add(s, /\[\s*['"`](--[a-zA-Z0-9_-]+)['"`]\s*\]\s*=/g)
  }
  return defined
}

/** `var(--x)` references with NO fallback, by name. A reference WITH a fallback
 *  still renders something (it is merely theme-blind); one without is the
 *  invalid-declaration case above. */
function bareReferences() {
  const bare = new Map()
  for (const f of CSS) {
    const s = stripComments(readFileSync(f, 'utf8'))
    for (const m of s.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
      if (m[2] === ',') continue
      if (!bare.has(m[1])) bare.set(m[1], [])
      bare.get(m[1]).push(rel(f))
    }
  }
  return bare
}

describe('CSS custom properties resolve', () => {
  it('every var(--x) used WITHOUT a fallback is defined somewhere', () => {
    const defined = definedNames()
    const undef = [...bareReferences()]
      .filter(([name]) => !defined.has(name))
      // Report the NAME and where it is used. A bare count would say "3
      // undefined variables" and leave the next person grepping.
      .map(([name, files]) => `${name} (${files.length} refs, e.g. ${files[0]})`)
      .sort()
    expect(undef).toEqual([])
  })

  it('the nine legacy aliases are defined, and point at real tokens', () => {
    const tokens = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8')
    for (const [alias, target] of Object.entries(ALIASES)) {
      expect(tokens, `${alias} must alias ${target}`)
        .toMatch(new RegExp(`${alias}:\\s*var\\(${target}\\)`))
    }
  })

  it('the alias targets are themselves real tokens with a light-theme value', () => {
    // An alias is only theme-aware if what it points AT is redefined for light.
    // Pointing at a token that only exists on dark would look correct in dark
    // mode and be just as broken in light — the exact defect being fixed.
    const tokens = stripComments(readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8'))
    for (const target of TARGETS) {
      const defs = [...tokens.matchAll(new RegExp(`^\\s*${target}:`, 'gm'))]
      expect(defs.length, `${target} needs a dark AND a light definition`).toBeGreaterThanOrEqual(2)
    }
  })

  it('no alias is used in a stylesheet that re-points an alias target', () => {
    // An alias declared on :root is substituted with the ROOT's value and then
    // INHERITED as a finished value — it does NOT re-resolve inside a descendant
    // that re-points its target. ChartsWorkspace re-points --text / --bg /
    // --text-muted / --text-bright for chart widgets in light mode, so
    // `color: var(--color-text)` on .symbolStatic there would have resolved to
    // the page's ink (#1f2328) on the widget's black ground. Before the aliases
    // existed that declaration was invalid and the label inherited the widget's
    // own colour — so introducing them would have BROKEN a surface that looked
    // fine. Measured in a browser: a nested themed container still reported
    // --text-primary #f8f7f3, contrast 1.07 against white.
    const aliasNames = Object.keys(ALIASES)
    const offenders = []
    for (const f of CSS) {
      if (f.endsWith(join('styles', 'tokens.css'))) continue // :root is the sanctioned scope
      const src = stripComments(readFileSync(f, 'utf8'))
      const repoints = TARGETS.some((t) => new RegExp(`(^|[;{\\s])${t}\\s*:`, 'm').test(src))
      if (!repoints) continue
      const used = aliasNames.filter((a) => src.includes(`var(${a})`))
      if (used.length) offenders.push(`${rel(f)} re-points a token AND uses ${used.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
