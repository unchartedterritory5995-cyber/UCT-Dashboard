/* global process */
// Wave 8 (Task 8.17 fix round 1): My tools' stylesheet against its own markup. jsdom applies no CSS, so these read the
// source, and every set is DERIVED from the JSX and the stylesheet, never a hand list.
//
// 1. Only the Sheet's own panel has a fixed height. A push-in panel (notes, versions, rename, archive, delete, the
//    restore question) flows in the sheet's scrolling body; one that set a height clipped or doubled the scroll.
// 2. (Ruling R-37) A class that sets `display` beats the `hidden` attribute, so any class rendered with `hidden={...}`
//    that sets display must carry its own `.x[hidden] { display: none }` (the list behind a panel stayed visible).
// 3. (fix 2, I-1) Every outline is VALID in every theme: `<width> <style> <one colour>`. `--focus-ring` is a
//    box-shadow value, so `outline: 2px solid var(--focus-ring, …)` is invalid at computed time: no ring at all, and
//    the global ring is gone too. And every control (a clickable class, the field) has a focus-visible ring.
// 4. (fix 2, M-6) The Sheet's fixed height is a desktop-pointer rule only: on a touch tablet it is a bottom sheet.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRules, declarations, themeVars, resolveVars, parseColor, THEMES } from '../../../a11y/cssAudit'

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

/** Outline declarations that are not a valid `<width> <style> <colour>` in some theme, as "selector: value (theme)". */
export function badOutlines(css, vars = themeVars()) {
  const bad = []
  for (const r of parseRules(css)) {
    for (const d of declarations(r)) {
      if (d.prop !== 'outline' || /^(none|0)$/.test(d.value)) continue
      for (const theme of THEMES) {
        let ok = false
        try {
          const parts = resolveVars(d.value, vars[theme]).trim().split(/\s+(?![^(]*\))/)
          ok = parts.length === 3 && /^\d+(\.\d+)?px$/.test(parts[0]) && /^(solid|dashed|dotted|double)$/.test(parts[1])
            && !!parseColor(parts[2])
        } catch { ok = false }
        if (!ok) { bad.push(`${r.selector}: ${d.value} (${theme})`); break }
      }
    }
  }
  return bad
}

/** Clickable classes (cursor: pointer) and fields with no focus-visible ring of their own. */
export function ringless(css) {
  const clickable = new Set()
  const ringed = new Set()
  for (const r of parseRules(css)) {
    const decls = declarations(r)
    for (const part of r.selector.split(',')) {
      const p = part.trim()
      const cls = p.match(/\.([A-Za-z][\w-]*)/g)
      if (!cls) continue
      const last = cls[cls.length - 1].slice(1)
      if (decls.some((d) => d.prop === 'cursor' && d.value === 'pointer') && !/:/.test(p)) clickable.add(last)
      if (/:focus-visible|:has\(:focus-visible\)/.test(p) && decls.some((d) => d.prop === 'outline' || d.prop === 'box-shadow')) {
        ringed.add(cls[0].slice(1))
      }
    }
  }
  return [...clickable, 'input'].filter((c) => !ringed.has(c)).sort()
}

describe('My tools: every focus ring is real (fix 2, I-1)', () => {
  it('every outline is a valid width, style and colour in every theme', () => {
    expect(CSS).toMatch(/outline:/)                                     // non-vacuity
    expect(badOutlines(CSS)).toEqual([])
  })
  it('every control has a focus-visible ring', () => {
    expect(ringless(CSS)).toEqual([])
  })
  it('CONTROL: the --focus-ring outline is SEEN as invalid; a plain colour passes', () => {
    expect(badOutlines('.a:focus-visible { outline: 2px solid var(--focus-ring, var(--ut-gold)); }')).toHaveLength(1)
    expect(badOutlines('.a:focus-visible { outline: 2px solid var(--ut-gold); }')).toEqual([])
    expect(ringless('.a { cursor: pointer; } .input { color: red; }')).toEqual(['a', 'input'])
    expect(ringless('.a { cursor: pointer; } .a:focus-visible, .input:focus-visible { outline: 2px solid red; }')).toEqual([])
  })
})

/** Media conditions under which `.sheetPanel` gets a height (null = a base rule). */
function sheetHeightConditions(css) {
  const out = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /@media([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let m
  const inMedia = []
  while ((m = re.exec(text))) { inMedia.push([m.index, m.index + m[0].length]); if (/\.sheetPanel\s*\{[^}]*(^|[;{\s])height\s*:/.test(m[2])) out.push(m[1].trim()) }
  const base = text.split('').map((c, i) => (inMedia.some(([a, b]) => i >= a && i < b) ? ' ' : c)).join('')
  if (/(^|[^\w-])\.sheetPanel\s*\{[^}]*(^|[;{\s])height\s*:/.test(base)) out.push(null)
  return out
}

describe('My tools: the fixed height is for a desktop pointer only (fix 2, M-6)', () => {
  it('the Sheet height is set only under (hover: hover) and (pointer: fine)', () => {
    const conds = sheetHeightConditions(CSS)
    expect(conds.length).toBeGreaterThan(0)
    expect(conds.filter((c) => c === null || !/\(hover:\s*hover\)/.test(c) || !/\(pointer:\s*fine\)/.test(c))).toEqual([])
  })
  it('CONTROL: a width-only or base height is SEEN', () => {
    expect(sheetHeightConditions('@media (min-width: 641px) { .sheetPanel { height: 80vh; } }')).toEqual(['(min-width: 641px)'])
    expect(sheetHeightConditions('.sheetPanel { height: 80vh; }')).toEqual([null])
  })
})

/** `:hover` rules that would light up a control while it is aria-disabled (fix 3, m3). The classes are DERIVED: any
 *  class the stylesheet styles under `[aria-disabled='true']` can be aria-disabled, so its hover must exclude it. */
export function hoverOnDisabled(css) {
  const disableable = new Set()
  const rules = parseRules(css)
  for (const r of rules) {
    for (const part of r.selector.split(',')) {
      const m = /\.([A-Za-z][\w-]*)\[aria-disabled=['"]true['"]\]/.exec(part)
      if (m) disableable.add(m[1])
    }
  }
  const bad = []
  for (const r of rules) {
    for (const part of r.selector.split(',')) {
      const m = /\.([A-Za-z][\w-]*):hover/.exec(part)
      if (m && disableable.has(m[1]) && !/:not\(\[aria-disabled=['"]true['"]\]\)/.test(part)) bad.push(part.trim())
    }
  }
  return { disableable, bad }
}

describe('My tools: an aria-disabled control does not light up on hover (fix 3, m3)', () => {
  it('the derivation finds the aria-disabled controls (non-vacuity)', () => {
    const { disableable } = hoverOnDisabled(CSS)
    for (const c of ['btn', 'btnPrimary', 'btnDanger']) expect(disableable.has(c)).toBe(true)
  })
  it('every hover rule on one of them excludes aria-disabled', () => {
    expect(hoverOnDisabled(CSS).bad).toEqual([])
  })
  it('CONTROL: a plain hover on an aria-disabled control is SEEN', () => {
    const css = ".b[aria-disabled='true'] { opacity: .5; } .b:hover { background: red; } .c:hover { color: red; }"
    expect(hoverOnDisabled(css).bad).toEqual(['.b:hover'])
    expect(hoverOnDisabled(".b[aria-disabled='true'] { opacity: .5; } .b:hover:not([aria-disabled='true']) { color: red; }").bad).toEqual([])
  })
})
