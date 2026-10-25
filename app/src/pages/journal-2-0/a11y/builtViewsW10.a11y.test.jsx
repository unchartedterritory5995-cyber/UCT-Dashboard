// app/src/pages/journal-2-0/a11y/builtViewsW10.a11y.test.jsx
//
// Wave 10 Task 10.18 (R-46): one axe rail per NEW view state of a built widget, each drawn from a REAL payload of
// widget_engine/payload.py (builtViews/__fixtures__/w10Payloads.json) and proven rendered before axe runs, so an
// empty view cannot pass:
//   * built-line-running-total   -- a running total with its hatched drawdown band and "Drawdown" legend;
//   * built-line-running-readout -- the same, with a period's readout open ("... total · ... that day");
//   * built-number-drawdown      -- a max drawdown figure with the server's span sentence under it;
//   * built-number-stop          -- the stop-after line at the rule ("... Your rule says stop here.");
//   * built-progress-goal        -- a goal widget: "Weekly goal: $1,000.00" and the share;
//   * built-progress-goal-missing -- the placed widget with no goal set: the server's notice in place of the bar;
//   * built-scatter-quadrants    -- MAE vs MFE with its 1R guides and quadrant captions, at 600 and at 340 px;
//   * built-table-alt-w10        -- "Show as table" for each, carrying every new key as columns.
import { fireEvent, render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import BuiltWidgetEmbed from '../components/notebook/widgets/BuiltWidgetEmbed'
import LineView from '../components/notebook/widgets/builtViews/LineView'
import NumberView from '../components/notebook/widgets/builtViews/NumberView'
import ProgressView from '../components/notebook/widgets/builtViews/ProgressView'
import ScatterView from '../components/notebook/widgets/builtViews/ScatterView'
import TableAlt from '../components/notebook/widgets/builtViews/TableAlt'
import { widgetEmbedNode } from '../lib/notebookWidgets'
import W10 from '../components/notebook/widgets/builtViews/__fixtures__/w10Payloads.json'

const drill = () => {}

describe('wave 10 Task 10.18 surfaces (built widget views)', () => {
  axeSurface('built-line-running-total', async () => {
    const { container } = render(<LineView params={W10.line_cumulative} onDrill={drill} />)
    expect(container.querySelectorAll('[data-dd-band]').length).toBeGreaterThan(0)
    expect(screen.getByTestId('built-line-dd-legend').textContent).toBe('Drawdown')
    return { root: container }
  })

  axeSurface('built-line-running-readout', async () => {
    const { container } = render(<LineView params={W10.line_cumulative} onDrill={drill} />)
    const svg = screen.getByTestId('built-line-view')
    const x = Number(svg.querySelector('[data-period="2"] circle').getAttribute('cx'))
    fireEvent.pointerMove(svg.querySelector('[data-overlay]'), { clientX: x, pointerType: 'mouse' })
    expect(screen.getByTestId('built-line-readout').textContent).toContain('total · ')
    return { root: container }
  })

  axeSurface('built-number-drawdown', async () => {
    const { container } = render(<NumberView params={W10.number_drawdown_open} onDrill={drill} />)
    expect(screen.getByTestId('built-number-drawdown').textContent).toBe(W10.number_drawdown_open.drawdown.line)
    return { root: container }
  })

  axeSurface('built-number-stop', async () => {
    const { container } = render(<NumberView params={W10.stop_hit} onDrill={drill} />)
    expect(screen.getByTestId('built-number-stop').textContent).toBe(W10.stop_hit.stop.line)
    return { root: container }
  })

  axeSurface('built-progress-goal', async () => {
    const { container } = render(<ProgressView params={W10.progress_goal} onDrill={drill} />)
    screen.getByText('Weekly goal: $1,000.00')
    return { root: container }
  })

  axeSurface('built-progress-goal-missing', async () => {
    const miss = W10.progress_goal_missing
    const { container } = render(
      <BuiltWidgetEmbed attrs={{ ...widgetEmbedNode('builtWidget', miss).attrs, params: miss }} editable onUpdateParams={() => true} />,
    )
    expect(screen.getByTestId('built-progress-notice').textContent).toBe(miss.notice)
    return { root: container }
  })

  axeSurface('built-scatter-quadrants', async () => {
    const { container } = render(
      <div>
        <ScatterView params={W10.scatter_excursion} onDrill={drill} />
        <ScatterView params={W10.scatter_excursion} onDrill={drill} width={340} />
      </div>,
    )
    expect(container.querySelectorAll('[data-guide]').length).toBe(4)
    expect(container.querySelectorAll('[data-quadrant]').length).toBeGreaterThan(0)
    return { root: container }
  })

  axeSurface('built-table-alt-w10', async () => {
    const names = ['line_cumulative', 'number_drawdown_recovered', 'stop_under', 'progress_goal', 'progress_goal_missing',
      'scatter_excursion']
    const { container } = render(<div>{names.map((n) => <TableAlt key={n} params={W10[n]} onDrill={drill} />)}</div>)
    const heads = [...container.querySelectorAll('th')].map((th) => th.textContent)
    for (const h of ['Drawdown', 'Drawdown dates', 'Stop after', 'Weekly goal', 'Of goal', 'Quadrant']) expect(heads).toContain(h)
    return { root: container }
  })
})
