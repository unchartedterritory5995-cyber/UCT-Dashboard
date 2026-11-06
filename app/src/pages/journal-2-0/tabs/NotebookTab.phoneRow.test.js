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
  it('the sort words are compact ON A PHONE only (review minor 12); the select is still named for what it orders', () => {
    const sel = jsx.slice(jsx.indexOf('className={styles.sortSelect}'), jsx.indexOf('</select>', jsx.indexOf('className={styles.sortSelect}')))
    expect(sel).toMatch(/SORT_OPTIONS\.map\(\(o\) => <option key=\{o\.value\} value=\{o\.value\}>\{phoneSortWords \? o\.short : o\.label\}<\/option>\)/)
    expect(sel).toMatch(/aria-label="Sort notes"/)
    expect(jsx).toMatch(/const phoneSortWords = useIsPhone\(\)/)
  })

  it('on a phone only, the row\'s labelled buttons give up side padding', () => {
    expect(phone).toMatch(/\.toolbar \.toolBtn, \.toolbar \.phoneFolders \{ padding-inline: 10px; \}/)
    // measured at 390 px (the Tier 2 local-build check): with a 6 px gap the ⋯ still wrapped by 2 px
    expect(phone).toMatch(/\.toolbar \{ flex-wrap: wrap; gap: 4px;/)
    expect(phone).toMatch(/\.main:not\(\.mainNote\) \{ padding-top: 8px; \}/)
    const outside = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(outside).not.toMatch(/\.toolbar \.toolBtn, \.toolbar \.phoneFolders/)
  })
})
