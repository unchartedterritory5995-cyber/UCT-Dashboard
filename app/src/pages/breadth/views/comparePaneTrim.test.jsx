/**
 * 🔴 TWO LENSES DID NOT FIT A COMPARE PANE, AND THE MEASUREMENTS DISAGREED WITH
 * WHAT HAD BEEN WRITTEN DOWN ABOUT THEM.
 *
 * Measured in real Chromium at the two pane sizes this tab actually produces —
 * 746×318 (a 1512-wide desktop) and 710×245 (a 1440×772 laptop):
 *
 *   Rotation      318px pane: 0px over  ·  245px pane: 31px over, cutting the
 *                 third panel's verdict — the one sentence a panel exists for.
 *   Event Ledger  318px pane: the STATUS column resolved to 166px against a
 *                 sentence needing ~190, so "Last fired 2026-08-16 · 12 sessions
 *                 ago" wrapped inside a 26px row and had its second line clipped
 *                 — while the NOTE beside it held 265px.
 *
 * ⭐ BOTH TRIMS RIDE `[data-compare-pane]`, the attribute `CompareGrid.jsx` sets
 * on a pane body, rather than a media query: a pane is narrow and short at ANY
 * viewport width, and the same lens at the same viewport is not trimmed when it
 * is the single view. That is a fact about the BOX, and only the box knows it.
 *
 * ⛔ THE STYLESHEET IS READ, NOT REMEMBERED, AND SO IS THE WIRE. Asserting only
 * the className would pass with the whole `[data-compare-pane]` block deleted;
 * asserting only the CSS would pass on an element that never got the class.
 * Either alone is half a rail — the shape `phoneTapTargets.test.jsx` sets for
 * the phone rules, applied to the pane rules.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import RotationView from './RotationView'
import EventLedgerView from './EventLedgerView'
import rotationStyles from './RotationView.module.css'
import ledgerStyles from './EventLedgerView.module.css'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const cssOf = (file) => fs.readFileSync(path.join(HERE, file), 'utf8').replace(/\r\n/g, '\n')

/**
 * The declaration block of the rule with EXACTLY this selector.
 *
 * ⛔ AN `indexOf` HERE IS A RAIL THAT CANNOT FAIL. The first version of this
 * helper searched for the selector as a substring, so renaming
 * `[data-compare-pane] .note` to `… .noteX` — deleting the rule, as far as the
 * page is concerned — still matched, read the same braces and passed. Caught by
 * mutating the stylesheet and watching the test stay green
 * (`lesson_gate_that_cannot_fail`). The selector must END where the rule does.
 */
