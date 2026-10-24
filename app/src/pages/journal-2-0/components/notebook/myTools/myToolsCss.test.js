/* global process */
// Wave 8 (Task 8.17 fix round 1): My tools' stylesheet against its own markup. jsdom applies no CSS, so these read the
// source, and every set is DERIVED from the JSX and the stylesheet, never a hand list.
//
// 1. Only the Sheet's own panel has a fixed height. A push-in panel (notes, versions, rename, archive, delete, the
//    restore question) flows in the sheet's scrolling body; one that set a height clipped or doubled the scroll.
// 2. (Ruling R-37) A class that sets `display` beats the `hidden` attribute, so any class rendered with `hidden={...}`
//    that sets display must carry its own `.x[hidden] { display: none }` (the list behind a panel stayed visible).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations } from '../../../a11y/cssAudit'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'myTools')
const CSS = readFileSync(join(DIR, 'myTools.module.css'), 'utf8')
const SOURCES = readdirSync(DIR).filter((n) => /\.jsx$/.test(n) && !/\.test\./.test(n))
  .map((n) => [n, readFileSync(join(DIR, n), 'utf8')])

/** Every JSX opening tag's text, scanning braces so `() =>` inside an attribute never ends a tag. */
function openingTags(src) {
  const out = []
  const re = /<([A-Za-z][\w.]*)\b/g
  let m
  while ((m = re.exec(src))) {
    let i = re.lastIndex
    let depth = 0
    let quote = null
    for (; i < src.length; i += 1) {
      const c = src[i]
      if (quote) { if (c === quote) quote = null; continue }
      if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue }
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    out.push({ tag: m[1], text: src.slice(m.index, i + 1) })
  }
  return out
}
const classesOf = (text) => [...text.matchAll(/styles\.([A-Za-z]\w*)/g)].map((x) => x[1])

/** The classes the Sheet itself is given (`<Sheet className={styles.X}`), and the push-in panels' root classes (the
 *  tags carrying a `data-testid="my-tools-…"` panel id). */
function panelClasses(sources) {
  const sheet = new Set()
  const pushIn = new Set()
  for (const [, src] of sources) {
    for (const t of openingTags(src)) {
      if (t.tag === 'Sheet') { const m = /\sclassName=\{styles\.(\w+)\}/.exec(t.text); if (m) sheet.add(m[1]) }
      if (/data-testid="my-tools-(rename|archive|used-in|history|history-question|delete)"/.test(t.text)) {
        classesOf(t.text).forEach((c) => pushIn.add(c))
      }
    }
  }
  return { sheet, pushIn }
}

/** Classes (the last class of each selector part) whose rules set a height of any kind, with the property. */
function heightSetters(css) {
  const out = new Map()
  for (const r of parseRules(css)) {
    for (const d of declarations(r)) {
      if (!/^(height|min-height|max-height|block-size)$/.test(d.prop)) continue
      for (const part of r.selector.split(',')) {
        const last = part.trim().match(/\.([A-Za-z][\w-]*)/g)
        if (last) out.set(last[last.length - 1].slice(1), d.prop)
      }
    }
  }
  return out
}

function hiddenDefects(sources, css) {
  const hidden = new Set()
  for (const [, src] of sources) for (const t of openingTags(src)) if (/\shidden=\{/.test(t.text)) classesOf(t.text).forEach((c) => hidden.add(c))
  const sets = new Set()
  const guarded = new Set()
  for (const r of parseRules(css)) {
    const disp = declarations(r).find((d) => d.prop === 'display')
    if (!disp) continue
    for (const part of r.selector.split(',')) {
      const p = part.trim()
      const g = /^\.([A-Za-z][\w-]*)\[hidden\]$/.exec(p)
      if (g && disp.value === 'none') { guarded.add(g[1]); continue }
      const last = p.match(/\.([A-Za-z][\w-]*)/g)
      if (last && disp.value !== 'none' && !/\[hidden\]/.test(p)) sets.add(last[last.length - 1].slice(1))
    }
  }
  return { hidden, defects: [...hidden].filter((c) => sets.has(c) && !guarded.has(c)).sort() }
}

describe('My tools: only the Sheet panel has a fixed height', () => {
  const { sheet, pushIn } = panelClasses(SOURCES)

  it('the derivation sees the Sheet class and every push-in panel (non-vacuity)', () => {
    expect([...sheet]).toEqual(['sheetPanel'])
    expect([...pushIn]).toEqual(['pushPanel'])
  })

  it('no push-in panel class sets a height', () => {
    const setters = heightSetters(CSS)
    expect([...pushIn].filter((c) => setters.has(c)).map((c) => `.${c} sets ${setters.get(c)}`)).toEqual([])
    expect(setters.get('sheetPanel')).toBe('height')
  })

  it('CONTROL: a push-in panel that sets a height is SEEN', () => {
    expect(heightSetters('.pushPanel { display: flex; }\n@media (min-width: 641px) { .pushPanel { height: 80vh; } }').get('pushPanel')).toBe('height')
    expect(heightSetters('.a, .b .pushPanel { min-height: 10px; }').get('pushPanel')).toBe('min-height')
  })
})

describe('My tools: a class rendered with `hidden` that sets display is guarded (R-37)', () => {
  it('the derivation finds the hidden list behind a panel (non-vacuity)', () => {
    expect(hiddenDefects(SOURCES, CSS).hidden.has('listWrap')).toBe(true)
  })

  it('every such class has its own [hidden] rule', () => {
    expect(hiddenDefects(SOURCES, CSS).defects).toEqual([])
  })

  it('CONTROL: an unguarded one is SEEN, and a guard clears it', () => {
    const src = [['x.jsx', '<div hidden={a} className={styles.wrap}>']]
    expect(hiddenDefects(src, '.wrap { display: flex; }').defects).toEqual(['wrap'])
    expect(hiddenDefects(src, '.wrap { display: flex; }\n.wrap[hidden] { display: none; }').defects).toEqual([])
  })
})
