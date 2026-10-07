// UCT Terminal — every token the terminal paints with is defined in EVERY theme.
//
// The theme rail (themeColours.rail.test.js) makes terminal code ask the theme for its colours.
// That is only half a guarantee: a `var(--x)` the active theme cannot resolve paints NOTHING
// (CSS falls back to the inherited / initial value — black text, a transparent fill) and a
// canvas handed an unresolvable token drops the colour or paints black. So this file checks the
// other half, programmatically, across the whole theme set:
//
//   the base themes  — dark (:root), oled, light (styles/tokens.css)
//   the catalog      — every entry of APP_THEMES (styles/appThemes.js), applied the way
//                      Layout.jsx applies it: its family's base data-theme + its inline tokens.
//
// For each theme, every app token a terminal-mounted file references (a CSS `var(--…)`, or a
// lib/theme canvas spec `['--…', fallback]`) must resolve through its var() chain to a value,
// and a canvas-resolved token must resolve to something a canvas can paint (a colour) or size.
// The token set is DERIVED from the scope, never typed: a token a panel starts using tomorrow
// is checked the day it lands.
import { describe, it, expect } from 'vitest'
import { APP_THEMES } from '../../styles/appThemes'
import {
  terminalScope, readSrc, stripComments, cssBlocks, declsOf, tokenNames,
} from './__tests__/themeScope'
import fs from 'node:fs'
import path from 'node:path'
import { SRC } from './__tests__/themeScope'

const TOKENS_CSS = stripComments(readSrc('styles/tokens.css'), true)
const BLOCKS = cssBlocks(TOKENS_CSS)
const pick = (sel) => Object.assign({}, ...BLOCKS.filter(([s]) => s === sel).map(([, b]) => declsOf(b)))

/** name → { token: value } for every theme the member can choose. */
function themeMaps(root = pick(':root')) {
  const oled = { ...root, ...pick('[data-theme="oled"]') }
  const light = { ...root, ...pick('[data-theme="light"]') }
  const out = { dark: root, oled, light }
  for (const t of APP_THEMES) out[`uct:${t.id}`] = { ...(t.family === 'light' ? light : oled), ...t.tokens }
  return out
}

/** The app tokens terminal-mounted code references: `{ css: Set, canvas: Map(token → 'colour'|'size'),
 *  guarded: Set }` — `guarded` holds tokens EVERY css reference of which carries its own fallback
 *  (`var(--tick-up-bg, …)`), so a theme that leaves them unset still paints the fallback. */
