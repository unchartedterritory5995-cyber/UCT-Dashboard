import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, afterEach } from 'vitest'
import useLongPress from './useLongPress'

function Probe({ onTrigger, opts }) {
  const lp = useLongPress(onTrigger, opts)
  return <div data-testid="target" {...lp}>press me</div>
}

afterEach(() => { vi.useRealTimers() })

test('right-click (contextmenu) fires the handler immediately', () => {
  const onTrigger = vi.fn()
  render(<Probe onTrigger={onTrigger} />)
  fireEvent.contextMenu(screen.getByTestId('target'))
  expect(onTrigger).toHaveBeenCalledTimes(1)
})

test('touch press held past the threshold fires the handler', () => {
  vi.useFakeTimers()
  const onTrigger = vi.fn()
  render(<Probe onTrigger={onTrigger} opts={{ ms: 450 }} />)
  fireEvent.pointerDown(screen.getByTestId('target'), { pointerType: 'touch', clientX: 10, clientY: 10 })
  expect(onTrigger).not.toHaveBeenCalled()
  act(() => { vi.advanceTimersByTime(460) })
  expect(onTrigger).toHaveBeenCalledTimes(1)
})

test('moving past tolerance before the threshold cancels (it was a scroll)', () => {
  vi.useFakeTimers()
  const onTrigger = vi.fn()
  render(<Probe onTrigger={onTrigger} opts={{ ms: 450, moveTolerance: 10 }} />)
  const el = screen.getByTestId('target')
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 10, clientY: 10 })
  fireEvent.pointerMove(el, { clientX: 10, clientY: 40 }) // moved 30px > tolerance
  act(() => { vi.advanceTimersByTime(460) })
  expect(onTrigger).not.toHaveBeenCalled()
})

test('mouse pointerdown does not start the long-press timer', () => {
  vi.useFakeTimers()
  const onTrigger = vi.fn()
  render(<Probe onTrigger={onTrigger} />)
  fireEvent.pointerDown(screen.getByTestId('target'), { pointerType: 'mouse', clientX: 10, clientY: 10 })
  act(() => { vi.advanceTimersByTime(1000) })
  expect(onTrigger).not.toHaveBeenCalled()
})
