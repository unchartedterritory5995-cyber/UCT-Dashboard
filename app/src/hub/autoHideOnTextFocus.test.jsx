/**
 * §8 — "Auto-hide while a text input is focused."
 *
 * ⛔ REAL DOM FOCUS, NOT A PROP. The hub already had `useKeyboardVisible`, which infers typing from
 * a >150px visualViewport drop. That is a proxy: with no visualViewport it returns early and never
 * reports true at all, and a hardware keyboard or an emulated phone viewport resizes nothing. A
 * test that drove a `hidden` prop would have passed against that hook too, and proved nothing about
 * the case the spec names. So these cases focus and blur real elements and read the real attribute.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

import useTextInputFocus, { isTextEntry } from './useTextInputFocus'

/** Mount a real element, focus it, and hand it back. */
function mountAndFocus(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  const el = host.firstElementChild
  act(() => { el.focus() })
  return { el, host }
}

let hosts = []
const track = (r) => { hosts.push(r.host); return r }
beforeEach(() => { hosts = [] })
afterEach(() => { hosts.forEach((h) => h.remove()); document.body.innerHTML = '' })

describe('isTextEntry — the element kinds the member types into', () => {
  it.each([
    ['<input />', true, 'a bare input defaults to type=text'],
    ['<input type="text" />', true, ''],
    ['<input type="search" />', true, 'search boxes are typed into'],
    ['<input type="email" />', true, ''],
    ['<input type="number" />', true, ''],
    ['<textarea></textarea>', true, ''],
    ['<div contenteditable="true"></div>', true, 'the Notebook editor is one of these'],
    ['<input type="checkbox" />', false, 'hiding the pad on a checkbox tap would be its own bug'],
    ['<input type="radio" />', false, ''],
    ['<input type="submit" />', false, ''],
    ['<input type="range" />', false, ''],
    ['<input type="file" />', false, ''],
    ['<button></button>', false, ''],
    ['<div></div>', false, ''],
  ])('%s -> %s %s', (html, expected) => {
    const host = document.createElement('div')
    host.innerHTML = html
    expect(isTextEntry(host.firstElementChild)).toBe(expected)
  })

  it('null and non-elements are not text entry', () => {
    expect(isTextEntry(null)).toBe(false)
    expect(isTextEntry(undefined)).toBe(false)
    expect(isTextEntry(document.createTextNode('x'))).toBe(false)
  })
})

describe('useTextInputFocus — real focusin/focusout', () => {
  it('⛔ focus in a text field reports true; blur restores', () => {
    const { result } = renderHook(() => useTextInputFocus())
    expect(result.current, 'nothing focused yet').toBe(false)

    const { el } = track(mountAndFocus('<input type="text" />'))
    expect(result.current, 'a focused text input did not report').toBe(true)

    act(() => { el.blur() })
    expect(result.current, 'blur did not restore the pad').toBe(false)
  })

  it('a textarea and a contenteditable report the same way', () => {
    const { result } = renderHook(() => useTextInputFocus())
    const ta = track(mountAndFocus('<textarea></textarea>'))
    expect(result.current).toBe(true)
    act(() => { ta.el.blur() })
    expect(result.current).toBe(false)

    const ce = track(mountAndFocus('<div contenteditable="true"></div>'))
    expect(result.current).toBe(true)
    act(() => { ce.el.blur() })
    expect(result.current).toBe(false)
  })

  it('⛔ focus moving BETWEEN two fields never flickers back to false', () => {
    // focusout fires before the next element takes focus, so a handler trusting `e.target` on the
    // way out would report false for one frame and the pad would blink back over the form.
    const { result } = renderHook(() => useTextInputFocus())
    const a = track(mountAndFocus('<input type="text" />'))
    const b = track(mountAndFocus('<input type="text" />'))
    expect(result.current).toBe(true)
    act(() => { b.el.focus() })
    expect(result.current, 'tabbing between fields dropped the hide').toBe(true)
    act(() => { b.el.blur(); a.el.blur() })
    expect(result.current).toBe(false)
  })

  it('a checkbox does NOT hide the pad', () => {
    const { result } = renderHook(() => useTextInputFocus())
    const cb = track(mountAndFocus('<input type="checkbox" />'))
    expect(result.current).toBe(false)
    act(() => { cb.el.blur() })
  })

  it('⛔ it seeds from a field already focused at mount', () => {
    // The hub can mount into a page that already has an autofocused search box.
    const { el } = track(mountAndFocus('<input type="text" />'))
    const { result } = renderHook(() => useTextInputFocus())
    expect(result.current, 'a field focused BEFORE mount was missed').toBe(true)
    act(() => { el.blur() })
  })

  it('writes nothing — auto-hide must not outlive the focus that caused it', async () => {
    // A member who tapped a search box has not asked to hide the hub. If this hook ever wrote to
    // the session store or the preference, the hide would survive the blur.
    const store = await import('./hubSessionVisibility')
    const { result } = renderHook(() => useTextInputFocus())
    const { el } = track(mountAndFocus('<input type="text" />'))
    expect(result.current).toBe(true)
    const { result: override } = renderHook(() => store.default())
    expect(override.current, 'auto-hide wrote a session override').toBeNull()
    act(() => { el.blur() })
  })
})
