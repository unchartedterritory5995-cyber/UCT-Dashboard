// The notebook search panel's date/sector/theme filter fields must be
// finger-sized on a phone AND a tablet, not just visually present.
//
// ⛔⛔ WHY THIS EXISTS ALONGSIDE `FolderSidebar.test.jsx` AND
// `NotebookTab.touchTier.test.js`. These fields render only once a member
// clicks Search -> the filter toggle (`showFilters`), so a STATIC page-load
// audit (`tools/mobile_audit.py`) never saw them at all -- they were absent
// from every "small-target" report the tool ever produced. Driving the real
// panel at 390px and 1024px (`tools/mobile_audit_out/notebook_flows/` +
// `verify_fixes/`) measured the two date inputs and two selects at 26-31px
// tall, well under the 44px floor, on BOTH widths.
//
// ⛔ ONE SELECTOR PAIR, NOT A ROSTER -- `.searchFilterField input` and
// `.searchFilterField select` are the two node shapes this panel renders
// (date inputs, sector/theme selects); a hand-kept list of every possible
// future filter type is the artifact this repo keeps watching go stale.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Comments stripped BEFORE parsing (styles/tapFloor.test.js's own approach):
// a `/* ... */` block explaining the fix sits directly above the
// comma-separated selector it documents, and a naive `sels.split(',')`
// without this folds the comment text into the first selector chunk --
// `.searchFilterField select` (the chunk with no comment ahead of it)
// matched; `.searchFilterField input` (the chunk right after the comment)
// did not, and read as an absent rule rather than a present one.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/components/notebook/FolderSidebar.module.css'),
  'utf8',
))
const PHONE = 390
const TABLET = 820
const FLOOR = 44

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

/** px value of `prop` on a rule whose selector list contains `selector` as a
 *  full (trimmed) member, resolving `var(--tap-min[, 44px])` to its fallback
 *  (or the 44px floor when no fallback is given, matching this repo's token
 *  default). Mirrors NotebookTab.touchTier.test.js's split-not-regex-match
 *  declValue approach. */
function pxOf(blockText, selector, prop) {
  const rules = [...blockText.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  let best = 0
  for (const [, sels, decls] of rules) {
    const hit = sels.split(',').some((s) => s.trim() === selector)
    if (!hit) continue
    for (const part of decls.split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      if (part.slice(0, colon).trim() !== prop) continue
      const raw = part.slice(colon + 1).trim()
      const varMatch = /var\(\s*--tap-min\s*(?:,\s*(\d+)px\s*)?\)/.exec(raw)
      const pxMatch = /^(\d+)px$/.exec(raw)
      if (varMatch) best = Math.max(best, varMatch[1] ? Number(varMatch[1]) : FLOOR)
      else if (pxMatch) best = Math.max(best, Number(pxMatch[1]))
    }
  }
  return best
}

describe('the notebook search filter fields are finger-sized on phone AND tablet', () => {
  const phone = mediaBodiesAt(CSS, PHONE).join('\n')
  const tablet = mediaBodiesAt(CSS, TABLET).join('\n')

  it('⛔ NON-VACUITY — a touch-applicable block really was found at both widths', () => {
    expect(phone.length).toBeGreaterThan(0)
    expect(tablet.length).toBeGreaterThan(0)
    expect(phone).toMatch(/searchFilterField/)
    expect(tablet).toMatch(/searchFilterField/)
  })

  it('gives the date inputs the floor on both widths', () => {
    expect(pxOf(phone, '.searchFilterField input', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.searchFilterField input', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
  })

  it('gives the sector/theme selects the floor on both widths', () => {
    expect(pxOf(phone, '.searchFilterField select', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.searchFilterField select', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
  })

  it('⭐ CONTROL — a phone-only floor does NOT satisfy the tablet width', () => {
    // The class of defect this repo keeps re-finding: a floor declared only
    // under <=640px leaves the 641-1024 tablet tier -- which breakpoints.css
    // calls touch too -- uncovered.
    const phoneOnly = '@media (max-width: 640px) { .searchFilterField input { min-height: 44px; } }'
    const asTablet = mediaBodiesAt(phoneOnly, TABLET).join('\n')
    expect(pxOf(asTablet, '.searchFilterField input', 'min-height')).toBe(0)
  })
})
