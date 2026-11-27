// The board switch mark (boardSwitchMark.js): the grid's `charts-switching` class, on for the commit that shows a new
// layout and off two frames after it.
//   B1 marked, then committed: the class comes off two frames after the commit, not before
//   B2 a newer switch keeps the mark: the older switch's frames do not take it off
//   B3 (red first, review of #2860) a switch whose board never commits (X then the board on screen, one batch: React bails
//      out, no layout effect runs) still comes off: a fallback after SWITCH_MARK_FALLBACK_MS arms the frames, so a later
//      drag keeps react-grid-layout's transition
//   B4 the fallback of an older switch never arms the frames for a newer one still waiting on its commit
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBoardSwitchMark, SWITCH_MARK_CLASS, SWITCH_MARK_FALLBACK_MS } from './boardSwitchMark'

let frames
const raf = (f) => { frames.push(f) }
const flushFrame = () => { const run = frames.splice(0); run.forEach((f) => f()) }
const grid = () => { const el = document.createElement('div'); el.className = 'react-grid-layout layout'; return el }
const marked = (el) => el.classList.contains(SWITCH_MARK_CLASS)

beforeEach(() => { frames = []; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('board switch mark', () => {
  it('B1 marked, then committed: off two frames after the commit, not before', () => {
    const m = createBoardSwitchMark({ raf })
    const g = grid()
    m.mark(g)
    expect(marked(g)).toBe(true)
    flushFrame()                       // a frame before the commit spends nothing
    expect(marked(g)).toBe(true)
    m.committed()
    flushFrame()
    expect(marked(g), 'off one frame after the commit: that frame may not have computed its styles').toBe(true)
    flushFrame()
    expect(marked(g)).toBe(false)
  })

  it('B2 a newer switch keeps the mark', () => {
    const m = createBoardSwitchMark({ raf })
    const g = grid()
    m.mark(g)
    m.committed()
    flushFrame()
    m.mark(g)                          // a newer switch before the first one's frames ran out
    flushFrame()
    expect(marked(g), 'the older switch took the newer one\'s mark off').toBe(true)
    m.committed()
    flushFrame(); flushFrame()
    expect(marked(g)).toBe(false)
  })

  it('B3 (red first) a switch whose board never commits still comes off after the fallback', () => {
    const m = createBoardSwitchMark({ raf })
    const g = grid()
    m.mark(g)                          // X ... then the board on screen in the same batch: no commit, no committed()
    vi.advanceTimersByTime(SWITCH_MARK_FALLBACK_MS)
    flushFrame(); flushFrame()
    expect(marked(g), 'the mark stayed on: every later drag would lose its transition').toBe(false)
  })

  it('B4 an older switch\'s fallback never arms the frames for a newer one still waiting on its commit', () => {
    const m = createBoardSwitchMark({ raf })
    const g = grid()
    m.mark(g)                          // switch 1: never commits
    vi.advanceTimersByTime(SWITCH_MARK_FALLBACK_MS - 50)
    m.mark(g)                          // switch 2: its commit comes later
    vi.advanceTimersByTime(60)         // switch 1's fallback fires now
    flushFrame(); flushFrame()
    expect(marked(g), 'switch 1\'s fallback took off switch 2\'s mark before its board committed').toBe(true)
    m.committed()
    flushFrame(); flushFrame()
    expect(marked(g)).toBe(false)
  })
})
