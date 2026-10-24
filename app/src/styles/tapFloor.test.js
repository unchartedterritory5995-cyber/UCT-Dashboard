// app/src/styles/tapFloor.test.js
//
// APP-WIDE: no stylesheet may declare a finger target on the PHONE only.
//
// `--tap-min` is 44px and this repo's breakpoints.css calls EVERYTHING at or
// below 1024px touch — phone AND tablet. Dozens of stylesheets restored the
// floor inside a `max-width: 640px` block and nowhere else, so on a tablet
// those controls rendered at 22-29px. Measured with `tools/mobile_audit.py`
// across 28 routes before the sweep: 360 sub-44px targets at 820px, against
// 15 at 390px. Tablet was not a smaller phone; it was uncovered.
//
// ⛔ THE RULE IS A RELATIONSHIP, NOT A ROSTER. Whatever a file declares a
// finger target at 390px it must also declare at 820px. A hand-maintained
// list of "files to check" is the artifact this repo keeps watching go stale;
// this walks every stylesheet each run, so a file added tomorrow is covered.
//
// ⛔ WHAT THIS CANNOT DO: it reads declarations, not rendered boxes. jsdom
// computes no layout, so a class can satisfy this and still render small (a
// `min-height` on an inline <a> is inert). It is the cheap standing check;
// `tools/mobile_audit.py` + a naming probe remain the ground truth. Passing
// here is necessary, not sufficient.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.css')) out.push(p)
  }
  return out
}

/** Bodies of every `@media` block that ACTUALLY APPLIES at `width`.
 *  ⛔ Not "max-width <= bound": a `<=1024px` query also matches 390, which
 *  makes the phone set a trivial subset of the touch set and the whole check
 *  a tautology. That bug shipped once here and its own control caught it. */
function mediaBodies(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    const applies = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    if (applies) out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}

const withoutMedia = (css) => css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

/** Classes pinned to `var(--tap-min)`. The TARGET is the LAST class in each
 *  comma-separated part — `.bar .input` styles the INPUT, and naming `.bar`
 *  sends the next reader to fix a container that was never broken. */
function tapTargetClasses(blockText) {
  const found = new Set()
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(blockText))) {
    const [, sel, body] = m
    if (!/min-(?:width|height):\s*var\(--tap-min/.test(body)) continue
    for (const part of sel.split(',')) {
      const classes = part.match(/\.[A-Za-z][A-Za-z0-9_-]*/g)
      if (classes) found.add(classes[classes.length - 1])
    }
  }
  return found
}

function phoneOnlyTargets(css) {
  const clean = stripComments(css)
  const phone = tapTargetClasses(mediaBodies(clean, 390))
  const tablet = tapTargetClasses(mediaBodies(clean, 820))
  const base = tapTargetClasses(withoutMedia(clean))
  return [...phone].filter((c) => !tablet.has(c) && !base.has(c)).sort()
}

const FILES = walk(SRC).filter((f) => !f.endsWith('.test.js'))

