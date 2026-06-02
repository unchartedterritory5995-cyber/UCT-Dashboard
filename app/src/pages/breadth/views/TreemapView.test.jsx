import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// echarts-for-react renders a canvas in jsdom; stub it to capture the option.
vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-series={JSON.stringify(option?.series?.length ?? 0)} />,
}))

import TreemapView from './TreemapView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75' },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]

describe('TreemapView', () => {
  it('renders an ECharts treemap for the visible metrics', () => {
    const { getByTestId } = render(
      <TreemapView currentRow={{ breadth_score: 75, up_4pct_today: 383, date: '2026-06-01' }}
                   prevRow={null} pctileByKey={{}} visibleKeys={new Set(['breadth_score', 'up_4pct_today'])}
                   onDrill={() => {}} />,
    )
    expect(getByTestId('echart')).toBeInTheDocument()
  })
})
