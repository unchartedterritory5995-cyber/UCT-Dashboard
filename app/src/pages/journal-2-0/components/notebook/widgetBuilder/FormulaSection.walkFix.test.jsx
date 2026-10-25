// The waves 8-10 ship-walk fix round, W10.8 at 390 px:
//   * with the keyboard open (a visual viewport of about 390 x 400) the Formula box sat under the sticky Undo / Redo /
//     Save footer and its suggestions rendered below the visible area. The focused box is now scrolled into what is
//     visible, and the list opens ABOVE the box when there is no room under it (formulaListPlace.js);
//   * "Give the field a name." showed before the member had typed anything. It now waits until they typed in the
//     Name, left the field, or tried to save.
// The placement logic is tested pure for a short viewport, then through the real sheet with measured rectangles.
// Copy is asserted by rendered text. (The device re-check is the controller's.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS } from './WidgetBuilderSheet'
import { __resetBuiltCaches } from '../../../lib/builtWidgets'
import { installFetch, answer } from './__fixtures__/builderFixtures'
import { FORMULA_CATALOG } from './__fixtures__/formulaCatalog'
import { S_FORMULA_NAME } from './formulaFields'
import {
  visibleBand, revealDelta, placeList, scrollParentOf, LIST_MAX, LIST_MIN, LIST_GAP, REVEAL_MARGIN,
} from './formulaListPlace'

// ── the placement logic, pure, for a short viewport ──────────────────────────────────────────────────

describe('formulaListPlace: a phone with the keyboard up (visual viewport 390 x 400)', () => {
  // The sheet body scrolls from y 60 (under its title) to y 395 (the footer's top); the keyboard starts at 400.
  const BODY = { top: 60, bottom: 395 }
  const VV = { height: 400, offsetTop: 0 }

  it('the visible band is the scroll body cut to the visual viewport', () => {
    expect(visibleBand(BODY, VV)).toEqual({ top: 60, bottom: 395 })
    // the panel not yet shrunk (the body still reaches 780): the visual viewport is what cuts it
    expect(visibleBand({ top: 60, bottom: 780 }, VV)).toEqual({ top: 60, bottom: 400 })
    // an iOS visual viewport scrolled 120 px into the layout viewport
    expect(visibleBand({ top: 0, bottom: 844 }, { height: 400, offsetTop: 120 })).toEqual({ top: 120, bottom: 520 })
    // no visual viewport (an older browser): the body alone
    expect(visibleBand(BODY, null)).toEqual(BODY)
  })

  it('a box under the footer is scrolled up into view; one in view is left alone; a too-tall box shows its top', () => {
    const band = visibleBand(BODY, VV)
    // the walk's box: y 370-430, under the footer from 395
    expect(revealDelta({ top: 370, bottom: 430 }, band)).toBe(430 + REVEAL_MARGIN - 395)
    expect(revealDelta({ top: 200, bottom: 260 }, band)).toBe(0)
    // above the band (scrolled past): brought down
    expect(revealDelta({ top: 20, bottom: 80 }, band)).toBe(20 - REVEAL_MARGIN - 60)
    // taller than the band: its top is aligned, never pushed out
    expect(revealDelta({ top: 300, bottom: 800 }, band)).toBe(300 - REVEAL_MARGIN - 60)
  })

  it('no room under the box: the list opens ABOVE it, as tall as the room there', () => {
    const band = visibleBand(BODY, VV)
    const box = { top: 327, bottom: 387 }                    // the box once scrolled into view
    const p = placeList(box, band)
    expect(p.side).toBe('above')
    expect(p.maxHeight).toBe(327 - 60 - LIST_GAP)
  })

  it('room under the box: the list opens under it; a short list needs only its own height', () => {
    const band = visibleBand(BODY, VV)
    expect(placeList({ top: 70, bottom: 100 }, band)).toEqual({ side: 'below', maxHeight: LIST_MAX })
    // two options (96 px) fit in the 111 px under this box
    expect(placeList({ top: 250, bottom: 280 }, band, 96)).toEqual({ side: 'below', maxHeight: 395 - 280 - LIST_GAP })
    // ...and not in the 91 px under this one, so they open above it
    expect(placeList({ top: 250, bottom: 300 }, band, 96).side).toBe('above')
  })

  it('cramped both ways: under the box, squeezed but never below one option', () => {
    const p = placeList({ top: 70, bottom: 380 }, { top: 60, bottom: 395 })
    expect(p).toEqual({ side: 'below', maxHeight: LIST_MIN })
  })

  it('the scroll parent is the nearest vertically scrolling ancestor', () => {
    const outer = document.createElement('div')
    outer.style.overflowY = 'auto'
    const mid = document.createElement('div')
    const el = document.createElement('textarea')
    mid.appendChild(el)
    outer.appendChild(mid)
    document.body.appendChild(outer)
    expect(scrollParentOf(el)).toBe(outer)
    outer.remove()
    expect(scrollParentOf(document.createElement('textarea'))).toBeNull()
  })
})

