import { render, screen, fireEvent } from '@testing-library/react'
import { vi, afterEach } from 'vitest'
import useSwipeAction from './useSwipeAction'

afterEach(() => { delete navigator.vibrate })

function Probe({ onSwipeLeft, onSwipeRight }) {
  const { offset, props } = useSwipeAction({ onSwipeLeft, onSwipeRight, threshold: 60 })
  return <div data-testid="row" data-offset={offset} {...props}>row</div>
}

test('swiping left past the threshold fires onSwipeLeft', () => {
  const onSwipeLeft = vi.fn()
  render(<Probe onSwipeLeft={onSwipeLeft} />)
  const row = screen.getByTestId('row')
  fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 200 })
  fireEvent.pointerMove(row, { clientX: 120 }) // dx = -80
  fireEvent.pointerUp(row, { clientX: 120 })
  expect(onSwipeLeft).toHaveBeenCalledTimes(1)
})

test('swiping right past the threshold fires onSwipeRight', () => {
  const onSwipeRight = vi.fn()
  render(<Probe onSwipeRight={onSwipeRight} />)
  const row = screen.getByTestId('row')
  fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 100 })
  fireEvent.pointerMove(row, { clientX: 180 }) // dx = +80
  fireEvent.pointerUp(row, { clientX: 180 })
  expect(onSwipeRight).toHaveBeenCalledTimes(1)
})

test('a small drag under the threshold does not fire and resets offset to 0', () => {
  const onSwipeLeft = vi.fn()
  render(<Probe onSwipeLeft={onSwipeLeft} />)
  const row = screen.getByTestId('row')
  fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 200 })
  fireEvent.pointerMove(row, { clientX: 180 }) // dx = -20
  fireEvent.pointerUp(row, { clientX: 180 })
  expect(onSwipeLeft).not.toHaveBeenCalled()
  expect(row.getAttribute('data-offset')).toBe('0')
})

test('mouse pointer is ignored (touch-only)', () => {
  const onSwipeLeft = vi.fn()
  render(<Probe onSwipeLeft={onSwipeLeft} />)
  const row = screen.getByTestId('row')
  fireEvent.pointerDown(row, { pointerType: 'mouse', clientX: 200 })
  fireEvent.pointerMove(row, { clientX: 100 })
  fireEvent.pointerUp(row, { clientX: 100 })
  expect(onSwipeLeft).not.toHaveBeenCalled()
})
