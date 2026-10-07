// UCT Terminal — the theme rail: no NEW hardcoded colour in terminal-mounted panel code.
//
// ⭐ THE TERMINAL HAS NO LOOK OF ITS OWN (owner ruling, 2026-10-06). Every panel follows the
// member's app theme — dark, light, oled and the catalog themes — so a colour is a token
// (`var(--gain)`, `color-mix(in srgb, var(--ut-gold) 12%, transparent)`) or, on a canvas, a
// token resolved through lib/theme (`useThemeInk` / `resolveThemeColor`). A hex or rgba literal
// is a colour no theme can reach: it is how the COT pane, the UCT20 equity chart and the
// About panel each stayed dark on a white page.
//
// SCOPE is derived, never typed: `terminalScope()` walks the import graph from every module
// under pages/terminal/ (lazy `import()` included), so a page promoted to a panel tomorrow is
// covered the day it lands. Files other lanes own (the chart engine, Options Flow, Journal 2.0)
// are not walked; theme DEFINITIONS (tokens.css, appThemes.js, lib/theme) are walked, not scanned.
//
// The ledger is `__tests__/themeColours.baseline.json`:
//   • exceptions — genuine fixed colours (a brand mark, a member-picked tag colour), each with
//     its reason;
//   • debt — colours that should follow the theme and do not yet.
// Both are SHRINK-ONLY: a file may never gain a literal, and a count that drops must be lowered
// in the ledger in the same commit, so the debt can only go one way.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  terminalScope, scannedFiles, literalCounts, colourLiteralsIn, readSrc, tokenNames,
  locallyDeclared,
} from './__tests__/themeScope'

const LEDGER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '__tests__', 'themeColours.baseline.json')
const LEDGER = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'))

/** Every allowed count, from both halves of the ledger. */
function allowed(ledger) {
  return { ...ledger.exceptions, ...ledger.debt }
}

/** The rail's verdict for a measured `{file: count}` against a ledger. Pure, so the control
 *  below can prove it fails. */
function railVerdict(counts, ledger) {
  const allow = allowed(ledger)
  const grew = []
  const stale = []
  for (const [file, n] of Object.entries(counts)) {
    const cap = allow[file]?.count ?? 0
    if (n > cap) grew.push(`${file}: ${n} colour literal(s), ledger allows ${cap}`)
  }
  for (const [file, entry] of Object.entries(allow)) {
    const n = counts[file] ?? 0
    if (n < entry.count) stale.push(`${file}: now ${n}, ledger still says ${entry.count} — lower it`)
  }
  return { grew, stale }
}

const COUNTS = literalCounts()