describe('the 44px touch floor covers TABLET, not just phone', () => {
  it('some stylesheet declares finger targets at all (non-vacuity)', () => {
    // Without this, a walk that found nothing would satisfy every assertion.
    const declaring = FILES.filter((f) => readFileSync(f, 'utf8').includes('--tap-min'))
    expect(declaring.length).toBeGreaterThan(10)
  })

  it('no stylesheet declares a finger target on the PHONE only', () => {
    const offenders = []
    for (const f of FILES) {
      const css = readFileSync(f, 'utf8')
      if (!css.includes('--tap-min')) continue
      const gap = phoneOnlyTargets(css)
      if (gap.length) {
        offenders.push(`${f.slice(SRC.length + 1).replace(/\\/g, '/')}: ${gap.join(', ')}`)
      }
    }
    expect(
      offenders,
      `declared a finger target at <=640px but not at <=1024px — tablet is touch too:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('CONTROL: the derivation SEES a phone-only class', () => {
    const bad = [
      '@media (max-width: 640px) { .a { min-height: var(--tap-min); } .b { min-height: var(--tap-min); } }',
      '@media (max-width: 1024px) { .a { min-height: var(--tap-min); } }',
    ].join('\n')
    expect(phoneOnlyTargets(bad)).toEqual(['.b'])
  })

  it('CONTROL: a base-rule floor counts as covered at every width', () => {
    const base = '.c { min-height: var(--tap-min); }\n@media (max-width: 640px) { .c { min-height: var(--tap-min); } }'
    expect(phoneOnlyTargets(base)).toEqual([])
  })

  it('CONTROL: an ancestor in a descendant selector is not reported', () => {
    // `.bar .input` styles the input; `.bar` is a container.
    const desc = '@media (max-width: 640px) { .bar .input { min-height: var(--tap-min); } }'
    expect(phoneOnlyTargets(desc)).toEqual(['.input'])
  })
})

// Wave 8 (Task 8.15): the widget builder. Its controls are the member-facing surface of built widgets, and spec 5.11
// requires every one of them -- view thumbnails and chip remove buttons included -- to be a 44px target at EVERY
// touch tier. The rule above only catches a phone-only floor; it says nothing about a control with NO floor. This
// derives the builder's controls from its own stylesheet (every class whose rule sets `cursor: pointer`), so a
// control added tomorrow is covered the day it lands, and asks that each is floored at 390 AND 820.
const BUILDER_CSS = join(SRC, 'pages', 'journal-2-0', 'components', 'notebook', 'widgetBuilder', 'WidgetBuilderSheet.module.css')

/** Classes whose rule declares `cursor: pointer` (the last class of each comma-separated part, as above). */
function clickableClasses(css) {
  const found = new Set()
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(withoutMedia(css)))) {
    if (!/cursor:\s*pointer/.test(m[2])) continue
    for (const part of m[1].split(',')) {
      const classes = part.match(/\.[A-Za-z][A-Za-z0-9_-]*/g)
      if (classes) found.add(classes[classes.length - 1])
    }
  }
  return found
}

function unflooredAt(css, width) {
  const clean = stripComments(css)
  const floored = new Set([...tapTargetClasses(mediaBodies(clean, width)), ...tapTargetClasses(withoutMedia(clean))])
  return [...clickableClasses(clean)].filter((c) => !floored.has(c)).sort()
}

describe('the widget builder floors every control at 44px on touch', () => {
  it('the builder has clickable controls at all (non-vacuity)', () => {
    const classes = clickableClasses(stripComments(readFileSync(BUILDER_CSS, 'utf8')))
    for (const c of ['.chip', '.chipRemove', '.thumb', '.option', '.btnPrimary', '.summaryBar']) expect(classes).toContain(c)
  })

  it('every clickable class is floored at phone AND tablet width', () => {
    const css = readFileSync(BUILDER_CSS, 'utf8')
    expect(unflooredAt(css, 390), 'no 44px floor at 390px').toEqual([])
    expect(unflooredAt(css, 820), 'no 44px floor at 820px').toEqual([])
  })

  it('CONTROL: a clickable class with no floor is SEEN', () => {
    const bad = '.a { cursor: pointer; } .b { cursor: pointer; }\n@media (max-width: 1024px) { .a { min-height: var(--tap-min); } }'
    expect(unflooredAt(bad, 390)).toEqual(['.b'])
    expect(unflooredAt(bad, 820)).toEqual(['.b'])
    const phoneOnly = '.a { cursor: pointer; }\n@media (max-width: 640px) { .a { min-height: var(--tap-min); } }'
    expect(unflooredAt(phoneOnly, 820)).toEqual(['.a'])
  })
})

// Wave 8 (Task 8.17): My tools. The owner's bar for it is "every control is 44 px or larger", at EVERY width, so this
// asks more than the builder rail does: each clickable class (derived from the stylesheet, as above) must be floored at
// 390, 820 AND 1200 px, which in practice means in its base rule.
const MY_TOOLS_CSS = join(SRC, 'pages', 'journal-2-0', 'components', 'notebook', 'myTools', 'myTools.module.css')

describe('My tools floors every control at 44px at every width', () => {
  it('My tools has clickable controls at all (non-vacuity)', () => {
    const classes = clickableClasses(stripComments(readFileSync(MY_TOOLS_CSS, 'utf8')))
    for (const c of ['.btn', '.btnPrimary', '.btnDanger', '.filter', '.moreBtn', '.backBtn', '.linkBtn', '.noteLink']) {
      expect(classes).toContain(c)
    }
  })

  it('every clickable class is floored at phone, tablet AND desktop width', () => {
    const css = readFileSync(MY_TOOLS_CSS, 'utf8')
    expect(unflooredAt(css, 390), 'no 44px floor at 390px').toEqual([])
    expect(unflooredAt(css, 820), 'no 44px floor at 820px').toEqual([])
    expect(unflooredAt(css, 1200), 'no 44px floor at 1200px').toEqual([])
  })

  it('CONTROL: a control floored on touch only is SEEN at desktop width', () => {
    const touchOnly = '.a { cursor: pointer; }\n@media (max-width: 1024px) { .a { min-height: var(--tap-min); } }'
    expect(unflooredAt(touchOnly, 820)).toEqual([])
    expect(unflooredAt(touchOnly, 1200)).toEqual(['.a'])
  })
})
