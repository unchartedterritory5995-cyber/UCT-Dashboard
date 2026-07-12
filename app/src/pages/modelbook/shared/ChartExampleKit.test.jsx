import { vi, test, expect } from 'vitest'

// Stub the heavy chart module — this smoke test only exercises the pure
// buildExampleChartProps helper + the upbTemplates shape (the views agent
// owns component-level tests).
vi.mock('../../../components/StockChart', () => ({
  default: () => <div data-testid="stock-chart" />,
}))

import { buildExampleChartProps } from './ChartExampleKit'
import { TEMPLATES, getTemplate } from '../builder/upbTemplates'

const baseEx = {
  id: 'x1',
  symbol: 'NVDA',
  year: 2023,
  timeframe: 'D',
  scale_mode: 'arith',
  label_date: null,
  frame_start_date: null,
  result_start_date: null,
  result_end_date: null,
  entry_price: null,
  stop_price: null,
  target_price: null,
  drawings_json: null,
  result_drawings_json: null,
}

test('no label_date → calendar-year frame from year', () => {
  const props = buildExampleChartProps(baseEx, {})
  expect(props.entryDate).toBe('2023-01-01')
  expect(props.exitDate).toBe('2023-12-31')
  expect(props.exactDateRange).toBe(true)
  expect(props.keepBarsAfterExit).toBe(false)
})

test('label_date → frame ends on the setup day, starts 120d before by default', () => {
  const props = buildExampleChartProps({ ...baseEx, label_date: '2023-06-15' }, {})
  expect(props.exitDate).toBe('2023-06-15')
  expect(props.entryDate).toBe('2023-02-15') // 120 calendar days of lead-up
})

test('frame_start_date overrides the default lead-up', () => {
  const props = buildExampleChartProps(
    { ...baseEx, label_date: '2023-06-15', frame_start_date: '2023-04-01' }, {},
  )
  expect(props.entryDate).toBe('2023-04-01')
})

test('result view → result dates + keepBarsAfterExit', () => {
  const ex = {
    ...baseEx,
    label_date: '2023-06-15',
    result_start_date: '2023-05-01',
    result_end_date: '2023-09-30',
  }
  const props = buildExampleChartProps(ex, { view: 'result' })
  expect(props.entryDate).toBe('2023-05-01')
  expect(props.exitDate).toBe('2023-09-30')
  expect(props.keepBarsAfterExit).toBe(true)
  expect(props.instantFrameFlip).toBe(true)
})

test('result view without result_start_date falls back to the setup frame start', () => {
  const ex = { ...baseEx, label_date: '2023-06-15', result_end_date: '2023-09-30' }
  const props = buildExampleChartProps(ex, { view: 'result' })
  expect(props.entryDate).toBe('2023-02-15')
})

test('empty price lines reuse ONE stable module-level array', () => {
  const a = buildExampleChartProps(baseEx, {})
  const b = buildExampleChartProps({ ...baseEx }, {})
  expect(a.priceLines).toBe(b.priceLines) // identity, not just equality
  expect(Object.isFrozen(a.priceLines)).toBe(true)
  expect(a.priceLines.length).toBe(0)
})

test('entry/stop/target become dashed price lines', () => {
  const props = buildExampleChartProps(
    { ...baseEx, entry_price: 10, stop_price: 9, target_price: 15 }, {},
  )
  expect(props.priceLines.map(l => l.price)).toEqual([10, 9, 15])
  expect(props.priceLines.every(l => l.lineStyle === 2)).toBe(true)
})

test('hray drawings get rightBoundTime injected at render time', () => {
  const drawings = JSON.stringify([
    { type: 'hray', price: 12 },
    { type: 'trendline', a: 1 },
  ])
  const props = buildExampleChartProps(
    { ...baseEx, label_date: '2023-06-15', drawings_json: drawings }, {},
  )
  expect(props.annotations[0].rightBoundTime).toBe('2023-06-15')
  expect(props.annotations[1].rightBoundTime).toBeUndefined()
})

