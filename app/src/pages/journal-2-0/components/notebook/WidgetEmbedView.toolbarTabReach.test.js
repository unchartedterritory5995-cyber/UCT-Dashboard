// Finish program, lane KEYS: the chart toolbar in a note is reachable by forward Tab.
//
// It was `display: none` until hover or focus inside the chart. A hidden element is not a Tab
// stop, and the toolbar sits BEFORE the chart body, so forward Tab passed it while it was
// hidden: on a wide screen 600 Tab presses never reached Plan (docs/notebook/fin-clicks.md).
//
// The rule now: the toolbar is always laid out and focusable; at rest it is only made
// invisible and click-transparent, and hover, focus inside the frame, selection, draw mode,
// a tour, touch and the <= 1024 px tier show it. jsdom applies no stylesheet, so this rail
// reads the rules themselves.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'WidgetEmbedView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function rules(source) {
  const out = []
  const re = /([^{}@]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(source))) out.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] })
  return out
}
const top = rules(css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''))
const media = (query) => {
  const m = new RegExp(`@media\\s*\\(${query}\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*)`).exec(css)
  return m ? rules(m[1]) : []
}
const decl = (body, prop) => (new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body) || [])[1]?.trim()

describe('the chart toolbar is a Tab stop even while it is not shown', () => {
  const base = top.filter((r) => r.selectors.length === 1 && r.selectors[0] === '.toolbar')

  it('the resting rule is found (the parser is not vacuous)', () => {
    expect(base.length).toBe(1)
  })

  it('at rest it is laid out, never display:none (a hidden element cannot take focus)', () => {
    expect(decl(base[0].body, 'display')).toBe('inline-flex')
    expect(/display\s*:\s*none/.test(base[0].body)).toBe(false)
    expect(/visibility\s*:\s*hidden/.test(base[0].body)).toBe(false)
  })

  it('at rest it is invisible and cannot take a click meant for the chart under it', () => {
    expect(decl(base[0].body, 'opacity')).toBe('0')
    expect(decl(base[0].body, 'pointer-events')).toBe('none')
  })

  it('hover, focus inside the frame, selection and draw mode show it and make it clickable', () => {
    const show = top.filter((r) => decl(r.body, 'opacity') === '1' && decl(r.body, 'pointer-events') === 'auto')
    const selectors = show.flatMap((r) => r.selectors)
    for (const s of ['.frame:hover .toolbar', '.frame:focus-within .toolbar', '.selected .toolbar', '.annotating .toolbar']) {
      expect(selectors).toContain(s)
    }
  })

  it('a tour pointing at the chart shows it', () => {
    const selectors = top.filter((r) => decl(r.body, 'opacity') === '1').flatMap((r) => r.selectors)
    expect(selectors.some((s) => /\.frame\[data-tour-active\] \.toolbar/.test(s))).toBe(true)
    expect(selectors.some((s) => /\.frame:has\(\[data-tour-active\]\) \.toolbar/.test(s))).toBe(true)
  })

  it.each([['hover: none'], ['max-width: 1024px']])('@media (%s): always shown and clickable', (q) => {
    const r = media(q.replace(/[()]/g, '\\$&')).filter((x) => x.selectors.includes('.toolbar'))
    expect(r.length).toBeGreaterThan(0)
    expect(decl(r[0].body, 'opacity')).toBe('1')
    expect(decl(r[0].body, 'pointer-events')).toBe('auto')
  })

  it('the buttons inside are not taken out of the Tab order by the stylesheet', () => {
    const btn = top.filter((r) => r.selectors.some((s) => s === '.toolBtn' || s === '.toolSelect'))
    for (const r of btn) {
      expect(/display\s*:\s*none/.test(r.body)).toBe(false)
      expect(/visibility\s*:\s*hidden/.test(r.body)).toBe(false)
    }
  })
})
