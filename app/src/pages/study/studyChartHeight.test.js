// owner 2026-11-12: "the chart layout should take up most of the screen vs just a tiny portion", and the
// "THE READ ON THIS CHART" table is gone ("just noisy").
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHART_HEIGHT, studyChartHeight } from './DrillPlayer'

describe('study drill chart size', () => {
  it('a phone keeps the fixed height', () => {
    expect(studyChartHeight(true, 900)).toBe(CHART_HEIGHT)
  })
  it('a bigger screen gives the chart about 60% of its height, between the floor and 720px', () => {
    expect(studyChartHeight(false, 1000)).toBe(600)
    expect(studyChartHeight(false, 500)).toBe(CHART_HEIGHT)
    expect(studyChartHeight(false, 1600)).toBe(720)
  })
  it('the chart read table is not rendered any more', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/study/DrillPlayer.jsx'), 'utf8')
    expect(src).not.toMatch(/The read on this chart<\/div>/)
    expect(src).not.toMatch(/data-testid="chart-stats"/)
  })
})
