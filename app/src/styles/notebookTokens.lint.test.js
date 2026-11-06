// app/src/styles/notebookTokens.lint.test.js
//
// VIS-6 (audit 2026-11-05, V1 "The tightened design system"): the Notebook's styles stay on the tokens.
//
// It walks the Notebook's own files -- pages/journal-2-0/components/notebook/**, tabs/NotebookTab*, and the
// journal-2-0 CSS modules named for a note or the Notebook -- and fails on a NEW off-token literal:
//   - a font-size in px off the scale (11 12 13 14 17 20 24 36);
//   - a border-radius in px off the scale (0 4 6 8 12 999);
//   - `transition: all`;
//   - a transition duration written as a raw number (use --duration-fast / --duration-base).
//
// ⭐ A RATCHET, NOT A SWEEP. notebookTokens.baseline.json freezes the literals that existed when this rail
// landed, per file and per value. More than the baseline is a failure (a new literal); FEWER is a failure too
// (the baseline overstates, so shrink it: a fixed literal must not leave room for a new one to come back).
// To rewrite the baseline after a fix: NOTEBOOK_TOKENS_WRITE_BASELINE=1 npx vitest run src/styles/notebookTokens.lint.test.js
// -- and only ever let it SHRINK.
//
// ⛔ The scan set is DERIVED from the directory walk every run, never typed, so a file added tomorrow is
// covered today. Each rule has a control below that proves the scanner can see it.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  scanCss, scanJs, tally, compareToBaseline, checkDeclaration, planBaselineWrite, ruleTotals, FONT_SCALE, RADIUS_SCALE, RULES, ICON_SIZES,
} from './__tests__/notebookTokenLint'
import { TOOLBAR_ICON, ICON_STROKE } from '../pages/journal-2-0/lib/notebookIcons'

const SRC = join(process.cwd(), 'src')
const J2 = join(SRC, 'pages', 'journal-2-0')
const BASELINE_PATH = join(SRC, 'styles', 'notebookTokens.baseline.json')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const isTest = (p) => /\.test\.|__tests__|__fixtures__/.test(p)
const rel = (p) => relative(SRC, p).split(sep).join('/')

/** The Notebook's files, derived. */
export function notebookFiles() {
  const notebook = walk(join(J2, 'components', 'notebook')).filter((p) => /\.(css|jsx?)$/.test(p) && !isTest(p))
  const tab = readdirSync(join(J2, 'tabs')).filter((n) => /^NotebookTab.*\.(css|jsx)$/.test(n) && !isTest(n))
    .map((n) => join(J2, 'tabs', n))
  const modules = walk(J2).filter((p) => /(Note|Notebook)[^/\\]*\.module\.css$/.test(p) && !isTest(p))
  // Fix round 1 (review 6): the one GLOBAL stylesheet every note body wears (lib/tiptap.js imports it into the editor,
  // the shared page and the version previews). Named, not matched: it is an authority, not a pattern.
  // Fix round 2 (live scorecard): the Journal Today surface and the Journal shell every Notebook screen sits in.
  const named = [join(J2, 'lib', 'noteContent.css'), join(J2, 'surfaces', 'TodaySurface.module.css'),
    join(J2, 'JournalLayout.module.css'), join(J2, 'components', 'accounts', 'AccountSelector.module.css'),
    // Final polish (live scorecard): the Today panels, drawn on the Notebook's Today home.
    join(J2, 'surfaces', 'today', 'panels', 'panels.module.css')]
  return [...new Set([...notebook, ...tab, ...modules, ...named])].sort()
}

function currentTally() {
  const out = {}
  for (const p of notebookFiles()) {
    const text = readFileSync(p, 'utf8')
    const t = tally(p.endsWith('.css') ? scanCss(text) : scanJs(text))
    if (Object.keys(t).length) out[rel(p)] = Object.fromEntries(Object.entries(t).sort())
  }
  return out
}

const readBaseline = () => JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))

/** Fix round 1 (review 2): the per-rule ceiling (see the test that reads it). Only ever lowered. */
const CEILING = Object.freeze({ 'font-size': 202, 'border-radius': 76, 'transition-all': 0, 'raw-duration': 0, spacing: 1253, 'icon-size': 244 })

