// lightweight-charts lays the chart out in a <table>; unmarked, axe and VoiceOver read it as a
// data table of empty cells ("table, 4 rows" under the TickerPopup and hub sheet meta row).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { markChartLayoutPresentational } from './chartLayoutTable'

function fakeChart() {
  const root = document.createElement('div')
  const table = document.createElement('table')
  for (let r = 0; r < 4; r += 1) {
    const tr = document.createElement('tr')
    tr.appendChild(document.createElement('td'))
    table.appendChild(tr)
  }
  root.appendChild(table)
  document.body.appendChild(root)
  return { chart: { chartElement: () => root }, table }
}

test('the library layout table is marked presentational', () => {
  const { chart, table } = fakeChart()
  expect(markChartLayoutPresentational(chart)).toBe(true)
  expect(table.getAttribute('role')).toBe('presentation')
})

test('never throws on a chart without chartElement, or one that throws', () => {
  expect(markChartLayoutPresentational(null)).toBe(false)
  expect(markChartLayoutPresentational({})).toBe(false)
  expect(markChartLayoutPresentational({ chartElement: () => { throw new Error('disposed') } })).toBe(false)
  expect(markChartLayoutPresentational({ chartElement: () => document.createElement('div') })).toBe(false)
})

test('the library still builds its layout from a <table> (the premise of the fix)', () => {
  const src = readFileSync(join(process.cwd(), 'node_modules/lightweight-charts/dist/lightweight-charts.development.mjs'), 'utf8')
  expect(src).toMatch(/document\.createElement\('table'\)/)
})

test('StockChart marks it right after creating the chart (the wire)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
  expect(src).toMatch(/import \{ markChartLayoutPresentational \} from '\.\.\/utils\/chartLayoutTable'/)
  expect(src).toMatch(/chartRef\.current = chart\r?\n\s*\/\/[^\n]*\r?\n\s*markChartLayoutPresentational\(chart\)/)
})
