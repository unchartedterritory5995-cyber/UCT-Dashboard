// The Journal header's action cluster (Log Trade / ? / account / report /
// settings / More) must FIT a phone: every control on screen, and both header
// menus usable.
//
// ⛔ A STRUCTURAL RAIL, NOT THE VERDICT. jsdom performs no layout, so it cannot
// see where a flex row puts a button at 390 px. The verdict is the real-browser
// walk row B9d (tools/notebook_wave10b_walk.py): at 390 and 820 px, on the
// Notebook, Today, Trades, Calendar, Insights and Compass tabs, every header
// control wholly inside the viewport, the document and the app's <main>
// scroller no wider than themselves, and at 390 the More and Log Trade menus
// opened with a finger -- every item on screen and what a finger at its centre
// lands on. This file asserts the CSS that makes that true exists, in the media
// block that actually applies at the width that broke, with controls proving
// the parser can see an absent fix.
//
// ⚰️ HISTORY. The phone rule used to make `.headerRight` a hidden-scrollbar
// sideways SCROLLER (overflow-x: auto + nowrap), and this file asserted exactly
// that. B9d measured what it did (wave 10 follow-up F1): the settings gear and
// "More" (Community + Accounts -- the only door to Journal Accounts) sat off
// screen at x 358-458 behind a swipe nothing hinted at, and -- because a box
// that scrolls one axis clips the other -- BOTH header menus opened inside the
// 46 px row and were clipped away: a finger at an item's centre landed on the
// menu backdrop. The row now WRAPS instead, and the More menu anchors to the
// row. This file is rewritten to the rule that measured clean; the scroller is
// now asserted ABSENT.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/JournalLayout.module.css'),
  'utf8',
  // Comments out first: a comment inside a rule (or just above one) would be read
  // as part of a selector or a declaration, and a guard that is present would read
  // as absent.
).replace(/\/\*[\s\S]*?\*\//g, '')
const PHONE = 390

/** Bodies of the @media blocks that ACTUALLY APPLY at `width`. */
function mediaBodiesAt(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const cond = m[1]
    const max = /max-width:\s*(\d+)px/.exec(cond)
    const min = /min-width:\s*(\d+)px/.exec(cond)
    if (max && width > Number(max[1])) continue
    if (min && width < Number(min[1])) continue
    let depth = 1
    let i = re.lastIndex
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
    }
    out.push(css.slice(re.lastIndex, i - 1))
  }
  return out
}

/** The stylesheet with every @media block cut out -- the rules for every width. */
function baseRules(css) {
  let out = ''
  let i = 0
  const re = /@media[^{]+\{/g
  let m
  while ((m = re.exec(css))) {
    out += css.slice(i, m.index)
    let depth = 1
    let j = re.lastIndex
    for (; j < css.length && depth > 0; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
    }
    i = j
    re.lastIndex = j
  }
  return out + css.slice(i)
}

/** Does `selector`'s rule body (within the given CSS text) declare `prop`
 *  with a value matching `pattern`? Split, never a template-literal regex (one
 *  silently swallows `\s` -- how NotebookTab.touchTier.test.js's first version
 *  failed against CSS that was already correct). */
function declaresProp(blockText, selector, prop, pattern) {
  const rules = [...blockText.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  for (const [, sels, decls] of rules) {
    const hit = sels.split(',').some((s) => s.trim() === selector)
    if (!hit) continue
    for (const part of decls.split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      if (part.slice(0, colon).trim() !== prop) continue
      if (pattern.test(part.slice(colon + 1).trim())) return true
    }
  }
  return false
}

describe('the Journal header action cluster fits a phone (structural rail; B9d is the verdict)', () => {
  const phoneCss = mediaBodiesAt(CSS, PHONE).join('\n')
  const atPhone = baseRules(CSS) + '\n' + phoneCss

  it('⛔ NON-VACUITY -- a phone-applicable block really was found, and it names the row', () => {
    expect(phoneCss.length).toBeGreaterThan(0)
    expect(phoneCss).toMatch(/headerRight/)
  })

  it('wraps .headerRight on a phone, inside a row that may shrink to the header', () => {
    expect(declaresProp(phoneCss, '.headerRight', 'flex-wrap', /^wrap$/)).toBe(true)
    expect(declaresProp(phoneCss, '.headerRight', 'max-width', /100%/)).toBe(true)
    // min-width: auto would hold the row at its widest control and never let it wrap
    expect(declaresProp(phoneCss, '.headerRight', 'min-width', /^0(px)?$/)).toBe(true)
  })

  it('⛔ .headerRight is NOT a scroller at 390 px -- a box that scrolls one axis clips the menus', () => {
    for (const prop of ['overflow', 'overflow-x', 'overflow-y']) {
      expect(declaresProp(atPhone, '.headerRight', prop, /auto|scroll|hidden|clip/)).toBe(false)
    }
  })

  it('anchors the More menu to the whole row on a phone (the row relative, .moreWrap static)', () => {
    expect(declaresProp(phoneCss, '.headerRight', 'position', /relative/)).toBe(true)
    expect(declaresProp(phoneCss, '.moreWrap', 'position', /static/)).toBe(true)
    // ...while the Log Trade split keeps its own anchor, the first control in the row
    expect(declaresProp(phoneCss, '.logTradeWrap', 'position', /static/)).toBe(false)
  })

  it('⭐ CONTROL -- a phone block without the wrap does NOT satisfy this', () => {
    const withoutFix = '@media (max-width: 640px) { .headerRight { display: flex; max-width: 100%; } }'
    const parsed = mediaBodiesAt(withoutFix, PHONE).join('\n')
    expect(declaresProp(parsed, '.headerRight', 'flex-wrap', /^wrap$/)).toBe(false)
  })

  it('⭐ CONTROL -- the scroller check can see a scroller (the old rule reds it)', () => {
    const oldRule = '@media (max-width: 640px) { .headerRight { flex-wrap: nowrap; overflow-x: auto; } }'
    const parsed = mediaBodiesAt(oldRule, PHONE).join('\n')
    expect(declaresProp(parsed, '.headerRight', 'overflow-x', /auto|scroll|hidden|clip/)).toBe(true)
  })

  it('⭐ CONTROL -- the tablet (820 px) is untouched by the phone-only rule', () => {
    // B9d measured the 820 px header whole and on screen with no phone rule applying;
    // a rule scoped wider than the phone would be an unmeasured change there.
    const tabletCss = mediaBodiesAt(CSS, 820).join('\n')
    expect(declaresProp(tabletCss, '.headerRight', 'flex-wrap', /^wrap$/)).toBe(false)
    expect(declaresProp(tabletCss, '.moreWrap', 'position', /static/)).toBe(false)
  })
})
