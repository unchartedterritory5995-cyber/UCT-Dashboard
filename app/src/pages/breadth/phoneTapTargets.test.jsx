/**
 * 🔴 PHONE WIDTH HAD NEVER BEEN LOOKED AT, AND WHAT BROKE WAS NOT THE LAYOUT.
 *
 * Rendered at 390×844 in real Chromium, this tab has NO horizontal overflow —
 * the switcher's own `overflow-x: auto` strip already carries sixteen buttons —
 * but almost nothing on it could be TAPPED. Measured, against this repo's own
 * `--tap-min: 44px`: the two day arrows were **17×19px**, the layout toggle
 * 22px tall, the scrubber's play button 34×24, its slider 16px tall, its speed
 * picker 62×24, the preset dropdown 27px, and a compare pane's picker and gear
 * 22px each. The two arrows are how a reader moves the cursor one session at a
 * time — the tab's primary action — and they were a third of the minimum.
 *
 * ⭐ WHAT THIS RAIL CAN AND CANNOT SEE. jsdom applies no media query, so the
 * SIZE at 390px is not assertable here; it was measured in a browser instead.
 * What jsdom can hold is the WIRE — a phone rule reaches a control only through
 * a class, and a control rendered without its class is the failure mode that
 * would otherwise be invisible until someone next picked up a phone. Both ends
 * are pinned: the element carries the hook, and the stylesheet still sizes it.
 *
 * ⛔ THE STYLESHEET IS READ, NOT REMEMBERED. Asserting only the className would
 * pass with the whole `@media` block deleted; asserting only the CSS would pass
 * on a button that never got the class. Either alone is half a rail.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import BreadthViews from './BreadthViews'
import layoutStyles from './BreadthLayout.module.css'
import scrubberStyles from './BreadthScrubber.module.css'
import compareStyles from './CompareGrid.module.css'
import presetStyles from './QuickPresetSwitcher.module.css'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cssOf = (file) => fs.readFileSync(path.join(HERE, file), 'utf8').replace(/\r\n/g, '\n')

/**
 * EVERY phone block of one stylesheet, concatenated — the canonical ≤640px
 * breakpoint this repo declares in `styles/breakpoints.css`, matched rather
 * than re-typed per file.
 *
 * ⛔ ALL of them, not the first. `CompareGrid.module.css` carries two: the
 * one-column grid it always had, and the tap-target block added beside it. A
 * probe that stopped at the first reported "no phone rule" for every class in
 * the second — a rail that reads as a finding.
 */
function phoneBlock(file) {
  const css = cssOf(file)
  const out = []
  const MARK = '@media (max-width: 640px)'
  for (let at = css.indexOf(MARK); at >= 0; at = css.indexOf(MARK, at + MARK.length)) {
    let depth = 0, i = css.indexOf('{', at)
    const start = i
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    out.push(css.slice(start, i))
  }
  return out.join('\n')
}

// `.step` in a stylesheet vs `_step_h4sh` on the element: CSS modules hash the
// local name into the class, so the local name is what both sides agree on.
const sizedOnPhone = (file, local) => {
  const block = phoneBlock(file)
  const re = new RegExp(`\\.${local}\\b[^{}]*(,[^{}]*)*\\{[^}]*min-height`, 's')
  return re.test(block)
}

const rows = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60, pct_above_50sma: 60 - i,
    pct_above_200sma: 55, pct_above_5sma: 40, pct_above_10sma: 45, pct_above_20ema: 50,
    pct_above_40sma: 52, pct_above_100sma: 55, up_4pct_today: 300 - i, down_4pct_today: 100 + i,
    new_52w_highs: 40, new_52w_lows: 9, mcclellan_osc: 20 - i, vix: 16 + (i % 4),
    sp500_close: 5000 + i * 3, advancing: 3000, declining: 1500,
  }
})

beforeEach(() => localStorage.clear())

