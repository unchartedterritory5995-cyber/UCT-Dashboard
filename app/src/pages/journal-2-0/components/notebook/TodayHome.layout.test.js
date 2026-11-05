// @vitest-environment node
// Tier 3b fix round 1 (I7): the Today home reserves each card's FILLED height, so nothing shifts when the answer
// arrives. jsdom lays nothing out, so this rail reads the two sources that decide it:
//   * the CSS: every half-width card reserves the SAME height (one variable), and the plan its own;
//   * the row caps the SERVER sends (api/services/journal_two/notebook_today.py, parsed, never restated): the
//     reserved height covers the most rows a card can show, at the row height the CSS itself declares.
// With one shared half-card height, the session's order (or a holiday's) cannot change the grid's total height.
// The browser measurement (the debug layout-shift logger, lib/clsDebug.js) is the production check.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CARD_ORDER, SKELETON_ORDER } from './TodayHome'

const here = path.resolve(__dirname)
const CSS = fs.readFileSync(path.join(here, 'TodayHome.module.css'), 'utf8')
function repoRoot() {
  let dir = here
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, 'api', 'services', 'journal_two', 'notebook_today.py'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('repo root not found')
}
const PY = fs.readFileSync(path.join(repoRoot(), 'api', 'services', 'journal_two', 'notebook_today.py'), 'utf8')
const cap = (name) => {
  const m = PY.match(new RegExp(`^${name} = (\\d+)`, 'm'))
  if (!m) throw new Error(`${name} not found in notebook_today.py`)
  return Number(m[1])
}
const px = (name) => {
  const m = CSS.match(new RegExp(`${name}:\\s*(\\d+)px`))
  if (!m) throw new Error(`${name} not declared`)
  return Number(m[1])
}
const reserveOf = (cls) => {
  const block = CSS.match(new RegExp(`((?:\\.card_\\w+,?\\s*)+)\\{[^}]*min-height:\\s*var\\((--[\\w-]+)\\)`, 'g')) || []
  for (const b of block) {
    if (new RegExp(`\\.${cls}\\b`).test(b)) return b.match(/var\((--[\w-]+)\)/)[1]
  }
  return null
}

const HALF = ['setups', 'names', 'yesterday', 'onThisDay']
const HEAD_AND_PADDING = 28 + 24 + 16        // card head, padding, gaps
const MORE_LINE = 20

describe('the Today home reserves each card at its filled height (I7)', () => {
  it('every half-width card reserves the SAME height', () => {
    const vars = HALF.map((c) => reserveOf(`card_${c}`))
    expect(vars.every(Boolean)).toBe(true)
    expect(new Set(vars).size).toBe(1)
  })

  it('that height covers the most rows any half card shows (the server caps), at the CSS row height', () => {
    const row = px('--today-row-h')
    const half = px('--today-half-h')
    const most = Math.max(cap('NAMES_SHOWN'), cap('OPEN_ITEMS_SHOWN'), cap('SETUPS_SHOWN') + 1)
    expect(half).toBeGreaterThanOrEqual(HEAD_AND_PADDING + most * row + MORE_LINE)
    // non-vacuity: the caps are what the card draws
    expect(cap('NAMES_SHOWN')).toBe(8)
  })

  it('the plan reserves its 6 items, the notice and its button', () => {
    expect(reserveOf('card_plan')).toBe('--today-plan-h')
    expect(px('--today-plan-h')).toBeGreaterThanOrEqual(HEAD_AND_PADDING + cap('PLAN_ITEMS_SHOWN') * 26 + 18 + 44)
  })

  it('every session order holds the same cards as the skeleton (so the same total height)', () => {
    for (const order of Object.values(CARD_ORDER)) {
      expect(order.filter((c) => c !== 'recap').sort()).toEqual([...SKELETON_ORDER].sort())
    }
  })
})
