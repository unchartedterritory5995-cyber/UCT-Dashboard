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

/* The release-click swallow: a FIRED long-press releases into a synthetic
 * click, which used to also run the element's own onClick — selecting the row
 * underneath the menu the press just opened. The hook now swallows exactly
 * that one click, and nothing else. */
function ClickProbe({ onTrigger, onClick }) {
  const lp = useLongPress(onTrigger)
  return <div data-testid="target" {...lp} onClick={onClick}>press me</div>
}

test('the click that releases a FIRED long-press is swallowed', () => {
  vi.useFakeTimers()
  const onTrigger = vi.fn()
  const onClick = vi.fn()
  render(<ClickProbe onTrigger={onTrigger} onClick={onClick} />)
  const el = screen.getByTestId('target')
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 10, clientY: 10 })
  act(() => { vi.advanceTimersByTime(460) })
  expect(onTrigger).toHaveBeenCalledTimes(1)
  fireEvent.pointerUp(el)
  fireEvent.click(el)
  expect(onClick).not.toHaveBeenCalled()
  // …and only THAT click: the next tap goes through normally.
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 10, clientY: 10 })
  fireEvent.pointerUp(el)
  fireEvent.click(el)
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('a plain tap (released before the threshold) clicks normally', () => {
  vi.useFakeTimers()
  const onTrigger = vi.fn()
  const onClick = vi.fn()
  render(<ClickProbe onTrigger={onTrigger} onClick={onClick} />)
  const el = screen.getByTestId('target')
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 10, clientY: 10 })
  act(() => { vi.advanceTimersByTime(100) })
  fireEvent.pointerUp(el)
  fireEvent.click(el)
  expect(onTrigger).not.toHaveBeenCalled()
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('a right-click never arms the swallow — the next mouse click passes', () => {
  const onTrigger = vi.fn()
  const onClick = vi.fn()
  render(<ClickProbe onTrigger={onTrigger} onClick={onClick} />)
  const el = screen.getByTestId('target')
  fireEvent.contextMenu(el)
  expect(onTrigger).toHaveBeenCalledTimes(1)
  fireEvent.click(el)
  expect(onClick).toHaveBeenCalledTimes(1)
})