describe('every control on this tab can be hit with a thumb', () => {
  // [what it is, the element, its module class, the stylesheet that sizes it]
  const controls = () => [
    ['the previous-day arrow', screen.getByLabelText('Previous day'),
      layoutStyles.step, 'BreadthLayout.module.css', 'step'],
    ['the next-day arrow', screen.getByLabelText('Next day'),
      layoutStyles.step, 'BreadthLayout.module.css', 'step'],
    ['the layout toggle', screen.getByTestId('layout-compare'),
      layoutStyles.btn, 'BreadthLayout.module.css', 'btn'],
    ['the play button', screen.getByTestId('scrubber-play'),
      scrubberStyles.btn, 'BreadthScrubber.module.css', 'btn'],
    ['the scrubber slider', screen.getByTestId('scrubber-range'),
      scrubberStyles.range, 'BreadthScrubber.module.css', 'range'],
    ['the speed picker', screen.getByTestId('scrubber-speed'),
      scrubberStyles.speed, 'BreadthScrubber.module.css', 'speed'],
    ['the preset dropdown', screen.getByLabelText('Switch preset'),
      presetStyles.select, 'QuickPresetSwitcher.module.css', 'select'],
  ]

  it('carries the class its phone rule needs, and that rule still sizes it', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    for (const [what, el, cls, file, local] of controls()) {
      expect(cls, `${what}: no class exported for the phone rule to hook`).toBeTruthy()
      expect(el.className.split(/\s+/), `${what} lost its phone hook`).toContain(cls)
      expect(sizedOnPhone(file, local),
        `${what}: ${file} no longer gives .${local} a phone minimum`).toBe(true)
    }
  })

  it('covers LATEST, which only exists once the cursor has moved', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByLabelText('Previous day'))
    const latest = screen.getByRole('button', { name: 'LATEST' })
    expect(latest.className.split(/\s+/)).toContain(layoutStyles.latest)
    expect(sizedOnPhone('BreadthLayout.module.css', 'latest')).toBe(true)
  })

  it('covers a compare pane’s own two controls', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByTestId('layout-compare'))
    const pane = screen.getByTestId('compare-pane-0')
    expect(within(pane).getByTestId('compare-pick-0').className.split(/\s+/))
      .toContain(compareStyles.pick)
    expect(within(pane).getByTestId('compare-customize-0').className.split(/\s+/))
      .toContain(compareStyles.gear)
    expect(sizedOnPhone('CompareGrid.module.css', 'pick')).toBe(true)
    expect(sizedOnPhone('CompareGrid.module.css', 'gear')).toBe(true)
  })

  it('CONTROL: the probe can say no', () => {
    // ⛔ Without this, `sizedOnPhone` returning true for everything — a broken
    // regex, a missing file — would read as full coverage.
    expect(sizedOnPhone('BreadthLayout.module.css', 'noSuchClass')).toBe(false)
    expect(sizedOnPhone('BreadthScrubber.module.css', 'position')).toBe(false)
  })
})

/**
 * 🔴 AND THE PANE FLOOR MOVED WHEN THE HEADER DID.
 *
 * One-column compare on a phone sizes its rows `minmax(<floor>, auto)`. The
 * floor is the pane HEADER plus the smallest body a lens still reads in —
 * measured in Chromium, the Regime Clock's momentum-axis labels start colliding
 * below 189px of body. Raising the picker and gear to the tap minimum grew that
 * header from 31px to 53px and silently took 24px off every pane, so the clock
 * rendered its scale as one smear of digits. The floor has to move with it.
 */
describe('the phone pane floor', () => {
  it('leaves room for a lens under a 44px-tall pane header', () => {
    const block = phoneBlock('CompareGrid.module.css')
    const floor = Number(/grid-auto-rows:\s*minmax\((\d+)px/.exec(block)?.[1])
    expect(floor, 'the phone grid no longer states a row floor').toBeGreaterThan(0)
    // 53px of header (two 44px controls in a 4px-padded, bordered bar) + the
    // 189px body the narrowest lens needs. Stated as the sum it is, not as a
    // number with no derivation beside it.
    expect(floor).toBeGreaterThanOrEqual(53 + 189)
  })
})
