// W14-Q2, measured in a real browser at 1200 px: the chart embed's toolbar is shown on hover
// and while a tour marks the chart or a control in it (`data-tour-active`, read by
// WidgetEmbedView.module.css). On Next from the chart to its Draw button the engine cleared
// the chart's marker first, the toolbar lost its box, and the new marker was never set
// because the engine only marked an anchor that was on screen at that instant. The card said
// "Step 2 of 6" and pointed at nothing; the Plan and Replay steps after it were skipped.
//
// This rail reproduces the CSS in the fixture, synchronously: the inner control has a box
// only while it, or its container, carries the marker.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCallback } from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { installTourLayout } from './__fixtures__/tourLayout'

const STEPS = [
  { id: 'chart', anchor: 'q2-frame', file: 'x' },
  { id: 'draw', anchor: 'q2-draw', file: 'x' },
]
const TOUR = {
  id: 'q2-reveal',
  title: 'q2-reveal',
  replayable: true,
  load: async () => ({
    steps: STEPS,
    copy: { chart: { title: 'The chart', body: 'A.' }, draw: { title: 'Draw', body: 'B.' } },
  }),
}

const BOX = { left: 100, top: 100, right: 300, bottom: 140 }
const rect = (b) => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON() { return b } })

function Page() {
  // the toolbar rule: the control has a box only while the frame or the control is marked
  const revealWhileMarked = useCallback((btn) => {
    if (!btn) return
    const shown = () => Boolean(btn.closest('[data-tour-active]') || btn.hasAttribute('data-tour-active'))
    btn.getClientRects = () => (shown() ? [rect(BOX)] : [])
    btn.getBoundingClientRect = () => (shown() ? rect(BOX) : rect({ left: 0, top: 0, right: 0, bottom: 0 }))
  }, [])
  return (
    <div data-tour="q2-frame">
      chart
      <button type="button" ref={revealWhileMarked} data-tour="q2-draw">Draw</button>
    </div>
  )
}

beforeEach(() => {
  installTourLayout()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { vi.restoreAllMocks() })

describe('a "do this to continue" step brings its control clear of the card', () => {
  // W14-Q2 at 390 px: 'nearest' left Templates at the bottom edge, under the pinned card.
  const WAIT_TOUR = {
    id: 'q2-wait',
    title: 'q2-wait',
    replayable: true,
    load: async () => ({
      steps: [
        { id: 'plain', anchor: 'q2-plain', file: 'x' },
        { id: 'press', anchor: 'q2-press', file: 'x', waitFor: 'q2-opened' },
        { id: 'opened', anchor: 'q2-opened', file: 'x' },
      ],
      copy: { plain: { title: 'Plain', body: 'P.' }, press: { title: 'Press it', body: 'Q.' }, opened: { title: 'Opened', body: 'R.' } },
    }),
  }

  it('the plain step scrolls to "nearest"; the waitFor step centres its control', async () => {
    const calls = []
    Element.prototype.scrollIntoView = function scrollIntoView(opts) { calls.push([this.getAttribute('data-tour'), opts?.block]) }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={['/journal/notebook']}>
          <div data-tour="q2-plain">plain</div>
          <button type="button" data-tour="q2-press">Press</button>
          <GenericTourEngine entry={WAIT_TOUR} onClose={vi.fn()} startWaitMs={50} stepWaitMs={100} />
        </MemoryRouter>
      </SWRConfig>,
    )
    await screen.findByRole('dialog', { name: 'Plain' })
    act(() => { screen.getByRole('button', { name: 'Next' }).click() })
    await screen.findByRole('dialog', { name: 'Press it' })
    expect(calls).toContainEqual(['q2-plain', 'nearest'])
    expect(calls).toContainEqual(['q2-press', 'center'])
    delete Element.prototype.scrollIntoView
  })
})

describe('a control revealed only while a tour marks it can be walked to', () => {
  it('Next from the container to the hover-revealed control: the control is marked and the step stays', async () => {
    const onClose = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={['/journal/notebook']}>
          <Page />
          <GenericTourEngine entry={TOUR} onClose={onClose} startWaitMs={50} stepWaitMs={100} />
        </MemoryRouter>
      </SWRConfig>,
    )
    await screen.findByRole('dialog', { name: 'The chart' })
    act(() => { screen.getByRole('button', { name: 'Next' }).click() })
    await screen.findByRole('dialog', { name: 'Draw' })
    const draw = document.querySelector('[data-tour="q2-draw"]')
    expect(draw.getAttribute('data-tour-active')).toBe('true')
    // well past the "never point at nothing" wait: still on the control, tour not ended
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(screen.getByRole('dialog', { name: 'Draw' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
