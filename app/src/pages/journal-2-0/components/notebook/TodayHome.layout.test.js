// @vitest-environment node
// Tier 3b fix round 2 (R1-A): the Today home reserves height on its SKELETONS only, at a card's TYPICAL filled
// height; a filled card takes its own height. Why that is enough: a skeleton and the card that replaces it are
// different components under one key, so React REPLACES the node -- and the Layout Instability API scores only nodes
// that existed in the previous frame and moved. The cards cannot shift; what is left is what sits below the grid
// (the footer, and the first-run slot, which holds its own height while it loads). Fix round 1 reserved each card's
// CAPPED height on the filled card too, which left large blank areas (against S17: never reserve blank space).
// jsdom lays nothing out, so this rail reads the CSS. The browser figure is the clsDebug rig's (lib/clsDebug.js).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CARD_ORDER, SKELETON_ORDER } from './TodayHome'

const CSS = fs.readFileSync(path.join(path.resolve(__dirname), 'TodayHome.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const RULES = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))
const px = (name) => {
  const m = CSS.match(new RegExp(`${name}:\\s*(\\d+)px`))
  if (!m) throw new Error(`${name} not declared`)
  return Number(m[1])
}
const CARDS = ['plan', 'recap', 'setups', 'names', 'yesterday', 'onThisDay']
const reserveOf = (id) => {
  const r = RULES.find((x) => x.sel.split(',').some((s) => s.trim() === `.skeleton.card_${id}`) && /min-height/.test(x.body))
  return r ? r.body.match(/min-height:\s*var\((--[\w-]+)\)/)?.[1] || null : null
}

describe('the Today home reserves height on its skeletons only (R1-A)', () => {
  it('a FILLED card has no reserve: no rule naming a card without `.skeleton` sets a min-height', () => {
    const offenders = RULES.filter((r) => /\.card_\w+/.test(r.sel) && /min-height/.test(r.body))
      .flatMap((r) => r.sel.split(',').map((s) => s.trim()).filter((s) => /\.card_\w+/.test(s) && !s.includes('.skeleton')))
    expect(offenders).toEqual([])
  })

  // Simplify pass 2, fix round 1: B2 hides empty cards, so the answer's card count is unknown before it lands. ONE
  // skeleton is drawn (the plan card's), and nothing below the grid until the answer (TodayHome.test.jsx rails that).
  it('the one skeleton is the plan card, reserved at its typical filled height (220 px); no other skeleton reserves', () => {
    expect([...SKELETON_ORDER]).toEqual(['plan'])
    expect(px(reserveOf('plan'))).toBe(220)
    for (const id of CARDS.filter((c) => c !== 'plan')) expect(reserveOf(id), id).toBeNull()
  })

  it('every session order holds the plan card the skeleton stands for', () => {
    for (const order of Object.values(CARD_ORDER)) expect(order).toContain('plan')
  })
})
