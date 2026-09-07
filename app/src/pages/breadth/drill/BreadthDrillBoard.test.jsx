// BreadthDrillBoard — the two-pane geometry, pop-out, and the PHONE layout.
//
// The phone rules live in CSS (`data-pane` + a max-width query) precisely so
// first paint is correct without a JS breakpoint read — useMediaQuery seeds at
// mount and only updates on a `change` event, so in a fixed mobile viewport a
// render-time read is stale exactly when it matters. CSS modules are not applied
// in jsdom, so these tests assert the CONTRACT the stylesheet keys off: that the
// attribute is published and the panes carry stable, selectable classes.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let hosted = []
vi.mock('../../charts/WidgetHost', () => ({
  default: ({ widget, onPopOut }) => {
    hosted.push(widget.id)
    return (
      <div data-testid={`host-${widget.id}`}>
        {onPopOut && <button onClick={onPopOut}>pop {widget.id}</button>}
      </div>
    )
  },
}))

import BreadthDrillBoard from './BreadthDrillBoard'
import { defaultBoard, LIST_WIDGET_ID, CHART_WIDGET_ID } from './drillBoardPrefs'

function mount(props = {}) {
  hosted = []
  const board = defaultBoard()
  return render(
    <BreadthDrillBoard board={board} onBoardChange={() => {}} {...props} />,
  )
}

const boardEl = (c) => c.querySelector('[data-pane]')

describe('BreadthDrillBoard — desktop geometry', () => {
  it('hosts both widgets with a resize handle between them', () => {
    const { container } = mount()
    expect(hosted).toEqual([LIST_WIDGET_ID, CHART_WIDGET_ID])
    expect(container.querySelector('[role="separator"]')).toBeTruthy()
  })

  it('publishes data-pane for the stylesheet to key off', () => {
    const { container } = mount({ mobilePane: 'chart' })
    expect(boardEl(container).getAttribute('data-pane')).toBe('chart')
  })

  it('defaults to the list pane', () => {
    const { container } = mount()
    expect(boardEl(container).getAttribute('data-pane')).toBe('list')
  })
})

describe('BreadthDrillBoard — pop-out', () => {
  it('⛔ a popped widget is NOT also rendered by the board', () => {
    // The same widget mounted twice runs two copies of its state and both answer
    // the keyboard. The modal renders the popped one into its own window.
    mount({ poppedIds: [CHART_WIDGET_ID], onPopOut: () => {} })
    expect(hosted).toEqual([LIST_WIDGET_ID])
  })

  it('the surviving pane takes the whole board — no dead gap, no divider', () => {
    const { container } = mount({ poppedIds: [CHART_WIDGET_ID], onPopOut: () => {} })
    expect(container.querySelector('[role="separator"]')).toBeNull()
  })

  it('both popped says why the board is empty rather than showing a void', () => {
    mount({ poppedIds: [LIST_WIDGET_ID, CHART_WIDGET_ID], onPopOut: () => {} })
    expect(hosted).toEqual([])
    expect(screen.getByText(/own windows/i)).toBeTruthy()
  })

  it('offers no pop-out control when the host supplies no handler', () => {
    mount()
    expect(screen.queryByText(/^pop /)).toBeNull()
  })
})

describe('BreadthDrillBoard — the phone contract', () => {
  it('both panes carry stable classes the phone query can select', () => {
    // If these class hooks are ever renamed, the CSS silently stops hiding a
    // pane and the phone gets the unusable 330px/60px split back.
    const { container } = mount()
    const panes = [...container.querySelectorAll('[data-pane] > div')]
    const classes = panes.map(p => p.className).join(' ')
    expect(classes).toMatch(/paneList/)
    expect(classes).toMatch(/paneChart/)
  })

  it('keeps BOTH panes mounted while switching — the chart is hidden, not torn down', () => {
    // Unmounting the chart on every toggle would re-fetch bars and re-frame the
    // series each time you flip back. CSS hides it; React keeps it.
    mount({ mobilePane: 'chart' })
    expect(hosted).toEqual([LIST_WIDGET_ID, CHART_WIDGET_ID])
  })
})
