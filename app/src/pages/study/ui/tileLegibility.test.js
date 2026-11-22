// The ONE answer tile (ui/Tile, kit2.module.css .tile), checked against the defects a real-screen review found on the
// drills' answer cards (2026-11-08, sandbox, 1440x900 + 390x844, light and dark themes).
//
// 1. Text readable in every state a member acts on (resting, hover, picked, right, wrong): the tile is black glass
//    with LITERAL surfaces, so its ink must be a literal too, never a theme token that turns dark on the light theme.
// 2. Two tiles in one row are the same height: ChoiceList wraps each tile in a list item, and a long answer (470 bank
//    choices run past 40 characters) wrapped to three lines stood 117 px tall beside a 72 px neighbour.
// 3. A picked tile shows green or red after Check, never gold: the verdict wins over the pick.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { declarations, parseColor, parseRules } from '../../terminal/a11y/__tests__/terminalContrast'
import { contrast } from '../../../styles/__tests__/contrastMath'

const UI = join(process.cwd(), 'src', 'pages', 'study', 'ui')
const CSS = readFileSync(join(UI, 'kit2.module.css'), 'utf8')
const RULES = parseRules(CSS)

/** The last value a rule whose selector is exactly `selector` gives `prop` (source order = the cascade). */
function lastDeclared(selector, prop) {
  let out = null
  for (const r of RULES) {
    if (r.selector !== selector) continue
    const v = declarations(r.body).get(prop)
    if (v != null) out = v
  }
  return out
}
const rgb = (v) => parseColor(v).rgb.map(Math.round)
const hexStops = (bg) => [...bg.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0])

describe('the answer tile: every state reads, rows line up, the verdict wins', () => {
  it('the ink is a literal, not a theme token, and reads >= 4.5:1 on every stop of every state the member acts on', () => {
    const ink = lastDeclared('.tile', 'color')
    expect(ink).toMatch(/^#/)
    const states = [['resting', '.tile'], ['picked', '.tile.sel'], ['right', '.tile.right'], ['wrong', '.tile.wrong']]
    const bad = []
    for (const [state, sel] of states) {
      expect(lastDeclared(sel, 'color') ?? ink, `${state} ink`).not.toMatch(/var\(/)
      const stops = hexStops(lastDeclared(sel, 'background'))
      expect(stops.length, `${state} stops`).toBeGreaterThan(0)
      for (const s of stops) {
        const r = contrast(rgb(lastDeclared(sel, 'color') ?? ink), rgb(s))
        if (r < 4.5) bad.push(`${state} ${s} ${r.toFixed(2)}`)
      }
    }
    // hover lifts the tile and changes its rim; it keeps the resting surface and ink
    const hover = declarations(RULES.find((r) => r.selector === '.tile:hover:not(:disabled)').body)
    expect(hover.has('background') || hover.has('color')).toBe(false)
    expect(bad).toEqual([])
  })

  it('a tile in a list item fills its grid row (ChoiceList), so a three-line answer never leaves its neighbour shorter', () => {
    expect(lastDeclared('li > .tile', 'height')).toBe('100%')
    const list = readFileSync(join(UI, '..', 'drills', 'ChoiceList.jsx'), 'utf8')
    expect(list).toMatch(/<li key=[^>]*>\s*<Tile /)    // the wire: ChoiceList still wraps each Tile in an <li>
  })

  it('the verdict wins over the pick: Tile renders right / wrong before sel, so a picked tile turns green or red', () => {
    const list = readFileSync(join(UI, '..', 'drills', 'ChoiceList.jsx'), 'utf8')
    expect(list).toMatch(/\? 'right' : [^?]*\? 'wrong' : revealed \? 'quiet' : selected \? 'sel' : 'idle'/)
  })
})
