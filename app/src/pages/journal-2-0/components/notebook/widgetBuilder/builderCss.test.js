// Wave 8 (Task 8.15 fix 1): the builder's stylesheet against its own markup. jsdom applies no CSS, so these read
// the source: every one of them is DERIVED (from the JSX and the stylesheet), never a hand list of classes.
//
// 1. (C1) A class that sets `display` beats the `hidden` attribute, so any class rendered with `hidden={...}` that
//    sets display must carry its own `.x[hidden] { display: none }`. The sections were visible under every picker.
// 2. (I-5) A label-wrapped radio or checkbox (the input visually hidden) shows its focus on the LABEL: the class
//    needs a `:has(:focus-visible)` rule with a ring. `:focus-within` also lit on a mouse click.
// 3. (I-11) A disabled view's reason is read at 4.5:1 in every theme; the dimming is on the drawing and name only.
// 4. The dimmed last-good preview stays readable: bright text at the dimmed opacity reaches 4.5:1.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { contrast } from '../../../../../styles/__tests__/contrastMath'
import { parseRules, declarations, themeVars, resolveVars, parseColor, colorsIn, opaque, THEMES } from '../../../a11y/cssAudit'

const DIR = join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'widgetBuilder')
const CSS = readFileSync(join(DIR, 'WidgetBuilderSheet.module.css'), 'utf8')

function jsxFiles(dir = DIR, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__fixtures__') jsxFiles(p, out) } else if (/\.jsx$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

/** Every JSX opening tag as `{tag, text, end}`, scanning braces so `() =>` inside an attribute never ends a tag. */
export function openingTags(src) {
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
    out.push({ tag: m[1], text: src.slice(m.index, i + 1), end: i + 1 })
  }
  return out
}

const classesOf = (tagText) => [...tagText.matchAll(/styles\.([A-Za-z][\w]*)/g)].map((x) => x[1])

/** Classes rendered with a `hidden` attribute. */
export function hiddenClasses(src) {
  const out = new Set()
  // `hidden={...}`, `hidden="..."` and a bare `hidden` all hide (fix 2).
  for (const t of openingTags(src)) if (/\shidden(?=[\s=>/])/.test(t.text)) classesOf(t.text).forEach((c) => out.add(c))
  return out
}

/** Classes that set `display` (not none) outside a [hidden] rule, and classes with a `.x[hidden]{display:none}`. */
export function displayFacts(css) {
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
  return { sets, guarded }
}

export function hiddenDefects(sources, css) {
  const { sets, guarded } = displayFacts(css)
  const hidden = new Set()
  for (const src of sources) hiddenClasses(src).forEach((c) => hidden.add(c))
  return [...hidden].filter((c) => sets.has(c) && !guarded.has(c)).sort()
}

/** Classes of labels that wrap a radio or a checkbox. */
export function wrappedInputLabels(src) {
  const out = new Set()
  for (const t of openingTags(src)) {
    if (t.tag !== 'label') continue
    const close = src.indexOf('</label>', t.end)
    const inner = src.slice(t.end, close < 0 ? t.end : close)
    // The label's BASE class (its first): the state modifiers (`optionOn`) ride on it.
    const base = classesOf(t.text)[0]
    if (base && /type="(radio|checkbox)"/.test(inner)) out.add(base)
  }
  return out
}

export function focusRingDefects(sources, css) {
  const ringed = new Set()
  for (const r of parseRules(css)) {
    const ring = declarations(r).some((d) => d.prop === 'outline' && !/^(none|0)$/.test(d.value)) || declarations(r).some((d) => d.prop === 'box-shadow')
    if (!ring) continue
    for (const part of r.selector.split(',')) {
      const m = /^\.([A-Za-z][\w-]*):has\(:focus-visible\)$/.exec(part.trim())
      if (m) ringed.add(m[1])
    }
  }
  const labels = new Set()
  for (const src of sources) wrappedInputLabels(src).forEach((c) => labels.add(c))
  return [...labels].filter((c) => !ringed.has(c)).sort()
}

