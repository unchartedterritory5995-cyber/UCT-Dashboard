// W4 step 2 — the hub's motion has ONE vocabulary, and every transition speaks it.
//
// ⛔⛔ THE DEFECT THIS PINS IS DRIFT, NOT UGLINESS. Measured from `hub.module.css` before this
// landed (comments stripped): 8 `transition` declarations, of which **2 named a curve and 3
// relied on the browser default**. The two named ones were
// `cubic-bezier(0.34, 1.56, 0.64, 1)` at 0.28s and `cubic-bezier(0.34, 1.4, 0.64, 1)` at 0.26s —
// a difference of **0.16 of overshoot and 20 ms**, which no thumb can feel and no eye can see.
// That is not two considered motions. It is one motion typed twice, drifted, and nobody noticed
// because nothing compared them.
//
// ⭐ A LITERAL CURVE IS WHERE DRIFT COMES FROM. Two call sites holding their own copy of a value
// is the second-authority defect this repo keeps paying for, and motion is the case where it is
// least visible: the two curves render almost identically, so the drift produces no symptom until
// someone tries to tune "the" spring and finds there are two.
//
// ⛔ AND THE COUNT IS PINNED AT TWO ON PURPOSE. Collapsing them to one is a change a member could
// feel, so it must be a deliberate, visible act in a tuning commit — not something that arrives
// inside a rename. This rail goes red when the count changes in EITHER direction.
import { describe, it as vitestIt, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const CSS = readFileSync(path.join(HUB, 'hub.module.css'), 'utf8')
const TOKENS = readFileSync(path.join(HUB, '..', 'styles', 'tokens.css'), 'utf8')

/** ⛔ CODE, NEVER PROSE. A stylesheet's comments quote its own declarations — this file's own
 *  header quotes both curves — so a scan that does not strip comments reports a property of the
 *  commentary as a property of the product. Six instances of exactly that in one session. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ')
const CSS_CODE = strip(CSS)

describe('the hub has one motion vocabulary', () => {
  it('CONTROL — the scan can see a literal curve, so its absence below means something', () => {
    const planted = strip('.x { transition: transform 1s cubic-bezier(0.1, 0.2, 0.3, 0.4); }')
    expect(planted.match(/cubic-bezier\([^)]*\)/g), 'the matcher cannot find a planted curve — '
      + 'every "none found" result in this file would be vacuous').toHaveLength(1)
    // ...and it must NOT find one that is only mentioned in a comment.
    const commented = strip('/* we used to use cubic-bezier(0.34, 1.56, 0.64, 1) here */ .x { color: red; }')
    expect(commented.match(/cubic-bezier\([^)]*\)/g),
      'the matcher counts a curve quoted in prose — it is measuring the comments').toBeNull()
  })

  it('⛔ no literal cubic-bezier survives in the hub stylesheet', () => {
    const literals = CSS_CODE.match(/cubic-bezier\([^)]*\)/g) || []
    expect(literals, `a curve is written inline instead of using a token: ${literals.join(', ')}`)
      .toEqual([])
  })

  it('⛔ every transition NAMES its curve — none falls back to the browser default', () => {
    // `transition: opacity 0.18s` is not "no easing", it is `ease`, chosen by omission. Stating
    // it is what makes the next question ("should this be a spring?") answerable from the file.
    const bare = []
    for (const m of CSS_CODE.matchAll(/transition:\s*([^;]+);/g)) {
      const value = m[1].trim()
      if (value === 'none') continue // the deliberate mid-drag suppressions
      for (const part of value.split(',')) {
        if (!/var\(--hub-(ease|spring|spring-soft)\)/.test(part)) bare.push(part.trim())
      }
    }
    expect(bare, 'these transition parts name no timing function, so they silently get `ease`')
      .toEqual([])
  })

  it('⛔ EXACTLY TWO spring tokens — collapsing them must be a visible act, never a rename', () => {
    const springs = [...strip(TOKENS).matchAll(/(--hub-spring[a-z-]*)\s*:/g)].map((m) => m[1]).sort()
    expect(springs, 'the spring vocabulary changed size. If this is the deliberate collapse of '
      + 'the two drifted curves into one, update this assertion IN THAT COMMIT and say so — that '
      + 'is the whole point of pinning it.').toEqual(['--hub-spring', '--hub-spring-soft'])
  })

  it('every motion token the stylesheet uses is actually defined', () => {
    const used = new Set([...CSS_CODE.matchAll(/var\((--hub-(?:ease|spring)[a-z-]*)\)/g)].map((m) => m[1]))
    expect(used.size, 'the stylesheet uses no motion token — this rail is asserting nothing')
      .toBeGreaterThan(0)
    const defined = new Set([...strip(TOKENS).matchAll(/(--hub-(?:ease|spring)[a-z-]*)\s*:/g)].map((m) => m[1]))
    const missing = [...used].filter((t) => !defined.has(t)).sort()
    expect(missing, 'a motion token is used but defined nowhere — an undefined var() in a '
      + 'transition shorthand makes the whole declaration invalid, so the element simply snaps')
      .toEqual([])
  })

  it('⚠️ the two curves are still the near-identical pair, and that is RECORDED not hidden', () => {
    // If someone retunes one of them, this goes red and they are told to retune both or to
    // collapse them — which is the conversation this whole file exists to force.
    const t = strip(TOKENS)
    expect(t).toContain('--hub-spring: cubic-bezier(0.34, 1.56, 0.64, 1)')
    expect(t).toContain('--hub-spring-soft: cubic-bezier(0.34, 1.4, 0.64, 1)')
  })
})
