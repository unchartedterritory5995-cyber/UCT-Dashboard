/* The Company Panel's default width must fit its own header chrome.
   Regression: at DEFAULT_RIGHT_W=360 the tab strip (`overflow-x: auto`) did not
   push back when the five labels + the search button overflowed -- it scrolled,
   and the "News" tab slid under the search control, clipped mid-word, in the
   DEFAULT position. Reported from production 8 Sep 2026. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RIGHT_W, MIN_RIGHT_W, TABSTRIP_FIT_W, COMPANY_TABS, normalizeDock,
} from './chartDock'

describe('company panel width', () => {
  it('opens wide enough for the whole tab strip', () => {
    expect(DEFAULT_RIGHT_W).toBeGreaterThanOrEqual(TABSTRIP_FIT_W)
  })

  it('still allows a deliberately narrow panel', () => {
    // The feed is designed down to 300px; dragging narrow is a user choice and
    // scrolling tabs is the accepted trade there. Only the DEFAULT must fit.
    expect(MIN_RIGHT_W).toBeLessThan(DEFAULT_RIGHT_W)
  })

  it('keeps News as the last tab the strip has to fit', () => {
    // If a tab is ever appended after News, TABSTRIP_FIT_W is stale.
    expect(COMPANY_TABS.at(-1).key).toBe('news')
    expect(COMPANY_TABS).toHaveLength(5)
  })

  it('migrates every previously shipped default forward', () => {
    // 360 clipped the News tab; 400 left dead space after the search control.
    // Neither was chosen by the user, so neither should outlive the default.
    for (const shipped of [360, 400]) {
      expect(normalizeDock({ rightW: shipped }).rightW).toBe(DEFAULT_RIGHT_W)
    }
  })

  it('leaves no dead space after the search control', () => {
    // The strip hugs its content now, so any slack piles up at the right edge.
    expect(DEFAULT_RIGHT_W - TABSTRIP_FIT_W).toBeLessThanOrEqual(12)
  })

  it('does not touch a width the user actually chose', () => {
    expect(normalizeDock({ rightW: 520 }).rightW).toBe(520)
    expect(normalizeDock({ rightW: 300 }).rightW).toBe(300)
  })

  it('falls back to the default when nothing is stored', () => {
    expect(normalizeDock({}).rightW).toBe(DEFAULT_RIGHT_W)
    expect(normalizeDock(null).rightW).toBe(DEFAULT_RIGHT_W)
  })
})

/* The search control is spaced like one more tab. Two numbers in two different
   CSS rules have to agree for that to hold, and nothing but a comment was
   keeping them together -- so read the stylesheet and check. */
describe('company panel header spacing', () => {
  // vitest root is app/; import.meta.url is not a file: URL under the transform.
  const css = readFileSync(
    resolve(process.cwd(), 'src/pages/charts/widgets/ChartDetailDock.module.css'),
    'utf8',
  )
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))

  it('gaps the search control exactly like the gap between two tabs', () => {
    const tabPad = /padding:\s*0\s+(\d+)px/.exec(block('.rdTab {'))
    const searchMargin = /margin:\s*0\s+\d+px\s+0\s+(\d+)px/.exec(block('.rdSearch {'))
    expect(tabPad, '.rdTab padding not found').toBeTruthy()
    expect(searchMargin, '.rdSearch margin not found').toBeTruthy()
    // label-to-label gap = 9 + 9; News-to-search gap = 9 (tab pad) + margin-left
    expect(Number(searchMargin[1])).toBe(Number(tabPad[1]))
  })

  it('does not let the tab strip grow and push search to the far edge', () => {
    // `flex: 1` here made the gap after News widen with the panel.
    expect(block('.rdTabs {')).toMatch(/flex:\s*0\s+1\s+auto/)
  })
})
