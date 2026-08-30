import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// echarts-for-react renders a canvas in jsdom; stub it to capture the option.
vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-series={JSON.stringify(option?.series?.length ?? 0)} />,
}))

import TreemapView from './TreemapView'

// ⛔ NO `metrics` FIXTURE. This view is a BOARD: it reads `visibleKeys` and
// resolves each tile off the registry itself, so a hand-built metric list here
// was an unused prop-shaped decoy that read as though it were the input.

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