// ── through the real sheet ───────────────────────────────────────────────────────────────────────────

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  installFetch([['GET', (u) => u.endsWith('/vocabulary'), () => answer(FORMULA_CATALOG)]])
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function openBuilder() {
  render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
}
const fieldGroups = () => screen.getAllByTestId('formula-field')
const boxOf = (g) => within(g).getByLabelText('Formula')
const nameOf = (g) => within(g).getByLabelText('Name')
async function addBlankField() {
  fireEvent.click(screen.getByRole('button', { name: 'Add your own field' }))
  await flush()
  return fieldGroups().at(-1)
}

describe('the Formula box with the keyboard open, in the sheet', () => {
  it('focus scrolls the box above the footer, and its suggestions open above it where there is no room under it', async () => {
    vi.stubGlobal('visualViewport', { height: 400, offsetTop: 0, addEventListener() {}, removeEventListener() {} })
    await openBuilder()
    const g = await addBlankField()
    const box = boxOf(g)
    // The sheet's scrolling body, as its stylesheet makes it (jsdom applies no CSS module), with the walk's geometry:
    // it shows y 60-395 (the footer's top) and the box sits at y 370-430, under the footer, until it is scrolled.
    const body = box.closest('[data-testid="widget-builder"]').parentElement
    body.style.overflowY = 'auto'
    let top = 0
    Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v } })
    body.getBoundingClientRect = () => ({ top: 60, bottom: 395, left: 0, right: 390, width: 390, height: 335 })
    box.getBoundingClientRect = () => ({ top: 370 - top, bottom: 430 - top, left: 16, right: 374, width: 358, height: 60 })

    act(() => { box.focus() })
    expect(top).toBe(430 + REVEAL_MARGIN - 395)                    // the box is now inside what is visible
    expect(box.getBoundingClientRect().bottom).toBeLessThanOrEqual(395 - REVEAL_MARGIN)

    fireEvent.change(box, { target: { value: '[' } })
    const list = screen.getByRole('listbox', { name: 'Suggestions' })
    expect(list).toHaveAttribute('data-side', 'above')
    const roomAbove = (370 - top) - 60 - LIST_GAP
    expect(list.style.maxHeight).toBe(`${roomAbove}px`)
  })

  it('CONTROL: with room under the box (no keyboard), the list opens under it and nothing scrolls', async () => {
    vi.stubGlobal('visualViewport', { height: 844, offsetTop: 0, addEventListener() {}, removeEventListener() {} })
    await openBuilder()
    const g = await addBlankField()
    const box = boxOf(g)
    const body = box.closest('[data-testid="widget-builder"]').parentElement
    body.style.overflowY = 'auto'
    let top = 0
    Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v } })
    body.getBoundingClientRect = () => ({ top: 60, bottom: 780, left: 0, right: 390, width: 390, height: 720 })
    box.getBoundingClientRect = () => ({ top: 200 - top, bottom: 260 - top, left: 16, right: 374, width: 358, height: 60 })
    act(() => { box.focus() })
    expect(top).toBe(0)
    fireEvent.change(box, { target: { value: '[' } })
    expect(screen.getByRole('listbox', { name: 'Suggestions' })).toHaveAttribute('data-side', 'below')
  })
})

