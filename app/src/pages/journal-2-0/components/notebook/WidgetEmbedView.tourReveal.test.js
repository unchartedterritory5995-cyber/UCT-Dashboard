// W14-Q2: the chart embed's toolbar is revealed on hover on a computer, and a walkthrough
// cannot hover, so in a real browser at 1200 px "Chart plan basics" showed 1 of its 6 steps
// (Draw and Plan had no box and were skipped; the panel steps after Plan never appeared). The
// fix is one CSS rule: the toolbar shows while the tour points at the chart or at anything in
// it. jsdom applies no stylesheet, so this rail reads the rule itself, and it reads the
// marker's NAME from the engine rather than restating it, so the two cannot drift.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'WidgetEmbedView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const engine = readFileSync(join(here, 'onboarding', 'GenericTourEngine.jsx'), 'utf8')

function rulesFor(selectorPart) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim())
    if (selectors.some((s) => s.includes(selectorPart))) out.push({ selectors, body: m[2] })
  }
  return out
}

describe('a walkthrough step on the chart embed can see its toolbar', () => {
  const attr = (/const ACTIVE_ATTR = '([^']+)'/.exec(engine) || [])[1]

  it('the engine still marks its target with an attribute (read from the engine)', () => {
    expect(attr).toBeTruthy()
  })

  it('the toolbar shows while the frame is the target, or holds the target', () => {
    const reveal = rulesFor(`[${attr}]`).filter((r) => /display:\s*inline-flex/.test(r.body))
    const selectors = reveal.flatMap((r) => r.selectors)
    expect(selectors).toContain(`.frame[${attr}] .toolbar`)
    expect(selectors).toContain(`.frame:has([${attr}]) .toolbar`)
  })

  it('control: the hover reveal it complements is still there (the rule is read, not assumed)', () => {
    const hover = rulesFor('.frame:hover .toolbar')
    expect(hover.length).toBeGreaterThan(0)
  })
})
