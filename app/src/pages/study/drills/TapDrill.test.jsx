/** TapDrill rails (spec §4.3 type 14, §13.7 D10, D18). */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { Body, ChartOverlay, answerFromState, isAnswerable, annotationsFor, onChartTap, framingOf } from './TapDrill'

function bars(n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const day = String(i + 1).padStart(2, '0')
    out.push({ t: `2025-03-${day}`, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 100 })
  }
  return out
}

const item = { id: 't1', type: 'tap', prompt_json: { question: 'Tap the pivot.', target: 'the pivot' }, bars: { symbol: 't1', tf: 'D', bars: bars(12) } }

function Host({ locked = false, reveal = null }) {
  const [state, setState] = useState(null)
  const list = bars(12)
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <ChartOverlay item={item} state={state} setState={setState} locked={locked} reveal={reveal} bars={list} />
      </div>
      <Body item={item} state={state} setState={setState} locked={locked} reveal={reveal} />
      <button type="button" onClick={() => setState((s) => onChartTap(s, { barIndex: 3, price: 14.2 }, item, list))}>tap-3</button>
      <button type="button" onClick={() => setState((s) => onChartTap(s, { time: '2025-03-08', price: 18.9 }, item, list))}>tap-8</button>
      <output data-testid="answer">{JSON.stringify(answerFromState(state))}</output>
      <output data-testid="answerable">{String(isAnswerable(state))}</output>
      <output data-testid="annotations">{JSON.stringify(annotationsFor(state, item, reveal, list).map((a) => a.id))}</output>
    </div>
  )
}

describe('TapDrill', () => {
  it('reads "Tap the pivot" before a tap, places on the first tap, and the second tap MOVES the anchor', () => {
    render(<Host />)
    expect(screen.getByTestId('tap-hud')).toHaveTextContent('Tap the pivot')
    expect(screen.getByTestId('tap-status')).toHaveTextContent('Tap the pivot on the chart.')
    expect(screen.getByTestId('answerable')).toHaveTextContent('false')

    fireEvent.click(screen.getByText('tap-3'))
    expect(screen.getByTestId('tap-hud')).toHaveTextContent('Tap Check, or tap again to move')
    expect(screen.getByTestId('tap-status')).toHaveTextContent('Marker on 2025-03-04 at 14.20.')
    expect(JSON.parse(screen.getByTestId('answer').textContent)).toEqual({ bar_index: 3, price: 14.2, time: '2025-03-04' })
    expect(screen.getByTestId('answerable')).toHaveTextContent('true')

    fireEvent.click(screen.getByText('tap-8'))
    expect(screen.getByTestId('tap-status')).toHaveTextContent('Marker on 2025-03-08 at 18.90.')
    expect(JSON.parse(screen.getByTestId('answer').textContent)).toEqual({ bar_index: 7, price: 18.9, time: '2025-03-08' })
    // Still ONE anchor: a dot and a halo, never two markers.
    expect(JSON.parse(screen.getByTestId('annotations').textContent)).toEqual(['study-tap-dot', 'study-tap-halo'])
  })

  it('the keyboard cursor moves one bar with the arrows, reads the bar aloud, and Enter places', () => {
    render(<Host />)
    const cursor = screen.getByTestId('tap-keyboard-cursor')
    expect(cursor).toHaveTextContent('Bar 12 of 12, 2025-03-12')
    fireEvent.keyDown(cursor, { key: 'ArrowLeft' })
    expect(screen.getByTestId('tap-live')).toHaveTextContent('Bar 11 of 12, 2025-03-11: open 20, high 21, low 19, close 20.5')
    fireEvent.keyDown(cursor, { key: 'ArrowLeft' })
    fireEvent.keyDown(cursor, { key: 'Enter' })
    expect(screen.getByTestId('tap-live')).toHaveTextContent('Placed on Bar 10 of 12')
    // The target says "pivot", so the placed price is that bar's high.
    expect(JSON.parse(screen.getByTestId('answer').textContent)).toEqual({ bar_index: 9, price: 20, time: '2025-03-10' })
    fireEvent.keyDown(cursor, { key: 'Home' })
    expect(screen.getByTestId('tap-live')).toHaveTextContent('Bar 1 of 12')
  })

  it('on reveal the accepted region prints as a dashed ring and the HUD reads Placed', () => {
    const reveal = { answer: { bar_index: 7, bar_tol: 1, price: 18, price_tol_pct: 2 } }
    render(<Host locked reveal={reveal} />)
    expect(screen.getByTestId('tap-hud')).toHaveTextContent('Placed')
    const ring = annotationsFor(null, item, reveal, bars(12)).find((a) => a.id === 'study-tap-ring')
    expect(ring).toBeTruthy()
    expect(ring.lineStyle).toBe('dashed')
    expect(ring.points[0].time).toBe('2025-03-06')
    expect(ring.points[1].time).toBe('2025-03-10')
    expect(ring.points[0].price).toBeLessThan(18 * 0.98)
    expect(ring.points[1].price).toBeGreaterThan(18 * 1.02)
    expect(screen.getByTestId('tap-keyboard-cursor')).toBeDisabled()
  })

  it('a box key draws the ring over the box; a tap outside the bars is ignored', () => {
    const list = bars(12)
    const ring = annotationsFor(null, item, { answer: { bar_from: 2, bar_to: 4, price_lo: 11, price_hi: 15 } }, list).find((a) => a.id === 'study-tap-ring')
    expect(ring.points[0].time).toBe('2025-03-02')
    expect(ring.points[1].time).toBe('2025-03-06')
    expect(onChartTap(null, { time: '1999-01-01', price: 1 }, item, list)).toBeNull()
    expect(onChartTap(null, { barIndex: 99 }, item, list).barIndex).toBe(11)
    expect(framingOf(item)).toBe('Daily chart, 12 bars. Tap the pivot.')
  })
})
