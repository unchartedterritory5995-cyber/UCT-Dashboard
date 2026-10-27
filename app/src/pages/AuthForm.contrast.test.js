// W11-R81 PD-1 (the 50-user campaign, P48 on the Login page, axe serious): "Log In" read 1.73:1, #f8f7f3
// (--text-bright) on #dcbb5e (--ut-gold), and on the touch tier "Log In" was 40 px tall and "Forgot password?" 19 px.
// The shared solid-gold pair is buttons.css's `.btn-primary` (background --accent, ink --bg: dark ink on bright gold
// in dark and OLED, white on the deep gold in light), and the auth form's gold submit now takes exactly that pair.
// A computed rail: the cascade's winning `color` and `background` for `.submit.submitPro` in each state, resolved through
// every theme tokens.css defines, must reach 4.5:1; and inside the <=1024px query both controls hold --tap-min.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrast, hexRgb } from '../styles/__tests__/contrastMath'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = read('./AuthForm.module.css')
const TOKENS = read('../styles/tokens.css')
const BUTTONS = read('../styles/buttons.css')

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
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|[;{\\s])${prop.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(body)
  return m ? m[1].trim() : null
}
function block(css, selector) {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no ${selector}`)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}
/** Does a compound selector (classes and one pseudo-class chain, `:not(...)` ignored) match `classes` in `state`? */
function matches(sel, classes, state) {
  const clean = sel.replace(/:not\([^)]*\)/g, '')
  if (/[\s>+~[]/.test(clean)) return null
  const parts = clean.match(/[.:][\w-]+/g) || []
  if (parts.join('') !== clean) return null
  let spec = 0
  for (const p of parts) {
    if (p[0] === '.') { if (!classes.includes(p.slice(1))) return null } else if (p.slice(1) !== state) return null
    spec += 1
  }
  return spec
}
function winner(prop, classes, state) {
  let best = null
  rules(CSS).filter((r) => !r.media).forEach((r, order) => {
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
const resolve = (value, layers) => {
  let v = value
  for (let n = 0; n < 10 && /^var\(/.test(v || ''); n++) {
    const name = /^var\((--[\w-]+)/.exec(v)[1]
    v = layers.map((b) => decl(b, name)).find((x) => x != null)
  }
  return v
}

// `.submitPro` composes `.submit`: the element carries both classes.
const GOLD = ['submit', 'submitPro']
/** sRGB alpha blend of `top` over `under` (what `opacity` does to a flat button over the card). */
const blend = (top, under, a) => {
  const t = hexRgb(top)
  const u = hexRgb(under)
  return '#' + t.map((c, i) => Math.round(c * a + u[i] * (1 - a)).toString(16).padStart(2, '0')).join('')
}
describe('the Login gold submit is readable in every theme and every state (W11-R81 PD-1, W11-R82 m-2)', () => {
  for (const [theme, layers] of Object.entries(THEMES)) {
    // `disabled` is also the LOADING state ("Logging in...", "Checking..."): the buttons are disabled while they load,
    // and the TOTP "Verify" is disabled until a code is typed. Both carry words a member reads, so they keep 4.5:1.
    for (const state of ['rest', 'hover', 'disabled']) {
      it(`${theme}, ${state}: at least 4.5:1, opacity included (over the card, --bg-surface)`, () => {
        const fg = resolve(winner('color', GOLD, state), layers)
        const bg = resolve(winner('background', GOLD, state), layers)
        const surface = resolve('var(--bg-surface)', layers)
        expect(fg).toMatch(/^#[0-9a-f]{6}$/i)
        expect(bg).toMatch(/^#[0-9a-f]{6}$/i)
        const op = Number(winner('opacity', GOLD, state) ?? 1)
        const f = op < 1 ? blend(fg, surface, op) : fg
        const b = op < 1 ? blend(bg, surface, op) : bg
        expect(contrast(hexRgb(f), hexRgb(b))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
  it('CONTROL: the blend is real (the green .submit at its old disabled opacity 0.6 reads lower than at rest)', () => {
    const [layers] = [THEMES.light]
    const fg = resolve('var(--text-bright)', layers)
    const bg = resolve('var(--ut-green)', layers)
    const surface = resolve('var(--bg-surface)', layers)
    expect(contrast(hexRgb(blend(fg, surface, 0.6)), hexRgb(blend(bg, surface, 0.6))))
      .toBeLessThan(contrast(hexRgb(fg), hexRgb(bg)))
  })
  it('a disabled gold button still says it is disabled without dimming its words (its own cue: not-allowed + a dashed inset ring)', () => {
    expect(winner('cursor', GOLD, 'disabled')).toBe('not-allowed')
    expect(winner('outline', GOLD, 'disabled') || '').toMatch(/dashed/)
  })
  it("takes the shared solid-gold pair, .btn-primary's own (one source, never a third ink)", () => {
    const primary = block(BUTTONS, '.btn-primary')
    expect(winner('color', GOLD, 'rest')).toBe(decl(primary, 'color'))
    expect(winner('background', GOLD, 'rest')).toBe(decl(primary, 'background'))
  })
})

describe('the Login controls hold the 44 px floor on the touch tier (W11-R81 PD-1)', () => {
  const touch = rules(CSS).filter((r) => r.media && /max-width:\s*1024px/.test(r.media))
  for (const cls of ['.submit', '.forgotLink']) {
    it(`${cls}: min-height var(--tap-min) inside the <=1024px query`, () => {
      const hits = touch.filter((r) => r.selectors.includes(cls))
      expect(hits.map((r) => decl(r.body, 'min-height')).filter(Boolean)).toContain('var(--tap-min)')
    })
  }
  it('CONTROL: at rest neither declares the floor (the desktop form is unchanged)', () => {
    const rest = rules(CSS).filter((r) => !r.media && (r.selectors.includes('.submit') || r.selectors.includes('.forgotLink')))
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.map((r) => decl(r.body, 'min-height')).filter(Boolean)).toEqual([])
  })
})

// W11-R84 New-2 (re-walk, axe serious, live on master): the Login page's "Join the launch list" (`.switchLink`) read
// 4.2:1 in dark, --ut-green #2d8c4e on the card's --bg-surface #17181b. Every text link on the auth card (the switch
// link and "Forgot password?", at rest and hovered) reaches 4.5:1 on the card in every theme.
describe('the auth card links are readable in every theme (W11-R84 New-2)', () => {
  for (const [cls, states] of [['switchLink', ['rest', 'hover']], ['forgotLink', ['rest', 'hover']]]) {
    for (const [theme, layers] of Object.entries(THEMES)) {
      for (const state of states) {
        it(`.${cls}, ${theme}, ${state}: at least 4.5:1 on the card`, () => {
          const fg = resolve(winner('color', [cls], state), layers)
          const card = resolve(winner('background', ['card'], 'rest'), layers)
          expect(card).toMatch(/^#[0-9a-f]{6}$/i)
          expect(fg).toMatch(/^#[0-9a-f]{6}$/i)
          expect(contrast(hexRgb(fg), hexRgb(card))).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})
