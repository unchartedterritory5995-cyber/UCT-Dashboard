// app/src/pages/journal-2-0/a11y/skipLinkUntappable.test.js
//
// ⛔ The Notebook's "Skip to notes list" link sits off-screen until it takes focus. At <=640 px the
// Notebook's `.wrap` is `overflow: visible`, so the translated link was PAINTED over the Journal's
// tab strip, and a tap at the centre of Today or Trades landed on the link instead of the tab
// (H14, measured on the live build 2026-09-27 at 390 px: elementFromPoint returned the link, and a
// real tap on Today left the URL unchanged and focused the link). jsdom lays nothing out, so this
// rail reads the stylesheet: every unfocused state is invisible and lets the pointer through, and
// the focused state restores both, so a keyboard member still sees where focus went.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CSS_PATH = resolve(here, '../tabs/NotebookTab.module.css')
const SHELL_CSS_PATH = resolve(here, '../../../components/Layout.module.css')
// Wave 13 lane 13Q-3: the editor's OWN "Skip to editor toolbar" link (NoteEditorPage.jsx),
// same H14 hazard class -- a second skip link in a second module can paint over something a
// tap was meant to hit exactly the same way the first one did.
const EDITOR_CSS_PATH = resolve(here, '../components/notebook/NoteEditorPage.module.css')
// Wave 13 lane 13Q-3: the folder panel's OWN "Skip to folder navigation" link
// (FolderSidebar.jsx) -- same H14 hazard class, third module.
const SIDEBAR_CSS_PATH = resolve(here, '../components/notebook/FolderSidebar.module.css')

function rules(css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  while ((m = re.exec(text))) out.push({ selector: m[1].trim(), body: m[2] })
  return out
}
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

describe("the Notebook's skip link never takes a tap meant for something else", () => {
  const all = rules(readFileSync(CSS_PATH, 'utf8'))
  const link = all.filter((r) => /\.skipLink\b/.test(r.selector))
  const base = link.find((r) => r.selector === '.skipLink' && decl(r.body, 'position') === 'absolute')
  const focused = link.filter((r) => /\.skipLink:focus\b/.test(r.selector))

  it('non-vacuity: the base rule and a focused rule are both present', () => {
    expect(base, 'the positioned .skipLink rule').toBeTruthy()
    expect(focused.length).toBeGreaterThan(0)
  })

  it('unfocused, it is invisible and pointer-transparent', () => {
    expect(decl(base.body, 'opacity')).toBe('0')
    expect(decl(base.body, 'pointer-events')).toBe('none')
  })

  it('no other unfocused rule makes it visible or tappable again', () => {
    for (const r of link.filter((x) => !/:focus/.test(x.selector))) {
      const op = decl(r.body, 'opacity')
      expect(op === null || op === '0', `${r.selector}: opacity ${op}`).toBe(true)
      const pe = decl(r.body, 'pointer-events')
      expect(pe === null || pe === 'none', `${r.selector}: pointer-events ${pe}`).toBe(true)
    }
  })

  it('focused, it shows and takes the pointer, so a keyboard member sees where focus went', () => {
    for (const r of focused) {
      expect(decl(r.body, 'opacity'), `${r.selector}: opacity`).toBe('1')
      expect(decl(r.body, 'pointer-events'), `${r.selector}: pointer-events`).toBe('auto')
    }
  })
})

// ── The app shell's OWN "Skip to main content" (Layout.module.css) ──────────
//
// ⛔ Wave 10 lane FX, proof walk wk-7bd834b9f clause 2b: the geometry sweep named "Skip to main
// content" as covering header/title controls on nb-table/nb-board/nb-calendar/nb-timeline/
// nb-graph/nb-trash/nb-search/nb-note/ed-find/ed-property at 390px. Measured directly in a
// sandbox (Playwright, `document.elementFromPoint` at the reported centres, both the Notebook
// list page and the note editor, 390px, unfocused): it never returns the skip link or its
// wrapper -- it returns the app's own fixed MobileNav top bar for the near-top findings, and
// (a SEPARATE, already-fixed occluder) the Log-Trade FAB / voice orb for the near-bottom ones.
// getBoundingClientRect() on both the shell's own link and the Notebook's own portaled one
// (rendered through SkipLinkPortal into the shell's slot) put their ENTIRE box above y=0 --
// [8,-80,154,44] and [8,-149..-190,...] -- so elementFromPoint cannot return either for any
// point a real tap could reach. The geometry instrument's own occluder-naming walks from the
// REAL hit element up to the nearest div/section ancestor and describes THAT ancestor by its
// first line of innerText, which happens to start with the skip link's text (the first DOM
// node under `.shell`) even though the link itself has no on-screen presence -- a labelling
// artifact, not a hit-testability defect (flagged for the walk-instrument lane, not fixed here).
//
// This is WHY it is safe: `.skipLinks` (the wrapper `Layout.jsx` renders both its own link and
// every page's portaled one into) is `position: fixed`, so unlike the Notebook's OWN skip link
// above (which is `position: absolute` and, pre-H14, scrolled WITH the page at <=640px where
// `.wrap` drops scroll containment, landing on top of whatever had scrolled into that spot),
// the shell's version can never move relative to the viewport -- it stays translated off the
// TOP of the screen no matter how far the page scrolls. This rail pins that structural
// guarantee, and the transform that puts it there, so neither can regress unnoticed.
describe("the app shell's own skip link never takes a tap meant for something else", () => {
  const shellCss = readFileSync(SHELL_CSS_PATH, 'utf8')
  const shellRules = rules(shellCss)
  const wrap = shellRules.find((r) => r.selector === '.skipLinks')
  const base = shellRules.find((r) => r.selector === '.skipLink')
  const focusedShell = shellRules.filter((r) => /\.skipLink:focus\b/.test(r.selector))

  it('non-vacuity: the wrapper, the base rule and a focused rule are all present', () => {
    expect(wrap, 'the .skipLinks wrapper rule').toBeTruthy()
    expect(base, 'the positioned .skipLink rule').toBeTruthy()
    expect(focusedShell.length).toBeGreaterThan(0)
  })

  it('the wrapper is position:fixed -- viewport-anchored, so no ancestor scroll can move it', () => {
    expect(decl(wrap.body, 'position')).toBe('fixed')
  })

  it('unfocused, the link is translated off the top of the viewport by more than its own height', () => {
    const t = decl(base.body, 'transform')
    const m = t && t.match(/translateY\((-\d+(?:\.\d+)?)%\)/)
    expect(m, `.skipLink transform: ${t}`).toBeTruthy()
    // top:8px plus a translate of at least -100% of its own (small, single-line) height
    // guarantees its whole box sits above y=0 -- measured live at -200%, landing at y=-80.
    expect(Number(m[1])).toBeLessThanOrEqual(-100)
  })

  it('focused, the transform is removed so a keyboard member sees where focus went', () => {
    for (const r of focusedShell) {
      expect(decl(r.body, 'transform'), `${r.selector}: transform`).toBe('none')
    }
  })
})

