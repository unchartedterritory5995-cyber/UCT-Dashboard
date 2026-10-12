// UCT Agent sidebar resize (10-12): the dock's LEFT edge is a separator. Drag left = wider, right =
// narrower; keyboard arrows / Home / End / Enter; double-click resets; the width is clamped by the
// layout and kept across close/reopen and a reload (this browser's storage, like the open state).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import AgentDock from './AgentDock'
import {
  AGENT_WIDTH_KEY, AGENT_W_DEFAULT, AGENT_W_MIN, AGENT_W_MAX, MIN_BOARD, clampAgentWidth, maxAgentWidth, readAgentWidth,
} from './agentWidth'

const ROW = 1600
function mount(open = true) {
  return render(<div data-testid="row" style={{ display: 'flex' }}><AgentDock open={open}><div>panel</div></AgentDock></div>)
}
const handle = () => screen.getByTestId('agent-resizer')
const dockW = () => handle().parentElement.style.getPropertyValue('--agent-w')
const drag = (dx) => {
  fireEvent.pointerDown(handle(), { button: 0, clientX: 1000, pointerId: 1 })
  fireEvent.pointerMove(handle(), { clientX: 1000 + dx, pointerId: 1 })
  fireEvent.pointerUp(handle(), { clientX: 1000 + dx, pointerId: 1 })
}

beforeEach(() => {
  // jsdom has no layout: the row is ROW px wide
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: ROW, height: 800, top: 0, left: 0, right: ROW, bottom: 800, x: 0, y: 0 })
  try { localStorage.removeItem(AGENT_WIDTH_KEY) } catch { /* */ } })
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-agent-resizing') })

describe('agentWidth limits', () => {
  it('min, max and the room the charts keep', () => {
    expect(maxAgentWidth(4000)).toBe(AGENT_W_MAX)
    expect(maxAgentWidth(1100)).toBe(1100 - MIN_BOARD)
    expect(maxAgentWidth(600)).toBe(AGENT_W_MIN)                  // never below the minimum
    expect(clampAgentWidth(100, 1600)).toBe(AGENT_W_MIN)
    expect(clampAgentWidth(5000, 1600)).toBe(AGENT_W_MAX)
    expect(clampAgentWidth('junk', 1600)).toBe(AGENT_W_DEFAULT)
  })
  it('a stored width is read back; junk is the default', () => {
    expect(readAgentWidth()).toBe(AGENT_W_DEFAULT)
    localStorage.setItem(AGENT_WIDTH_KEY, '512')
    expect(readAgentWidth()).toBe(512)
    localStorage.setItem(AGENT_WIDTH_KEY, 'wide')
    expect(readAgentWidth()).toBe(AGENT_W_DEFAULT)
  })
})

describe('the resize handle', () => {
  it('is an accessible vertical separator with the current width and limits', () => {
    mount()
    expect(handle().getAttribute('role')).toBe('separator')
    expect(handle().getAttribute('aria-orientation')).toBe('vertical')
    expect(handle().getAttribute('aria-valuenow')).toBe(String(AGENT_W_DEFAULT))
    expect(handle().getAttribute('aria-valuemin')).toBe(String(AGENT_W_MIN))
    expect(dockW()).toBe(`${AGENT_W_DEFAULT}px`)
  })

  it('drag LEFT = wider, drag RIGHT = narrower; the width is stored', () => {
    mount()
    drag(-100)
    expect(dockW()).toBe(`${AGENT_W_DEFAULT + 100}px`)
    expect(localStorage.getItem(AGENT_WIDTH_KEY)).toBe(String(AGENT_W_DEFAULT + 100))
    drag(150)
    expect(dockW()).toBe(`${AGENT_W_DEFAULT - 50}px`)
  })

  it('a drag is clamped to the limits', () => {
    mount()
    drag(-2000)
    expect(dockW()).toBe(`${AGENT_W_MAX}px`)
    drag(2000)
    expect(dockW()).toBe(`${AGENT_W_MIN}px`)
  })

  it('a drag marks the page (no selection, col-resize) only while it lasts and stops the event', () => {
    mount()
    const down = fireEvent.pointerDown(handle(), { button: 0, clientX: 1000, pointerId: 1 })
    expect(down).toBe(false)                                        // preventDefault: no text selection
    expect(document.documentElement.hasAttribute('data-agent-resizing')).toBe(true)
    fireEvent.pointerUp(handle(), { clientX: 1000, pointerId: 1 })
    expect(document.documentElement.hasAttribute('data-agent-resizing')).toBe(false)
    expect(localStorage.getItem(AGENT_WIDTH_KEY)).toBe(null)        // no move ⇒ nothing stored
  })

  it('keyboard: ← wider, → narrower, Shift = big step, Home/End = limits, Enter = default', () => {
    mount()
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(dockW()).toBe(`${AGENT_W_DEFAULT + 16}px`)
    fireEvent.keyDown(handle(), { key: 'ArrowRight', shiftKey: true })
    expect(dockW()).toBe(`${AGENT_W_DEFAULT + 16 - 64}px`)
    fireEvent.keyDown(handle(), { key: 'Home' })
    expect(dockW()).toBe(`${AGENT_W_MIN}px`)
    fireEvent.keyDown(handle(), { key: 'End' })
    expect(dockW()).toBe(`${AGENT_W_MAX}px`)
    fireEvent.keyDown(handle(), { key: 'Enter' })
    expect(dockW()).toBe(`${AGENT_W_DEFAULT}px`)
  })

  it('double-click resets to the default', () => {
    mount()
    drag(-200)
    fireEvent.doubleClick(handle())
    expect(dockW()).toBe(`${AGENT_W_DEFAULT}px`)
  })

  it('the width survives close/reopen and a remount (reload)', () => {
    const r = mount()
    drag(-120)
    r.rerender(<div data-testid="row"><AgentDock open={false}><div>panel</div></AgentDock></div>)
    cleanup()
    mount()
    return waitFor(() => expect(dockW()).toBe(`${AGENT_W_DEFAULT + 120}px`))
  })
})
