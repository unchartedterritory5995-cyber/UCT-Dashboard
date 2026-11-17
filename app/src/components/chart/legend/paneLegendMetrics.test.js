// app/src/components/chart/legend/paneLegendMetrics.test.js
//
// ⭐ OWNER 11-16 — A SUB-PANE'S LEGEND ROWS LINE UP WITH THE PRICE PANE'S.
//
// The volume pane's strip (`.volLegend`) and every other pane's readout (`.paneLegend`)
// hold the same `LegendRow`s as the price pane's `.studyStack`, but their box was the
// old horizontal volume strip's: 2px 7px of padding (names 5px right of the price
// pane's), a filled panel, and no line-height (a looser pitch than 14 + 8). They now
// take the price stack's row metrics. This rail fails if `.studyStack` changes and
// the pane legends do not, or the other way round.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CSS = fs.readFileSync(path.join(HERE, '../../StockChart.module.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Every declaration of every top-level rule whose selector is exactly `sel`, later wins. */
function declsOf(sel) {
  const out = {}
  const re = /(^|\n)([^{}\n@][^{}]*?)\{([^}]*)\}/g
  let m
  while ((m = re.exec(CSS))) {
    const sels = m[2].split(',').map((x) => x.trim())
    if (!sels.includes(sel)) continue
    for (const d of m[3].split(';')) {
      const i = d.indexOf(':')
      if (i < 0) continue
      out[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    }
  }
  return out
}

const METRICS = ['line-height', 'row-gap', 'padding', 'border-radius', 'background', 'backdrop-filter', '-webkit-backdrop-filter']

describe('sub-pane legends use the price pane study stack row metrics', () => {
  const stack = declsOf('.studyStack')

  it('the price stack still declares every metric this rail compares', () => {
    for (const k of METRICS) expect(stack[k], `.studyStack declares no ${k}`).toBeTruthy()
  })

  for (const sel of ['.paneLegend', '.volLegend']) {
    it(`${sel}: same line-height, row gap, padding (left inset), radius and wash as .studyStack`, () => {
      const d = declsOf(sel)
      for (const k of METRICS) expect(d[k], `${sel} ${k}`).toBe(stack[k])
    })
  }

  it('both start at the same x as the price stack (the shared left: 8px)', () => {
    // `.legendV2` (the price legend box) and the pane strips share `left: 8px`; with the
    // same padding the first glyph of every pane's rows lands on one x.
    const legend = declsOf('.legendV2')
    expect(legend.left).toBe('8px')
    expect(declsOf('.paneLegend').left).toBe('8px')
    expect(declsOf('.volLegend').left).toBe('8px')
  })
})
