import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MetersView from './MetersView'

const metrics = [
  { key: 'pct_above_50sma', label: '>50 SMA', getTier: () => 'g2', getFmt: () => '57.8%',
    drillKey: null },
  { key: 'vix', label: 'VIX', getTier: () => 'a', getFmt: () => '16.0', drillKey: null },
]
const row = { pct_above_50sma: 57.8, vix: 16 }

describe('MetersView', () => {
  it('renders a labeled meter per metric with its value', () => {
    render(<MetersView currentRow={row} metrics={metrics} normalize={() => 57.8} onDrill={() => {}} />)
    expect(screen.getByText('>50 SMA')).toBeInTheDocument()
    expect(screen.getByText('57.8%')).toBeInTheDocument()
  })
  it('positions the marker at the normalized value', () => {
    render(<MetersView currentRow={row} metrics={metrics} normalize={() => 58} onDrill={() => {}} />)
    const marker = screen.getByTestId('meters-marker-pct_above_50sma')
    expect(marker).toHaveStyle({ left: '58%' })
  })
  it('clicking a meter with a drillKey calls onDrill', () => {
    const onDrill = vi.fn()
    const withDrill = [{ ...metrics[0], drillKey: 'x_list' }]
    render(<MetersView currentRow={row} metrics={withDrill} normalize={() => 58} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('>50 SMA details'))
    expect(onDrill).toHaveBeenCalledWith(withDrill[0])
  })
})

/**
 * ⭐ THE GHOST IS THE ROW'S SECOND FACT. `prevRow` is the session the container
 * already hands every board — the one Signal of the Day is measured against — so
 * the row can answer "and which way is it moving?" without a second data source.
 */
describe('MetersView movement + scale', () => {
  const prev = { pct_above_50sma: 30, vix: 16 }

  it('marks where the metric sat three sessions back', () => {
    const { container } = render(
      <MetersView currentRow={row} prevRow={prev} metrics={metrics}
                  normalize={(m, r) => (r === prev ? 30 : 58)} onDrill={() => {}} />)
    expect(container.querySelector('[data-testid="meters-ghost-pct_above_50sma"]').style.left)
      .toBe('30%')
  })

  it('draws no ghost when the window has no earlier session to point at', () => {
    const { container } = render(
      <MetersView currentRow={row} metrics={metrics} normalize={() => 58} onDrill={() => {}} />)
    expect(container.querySelector('[data-testid^="meters-ghost-"]')).toBeNull()
  })

  it('numbers the track the markers are read against', () => {
    const { container } = render(
      <MetersView currentRow={row} metrics={metrics} normalize={() => 58} onDrill={() => {}} />)
    const scale = container.querySelector('[data-testid="meters-scale"]')
    expect(scale.textContent).toBe('OVERSOLD0255075100OVERBOUGHT')
  })
})
