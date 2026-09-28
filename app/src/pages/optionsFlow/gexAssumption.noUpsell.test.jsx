/**
 * TERM-029 AC(b) — the assumption note carries NO upgrade affordance, pricing
 * or locked state.
 *
 * The spec asks for this to be "asserted by a text rail on the diff", and until
 * this file nothing asserted it: the product met the clause and no test could
 * have noticed it stop meeting it. The owner ruled ONE paid tier only
 * (2026-09-26), so a disclosure that grew an "unlock"/"upgrade" hook would be
 * describing a tier that does not exist.
 *
 * Two halves, because either alone is blind to the other:
 *   1. the SOURCE of both TERM-029 modules, comments stripped (a comment that
 *      explains "no upgrade copy" must not trip the rail — CODE, NEVER PROSE);
 *   2. the RENDERED note, opened, in both modes — copy can arrive from an
 *      import this file does not read.
 * `the matcher sees a planted word` is the control: an absence is only evidence
 * if the instrument could have seen a presence.
 */
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import GexAssumptionNote from './GexAssumptionNote'

// Built by concatenation so this file's own source can never be a match.
const UPSELL = new RegExp(
  '\\b(' + ['up' + 'grade', 'pric' + 'ing', 'un' + 'lock', 'lock' + 'ed',
    'prem' + 'ium', 'pay' + 'wall', 'sub' + 'scribe', 'sub' + 'scription',
    'pro ' + 'plan', 'ti' + 'er'].join('|') + ')\\b',
  'i',
)
const LOCK_ICON = new RegExp('name=["\']' + 'lo' + 'ck' + '["\']')

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function moduleSource(name) {
  const p = [`src/pages/optionsFlow/${name}`, `app/src/pages/optionsFlow/${name}`]
    .map((c) => resolve(process.cwd(), c))
    .find((c) => existsSync(c))
  return p && readFileSync(p, 'utf8')
}

describe('TERM-029 AC(b): no upsell in the GEX assumption note', () => {
  it('the matcher sees a planted word, and ignores it inside a comment', () => {
    expect(UPSELL.test('Unlock Trade-Aware with ' + 'Pre' + 'mium')).toBe(true)
    expect(LOCK_ICON.test('<FlowIcon name="' + 'lo' + 'ck" />')).toBe(true)
    const prose = '/* never add ' + 'up' + 'grade copy here */ const x = 1'
    expect(UPSELL.test(stripComments(prose))).toBe(false)
  })

  for (const name of ['GexAssumptionNote.jsx', 'gexAssumption.js']) {
    it(`${name}: no upsell words or lock icon in code`, () => {
      const src = moduleSource(name)
      expect(src, `${name} not found — a missing file is a broken invocation`).toBeTruthy()
      const code = stripComments(src)
      expect(code.match(UPSELL)).toBeNull()
      expect(code.match(LOCK_ICON)).toBeNull()
    })
  }

  for (const adjusted of [false, true]) {
    it(`the opened note (${adjusted ? 'trade-aware' : 'naive'}) says nothing about a paid tier`, () => {
      const { getByTestId, container } = render(<GexAssumptionNote adjusted={adjusted} />)
      fireEvent.click(getByTestId('gex-assumption-trigger'))
      const text = container.textContent
      // Non-vacuity: the sentence actually rendered.
      expect(container.querySelector('[data-gexnote]')).not.toBeNull()
      expect(text.length).toBeGreaterThan(20)
      expect(text.match(UPSELL)).toBeNull()
      const label = getByTestId('gex-assumption-trigger').getAttribute('aria-label') || ''
      expect(label.match(UPSELL)).toBeNull()
    })
  }
})
