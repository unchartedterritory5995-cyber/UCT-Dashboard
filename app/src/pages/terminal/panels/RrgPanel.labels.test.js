// Audit 2026-10-08 (RRG #24): on a 390px phone the 560-unit graph scales to ~62%, so the point
// labels drew at ~7px and piled up in the crowded centre. Labels are now spaced apart and drawn
// larger on phones.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { placeLabels } from './RrgPanel'

const here = dirname(fileURLToPath(import.meta.url))

describe('RRG point labels', () => {
  it('spaces labels for points that sit on top of each other', () => {
    const heads = ['XLK', 'XLF', 'XLV', 'XLE'].map((sym, i) => ({ sym, x: 280 + i, y: 190 + i }))
    const out = placeLabels(heads)
    const ys = out.map((l) => l.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(20)
    // Labels that had to move say so, so the graph can draw a leader line back to the point.
    expect(out.filter((l) => l.moved).length).toBe(3)
  })

  it('leaves well-separated labels where they were and flips a label at the right edge', () => {
    const out = placeLabels([{ sym: 'XLK', x: 100, y: 100 }, { sym: 'XLU', x: 550, y: 300 }])
    expect(out[0]).toMatchObject({ x: 106, y: 94, anchor: 'start', moved: false })
    expect(out[1]).toMatchObject({ x: 544, anchor: 'end', moved: false })
  })

  it('draws the labels larger on phones', () => {
    const css = readFileSync(join(here, 'comparePanels.module.css'), 'utf8')
    const phone = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/)
    expect(phone, 'a phone block in comparePanels.module.css').not.toBeNull()
    const size = phone[1].match(/\.pointLabel\s*\{[^}]*font-size:\s*(\d+)px/)
    expect(Number(size?.[1])).toBeGreaterThanOrEqual(18)
  })
})
