// app/src/pages/journal-2-0/a11y/focusSuppression.test.js
//
// A4: no Notebook stylesheet hides a keyboard user's focus ring without
// putting something visible in its place (WCAG 2.4.7, 1.4.11).
//
// The rule, per rule: a rule that sets `outline: none` or `outline: 0` must, IN
// THAT SAME RULE, set a visible replacement — `box-shadow`, `border-color` or
// `background` — or be scoped by `:focus:not(:focus-visible)` (the mouse-only
// case, where suppressing the ring is the point). A base rule that removes the
// outline for every state and leaves the focus state to "a rule further down"
// is exactly the pattern this exists to stop: the next edit to that other rule
// takes the ring away and nothing here would know.
//
// "Visible" is measured, not assumed: at least one replacement colour must
// reach 3:1 against every surface the rule can sit on (its own background if
// it sets one, else --bg, --bg-surface and --bg-elevated) in all three themes,
// with a translucent colour composited onto that surface first. `--focus-ring`
// is the instructive failure: rgba(201,168,76,0.75) reads fine on the dark
// themes and measures 1.7:1 on the light one.
//
// The stylesheet set is DERIVED (cssAudit.deriveNotebookCss) and comments do
// not count. Measured at a5668a8a8: 20 regex hits in 11 files; at lane 8A's
// fix, every remaining hit passes.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrast } from '../../../styles/__tests__/contrastMath'
import { J2_DIR } from './population'
import {
  deriveNotebookCss, parseRules, declarations, themeVars, resolveVars,
  parseColor, colorsIn, opaque, THEMES, SURFACES,
} from './cssAudit'

const SUPPRESS = /^(none|0)$/
const REPLACEMENT_PROPS = new Set(['box-shadow', 'border-color', 'background', 'background-color'])
const BAR = 3

/**
 * Another lane's stylesheet that fails today, classified rather than fixed
 * here. Each entry names the lane and the rule. Empty is the goal; a stale
 * entry (the file now passes) is REPORTED by the rail, never failed, so that
 * lane's own fix cannot turn this rail red in its gate -- whoever sees the
 * report deletes the entry.
 * ⭐ SharedNotePage.module.css:17 (8B) was the plan's named case; lane 8B
 * fixed it in 2361ebffa (a :focus-visible ring on the read-only document), so
 * it is audited here like every other file and needs no entry.
 * ⭐ Empty again: lane 8C's three entries (NoteExportControls, the Research home
 * sample strip, the tour's title and Skip) were fixed by 8C in 6775e2968, so
 * those files are audited like the rest -- a return to var(--focus-ring) now
 * fails here instead of being skipped.
 */
export const OTHER_LANES = Object.freeze({})

const scopedToMouse = (selector) => selector.split(',').every((p) => /:focus:not\(:focus-visible\)/.test(p))

/** Every outline-suppressing rule in one stylesheet, judged. */
function audit(rel, vars = themeVars()) {
  const css = readFileSync(join(J2_DIR, rel), 'utf8')
  const findings = []
  for (const r of parseRules(css)) {
    const decls = declarations(r)
    const kill = decls.find((d) => d.prop === 'outline' && SUPPRESS.test(d.value))
    if (!kill) continue
    const at = `${rel}:${kill.line}`
    if (scopedToMouse(r.selector)) { findings.push({ at, ok: true, how: 'scoped to :focus:not(:focus-visible)' }); continue }
    const replacements = decls.filter((d) => REPLACEMENT_PROPS.has(d.prop))
    if (!replacements.length) {
      findings.push({ at, ok: false, why: `"${r.selector}" sets outline: ${kill.value} with no box-shadow, border-color or background in the same rule` })
      continue
    }
    const ownBg = decls.find((d) => d.prop === 'background' || d.prop === 'background-color')
    const measured = []
    let visible = false
    for (const rep of replacements) {
      if (rep === ownBg && replacements.length > 1) continue // the surface itself, when a ring is also present
      let worst = Infinity
      let worstAt = ''
      for (const theme of THEMES) {
        const v = vars[theme]
        const colours = colorsIn(resolveVars(rep.value, v)).map(parseColor)
        const colour = colours.find((c) => c.alpha > 0)
        if (!colour) { worst = 0; worstAt = `${theme}: no colour in "${rep.value}"`; break }
        const surfaces = ownBg && rep !== ownBg
          ? [resolveVars(ownBg.value, v)]
          : SURFACES.map((s) => resolveVars(`var(${s})`, v))
        for (const sText of surfaces) {
          const sc = colorsIn(sText).map(parseColor).find((c) => c.alpha > 0)
          if (!sc) continue
          const surface = opaque(sc, parseColor(resolveVars('var(--bg)', v)).rgb)
          const ratio = contrast(opaque(colour, surface), surface)
          if (ratio < worst) { worst = ratio; worstAt = `${theme} on ${sText}` }
        }
      }
      measured.push(`${rep.prop}: ${rep.value} -> ${worst.toFixed(2)}:1 (${worstAt})`)
      if (worst >= BAR) visible = true
    }
    findings.push(visible
      ? { at, ok: true, how: measured.join('; ') }
      : { at, ok: false, why: `"${r.selector}": no replacement reaches ${BAR}:1 — ${measured.join('; ')}` })
  }
  return findings
}