describe('VIS-6: Notebook token rail', () => {
  it('covers the Notebook (the walk finds the editor, the tab and its CSS modules)', () => {
    const files = notebookFiles().map(rel)
    expect(files).toContain('pages/journal-2-0/components/notebook/NoteEditorPage.module.css')
    expect(files).toContain('pages/journal-2-0/tabs/NotebookTab.module.css')
    expect(files).toContain('pages/journal-2-0/tabs/NotebookTab.jsx')
    expect(files).toContain('pages/journal-2-0/lib/noteContent.css')
    expect(files).toContain('pages/journal-2-0/surfaces/TodaySurface.module.css')
    expect(files).toContain('pages/journal-2-0/JournalLayout.module.css')
    expect(files).toContain('pages/journal-2-0/surfaces/today/panels/panels.module.css')
    expect(files.length).toBeGreaterThan(150)
    expect(files.some(isTest)).toBe(false)
  })

  it('adds no off-token literal beyond the baseline, and the baseline claims nothing that is gone', () => {
    const current = currentTally()
    if (process.env.NOTEBOOK_TOKENS_WRITE_BASELINE === '1') {
      // ⛔ Fix round 1 (review 2): the writer may only REMOVE entries. A literal the tree has beyond the baseline is
      // refused here, and nothing is written: fix it, never absorb it.
      const plan = planBaselineWrite(current, readBaseline())
      expect(plan.refused, `refusing to write: these are NEW off-token literals:\n${(plan.refused || []).join('\n')}`).toBeUndefined()
      const tmp = `${BASELINE_PATH}.tmp`
      writeFileSync(tmp, `${JSON.stringify(plan.next, null, 1)}\n`)
      renameSync(tmp, BASELINE_PATH)
      return
    }
    const { added, stale } = compareToBaseline(current, readBaseline())
    expect(added, `new off-token literals (use the tokens in styles/tokens.css):\n${added.join('\n')}`).toEqual([])
    expect(stale, `the baseline overstates (shrink notebookTokens.baseline.json):\n${stale.join('\n')}`).toEqual([])
  })

  // ⛔ Fix round 1 (review 2): the ceiling. Each rule's total in the baseline, written here, so growing the baseline is
  // a visible edit to THIS file. It may only go down: when a fix shrinks the baseline, lower the number to match.
  it('the baseline holds exactly the ceiling per rule (lower the ceiling with the baseline; it never rises)', () => {
    expect(ruleTotals(readBaseline())).toEqual(CEILING)
  })

  it('freezes no transition: all and no raw transition duration (issue 23 fixed them all)', () => {
    const left = Object.entries(readBaseline()).flatMap(([f, t]) => Object.keys(t)
      .filter((k) => k.startsWith('transition-all') || k.startsWith('raw-duration')).map((k) => `${f}: ${k}`))
    expect(left).toEqual([])
  })
})

describe('VIS-6: each rule can fail (controls)', () => {
  it('font-size: an off-scale px is reported, an on-scale px and a token are not', () => {
    expect(scanCss('.a { font-size: 12.5px; }')).toEqual([{ rule: 'font-size', value: '12.5px' }])
    expect(scanCss('.a { font-size: 13px; }')).toEqual([])
    expect(scanCss('.a { font-size: var(--text-md, 15px); }')).toEqual([])
    expect(scanJs('<p style={{ fontSize: 15 }} />')).toEqual([{ rule: 'font-size', value: '15px' }])
    expect(scanJs("<p style={{ fontSize: '12px' }} />")).toEqual([])
  })

  it('border-radius: an off-scale px is reported in any position, the scale and % are not', () => {
    expect(scanCss('.a { border-radius: 10px; }')).toEqual([{ rule: 'border-radius', value: '10px' }])
    expect(scanCss('.a { border-radius: 12px 12px 0 5px; }')).toEqual([{ rule: 'border-radius', value: '5px' }])
    expect(scanCss('.a { border-radius: 50%; } .b { border-radius: 999px; } .c { border-radius: var(--radius-sm, 3px); }')).toEqual([])
    expect(scanJs('<i style={{ borderRadius: 3 }} />')).toEqual([{ rule: 'border-radius', value: '3px' }])
  })

  it('transition: all is reported, a named property is not', () => {
    expect(scanCss('.a { transition: all var(--duration-fast) var(--ease-out); }'))
      .toEqual([{ rule: 'transition-all', value: 'all' }])
    expect(scanCss('.a { transition-property: all; }')).toEqual([{ rule: 'transition-all', value: 'all' }])
    expect(scanCss('.a { transition: background-color var(--duration-fast) var(--ease-out); }')).toEqual([])
  })

  it('a raw duration is reported in ms and in s; a token and a cubic-bezier are not', () => {
    expect(scanCss('.a { transition: color 120ms ease; }')).toEqual([{ rule: 'raw-duration', value: '120ms' }])
    expect(scanCss('.a { transition: transform .15s cubic-bezier(0.16, 1, 0.3, 1); }'))
      .toEqual([{ rule: 'raw-duration', value: '.15s' }])
    expect(scanCss('.a { transition-duration: 0.2s; }')).toEqual([{ rule: 'raw-duration', value: '0.2s' }])
    expect(scanCss('.a { transition: transform var(--duration-base) cubic-bezier(0.16, 1, 0.3, 1); }')).toEqual([])
    expect(scanJs("<b style={{ transition: 'all 0.2s' }} />")).toEqual([
      { rule: 'transition-all', value: 'all' }, { rule: 'raw-duration', value: '0.2s' }])
  })

  it('the ratchet reports one literal more than the baseline, and one fewer', () => {
    const base = { 'x.css': { 'font-size 15px': 2 } }
    expect(compareToBaseline({ 'x.css': { 'font-size 15px': 3 } }, base).added).toHaveLength(1)
    expect(compareToBaseline({ 'x.css': { 'font-size 15px': 1 } }, base).stale).toHaveLength(1)
    expect(compareToBaseline({ 'y.css': { 'raw-duration 1s': 1 } }, base).added).toHaveLength(1)
    expect(compareToBaseline(base, base)).toEqual({ added: [], stale: [] })
  })

  it('the scales are the V1 plan: at most 8 type sizes', () => {
    expect(FONT_SCALE.length).toBeLessThanOrEqual(8)
    expect(RADIUS_SCALE).toEqual([0, 4, 6, 8, 12, 999])
    expect(checkDeclaration('color', '12.5px')).toEqual([])
  })
})

