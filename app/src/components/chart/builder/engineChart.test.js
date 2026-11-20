// app/src/components/chart/builder/engineChart.test.js
//
// `StockChart`'s `engineChart` is "the chart as the engine sees it", handed to a check made BESIDE the
// chart (`runsHere.js`). It is only worth anything if it is the SAME bars and the SAME six facts the
// chart's own binder is handed: a script judged on anything else is judged on a chart the member is
// not looking at. StockChart cannot be mounted in a unit test, so this reads its source (comments
// removed) and holds the two to each other, expression for expression.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const LF = String.fromCharCode(10)
const read = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').split(String.fromCharCode(13)).join('')
const code = (text) => text.split(LF).map((l) => l.split('//')[0].trimEnd()).filter((l) => l.trim()).join(LF)
const CHART = read('src/components/StockChart.jsx')

function block(text, from, to) {
  const a = text.indexOf(from)
  expect(a, `not found: ${from}`).toBeGreaterThan(-1)
  const b = text.indexOf(to, a)
  expect(b, `not found after it: ${to}`).toBeGreaterThan(a)
  return code(text.slice(a, b))
}

describe('engineChart is the binder\'s own view of the chart', () => {
  const mine = block(CHART, 'const engineChart = useMemo(() => ({', '}), [filteredBars, sym, symbolMeta')
  // the binder's context: from the registry it is handed to the listing statement
  const binder = block(CHART, 'registry: engineRegistry,', 'historyWindowBars:')
  // ⭐⭐ (2026-11-20) the sixth: the listing FACT on a weekly / monthly chart where it is not served (`listingSeed.listingStartOf`)
  const FACTS = ['sym,', 'symbol: symbolMeta,', 'tf: resolvedTf,', 'newestBarIsForming: data?.newest_bar_is_forming ?? null,', 'historyFromListing,',
    '...(listingUnserved ? { listingStart: true } : {}),']

  it('the same bars, and the same six facts, written the same way in both', () => {
    expect(mine.split(LF).map((l) => l.trim())).toContain('bars: filteredBars,')
    expect(binder.split(LF).map((l) => l.trim())).toContain('bars: filteredBars,')
    const a = mine.split(LF).map((l) => l.trim()), b = binder.split(LF).map((l) => l.trim())
    for (const fact of FACTS) {
      expect(a, `engineChart: ${fact}`).toContain(fact)
      expect(b, `the binder's context: ${fact}`).toContain(fact)
    }
    // and engineChart's context holds nothing else: a seventh fact here would be one the binder is not handed
    const ctx = mine.slice(mine.indexOf('ctx: {') + 'ctx: {'.length, mine.lastIndexOf('}')).split(LF).map((l) => l.trim()).filter((l) => l && l !== '},')
    expect(ctx).toEqual(FACTS)
  })

  it('it is memoised on exactly what it reads, so a tick that changes none of them hands the toolbar the same object', () => {
    const deps = CHART.slice(CHART.indexOf('}), [filteredBars, sym, symbolMeta'), CHART.indexOf(LF, CHART.indexOf('}), [filteredBars, sym, symbolMeta')))
    expect(deps).toBe('}), [filteredBars, sym, symbolMeta, resolvedTf, data?.newest_bar_is_forming, historyFromListing, listingUnserved])')
  })

  it('every toolbar mount is handed it, beside the bars it already had', () => {
    const lines = CHART.split(LF)
    const mounts = lines.map((l, i) => (l.trim() === '<ChartToolbar' ? i : -1)).filter((i) => i >= 0)
    expect(mounts).toHaveLength(3)
    for (const m of mounts) {
      const end = lines.findIndex((l, i) => i > m && l.trim() === '/>')
      const props = lines.slice(m, end).map((l) => l.trim())
      expect(props, `the toolbar at line ${m + 1}`).toContain('bars={bars}')
      expect(props, `the toolbar at line ${m + 1}`).toContain('engineChart={engineChart}')
    }
    const toolbar = code(read('src/components/chart/ChartToolbar.jsx'))
    expect(toolbar).toContain('engineChart = null,')
    // the toolbar hands it to BOTH doors: the Create Indicator dock and the builder window
    expect(toolbar.split('engineChart={engineChart}').length - 1).toBe(2)
    const at = (text, tag) => { const a = text.indexOf(tag); return text.slice(a, text.indexOf('/>', a)) }
    expect(at(toolbar, '<CreateIndicatorPanel')).toContain('engineChart={engineChart}')
    expect(at(toolbar, '<BuilderSheet')).toContain('engineChart={engineChart}')
  })

  it('the builder window carries it down to the script box, whose status panel runs the script on it', () => {
    const sheet = code(read('src/components/chart/builder/BuilderSheet.jsx'))
    expect(sheet).toContain('engineChart = null,')
    const importBox = sheet.slice(sheet.indexOf('<ImportBox'), sheet.indexOf('/>', sheet.indexOf('<ImportBox')))
    expect(importBox).toContain('engineChart={engineChart}')
    const box = code(read('src/components/chart/builder/PineBox.jsx'))
    const outer = box.slice(box.indexOf('export function ImportBox('), box.indexOf('export default function PineBox('))
    expect(outer).toContain('lineJumpRef = null, engineChart = null,')
    expect(outer).toContain('engineChart={engineChart}')
    expect(box).toContain('usePineEditorStatus({ enabled: statusOn, report, inspectedSource: inspected, savedRow, chart: engineChart })')
  })
})
