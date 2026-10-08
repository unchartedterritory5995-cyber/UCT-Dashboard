// @vitest-environment jsdom
//
// The anchored menu must take focus only once it can be SEEN.
//
// Measured in a real browser (tools/notebook_fin_keys_folder_walk.py, lane KEYS round 4): the
// folder panel's keyboard menu opened and never took focus. The trace showed one call,
// `focus()` on the first item, made while the menu's computed visibility was still `hidden`.
// A browser silently refuses to focus a hidden element, so focus stayed on the row and every
// key went to the page behind the menu.
//
// WHY it was still hidden: with "reduce motion" on, styles/tokens.css gives EVERY element
// `transition-duration: 0.01ms !important`, and the default transition property is `all`. So
// the menu's change from hidden to visible is a (very short) transition, and at the instant it
// starts the computed value is still the starting one, `hidden`. One frame later it is
// visible. The component asked for focus in that first instant, once, and never again. This
// affects every anchored ContextPopover menu for a member with reduce motion on.
//
// jsdom does NOT refuse: it focuses a hidden element happily, and it has no transitions, which
// is why every existing test passed. So this file makes jsdom behave like that browser: an
// element just made visible refuses focus until a frame has passed. Then it asserts the
// outcome that matters: focus ends up in the menu.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))

import ContextPopover from './ContextPopover'

const realFocus = HTMLElement.prototype.focus
let calls
const settled = new WeakSet()
beforeEach(() => {
  calls = []
  HTMLElement.prototype.focus = function focusLikeABrowser(...args) {
    let hidden = false
    for (let el = this; el && el.style; el = el.parentElement) {
      if (el.style.visibility === 'hidden') { hidden = true; break }
      if (el.style.visibility === 'visible') {
        // the start of the 0.01 ms transition: still computed `hidden` until a frame has passed
        if (!settled.has(el)) { hidden = true; requestAnimationFrame(() => settled.add(el)) }
        break
      }
    }
    calls.push({ on: this.textContent, hidden })
    if (hidden) return undefined            // what a browser does: nothing
    return realFocus.apply(this, args)
  }
})
afterEach(() => { HTMLElement.prototype.focus = realFocus; cleanup() })

const ui = (
  <>
    <button type="button">opener</button>
    <ContextPopover open onClose={() => {}} anchor={{ x: 10, y: 10 }} title="Theses"
      items={[{ label: 'Rename', onClick: () => {} }, { label: 'Delete', onClick: () => {} }]} />
  </>
)

describe('ContextPopover: focus goes in when the menu can be seen', () => {
  it('focus ends on the first item, in an environment where a hidden element cannot be focused', async () => {
    render(ui)
    const menu = await screen.findByRole('menu', { name: 'Theses' })
    await waitFor(() => expect(menu.style.visibility).toBe('visible'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' })))
  })

  it('NON-VACUITY: the first attempt was made at the instant of the change, and was refused', async () => {
    render(ui)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' })))
    expect(calls[0]).toEqual({ on: 'Rename', hidden: true })
    expect(calls.some((c) => c.on === 'Rename' && !c.hidden)).toBe(true)
  })

  it('CONTROL: this environment really does refuse a hidden element', () => {
    const box = document.createElement('div')
    box.style.visibility = 'hidden'
    const btn = document.createElement('button')
    box.appendChild(btn)
    document.body.appendChild(box)
    btn.focus()
    expect(document.activeElement).not.toBe(btn)
    box.remove()
  })
})
