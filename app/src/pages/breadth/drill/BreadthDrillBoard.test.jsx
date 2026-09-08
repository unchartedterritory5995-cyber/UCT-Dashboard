// BreadthDrillBoard — the two-pane geometry, pop-out, and the PHONE layout.
//
// The phone rules live in CSS (`data-pane` + a max-width query) precisely so
// first paint is correct without a JS breakpoint read — useMediaQuery seeds at
// mount and only updates on a `change` event, so in a fixed mobile viewport a
// render-time read is stale exactly when it matters. CSS modules are not applied
// in jsdom, so these tests assert the CONTRACT the stylesheet keys off: that the
// attribute is published and the panes carry stable, selectable classes.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
import { defaultBoard, LIST_WIDGET_ID, CHART_WIDGET_ID, SPLIT_MIN, SPLIT_MAX } from './drillBoardPrefs'

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


// ── The divider is a control, so it must work without a pointer ──────────────
// A `role="separator"` that a user can operate is an ARIA widget: it has to be
// reachable by Tab and report its value. It had the role and the label but no
// tabIndex, no key handling and no value — so the split was mouse-only, and a
// screen reader was told "separator" with nothing to act on.
describe('BreadthDrillBoard — the split resizes from the keyboard', () => {
  const sep = (c) => c.querySelector('[role="separator"]')

  const mountWithState = (start = 340) => {
    let board = { ...defaultBoard(), split: start }
    const onBoardChange = vi.fn((fn) => { board = typeof fn === 'function' ? fn(board) : fn })
    const utils = render(<BreadthDrillBoard board={board} onBoardChange={onBoardChange} />)
    return { ...utils, onBoardChange, get split() { return board.split } }
  }

  it('is reachable by Tab and reports its value to assistive tech', () => {
    const { container } = mount()
    const d = sep(container)
    expect(d.getAttribute('tabindex')).toBe('0')
    expect(d.getAttribute('aria-valuenow')).toBe('340')
    // ⛔ Read off the module, never retyped — a hand-copied bound is the pair that
    // drifts silently because nobody can see aria values.
    expect(d.getAttribute('aria-valuemin')).toBe(String(SPLIT_MIN))
    expect(d.getAttribute('aria-valuemax')).toBe(String(SPLIT_MAX))
  })

  it('arrow keys move the split in both directions', () => {
    const v = mountWithState(340)
    const d = sep(v.container)
    fireEvent.keyDown(d, { key: 'ArrowRight' })
    expect(v.split).toBeGreaterThan(340)
    const wider = v.split
    fireEvent.keyDown(d, { key: 'ArrowLeft' })
    fireEvent.keyDown(d, { key: 'ArrowLeft' })
    expect(v.split).toBeLessThan(wider)
  })

  it('Shift takes a bigger step than a bare arrow', () => {
    const a = mountWithState(400); fireEvent.keyDown(sep(a.container), { key: 'ArrowRight' })
    const b = mountWithState(400); fireEvent.keyDown(sep(b.container), { key: 'ArrowRight', shiftKey: true })
    expect(b.split - 400).toBeGreaterThan(a.split - 400)
  })

  it('Home and End go to the stops, and never past them', () => {
    const v = mountWithState(400)
    fireEvent.keyDown(sep(v.container), { key: 'Home' })
    expect(v.split).toBe(SPLIT_MIN)
    fireEvent.keyDown(sep(v.container), { key: 'End' })
    expect(v.split).toBe(SPLIT_MAX)
  })

  it('clamps at the stops rather than running away', () => {
    const v = mountWithState(SPLIT_MAX)
    for (let i = 0; i < 12; i++) fireEvent.keyDown(sep(v.container), { key: 'ArrowRight', shiftKey: true })
    expect(v.split).toBe(SPLIT_MAX)
  })

  it('a key it does not own is left alone for the page', () => {
    const v = mountWithState(340)
    fireEvent.keyDown(sep(v.container), { key: 'a' })
    expect(v.onBoardChange).not.toHaveBeenCalled()
  })

  it('resizing does not also walk the watchlist selection', () => {
    // Watchlists binds arrows on `window`; without stopPropagation one arrow would
    // both resize the pane and move the selected row.
    const v = mountWithState(340)
    const onWindow = vi.fn()
    window.addEventListener('keydown', onWindow)
    fireEvent.keyDown(sep(v.container), { key: 'ArrowRight' })
    window.removeEventListener('keydown', onWindow)
    expect(onWindow).not.toHaveBeenCalled()
  })
})