describe('"Give the field a name." waits for the member (W10.8)', () => {
  it('a new field says nothing; typing in the Name and clearing it says it', async () => {
    await openBuilder()
    const g = await addBlankField()
    expect(within(g).queryByText(S_FORMULA_NAME)).toBeNull()
    expect(nameOf(g)).not.toHaveAttribute('aria-invalid')
    // moving from the Name to the Formula box is still inside the field: nothing yet
    fireEvent.change(boxOf(g), { target: { value: '[Net' } })
    expect(within(g).queryByText(S_FORMULA_NAME)).toBeNull()
    fireEvent.change(nameOf(g), { target: { value: 'E' } })
    fireEvent.change(nameOf(g), { target: { value: '' } })
    expect(within(g).getByText(S_FORMULA_NAME)).toBeInTheDocument()
    expect(nameOf(g)).toHaveAttribute('aria-invalid', 'true')
    expect(nameOf(g)).toHaveAccessibleDescription(S_FORMULA_NAME)
  })

  it('leaving the field without a name says it', async () => {
    await openBuilder()
    const g = await addBlankField()
    fireEvent.focusOut(nameOf(g), { relatedTarget: boxOf(g) })      // Name -> Formula: still inside
    expect(within(g).queryByText(S_FORMULA_NAME)).toBeNull()
    fireEvent.focusOut(boxOf(g), { relatedTarget: null })          // out of the field
    expect(within(g).getByText(S_FORMULA_NAME)).toBeInTheDocument()
  })

  it('trying to save says it', async () => {
    await openBuilder()
    const g = await addBlankField()
    expect(within(g).queryByText(S_FORMULA_NAME)).toBeNull()
    fireEvent.click(screen.getByTestId('builder-save'))
    await flush()
    expect(within(g).getByText(S_FORMULA_NAME)).toBeInTheDocument()
  })
})

describe('round 3, m-5: a member panning with the keyboard up keeps where they put it', () => {
  it('a visual viewport SCROLL never pulls the box back; a RESIZE (the keyboard) fits it again', async () => {
    const listeners = {}
    vi.stubGlobal('visualViewport', {
      height: 400, offsetTop: 0,
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn) },
      removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn) },
    })
    await openBuilder()
    const g = await addBlankField()
    const box = boxOf(g)
    const body = box.closest('[data-testid="widget-builder"]').parentElement
    body.style.overflowY = 'auto'
    let top = 0
    Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v } })
    body.getBoundingClientRect = () => ({ top: 60, bottom: 395, left: 0, right: 390, width: 390, height: 335 })
    let y = 200                                                     // the box's top before any scroll
    box.getBoundingClientRect = () => ({ top: y - top, bottom: y + 60 - top, left: 16, right: 374, width: 358, height: 60 })
    act(() => { box.focus() })
    expect(top).toBe(0)                                              // in view: nothing moves
    // The member pans: the box is now out of the band. Every scroll listener runs (the sheet's own keyboard
    // reading listens too); none of them moves the box.
    y = 600
    for (const fn of listeners.scroll || []) fn()
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
    expect(top).toBe(0)
    // The keyboard resizes the visual viewport: the box is fitted again, after a frame.
    expect(listeners.resize?.length).toBeGreaterThan(0)
    for (const fn of listeners.resize) fn()
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
    expect(top).toBe(600 + 60 + REVEAL_MARGIN - 395)
  })
})
