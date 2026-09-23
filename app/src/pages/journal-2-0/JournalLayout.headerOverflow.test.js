// The Journal header's action cluster (Log Trade / ? / account / report /
// settings / More) must not spill off-screen, unreachable, on a phone.
//
// ⛔⛔ WHY THIS EXISTS ALONGSIDE A RENDERED-COMPONENT TEST. jsdom performs no
// layout, so a `JournalLayout.test.jsx` render cannot see that `.headerRight`
// is 438px wide inside a 350px-wide row at 390px viewport — that fact only
// exists once a real browser lays the flex row out. Driving the real page at
// 390px (`tools/mobile_audit_out/notebook_flows/`) measured `.settingsPill`
// and `.gearIcon` sitting flush against the viewport's right edge and the
// "More" button (Community + Accounts — the only door to Journal Accounts)
// entirely out of frame, with `document.documentElement.scrollWidth` still
// reading 0 extra px (the app shell's `.main` clips horizontally, so the
// overflow is invisible rather than producing a page scrollbar — see
// `styles.headerRight` in JournalLayout.module.css for the fix and why the
// mechanism hides the bug from a page-level overflow check).
//
// This is the CSS-text-parsing style established by
// `tabs/NotebookTab.touchTier.test.js` for exactly this situation: assert the
// declaration exists in the media block that actually applies at the width
// that broke, with a non-vacuity check and a control proving the parser can
// see an absent fix.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/JournalLayout.module.css'),
  'utf8',
)
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

/** Does `selector`'s rule body (within the given CSS text) declare `prop`
 *  with a value matching `pattern`? Mirrors NotebookTab.touchTier.test.js's
 *  declValue split-not-match approach (a template-literal regex silently
 *  swallows `\s`, which is exactly how that file's first version failed
 *  against CSS that was already correct). */
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

describe('the Journal header action cluster is reachable on a phone', () => {
  const phoneCss = mediaBodiesAt(CSS, PHONE).join('\n')

  it('⛔ NON-VACUITY — a phone-applicable block really was found', () => {
    expect(phoneCss.length).toBeGreaterThan(0)
    expect(phoneCss).toMatch(/headerRight/)
  })

  it('makes .headerRight a real horizontal scroll container on phone', () => {
    expect(declaresProp(phoneCss, '.headerRight', 'overflow-x', /auto/)).toBe(true)
    // Without flex-wrap: nowrap the children would just wrap onto new lines
    // inside the row instead of overflowing it — there would be nothing
    // for overflow-x to scroll, and the fix would be a silent no-op.
    expect(declaresProp(phoneCss, '.headerRight', 'flex-wrap', /nowrap/)).toBe(true)
  })

  it('caps the row so it cannot just keep growing past the viewport', () => {
    expect(declaresProp(phoneCss, '.headerRight', 'max-width', /100%/)).toBe(true)
  })

  it('⭐ CONTROL — a media block missing the property does NOT satisfy this', () => {
    const withoutFix = '@media (max-width: 640px) { .headerRight { display: flex; } }'
    const parsed = mediaBodiesAt(withoutFix, PHONE).join('\n')
    expect(declaresProp(parsed, '.headerRight', 'overflow-x', /auto/)).toBe(false)
  })

  it('⭐ CONTROL — the tablet width (1024px) is untouched by the phone-only fix', () => {
    // Real-browser evidence (mobile_audit.py + a direct measurement) found
    // NO overflow at 820/1024px — .headerRight already fits there. A fix
    // scoped wider than phone would be an unreviewed behavior change to a
    // layout that already works.
    const tabletCss = mediaBodiesAt(CSS, 1024).join('\n')
    expect(declaresProp(tabletCss, '.headerRight', 'overflow-x', /auto/)).toBe(false)
  })
})
