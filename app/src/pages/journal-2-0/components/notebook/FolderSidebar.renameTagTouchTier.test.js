// Wave 6 lane E fix round 3, M7 (remainder) — the tag-rename controls
// (`.renameTagBtn`, `.tagRenameActionBtn`, `.tagRenameInput`, added round 2
// for I4/M7) must be finger-sized, and the input's text must clear iOS's
// 16px focus-zoom threshold, on BOTH phone and tablet.
//
// ⛔⛔ WHY THIS FILE EXISTS ALONGSIDE `app/src/styles/tapFloor.test.js`. That
// app-wide rail only checks that whatever a stylesheet declares at <=640px it
// ALSO declares at <=1024px — a RELATIONSHIP between the two tiers, not a
// floor value. Remove `min-height: var(--tap-min)` from BOTH the phone block
// and the touch-tier block for these three classes and that rail stays green
// (phone and tablet still "agree" — they agree on having nothing). This file
// pins the ABSOLUTE floor (>=44px) on the three classes the round-2 re-review
// named, at both measured widths, so an agreement-only check cannot mask a
// floor that quietly vanished from both tiers at once.
//
// ⛔ THE FONT GAP THIS FOUND: `.tagRenameInput` carried `font-size: 16px` in
// the phone block (<=640px) but only `min-height` — no font-size — in the
// touch-tier block (<=1024px), so a tablet fell back to the base rule's 12px
// and re-triggered iOS Safari's zoom-on-focus for any tablet running iOS
// (iPadOS reports as a "tablet" width here). The brief's own rule is stricter
// than "phone has it": 16px on the WHOLE touch tier, tablet included.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(readFileSync(
  join(process.cwd(), 'src/pages/journal-2-0/components/notebook/FolderSidebar.module.css'),
  'utf8',
))
const PHONE = 390
const TABLET = 820
const FLOOR = 44
const MIN_FONT = 16

/** Bodies of the @media blocks that ACTUALLY APPLY at `width` (mirrors
 *  FolderSidebar.searchFiltersTouchTier.test.js's own helper). */
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
 *  (or the 44px floor when no fallback is given). Takes the LARGEST match
 *  across every applicable block, so a base rule plus a media override both
 *  count. */
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

describe('M7 (wave 6 fix round 3): the tag-rename controls are finger-sized, and the input avoids iOS zoom, on phone AND tablet', () => {
  const phone = mediaBodiesAt(CSS, PHONE).join('\n')
  const tablet = mediaBodiesAt(CSS, TABLET).join('\n')

  it('⛔ NON-VACUITY — a touch-applicable block really was found at both widths, and it mentions these classes', () => {
    expect(phone.length).toBeGreaterThan(0)
    expect(tablet.length).toBeGreaterThan(0)
    expect(phone).toMatch(/tagRenameInput/)
    expect(tablet).toMatch(/tagRenameInput/)
  })

  it('gives the rename pencil button the ABSOLUTE floor on both widths', () => {
    expect(pxOf(phone, '.renameTagBtn', 'min-width')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(phone, '.renameTagBtn', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.renameTagBtn', 'min-width')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.renameTagBtn', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
  })

  it('gives the Rename/Cancel action buttons the ABSOLUTE floor on both widths', () => {
    expect(pxOf(phone, '.tagRenameActionBtn', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.tagRenameActionBtn', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
  })

  it('gives the rename text input the ABSOLUTE floor on both widths', () => {
    expect(pxOf(phone, '.tagRenameInput', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
    expect(pxOf(tablet, '.tagRenameInput', 'min-height')).toBeGreaterThanOrEqual(FLOOR)
  })

  it('gives the rename text input a >=16px font on the WHOLE touch tier, tablet included — no iOS focus-zoom', () => {
    expect(pxOf(phone, '.tagRenameInput', 'font-size')).toBeGreaterThanOrEqual(MIN_FONT)
    expect(pxOf(tablet, '.tagRenameInput', 'font-size')).toBeGreaterThanOrEqual(MIN_FONT)
  })

  it('⭐ CONTROL — a phone-only floor does NOT satisfy the tablet width', () => {
    const phoneOnly = '@media (max-width: 640px) { .renameTagBtn { min-height: 44px; } }'
    const asTablet = mediaBodiesAt(phoneOnly, TABLET).join('\n')
    expect(pxOf(asTablet, '.renameTagBtn', 'min-height')).toBe(0)
  })

  it('⭐ CONTROL — a phone-only 16px font does NOT satisfy the tablet width', () => {
    const phoneOnly = '@media (max-width: 640px) { .tagRenameInput { font-size: 16px; } }'
    const asTablet = mediaBodiesAt(phoneOnly, TABLET).join('\n')
    expect(pxOf(asTablet, '.tagRenameInput', 'font-size')).toBe(0)
  })
})
