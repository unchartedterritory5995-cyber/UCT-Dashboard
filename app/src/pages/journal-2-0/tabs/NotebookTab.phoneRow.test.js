// @vitest-environment node
// Tier 2 (production check of Tier 1b, 390 x 844): the sort select read "Recently upd…" and pushed ⋯ onto a line of
// its own. Per V4 the ⋯ sits IN the filter row: compact sort words, and tighter side padding on the row's labelled
// buttons, on a phone only. Structural (jsdom lays nothing out); the browser verdict is a 390 px measurement.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs')
const jsx = readFileSync(join(DIR, 'NotebookTab.jsx'), 'utf8')
const css = readFileSync(join(DIR, 'NotebookTab.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const phone = [...css.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')

describe('the phone filter row holds the ⋯', () => {
  it('the sort words are compact; the select is still named for what it orders', () => {
    const sel = jsx.slice(jsx.indexOf('className={styles.sortSelect}'), jsx.indexOf('</select>', jsx.indexOf('className={styles.sortSelect}')))
    const words = [...sel.matchAll(/<option value="[^"]+">([^<]+)<\/option>/g)].map((m) => m[1])
    expect(words).toEqual(['Updated', 'Created', 'Title'])
    expect(sel).toMatch(/aria-label="Sort notes"/)
  })

  it('on a phone only, the row\'s labelled buttons give up side padding', () => {
    expect(phone).toMatch(/\.toolbar \.toolBtn, \.toolbar \.phoneFolders \{ padding-inline: 10px; \}/)
    const outside = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(outside).not.toMatch(/\.toolbar \.toolBtn, \.toolbar \.phoneFolders/)
  })
})