test('result view layers result drawings on top of setup drawings', () => {
  const ex = {
    ...baseEx,
    label_date: '2023-06-15',
    result_end_date: '2023-09-30',
    drawings_json: JSON.stringify([{ type: 'trendline', a: 1 }]),
    result_drawings_json: JSON.stringify([{ type: 'text', t: 'up' }]),
  }
  expect(buildExampleChartProps(ex, {}).annotations).toHaveLength(1)
  expect(buildExampleChartProps(ex, { view: 'result' }).annotations).toHaveLength(2)
})

test('annotate mode unfreezes the chart and passes the draft', () => {
  const draft = [{ type: 'rect' }]
  const props = buildExampleChartProps(baseEx, { annotating: true, draft })
  expect(props.frozen).toBe(false)
  expect(props.hideCrosshair).toBe(false)
  expect(props.hideLegend).toBe(false)
  expect(props.annotations).toBe(draft)
  expect(props.annotationsEditable).toBe(true)
})

test('viewing mode is frozen with stored drawings', () => {
  const props = buildExampleChartProps(baseEx, {})
  expect(props.frozen).toBe(true)
  expect(props.hideCrosshair).toBe(true)
  expect(props.annotations).toBe(null) // no drawings stored
  expect(props.annotationsEditable).toBe(false)
})

test('gotcha props: watermark no-op wired, colorByNetChange absent, white highlight', () => {
  const props = buildExampleChartProps({ ...baseEx, label_date: '2023-06-15' }, {})
  expect(typeof props.onWatermarkCommit).toBe('function')
  expect(props.onWatermarkCommit()).toBeUndefined() // no-op stub
  expect('colorByNetChange' in props).toBe(false) // dead prop — never passed
  expect(props.highlightColor).toBe('#ffffff')
  expect(props.highlightBarTime).toBe('2023-06-15')
  expect(props.barsOverride).toBeUndefined() // custom-bars cut from v1
  expect(props.forceScaleMode).toBe('arith')
  expect(props.liveUpdates).toBe(false)
})

test('log scale mode passes through', () => {
  expect(buildExampleChartProps({ ...baseEx, scale_mode: 'log' }, {}).forceScaleMode).toBe('log')
})

// ── upbTemplates shape ────────────────────────────────────────────────────────

test('upbTemplates: three templates with the locked keys and valid docs', () => {
  expect(TEMPLATES.map(t => t.key)).toEqual(['blank', 'setup-definition', 'trade-recipe'])
  for (const t of TEMPLATES) {
    expect(typeof t.label).toBe('string')
    expect(typeof t.description).toBe('string')
    const d = t.doc()
    expect(d.type).toBe('doc')
    expect(Array.isArray(d.content)).toBe(true)
    expect(d.content.length).toBeGreaterThan(0)
    // fresh doc per call — mutating one seeded entry must not leak
    expect(t.doc()).not.toBe(d)
  }
})

test('setup-definition + trade-recipe carry the spec headings', () => {
  const texts = (key) => getTemplate(key).doc().content
    .filter(n => n.type === 'heading')
    .map(n => n.content[0].text)
  expect(texts('setup-definition')).toEqual([
    'What it is', 'When I trade this', 'Entry criteria', 'Stop & target', 'Common mistakes',
  ])
  expect(texts('trade-recipe')).toEqual([
    'Context', 'Trigger', 'Entry', 'Management', 'Exit',
  ])
})

test('templates use only heading/paragraph nodes (editor extension set)', () => {
  const walk = (n, out = []) => {
    if (n?.type) out.push(n.type)
    for (const c of n?.content || []) walk(c, out)
    return out
  }
  for (const t of TEMPLATES) {
    const types = new Set(walk(t.doc()))
    for (const type of types) {
      expect(['doc', 'heading', 'paragraph', 'text']).toContain(type)
    }
  }
})

test('getTemplate looks up by key and returns null on miss', () => {
  expect(getTemplate('blank').key).toBe('blank')
  expect(getTemplate('nope')).toBe(null)
})

// Import smoke — resolves the whole UpbRichEditor graph (tiptap libs, the
// Notebook tiptap config cross-import, SlashMenu.module.css) at runtime.
test('UpbRichEditor module loads and exports a component', async () => {
  const mod = await import('../builder/UpbRichEditor')
  expect(typeof mod.default).toBe('function')
})