function tokensUsed(files = terminalScope()) {
  const names = tokenNames()
  const css = new Set()
  const bare = new Set()
  const canvas = new Map()
  for (const f of files) {
    const t = stripComments(readSrc(f), f.endsWith('.css'))
    for (const m of t.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!names.has(m[1])) continue
      css.add(m[1])
      if (!m[2]) bare.add(m[1])
    }
    if (f.endsWith('.css')) continue
    for (const m of t.matchAll(/\[\s*['"](--[\w-]+)['"]\s*,/g)) if (names.has(m[1])) canvas.set(m[1], 'colour')
    for (const m of t.matchAll(/token:\s*['"](--[\w-]+)['"]/g)) if (names.has(m[1])) canvas.set(m[1], 'colour')
    for (const m of t.matchAll(/resolveThemeColor\(\s*['"](--[\w-]+)['"]/g)) if (names.has(m[1])) canvas.set(m[1], 'colour')
    for (const m of t.matchAll(/size:\s*['"](--[\w-]+)['"]/g)) if (names.has(m[1])) canvas.set(m[1], 'size')
  }
  const guarded = new Set([...css].filter((k) => !bare.has(k) && !canvas.has(k)))
  return { css, canvas, guarded }
}

/** A token's value with every var() substituted, or a reason it cannot be resolved. */
function resolve(map, token, seen = new Set()) {
  if (seen.has(token)) return { error: `cycle through ${token}` }
  if (!(token in map)) return { error: `${token} is not defined` }
  let value = map[token]
  const next = new Set(seen).add(token)
  for (let guard = 0; guard < 50 && /var\(/.test(value); guard++) {
    const m = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/.exec(value)
    if (!m) break
    let sub
    if (m[1] in map) {
      const r = resolve(map, m[1], next)
      if (r.error) return { error: `${token} → ${r.error}` }
      sub = r.value
    } else if (m[2] != null) sub = m[2].trim()
    else return { error: `${token} → var(${m[1]}) is not defined` }
    value = value.slice(0, m.index) + sub + value.slice(m.index + m[0].length)
  }
  return value.trim() ? { value: value.trim() } : { error: `${token} resolves to an empty value` }
}

const COLOUR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([^()]*\)|color-mix\(.*\)|transparent|[a-z]+)$/i
const SIZE = /^-?[\d.]+(px|rem|em)$/

/** Every [theme, problem] for a token set over a theme set. Pure, so the controls can feed it. */
function problems(themes, used) {
  const out = []
  for (const [name, map] of Object.entries(themes)) {
    for (const tok of new Set([...used.css, ...used.canvas.keys()])) {
      if (used.guarded?.has(tok) && !(tok in map)) continue // every use carries its own fallback
      const r = resolve(map, tok)
      if (r.error) { out.push(`${name}: ${r.error}`); continue }
      const kind = used.canvas.get(tok)
      if (kind === 'colour' && !COLOUR.test(r.value)) out.push(`${name}: ${tok} = "${r.value}" is not a colour a canvas can paint`)
      if (kind === 'size' && !SIZE.test(r.value)) out.push(`${name}: ${tok} = "${r.value}" is not a size`)
    }
  }
  return out
}

/** Bare `var(--x)` (no fallback) on a token declared NOWHERE in src: a typo that paints nothing. */
function undeclaredBareRefs(files = terminalScope()) {
  const declared = new Set(tokenNames())
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.(jsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
  for (const p of walk(SRC)) {
    const t = fs.readFileSync(p, 'utf8')
    for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1])
    for (const m of t.matchAll(/['"`](--[\w-]+)['"`]/g)) declared.add(m[1])
  }
  const out = []
  for (const f of files) {
    const t = stripComments(readSrc(f), f.endsWith('.css'))
    for (const m of t.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) if (!declared.has(m[1])) out.push(`${f}: var(${m[1]})`)
  }
  return out
}

const THEMES = themeMaps()
const USED = tokensUsed()

describe('every token the terminal uses is defined in every theme', () => {
  it('CONTROL: the theme set is the real one — 3 base themes plus the whole catalog', () => {
    expect(APP_THEMES.length, 'the catalog shrank or failed to import').toBeGreaterThanOrEqual(18)
    expect(Object.keys(THEMES)).toHaveLength(3 + APP_THEMES.length)
    expect(Object.keys(THEMES.dark).length, 'tokens.css :root parse broke').toBeGreaterThan(150)
    // A catalog theme really carries its own inline tokens over its base.
    const sample = APP_THEMES.find((t) => t.family === 'light')
    expect(THEMES[`uct:${sample.id}`]['--bg']).toBe(sample.tokens['--bg'])
  })

  it('CONTROL: the used set is real (the tokens chart code actually asks for)', () => {
    for (const t of ['--gain', '--loss', '--bg-surface', '--text-muted', '--ut-gold']) {
      expect(USED.css.has(t) || USED.canvas.has(t), `${t} not seen in the terminal scope`).toBe(true)
    }
    expect(USED.canvas.get('--bg-surface')).toBe('colour') // useCotPalette / UCT20Performance
    expect(USED.canvas.get('--text-xs')).toBe('size') // SIZE_INK
    expect(USED.css.size).toBeGreaterThan(40)
    // A token every use of which carries a fallback is guarded (ThemeTrackerPage's tick tint).
    expect(USED.guarded.has('--tick-up-bg')).toBe(true)
    expect(USED.guarded.has('--gain')).toBe(false)
  })

  it('CONTROL: the check fails on an undefined token, a dangling alias and a non-colour', () => {
    const used = { css: new Set(['--zz-probe']), canvas: new Map([['--zz-size', 'colour']]) }
    const map = { '--zz-alias': 'var(--zz-gone)', '--zz-size': '12px' }
    const p = problems({ t: map }, { ...used, css: new Set(['--zz-probe', '--zz-alias']) })
    expect(p).toEqual(expect.arrayContaining([
      't: --zz-probe is not defined',
      't: --zz-alias → var(--zz-gone) is not defined',
      't: --zz-size = "12px" is not a colour a canvas can paint',
    ]))
    // …and on the REAL theme set, a root that lost --bg-surface reds in every theme.
    const root = { ...pick(':root') }
    delete root['--bg-surface']
    const broken = problems(themeMaps(root), { css: new Set(['--bg-surface']), canvas: new Map() })
    // Catalog themes re-declare --bg-surface inline, so only the base themes without it red.
    expect(broken).toEqual(expect.arrayContaining(['dark: --bg-surface is not defined']))
  })

  it(`⛔ all ${3 + APP_THEMES.length} themes resolve every token the terminal uses`, () => {
    const p = problems(THEMES, USED)
    expect(p, `tokens a theme cannot resolve:\n${p.join('\n')}`).toEqual([])
  })

  it('⛔ no terminal-mounted file references a token declared nowhere (it would paint nothing)', () => {
    expect(undeclaredBareRefs()).toEqual([])
  })
})
