/* CHARTS-LANDS-ON-WRONG-WIDGET — the hydration-ordering rail.
 *
 * `MobileWorkspace` seeded its active tab with a `useState` INITIALIZER:
 *
 *     const [active] = useState(() => widgets.findIndex(w => w.type === 'chart'))
 *
 * That runs on the FIRST render, before `usePreferences` resolves
 * `charts_workspace_layout`. `ChartsWorkspace`'s DEFAULT_LAYOUT is
 * `{ widgets: [] }`, so the initializer saw an empty list, returned 0, and never
 * recomputed. The headline touch-charting route opened on whatever widget landed
 * first — measured on 2026-08-09: `Themes` with `aria-selected=true`.
 *
 * It is TIMING-DEPENDENT, which is why it survived: on a warm reload prefs can
 * be in the SWR cache at first render and the initializer gets the real list.
 * Every test below therefore renders EMPTY FIRST and then hydrates — the cold
 * order. The last test renders warm to prove the fix didn't just move the bug.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import MobileWorkspace, { defaultActiveIndex } from './MobileWorkspace'

// WidgetHost pulls the whole chart engine; the tab strip is what's under test.
vi.mock('../WidgetHost', () => ({
  default: ({ widget }) => <div data-testid="widget-body">{widget.type}</div>,
}))

// The shape ChartsWorkspace hands down once prefs resolve — Themes FIRST, which
// is the arrangement that produced the measured defect.
const HYDRATED = [
  { id: 'w-themes', type: 'themes', color: 'B', opts: {} },
  { id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D' } },
  { id: 'w-fund', type: 'fundamentals', color: 'A', opts: {} },
  { id: 'w-watch', type: 'watchlist', color: 'A', opts: {} },
]

const noop = () => {}

function renderWs(widgets) {
  return render(
    <MobileWorkspace
      widgets={widgets}
      onRemove={noop}
      onColorChange={noop}
      onOptsChange={noop}
      onAddWidget={noop}
    />,
  )
}

const selectedTabName = () => {
  const sel = screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')
  return sel ? sel.textContent.trim() : null
}

describe('defaultActiveIndex — the rule, stated once', () => {
  test('picks the first chart wherever it sits', () => {
    expect(defaultActiveIndex(HYDRATED)).toBe(HYDRATED.findIndex(w => w.type === 'chart'))
  })

  test('falls back to the first widget when there is no chart', () => {
    expect(defaultActiveIndex([{ id: 'a', type: 'themes' }, { id: 'b', type: 'watchlist' }])).toBe(0)
  })

  test('survives an empty or absent list', () => {
    expect(defaultActiveIndex([])).toBe(0)
    expect(defaultActiveIndex(undefined)).toBe(0)
  })
})

describe('COLD prefs — widgets arrive AFTER the first render', () => {
  test('lands on the chart, not on whatever is first', async () => {
    // CONTROL: the pre-hydration render must genuinely have nothing to pick
    // from, or this test proves nothing about ordering.
    const { rerender } = renderWs([])
    expect(screen.queryAllByRole('tab')).toHaveLength(0)

    rerender(
      <MobileWorkspace
        widgets={HYDRATED}
        onRemove={noop}
        onColorChange={noop}
        onOptsChange={noop}
        onAddWidget={noop}
      />,
    )

    expect(selectedTabName()).toBe('Chart')
    expect(screen.getByTestId('widget-body')).toHaveTextContent('chart')
  })

  test('the tab that is NOT selected is the one that used to win', () => {
    const { rerender } = renderWs([])
    rerender(
      <MobileWorkspace
        widgets={HYDRATED}
        onRemove={noop}
        onColorChange={noop}
        onOptsChange={noop}
        onAddWidget={noop}
      />,
    )
    const themes = screen.getAllByRole('tab').find(t => t.textContent.includes('Themes'))
    expect(themes).toHaveAttribute('aria-selected', 'false')
  })

  test('a later layout change still re-derives, until the user chooses', () => {
    const { rerender } = renderWs([])
    const reordered = [HYDRATED[3], HYDRATED[0], HYDRATED[1]] // chart moves to index 2
    rerender(
      <MobileWorkspace
        widgets={reordered}
        onRemove={noop}
        onColorChange={noop}
        onOptsChange={noop}
        onAddWidget={noop}
      />,
    )
    expect(selectedTabName()).toBe('Chart')
  })
})

describe('an explicit choice outranks the default', () => {
  test('tapping a tab sticks, and a later widgets change does not steal it back', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWs([])
    rerender(
      <MobileWorkspace
        widgets={HYDRATED}
        onRemove={noop}
        onColorChange={noop}
        onOptsChange={noop}
        onAddWidget={noop}
      />,
    )
    expect(selectedTabName()).toBe('Chart')

    await user.click(screen.getAllByRole('tab').find(t => t.textContent.includes('Watchlist')))
    expect(selectedTabName()).toBe('Watchlist')

    // Prefs settle again / another widget is added elsewhere.
    rerender(
      <MobileWorkspace
        widgets={[...HYDRATED, { id: 'w-scan', type: 'scanner', color: 'C', opts: {} }]}
        onRemove={noop}
        onColorChange={noop}
        onOptsChange={noop}
        onAddWidget={noop}
      />,
    )
    expect(selectedTabName()).toBe('Watchlist')
  })
})

describe('WARM prefs — the path that always looked fine', () => {
  test('still lands on the chart when widgets are present at first render', () => {
    renderWs(HYDRATED)
    expect(selectedTabName()).toBe('Chart')
  })
})
