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