describe('terminal theme rail — hardcoded colours', () => {
  it('CONTROL: the scope is the real terminal import graph, not an empty walk', () => {
    const scope = terminalScope()
    expect(scope.length, 'the import walk found almost nothing — the walker broke').toBeGreaterThan(300)
    // Named members, one per kind of edge the walk must follow.
    for (const f of [
      'pages/terminal/TerminalShell.jsx', // a root
      'pages/CotData.jsx', // panels.jsx → surfacePanels (lazy) → Breadth.jsx → CotData
      'components/tiles/UCT20Performance.jsx', // surface page UCT20 → its tile
      'pages/research/tabs/NewsTab.jsx', // a lazy PANEL_IMPORTERS entry
      'pages/cot/useCotPalette.js', // a hook two levels down
      'pages/CotData.module.css', // a stylesheet
    ]) expect(scope, `${f} fell out of the terminal scope`).toContain(f)
    // Other lanes' files are not walked, and theme definitions are not scanned.
    expect(scope.some((f) => f.startsWith('components/chart/'))).toBe(false)
    expect(scannedFiles()).not.toContain('styles/tokens.css')
  })

  it('CONTROL: the detector sees a literal, and only the sanctioned forms pass', () => {
    const known = new Set([...tokenNames(), '--local-ink'])
    const hits = (file, text) => colourLiteralsIn(file, text, known).map((h) => h.lit)
    // Reported.
    expect(hits('x.css', '.a { color: #c9a84c; }')).toEqual(['#c9a84c'])
    expect(hits('x.css', '.a { background: rgba(220, 187, 94, 0.2); }')).toHaveLength(1)
    expect(hits('x.css', '.a { color: white; }')).toEqual(['white'])
    expect(hits('x.jsx', "const s = { color: '#fff' }")).toEqual(['#fff'])
    expect(hits('x.jsx', "ctx.fillStyle = 'rgb(10, 20, 30)'")).toHaveLength(1)
    // A fallback behind a token nobody declares IS the colour (the `var(--gold, …)` class).
    expect(hits('x.css', '.a { color: var(--gold, #dcbb5e); }')).toEqual(['#dcbb5e'])
    // Sanctioned: a real token's fallback, a canvas spec's jsdom fallback, a scrim, a mask.
    expect(hits('x.css', '.a { color: var(--ut-gold, #dcbb5e); }')).toEqual([])
    expect(hits('x.css', '.a { color: var(--local-ink, #123456); }')).toEqual([])
    expect(hits('x.js', "const S = { gain: ['--gain', '#2faf68'] }")).toEqual([])
    expect(hits('x.js', "const S = { a: { token: '--text', fallback: '#f0efea' } }")).toEqual([])
    expect(hits('x.css', '.a { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4); }')).toEqual([])
    expect(hits('x.css', '.a { mask-image: linear-gradient(#000, transparent); }')).toEqual([])
    // Not colours at all: an HTML entity, a comment.
    expect(hits('x.jsx', 'return <q>&#8220;{q}&#8221;</q>')).toEqual([])
    expect(hits('x.css', '/* was #c9a84c */ .a { color: var(--ut-gold); }')).toEqual([])
  })

  it('CONTROL: the verdict reds on a new literal and on a ledger that was not lowered', () => {
    const ledger = { exceptions: {}, debt: { 'a.css': { count: 2, why: 'x' } } }
    expect(railVerdict({ 'a.css': 2 }, ledger)).toEqual({ grew: [], stale: [] })
    expect(railVerdict({ 'a.css': 3 }, ledger).grew).toHaveLength(1)
    expect(railVerdict({ 'b.css': 1 }, ledger).grew).toHaveLength(1)
    expect(railVerdict({ 'a.css': 1 }, ledger).stale).toHaveLength(1)
    // …and the REAL scan, with one literal planted in a real scoped file, reds too.
    const planted = { ...COUNTS, 'pages/CotData.jsx': (COUNTS['pages/CotData.jsx'] ?? 0) + 1 }
    expect(railVerdict(planted, LEDGER).grew.join('\n')).toMatch(/pages\/CotData\.jsx/)
  })

  it('⛔ no terminal-mounted file gains a hardcoded colour (fix it with a token, not the ledger)', () => {
    const { grew } = railVerdict(COUNTS, LEDGER)
    const detail = grew.map((g) => {
      const file = g.split(':')[0]
      const lits = colourLiteralsIn(file, readSrc(file), new Set([...tokenNames(), ...locallyDeclared()]))
      return `${g}\n${lits.map((l) => `    ${file}:${l.line}  ${l.lit}`).join('\n')}`
    })
    expect(detail, `hardcoded colours in terminal-mounted code:\n${detail.join('\n')}\n`
      + 'Use a token (var(--…) / color-mix(…)) or, on a canvas, lib/theme useThemeInk.').toEqual([])
  })

  it('⛔ the ledger only shrinks: a count that dropped is lowered in the same commit', () => {
    const { stale } = railVerdict(COUNTS, LEDGER)
    expect(stale, `ledger entries to lower in __tests__/themeColours.baseline.json:\n${stale.join('\n')}`)
      .toEqual([])
  })

  it('every ledger entry carries a reason, and no file is in both halves', () => {
    for (const [half, entries] of Object.entries({ exceptions: LEDGER.exceptions, debt: LEDGER.debt })) {
      for (const [file, e] of Object.entries(entries)) {
        expect(typeof e.why === 'string' && e.why.length > 20, `${half} ${file} has no reason`).toBe(true)
        expect(Number.isInteger(e.count) && e.count > 0, `${half} ${file} count`).toBe(true)
      }
    }
    const both = Object.keys(LEDGER.exceptions).filter((f) => f in LEDGER.debt)
    expect(both).toEqual([])
  })
})