function ruleBody(css, selector) {
  const re = new RegExp(`(?:^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const m = re.exec(css)
  return m ? m[1].trim() : null
}
// ⛔ `font-size` HIDES INSIDE THE `font` SHORTHAND. The base rule declares the
// family and the weight too, so it is written as `font: 800 22px …` while the
// pane override touches the size alone — a probe that only knew the longhand
// would read `null` for the number it exists to compare, and report the trim as
// missing when it is present.
const px = (body, prop) => {
  if (!body) return null
  const direct = new RegExp(`${prop}\\s*:\\s*([\\d.]+)px`).exec(body)
  if (direct) return Number(direct[1])
  if (prop !== 'font-size') return null
  const short = /(?:^|;|\s)font\s*:[^;]*?([\d.]+)px/.exec(body)
  return short ? Number(short[1]) : null
}

// 60 sessions of the three series the Rotation lens reads.
const rows = Array.from({ length: 60 }, (_, i) => ({
  date: `2026-06-${String(60 - i).padStart(2, '0')}`,
  rsp_spy_ratio: 0.62 + i * 0.0004,
  iwm_qqq_ratio: 0.55 - i * 0.0003,
  vxn: 21 + (i % 5) * 0.2,
  vix: 17 + (i % 3) * 0.2,
  new_52w_lows: 20, new_52w_highs: 60, mcclellan_osc: 10,
  advancing: 3000, declining: 2000, up_on_volume: 1800, down_on_volume: 1200,
  hvc_52w: 30, atr_ext_7: 9, is_ftd: 0,
}))

describe('the Rotation lens trims itself in a compare pane', () => {
  const css = cssOf('RotationView.module.css')

  it('declares a smaller headline and a shallower trace for a pane, not for the view', () => {
    const baseValue = px(ruleBody(css, '.value'), 'font-size')
    const paneValue = px(ruleBody(css, '[data-compare-pane] .value'), 'font-size')
    const baseTrace = px(ruleBody(css, '.trace'), 'min-height')
    const paneTrace = px(ruleBody(css, '[data-compare-pane] .trace'), 'min-height')

    for (const [what, v] of [['base value', baseValue], ['pane value', paneValue],
                             ['base trace', baseTrace], ['pane trace', paneTrace]]) {
      expect(v, `${what}: no declaration to read — the trim is gone`).toBeGreaterThan(0)
    }
    // ⛔ THE DIRECTION IS THE ASSERTION. Two numbers that merely EXIST would pass
    // on a pane rule that made the lens bigger, which is the failure this closes.
    expect(paneValue, 'the pane headline is not smaller than the full-size one')
      .toBeLessThan(baseValue)
    expect(paneTrace, 'the pane trace floor is not shallower than the full-size one')
      .toBeLessThan(baseTrace)
  })

  it('puts those two classes on the elements the rules name', () => {
    const { container } = render(<RotationView rows={rows} rowIdx={0}
      onSeek={() => {}} canSeek={() => true} options={{ lookback: 20 }} />)
    const values = [...container.querySelectorAll('[data-testid^="rotation-value-"]')]
    expect(values.length, 'no panels rendered — this rail proves nothing').toBe(3)
    for (const el of values) {
      expect(el.className, `${el.getAttribute('data-testid')}: the pane rule cannot reach it`)
        .toContain(rotationStyles.value)
      // …and the size is NOT inline, because an inline `font` beats the rule.
      expect(el.style.fontSize, 'an inline size would shadow the pane rule').toBe('')
    }
    expect(container.querySelectorAll(`.${rotationStyles.trace}`).length,
      'the trace band lost its class').toBe(3)
  })
})

describe('the Event Ledger drops its note column in a compare pane', () => {
  const css = cssOf('EventLedgerView.module.css')

  it('keeps five tracks at full width and four in a pane', () => {
    const base = ruleBody(css, '.row')
    const pane = ruleBody(css, '[data-compare-pane] .row')
    const tracks = (body) => {
      const m = /grid-template-columns\s*:\s*([^;]+);/.exec(body ?? '')
      // minmax(...) commas are inside parens; split on top-level whitespace.
      return m ? m[1].trim().replace(/minmax\([^)]*\)/g, 'T').split(/\s+/).length : 0
    }
    expect(tracks(base), 'the full-width row no longer declares five columns').toBe(5)
    expect(tracks(pane), 'the pane row must drop exactly one column — the note').toBe(4)
    expect(ruleBody(css, '[data-compare-pane] .note'),
      'the note column is dropped from the track list but still painted').toMatch(/display\s*:\s*none/)
  })

  it('puts the note class on the note, so the rule has something to hide', () => {
    const { container } = render(<EventLedgerView rows={rows} rowIdx={0}
      onSeek={() => {}} canSeek={() => true} options={{ families: 'all' }} />)
    const notes = [...container.querySelectorAll(`.${ledgerStyles.note}`)]
    expect(notes.length, 'no note rendered — this rail proves nothing').toBeGreaterThan(3)
    // ⛔ AND THE PROVENANCE CHIP STAYS. The ruling is that the note is the
    // threshold's WORDING and the chip is its SOURCE, so the wording is what a
    // narrow box gives up. A pane rule that hid the chip instead would pass every
    // "does it fit" measurement and lose the claim.
    const rowEl = notes[0].parentElement
    expect(rowEl.textContent).toMatch(/TIER|FORMULA|PCTILE|COLLECTED/)
  })
})