describe('Notebook stylesheets never hide focus without a visible replacement', () => {
  const files = deriveNotebookCss()

  it('non-vacuity: the derived set holds the files the plan measured', () => {
    for (const f of ['components/notebook/FolderSidebar.module.css', 'components/notebook/HeroImagePicker.module.css',
      'components/notebook/NoteEditorPage.module.css', 'tabs/NotebookTab.module.css', 'SharedNotePage.module.css']) {
      expect(files, f).toContain(f)
    }
    expect(files.length).toBeGreaterThan(40)
  })

  it('control: the judge fails a bare suppression and passes a measured replacement', () => {
    const vars = themeVars()
    const judge = (css) => {
      const [r] = parseRules(css)
      const d = declarations(r)
      return { kill: d.some((x) => x.prop === 'outline' && SUPPRESS.test(x.value)), rep: d.filter((x) => REPLACEMENT_PROPS.has(x.prop)) }
    }
    expect(judge('.a:focus { outline: none; }')).toEqual({ kill: true, rep: [] })
    expect(judge('.a:focus { outline: 0; border-color: var(--ut-gold); }').rep).toHaveLength(1)
    // the translucent shared ring really does fail on the light theme
    const ring = parseColor(colorsIn(resolveVars('var(--focus-ring)', vars.light))[0])
    const surface = parseColor(resolveVars('var(--bg-surface)', vars.light)).rgb
    expect(contrast(opaque(ring, surface), surface)).toBeLessThan(BAR)
    // and a comment is not a rule
    expect(parseRules('/* .a { outline: none; } */ .b { color: red; }').map((r) => r.selector)).toEqual(['.b'])
    // a mouse-only scope is recognised; a :focus-visible one is not
    expect(scopedToMouse('.a:focus:not(:focus-visible)')).toBe(true)
    expect(scopedToMouse('.a:focus-visible')).toBe(false)
  })

  it('every outline-suppressing rule has a replacement reaching 3:1 in all three themes (or is mouse-only)', () => {
    const failures = []
    let checked = 0
    for (const f of files) {
      if (Object.hasOwn(OTHER_LANES, f)) continue
      for (const x of audit(f)) {
        checked += 1
        if (!x.ok) failures.push(`${x.at} ${x.why}`)
      }
    }
    expect(checked, 'the walk found no suppression at all -- the parser is broken').toBeGreaterThan(10)
    expect(failures, failures.join('\n')).toEqual([])
  })

  // ⚠️ An OTHER_LANES entry that passes now is REPORTED, never failed: the other
  // lane's fix must not turn this rail red in that lane's own gate. It is
  // inert until someone deletes it; the lane's report lists which are.
  it('every OTHER_LANES entry names a lane, a reason and a real Notebook stylesheet', () => {
    for (const [f, { lane, why }] of Object.entries(OTHER_LANES)) {
      expect(['8B', '8C']).toContain(lane)
      expect(why.length).toBeGreaterThan(20)
      expect(files, `${f} is not a Notebook stylesheet any more`).toContain(f)
      if (!audit(f).some((x) => !x.ok)) console.info(`focusSuppression: OTHER_LANES ${f} passes now (inert; delete it)`)
    }
  })

  it('the two rules the plan named are fixed, not exempted', () => {
    const at = (f) => audit(f)
    // FolderSidebar's tag-rename field and HeroImagePicker's filled image
    expect(at('components/notebook/FolderSidebar.module.css').every((x) => x.ok)).toBe(true)
    expect(at('components/notebook/HeroImagePicker.module.css').every((x) => x.ok)).toBe(true)
    expect(Object.keys(OTHER_LANES)).not.toContain('components/notebook/FolderSidebar.module.css')
    expect(Object.keys(OTHER_LANES)).not.toContain('components/notebook/HeroImagePicker.module.css')
  })
})