const SOURCES = jsxFiles().map((f) => readFileSync(f, 'utf8'))
const VARS = themeVars()
const ruleOf = (selector) => parseRules(CSS).find((r) => r.selector === selector)
const declOf = (selector, prop) => declarations(ruleOf(selector) || { body: '', bodyStart: 0, text: '' }).find((d) => d.prop === prop)
const colour = (value, theme) => colorsIn(resolveVars(value, VARS[theme])).map(parseColor).find((c) => c.alpha > 0)

describe('the builder stylesheet against its markup', () => {
  it('C1: every class rendered with `hidden` that sets display has a [hidden] rule', () => {
    expect(SOURCES.length).toBeGreaterThan(5)
    expect([...hiddenClasses(SOURCES.join('\n'))]).toContain('sections')        // non-vacuity
    expect(hiddenDefects(SOURCES, CSS)).toEqual([])
  })

  it('C1 CONTROL: a display class rendered hidden with no [hidden] rule is SEEN', () => {
    const jsx = '<div hidden={open} className={styles.box} onClick={() => go()}>x</div>'
    expect(hiddenDefects([jsx], '.box { display: flex; }')).toEqual(['box'])
    expect(hiddenDefects([jsx], '.box { display: flex; }\n.box[hidden] { display: none; }')).toEqual([])
    expect(hiddenDefects([jsx], '.box { color: red; }')).toEqual([])
    // a bare `hidden` attribute counts too; a word that merely contains "hidden" does not
    expect(hiddenDefects(['<p hidden className={styles.box}>x</p>'], '.box { display: grid; }')).toEqual(['box'])
    expect(hiddenDefects(['<p data-hiddenish="1" className={styles.box}>x</p>'], '.box { display: grid; }')).toEqual([])
  })

  it('I-5: every label-wrapped radio or checkbox shows a focus ring through :has(:focus-visible)', () => {
    const labels = new Set()
    SOURCES.forEach((src) => wrappedInputLabels(src).forEach((c) => labels.add(c)))
    expect([...labels]).toEqual(expect.arrayContaining(['option', 'thumb', 'swatch']))  // non-vacuity
    expect(focusRingDefects(SOURCES, CSS)).toEqual([])
    expect(CSS).not.toMatch(/:focus-within/)
  })

  it('I-5 CONTROL: a wrapped radio without a ring is SEEN', () => {
    const jsx = '<label className={styles.pick}><input type="radio" className={styles.srOnlyInput} /></label>'
    expect(focusRingDefects([jsx], '.pick { color: red; }')).toEqual(['pick'])
    expect(focusRingDefects([jsx], '.pick:has(:focus-visible) { outline: 2px solid red; }')).toEqual([])
  })

  it('I-11: a disabled view dims its drawing and name, never its reason, which reaches 4.5:1 in every theme', () => {
    expect(declOf('.thumbOff', 'opacity')).toBeUndefined()
    expect(ruleOf('.thumbOff svg,\n.thumbOff .thumbLabel')).toBeTruthy()
    const text = declOf('.thumbReason', 'color').value
    for (const theme of THEMES) {
      const bg = colour('var(--bg-elevated)', theme)
      const surface = opaque(bg, parseColor(resolveVars('var(--bg)', VARS[theme])).rgb)
      const ratio = contrast(opaque(colour(text, theme), surface), surface)
      expect(ratio, `${theme}: ${text} on --bg-elevated`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the dimmed last result stays readable: bright text at the dimmed opacity reaches 4.5:1', () => {
    const alpha = Number(declOf('.dimmed', 'opacity').value)
    for (const theme of THEMES) {
      for (const s of ['--bg-base', '--bg-surface']) {
        const surface = opaque(colour(`var(${s})`, theme), parseColor(resolveVars('var(--bg)', VARS[theme])).rgb)
        const fg = colour('var(--text-bright)', theme)
        const ratio = contrast(opaque({ rgb: fg.rgb, alpha: alpha * fg.alpha }, surface), surface)
        expect(ratio, `${theme} on ${s} at opacity ${alpha}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  // Wave 11 campaign dry run, D-W11-007 (axe color-contrast, serious): the rule above checked only
  // --text-bright, and the dimmed preview draws far more than that. A positive figure in the number
  // view (--success-ink via SnapshotFrame's `.up`) measured #23834e on #000 = 4.42:1 at opacity 0.75.
  // No ink token survives 0.75 in every theme (the worst full-strength one is ~5.6:1), so the inks are
  // DERIVED from the stylesheets the preview's views draw with, and each must reach 4.5:1 at the
  // declared opacity. Retest: the campaign's P25 a.05 (a formula broken then fixed) at 1200 and 820.
  it('D-W11-007: every ink the dimmed preview draws reaches 4.5:1 at the dimmed opacity, in every theme', () => {
    const alpha = Number(declOf('.dimmed', 'opacity').value)
    const WIDGETS = join(DIR, '..', 'widgets')
    const sheets = [join(WIDGETS, 'SnapshotFrame.module.css'), join(WIDGETS, 'builtViews', 'builtViews.module.css')]
    const inks = new Set()
    for (const f of sheets) {
      for (const r of parseRules(readFileSync(f, 'utf8'))) {
        for (const d of declarations(r)) if (d.prop === 'color' && /^var\(--/.test(d.value)) inks.add(d.value)
      }
    }
    expect([...inks]).toEqual(expect.arrayContaining(['var(--success-ink)', 'var(--danger-ink)', 'var(--text-dim)'])) // non-vacuity
    const fails = []
    for (const ink of inks) {
      for (const theme of THEMES) {
        for (const s of ['--bg-base', '--bg-surface']) {
          const surface = opaque(colour(`var(${s})`, theme), parseColor(resolveVars('var(--bg)', VARS[theme])).rgb)
          const fg = colour(ink, theme)
          const ratio = contrast(opaque({ rgb: fg.rgb, alpha: alpha * fg.alpha }, surface), surface)
          if (ratio < 4.5) fails.push(`${theme} ${ink} on ${s}: ${ratio.toFixed(2)}`)
        }
      }
    }
    expect(fails, `at opacity ${alpha}`).toEqual([])
  })

  it('D-W11-007 CONTROL: the measured case (--success-ink at 0.75, oled) is under 4.5:1', () => {
    const surface = opaque(colour('var(--bg-base)', 'oled'), parseColor(resolveVars('var(--bg)', VARS.oled)).rgb)
    const fg = colour('var(--success-ink)', 'oled')
    expect(contrast(opaque({ rgb: fg.rgb, alpha: 0.75 * fg.alpha }, surface), surface)).toBeLessThan(4.5)
  })

  it('Task 8.16: the start screen stylesheet guards every class it renders with `hidden`', () => {
    // The gallery's files import ExamplesGallery.module.css, so they are checked against THAT sheet.
    const gallery = ['ExamplesGallery.jsx', 'ExampleCard.jsx', 'miniPreview.jsx'].map((f) => readFileSync(join(DIR, f), 'utf8'))
    const galleryCss = readFileSync(join(DIR, 'ExamplesGallery.module.css'), 'utf8')
    expect([...hiddenClasses(gallery.join('\n'))]).toContain('gallery')               // non-vacuity
    expect(hiddenDefects(gallery, galleryCss)).toEqual([])
    expect(galleryCss).not.toMatch(/:focus-within/)
  })

  it('the touch panel is sized from the visual viewport (--vvh) and sits above the keyboard (--vv-inset)', () => {
    expect(CSS).toMatch(/\.panel\.panel\s*\{[^}]*max-height:\s*min\(92dvh,\s*var\(--vvh/)
    expect(CSS).toMatch(/margin-bottom:\s*var\(--vv-inset/)
  })
})
