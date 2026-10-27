// 11.20 rehearsal R5 (axe serious, color-contrast): the community gallery's ACTIVE chip ("Review queue", a type, a
// style or a category chip) read 1.61:1 -- #f0efea on #dcbb5e -- because `.chip:hover` (two classes' worth of
// specificity) out-ranked `.chipActive` (one) and painted the hovered active chip in `--text` on gold.
//
// A computed rail, not a source match: every rule of TemplateGallery.module.css that applies to an element carrying
// `.chip.chipActive` in a state (at rest, hovered, keyboard-focused) is collected, the cascade picks the winning
// `color` and `background` by specificity then order, the theme's tokens resolve them, and the WCAG ratio is
// computed (contrastMath, the same math tokens.test.js uses) for every theme tokens.css defines.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrast, hexRgb } from '../../../../styles/__tests__/contrastMath'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = read('./TemplateGallery.module.css')
// W11-R74 item 2: the template picker's category chips carry the same `.chip` / `.chipActive` pair.
const SHEETS = { 'TemplateGallery.module.css': CSS, 'TemplatePicker.module.css': read('./TemplatePicker.module.css') }
const TOKENS = read('../../../../styles/tokens.css')

/** Top-level and @media-nested rules, in source order: [{selectors: [...], body}]. */
function rules(css) {
  const out = []
  const walk = (src, media = null) => {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open < 0) break
      const head = src.slice(i, open).trim()
      let depth = 0
      let j = open
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++
        else if (src[j] === '}' && --depth === 0) break
      }
      const body = src.slice(open + 1, j)
      if (head.startsWith('@media')) walk(body, head)
      else if (!head.startsWith('@')) out.push({ selectors: head.split(',').map((s) => s.trim()), body, media })
      i = j + 1
    }
  }
  walk(css)
  return out
}

function block(css, selector) {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no ${selector}`)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(body)
  return m ? m[1].trim() : null
}

/** A compound selector of classes and pseudo-classes only (no combinator): does it match `classes` in `state`? */
function matches(sel, classes, state) {
  if (/[\s>+~[]/.test(sel)) return null                       // not a single-element selector: not ours
  const parts = sel.match(/[.:][\w-]+/g) || []
  if (parts.join('') !== sel) return null
  let spec = 0
  for (const p of parts) {
    if (p[0] === '.') { if (!classes.includes(p.slice(1))) return null }
    else if (p.slice(1) !== state) return null
    spec += 1
  }
  return spec
}

/** The winning value of `prop` for an element with `classes` in `state` (cascade: specificity, then order). */
function winner(prop, classes, state, css = CSS) {
  let best = null
  rules(css).forEach((r, order) => {
    const v = decl(r.body, prop)
    if (v == null) return
    for (const s of r.selectors) {
      const spec = matches(s, classes, state)
      if (spec != null && (!best || spec > best.spec || (spec === best.spec && order >= best.order))) best = { v, spec, order }
    }
  })
  return best?.v ?? null
}

const ROOT = block(TOKENS, ':root')
const THEMES = { dark: [ROOT], oled: [block(TOKENS, '[data-theme="oled"]'), ROOT], light: [block(TOKENS, '[data-theme="light"]'), ROOT] }
function resolve(value, layers) {
  let v = value
  for (let n = 0; n < 10 && /^var\(/.test(v); n++) {
    const name = /^var\((--[\w-]+)/.exec(v)[1]
    v = layers.map((b) => decl(b, name)).find((x) => x != null)
  }
  return v
}

const ACTIVE = ['chip', 'chipActive']
for (const [sheet, css] of Object.entries(SHEETS)) describe(`${sheet}: a chip a member has chosen keeps its words readable (R5)`, () => {
  for (const [theme, layers] of Object.entries(THEMES)) {
    for (const state of ['rest', 'hover', 'focus-visible']) {
      it(`${theme}, ${state}: at least 4.5:1`, () => {
        const fg = resolve(winner('color', ACTIVE, state, css), layers)
        const bg = resolve(winner('background', ACTIVE, state, css), layers)
        expect(fg).toMatch(/^#[0-9a-f]{6}$/i)
        expect(bg).toMatch(/^#[0-9a-f]{6}$/i)
        expect(contrast(hexRgb(fg), hexRgb(bg))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
  it('CONTROL: the matcher sees the hover rule (an inactive chip, hovered, takes --text)', () => {
    expect(winner('color', ['chip'], 'hover', css)).toBe('var(--text)')
    expect(winner('color', ['chip'], 'rest', css)).toBe('var(--text-muted)')
  })
})

// 11.20 rehearsal R6: at 820 the filter chips "All" and "Day" measured 37x44 and 43x44. The touch tier is <=1024px
// (styles/breakpoints.css); there every gallery chip is at least --tap-min in BOTH directions.
describe('every gallery chip is a whole finger target on the touch tier (R6)', () => {
  const touch = rules(CSS).filter((r) => r.media && /max-width:\s*1024px/.test(r.media) && r.selectors.includes('.chip'))
  it('min-width and min-height are var(--tap-min) inside the <=1024px query', () => {
    expect(touch.length).toBeGreaterThan(0)
    expect(touch.map((r) => decl(r.body, 'min-height')).filter(Boolean)).toContain('var(--tap-min)')
    expect(touch.map((r) => decl(r.body, 'min-width')).filter(Boolean)).toContain('var(--tap-min)')
  })
  it('CONTROL: at rest (no media) a chip declares no floor, so the rule above is the touch tier\'s own', () => {
    const rest = rules(CSS).filter((r) => !r.media && r.selectors.includes('.chip'))
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.map((r) => decl(r.body, 'min-width')).filter(Boolean)).toEqual([])
  })
})

// 11.20 walk D4: every gallery card's "Use <name>" button (widget, routine and tracker cards: one word, "Use") measured
// 41x44 at 820 and 390. On the touch tier every gallery button (`.btn`, the cards' Use, Preview and Helpful) is at
// least --tap-min in BOTH directions, its label centred; 1200 is unchanged.
describe('every gallery card button is a whole finger target on the touch tier (walk D4)', () => {
  const touch = rules(CSS).filter((r) => r.media && /max-width:\s*1024px/.test(r.media) && r.selectors.includes('.btn'))
  it('min-width and min-height are var(--tap-min) inside the <=1024px query, the label centred', () => {
    expect(touch.length).toBeGreaterThan(0)
    expect(touch.map((r) => decl(r.body, 'min-height')).filter(Boolean)).toContain('var(--tap-min)')
    expect(touch.map((r) => decl(r.body, 'min-width')).filter(Boolean)).toContain('var(--tap-min)')
    expect(touch.map((r) => decl(r.body, 'justify-content')).filter(Boolean)).toContain('center')
  })
  it('CONTROL: at rest (no media) a card button declares no width floor (the desktop card is unchanged)', () => {
    const rest = rules(CSS).filter((r) => !r.media && r.selectors.includes('.btn'))
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.map((r) => decl(r.body, 'min-width')).filter(Boolean)).toEqual([])
  })
})
