// app/src/components/research/EarningsResearchModal.tapFloor.test.js
//
// `--tap-min` is 44px and this repo treats it as a floor for TOUCH targets.
// Twice in one session I shrank an interactive control for desktop density and
// took the touch target down with it:
//
//   .stepBtn  26x26 at 390px  ('Previous reporter' / 'Next reporter')
//   .btnChart 85x26 at 820px  ('View chart for DELL')  <- restored at <=640px
//                                                         only, so TABLET kept
//                                                         a 26px-tall target
//
// Both shipped green: jsdom computes no layout, so no rendering test can see a
// tap target at all. `tools/mobile_audit.py` found them by COUNT and a probe
// named them. This rail is the cheap standing check between those runs.
//
// ⛔ IT READS THE STYLESHEET, NOT THE DOM, and that is the point — it is the
// only instrument available here that can see a size at all.
//
// ⛔ THE RULE IS DERIVED: any selector in these files that pins a min-width or
// min-height to a literal BELOW 44px must restore `var(--tap-min)` inside a
// `max-width: 1024px` block — the canonical TOUCH bound (breakpoints.css), not
// the 640px phone bound. A floor restored at only one of the two touch tiers
// is not a floor; that is exactly how `.btnChart` stayed broken on tablet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = [
  join(process.cwd(), 'src', 'components', 'research', 'EarningsResearchModal.module.css'),
  join(process.cwd(), 'src', 'components', 'research', 'SectionTabs.module.css'),
]

const TAP_MIN = 44
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `@media` block whose condition covers the touch tier, concatenated. */
function touchBlocks(css) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    // A block only counts if it reaches 1024px — a 640px-only block leaves
    // tablet uncovered, which is the bug this rail exists for.
    if (!max || Number(max[1]) < 1024) continue
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

/** [selector, body] for top-level rules, selector collapsed to one line. */
function rules(css) {
  const out = []
  let i = 0
  for (;;) {
    const brace = css.indexOf('{', i)
    if (brace < 0) break
    const sel = css.slice(i, brace).replace(/\s+/g, ' ').trim()
    let depth = 1
    let j = brace + 1
    while (j < css.length && depth) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    out.push([sel, css.slice(brace + 1, j - 1)])
    i = j
  }
  return out
}

describe('touch targets keep the 44px floor', () => {
  for (const file of FILES) {
    const name = file.split(/[\\/]/).pop()
    const raw = stripComments(readFileSync(file, 'utf8'))
    // Everything outside a media query — the base, i.e. what tablet gets too.
    const base = raw.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    const touch = touchBlocks(raw)

    it(`${name}: every shrunken interactive size is restored on TOUCH`, () => {
      const offenders = []
      for (const [sel, body] of rules(base)) {
        if (sel.startsWith('@') || sel.startsWith(':')) continue
        for (const m of body.matchAll(/min-(?:width|height):\s*(\d+)px/g)) {
          if (Number(m[1]) >= TAP_MIN) continue
          // The class must reappear with var(--tap-min) in a <=1024px block.
          const cls = (sel.match(/\.[A-Za-z0-9_-]+/) || [])[0]
          if (!cls) continue
          const restored = new RegExp(
            `\\${cls}[^{}]*\\{[^{}]*min-(?:width|height):\\s*var\\(--tap-min\\)`, 's',
          ).test(touch)
          if (!restored) offenders.push(`${sel} sets min-*: ${m[1]}px with no touch restore`)
        }
      }
      expect(offenders, `sub-44px touch targets:\n${offenders.join('\n')}`).toEqual([])
    })
  }

  it('CONTROL: the probe can SEE a violation — it is not passing vacuously', () => {
    // A derivation that silently matches nothing would pass every assertion
    // above. Feed it a stylesheet with a known offender and a known-good pair.
    const bad = '.x { min-height: 26px; }\n@media (max-width: 1024px) { .y { min-height: var(--tap-min); } }'
    const good = '.x { min-height: 26px; }\n@media (max-width: 1024px) { .x { min-height: var(--tap-min); } }'
    const check = (css) => {
      const base = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
      const touch = touchBlocks(css)
      const hits = []
      for (const [sel, body] of rules(base)) {
        for (const m of body.matchAll(/min-(?:width|height):\s*(\d+)px/g)) {
          if (Number(m[1]) >= TAP_MIN) continue
          const cls = (sel.match(/\.[A-Za-z0-9_-]+/) || [])[0]
          const ok = new RegExp(`\\${cls}[^{}]*\\{[^{}]*min-(?:width|height):\\s*var\\(--tap-min\\)`, 's').test(touch)
          if (!ok) hits.push(sel)
        }
      }
      return hits
    }
    expect(check(bad)).toEqual(['.x'])   // sees the violation
    expect(check(good)).toEqual([])      // and clears the fixed form
  })

  it('CONTROL: a 640px-only restore does NOT satisfy the floor', () => {
    // The `.btnChart` bug exactly: restored on phone, still 26px on tablet.
    const phoneOnly = '.x { min-height: 26px; }\n@media (max-width: 640px) { .x { min-height: var(--tap-min); } }'
    expect(touchBlocks(phoneOnly)).toBe('')
  })
})
