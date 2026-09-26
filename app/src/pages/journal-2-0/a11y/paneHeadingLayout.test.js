// app/src/pages/journal-2-0/a11y/paneHeadingLayout.test.js
//
// ⛔ The Notebook pane heading (NotebookTab.jsx, `paneHeadingRef`) takes focus after in-place swaps
// and browser Back. When it showed on :focus as an IN-FLOW block it pushed the toolbar down, and the
// press that blurred it collapsed it again, so the toolbar moved between mousedown and mouseup and a
// "+ New note" click was lost (H14, measured on the live build 2026-09-26). jsdom lays nothing out,
// so this rail reads the stylesheet itself: every rule that SHOWS the heading must keep it out of
// flow and pointer-transparent, and no rule may show it on plain :focus.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CSS_PATH = resolve(here, '../tabs/NotebookTab.module.css')

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

describe('the pane heading can show without moving anything', () => {
  const all = rules(readFileSync(CSS_PATH, 'utf8'))
  const heading = all.filter((r) => /\.paneHeading\b/.test(r.selector))

  it('non-vacuity: the base rule and a shown-state rule are both present', () => {
    expect(heading.find((r) => r.selector === '.paneHeading')).toBeTruthy()
    expect(heading.some((r) => r.selector !== '.paneHeading')).toBe(true)
  })

  it('the base rule keeps it out of flow', () => {
    const base = heading.find((r) => r.selector === '.paneHeading')
    expect(decl(base.body, 'position')).toBe('absolute')
  })

  it('every shown state stays out of flow, takes no margin, and lets the pointer through', () => {
    for (const r of heading.filter((x) => x.selector !== '.paneHeading')) {
      const pos = decl(r.body, 'position')
      expect(pos === null || pos === 'absolute' || pos === 'fixed', `${r.selector}: position ${pos}`).toBe(true)
      const margin = decl(r.body, 'margin')
      expect(margin === null || /^0(px)?$/.test(margin), `${r.selector}: margin ${margin}`).toBe(true)
      expect(decl(r.body, 'pointer-events'), `${r.selector}: pointer-events`).toBe('none')
    }
  })

  it('it is shown for keyboard focus only, never on plain :focus', () => {
    const plainFocus = heading.filter((r) => /\.paneHeading:focus(?!-)/.test(r.selector))
    expect(plainFocus.map((r) => r.selector)).toEqual([])
    expect(heading.some((r) => /\.paneHeading:focus-visible/.test(r.selector))).toBe(true)
  })
})
