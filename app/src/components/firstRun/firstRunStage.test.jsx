// app/src/components/firstRun/firstRunStage.test.jsx
//
// The first-run stage store (wave 10 follow-up F5): the slot a one-time card is
// portaled into, and the hold a first-run tour takes while it is open. The two
// readers (FloatingOrb's "Meet Compass" card, NotebookTour) are railed in their own
// files; this one holds the store's own contract.
import { describe, it, expect, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import {
  registerFirstRunSlot, getFirstRunSlot, useFirstRunSlot,
  claimFirstRunStage, isFirstRunStageHeld, useFirstRunStageHeld,
  getFirstRunStageHolderCount, useFirstRunStageHolderCount,
} from './firstRunStage'

afterEach(() => { registerFirstRunSlot(null) })

describe('first-run stage: the slot', () => {
  it('holds the element Layout registers, and forgets it on unmount (null)', () => {
    const el = document.createElement('div')
    registerFirstRunSlot(el)
    expect(getFirstRunSlot()).toBe(el)
    registerFirstRunSlot(null)
    expect(getFirstRunSlot()).toBe(null)
  })

  it('re-renders a reader when the slot arrives and when it goes', () => {
    const seen = []
    function Reader() {
      seen.push(useFirstRunSlot())
      return null
    }
    render(<Reader />)
    const el = document.createElement('div')
    act(() => { registerFirstRunSlot(el) })
    act(() => { registerFirstRunSlot(null) })
    expect(seen[0]).toBe(null)
    expect(seen).toContain(el)
    expect(seen[seen.length - 1]).toBe(null)
  })
})

describe('first-run stage: the hold', () => {
  it('is held while any claim is open, and released when the LAST one closes', () => {
    expect(isFirstRunStageHeld()).toBe(false)
    const a = claimFirstRunStage()
    const b = claimFirstRunStage()
    expect(isFirstRunStageHeld()).toBe(true)
    a()
    expect(isFirstRunStageHeld(), 'one claim still open').toBe(true)
    b()
    expect(isFirstRunStageHeld()).toBe(false)
  })

  it('a release called twice is a no-op -- it never frees another claim', () => {
    const a = claimFirstRunStage()
    const b = claimFirstRunStage()
    a()
    a()
    expect(isFirstRunStageHeld(), 'b is still open').toBe(true)
    b()
    expect(isFirstRunStageHeld()).toBe(false)
  })

  it('re-renders a reader when the hold changes', () => {
    const seen = []
    function Reader() {
      seen.push(useFirstRunStageHeld())
      return null
    }
    render(<Reader />)
    let release
    act(() => { release = claimFirstRunStage() })
    act(() => { release() })
    expect(seen).toEqual([false, true, false])
  })
})

describe('first-run stage: the holder count (wave 14, W14-C2)', () => {
  it('counts open claims, so a claimant can tell its own hold from another one', () => {
    expect(getFirstRunStageHolderCount()).toBe(0)
    const mine = claimFirstRunStage()
    expect(getFirstRunStageHolderCount() - 1 > 0, 'only my own claim: not held by others').toBe(false)
    const theirs = claimFirstRunStage()
    expect(getFirstRunStageHolderCount() - 1 > 0, 'a second claim: held by others').toBe(true)
    theirs()
    mine()
    expect(getFirstRunStageHolderCount()).toBe(0)
  })

  it('re-renders a reader when the count changes', () => {
    const seen = []
    function Reader() {
      seen.push(useFirstRunStageHolderCount())
      return null
    }
    render(<Reader />)
    let a
    let b
    act(() => { a = claimFirstRunStage() })
    act(() => { b = claimFirstRunStage() })
    act(() => { a(); b() })
    expect(seen).toEqual([0, 1, 2, 0])
  })
})