// ── The editor's own "Skip to editor toolbar" (NoteEditorPage.module.css) ──
describe("the editor's own skip link never takes a tap meant for something else", () => {
  const all = rules(readFileSync(EDITOR_CSS_PATH, 'utf8'))
  const link = all.filter((r) => /\.skipLink\b/.test(r.selector))
  const base = link.find((r) => r.selector === '.skipLink' && decl(r.body, 'position') === 'absolute')
  const focused = link.filter((r) => /\.skipLink:focus\b/.test(r.selector))

  it('non-vacuity: the base rule and a focused rule are both present', () => {
    expect(base, 'the positioned .skipLink rule').toBeTruthy()
    expect(focused.length).toBeGreaterThan(0)
  })

  it('unfocused, it is invisible and pointer-transparent', () => {
    expect(decl(base.body, 'opacity')).toBe('0')
    expect(decl(base.body, 'pointer-events')).toBe('none')
  })

  it('no other unfocused rule makes it visible or tappable again', () => {
    for (const r of link.filter((x) => !/:focus/.test(x.selector))) {
      const op = decl(r.body, 'opacity')
      expect(op === null || op === '0', `${r.selector}: opacity ${op}`).toBe(true)
      const pe = decl(r.body, 'pointer-events')
      expect(pe === null || pe === 'none', `${r.selector}: pointer-events ${pe}`).toBe(true)
    }
  })

  it('focused, it shows and takes the pointer, so a keyboard member sees where focus went', () => {
    for (const r of focused) {
      expect(decl(r.body, 'opacity'), `${r.selector}: opacity`).toBe('1')
      expect(decl(r.body, 'pointer-events'), `${r.selector}: pointer-events`).toBe('auto')
    }
  })
})

// ── The folder panel's own "Skip to folder navigation" (FolderSidebar.module.css) ──
describe("the folder panel's own skip link never takes a tap meant for something else", () => {
  const all = rules(readFileSync(SIDEBAR_CSS_PATH, 'utf8'))
  const link = all.filter((r) => /\.skipLink\b/.test(r.selector))
  const base = link.find((r) => r.selector === '.skipLink' && decl(r.body, 'position') === 'absolute')
  const focused = link.filter((r) => /\.skipLink:focus\b/.test(r.selector))

  it('non-vacuity: the base rule and a focused rule are both present', () => {
    expect(base, 'the positioned .skipLink rule').toBeTruthy()
    expect(focused.length).toBeGreaterThan(0)
  })

  it('unfocused, it is invisible and pointer-transparent', () => {
    expect(decl(base.body, 'opacity')).toBe('0')
    expect(decl(base.body, 'pointer-events')).toBe('none')
  })

  it('no other unfocused rule makes it visible or tappable again', () => {
    for (const r of link.filter((x) => !/:focus/.test(x.selector))) {
      const op = decl(r.body, 'opacity')
      expect(op === null || op === '0', `${r.selector}: opacity ${op}`).toBe(true)
      const pe = decl(r.body, 'pointer-events')
      expect(pe === null || pe === 'none', `${r.selector}: pointer-events ${pe}`).toBe(true)
    }
  })

  it('focused, it shows and takes the pointer, so a keyboard member sees where focus went', () => {
    for (const r of focused) {
      expect(decl(r.body, 'opacity'), `${r.selector}: opacity`).toBe('1')
      expect(decl(r.body, 'pointer-events'), `${r.selector}: pointer-events`).toBe('auto')
    }
  })
})