describe('VIS-6: the tokens the scale names exist', () => {
  const TOKENS = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const root = TOKENS.slice(TOKENS.indexOf(':root'))
  const decl = (name) => {
    const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(root)
    return m ? m[1].trim() : null
  }

  it('defines every font-size step of the scale as a token', () => {
    const sizes = ['--text-sm', '--text-base', '--text-md', '--text-lg', '--text-read', '--text-2xl', '--text-3xl', '--text-title']
      .map((t) => Number.parseFloat(decl(t)))
    expect(sizes).toEqual([...FONT_SCALE])
  })

  it('defines the radii and the motion tokens; --duration-base derives from --duration-normal', () => {
    expect(['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl'].map(decl)).toEqual(['4px', '6px', '8px', '12px'])
    expect(decl('--duration-fast')).toBe('150ms')
    expect(decl('--duration-base')).toBe('var(--duration-normal)')
    expect(decl('--ease-out')).toMatch(/^cubic-bezier/)
  })

  it('the icon tokens and lib/notebookIcons.js say the same thing', () => {
    expect(decl('--icon-size-toolbar')).toBe(`${TOOLBAR_ICON.size}px`)
    expect(decl('--icon-size-nav')).toBe(`${ICON_SIZES[1]}px`)
    expect(Number(decl('--icon-stroke'))).toBe(ICON_STROKE)
    expect(TOOLBAR_ICON.gold).toBe(false)
  })
})

describe('fix round 1: the writer refuses growth, and the scanner gaps review 7 named are closed (controls)', () => {
  it('the writer refuses a baseline that would grow, and writes one that shrinks', () => {
    const base = { 'x.css': { 'font-size 15px': 1 } }
    expect(planBaselineWrite({ 'x.css': { 'font-size 15px': 1, 'font-size 9px': 1 } }, base).refused).toHaveLength(1)
    expect(planBaselineWrite({ 'y.css': { 'spacing 5px': 1 } }, base).refused).toHaveLength(1)
    expect(planBaselineWrite({}, base)).toEqual({ next: {} })
    expect(ruleTotals(base)).toMatchObject({ 'font-size': 1, spacing: 0 })
    expect(Object.keys(CEILING).sort()).toEqual([...RULES].sort())
  })

  it('a vendor-prefixed transition is a transition', () => {
    expect(scanCss('.a { -webkit-transition: all 120ms; }')).toEqual([
      { rule: 'transition-all', value: 'all' }, { rule: 'raw-duration', value: '120ms' }])
    expect(scanCss('.a { transition-delay: 80ms; }')).toEqual([{ rule: 'raw-duration', value: '80ms' }])
  })

  it('a rem or em size, and the off-scale --text-xs, are literals; an on-scale token is not', () => {
    expect(scanCss('.a { font-size: 0.95rem; }')).toEqual([{ rule: 'font-size', value: '0.95rem' }])
    expect(scanCss('.a { font-size: 1.2em; }')).toEqual([{ rule: 'font-size', value: '1.2em' }])
    expect(scanCss('.a { font-size: var(--text-xs); }')).toEqual([{ rule: 'font-size', value: 'var(--text-xs)' }])
    expect(scanCss('.a { font-size: var(--text-md); }')).toEqual([])
  })

  it('the font shorthand reads only the size before the slash', () => {
    expect(scanCss('.a { font: 600 13px/18px var(--font-sans); }')).toEqual([])
    expect(scanCss('.a { font: 600 15px/1.4 var(--font-sans); }')).toEqual([{ rule: 'font-size', value: '15px' }])
  })

  it('spacing: a padding, margin or gap off the 4 px steps is reported (2 px allowed, negative by size)', () => {
    expect(scanCss('.a { padding: 6px 12px; }')).toEqual([{ rule: 'spacing', value: '6px' }])
    expect(scanCss('.a { margin: -4px 0 2px; gap: var(--space-sm, 7px); column-gap: 10px; }')).toEqual([{ rule: 'spacing', value: '10px' }])
    expect(scanJs('<i style={{ padding: 5, marginTop: 8 }} />')).toEqual([{ rule: 'spacing', value: '5px' }])
  })

  it('icon-size: a UIcon that is not 16 or 20 is reported; the spread constant is not', () => {
    expect(scanJs('<UIcon name="x" size={12} gold={false} />')).toEqual([{ rule: 'icon-size', value: '12px' }])
    expect(scanJs('<UIcon name="x" size={16} />')).toEqual([])
    expect(scanJs('<UIcon name="x" {...TOOLBAR_ICON} />')).toEqual([])
  })
})