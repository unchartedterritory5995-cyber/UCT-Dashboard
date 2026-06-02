// app/src/pages/breadth/views/TreemapView.weight.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Mock the Breadth.jsx re-exports the view consumes so the test stays isolated.
vi.mock('../../Breadth', () => ({
  HM_METRICS_BY_KEY: {
    a: { key: 'a', label: 'A', getTier: () => 'g3', getFmt: () => '1' },
    b: { key: 'b', label: 'B', getTier: () => 'r3', getFmt: () => '2' },
  },
  TREEMAP_DEF: [{ items: [{ metricKey: 'a', weight: 90 }, { metricKey: 'b', weight: 10 }] }],
  TIER_CELL_COLORS: { g3: '#063', r3: '#600', '': '#333' },
  TIER_SCORES: { g3: 0, r3: 6 }, TIER_LABELS: {}, TIER_TIP_COLORS: {},
}))

// Capture the echarts option object.
let captured = null
vi.mock('echarts-for-react', () => ({ default: (props) => { captured = props.option; return null } }))

import TreemapView from './TreemapView'

const base = {
  currentRow: { date: 'd', a: 1, b: 2 }, prevRow: null, pctileByKey: {},
  visibleKeys: new Set(['a', 'b']), signalKey: null, notableKey: null, onDrill: () => {},
}
const children = () => captured.series[0].data[0].children

describe('TreemapView weightBy', () => {
  it('curated (default) uses item.weight', () => {
    render(<TreemapView {...base} options={{ weightBy: 'curated' }} />)
    const c = children()
    expect(c.find(x => x.name === 'a').value).toBe(90)
    expect(c.find(x => x.name === 'b').value).toBe(10)
  })
  it('equal makes every tile the same size', () => {
    render(<TreemapView {...base} options={{ weightBy: 'equal' }} />)
    const c = children()
    expect(c.find(x => x.name === 'a').value).toBe(c.find(x => x.name === 'b').value)
  })
})
