/**
 * useToolbarRoving: makes a row of controls ONE Tab stop (the toolbar pattern).
 *
 * Finish program, lane KEYS round 2. `hooks/useRovingTabIndex.js` does the same job for a list
 * whose items the caller renders one by one and can hand props to. A note chart's toolbar is
 * not that: about fourteen controls, each behind its own condition, one of them a <select> and
 * one a lazy child component. This hook works on the DOM that is there, so no control has to
 * be touched and none can be forgotten.
 *
 *  - Exactly one control has tabIndex 0. The rest have -1.
 *  - Left and Right move one control (wrapping). Home and End jump to the ends.
 *  - Up and Down are NOT handled: a <select> in the row needs them to change its value.
 *  - Whatever control takes focus (arrow keys, a click, a script) becomes the stop.
 *  - The first stop is `prefer` (a selector) when it matches a control, else the first control.
 *
 * It changes tabindex only. It sets no role on a control and does not handle Enter or Space,
 * so a button stays a button and a link stays a link. Hover and touch are not involved.
 *
 * Each control also carries `data-roving-item`, the same marker `useRovingTabIndex` writes, so
 * the click-budget tool (tools/notebook_w13q_clicks.py) walks this group the way a member does.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'

const CONTROLS = 'button, a[href], select'

export function toolbarControls(root) {
  if (!root) return []
  const all = [...root.querySelectorAll(CONTROLS)].filter((el) => !el.disabled)
  // Only controls that are on screen: a row can hold controls a stylesheet hides at this width
  // (the editor's phone-only buttons), and a stop on a hidden control would take the whole
  // row out of the Tab order. A control with no box is hidden. Where NOTHING has a box (a
  // test environment with no layout) every control counts.
  const shown = all.filter((el) => el.getClientRects().length > 0)
  return shown.length ? shown : all
}

export default function useToolbarRoving({ prefer, enabled = true, orientation = 'horizontal' } = {}) {
  // 'vertical' is for a short list of rows that is one stop: Down and Up instead of Right and Left.
  const NEXT = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const PREV = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  const ref = useRef(null)
  const stopRef = useRef(null)

  const apply = useCallback(() => {
    const root = ref.current
    if (!root) return
    if (!enabled) {
      // Switched off (the row is being used as something else for now): give back every
      // tabindex this hook set, so each control is an ordinary Tab stop again.
      for (const el of root.querySelectorAll('[data-roving-item^="tb-"]')) {
        el.removeAttribute('tabindex')
        el.removeAttribute('data-roving-item')
      }
      stopRef.current = null
      return
    }
    // A control that is hidden now keeps no stop and no marker.
    const items = toolbarControls(root)
    for (const el of root.querySelectorAll('[data-roving-item^="tb-"]')) {
      if (!items.includes(el)) { el.tabIndex = -1 }
    }
    if (!items.length) return
    let stop = stopRef.current
    if (!stop || !items.includes(stop)) {
      const wanted = prefer ? root.querySelector(prefer) : null
      stop = wanted && items.includes(wanted) ? wanted : items[0]
      stopRef.current = stop
    }
    items.forEach((el, i) => {
      const want = el === stop ? 0 : -1
      if (el.tabIndex !== want) el.tabIndex = want
      if (!el.hasAttribute('data-roving-item')) el.setAttribute('data-roving-item', `tb-${i}`)
    })
  }, [prefer, enabled])

  // A resize can hide the control that holds the stop (a phone-only button on a wide window).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined
    const again = () => apply()
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
  }, [apply])

  // Every render, before paint: a control that appeared or left is accounted for at once, so
  // the row is never seen with two stops or with none.
  useLayoutEffect(() => { apply() })

  // A lazy child can add a control without this component rendering again.
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || typeof MutationObserver === 'undefined') return undefined
    const mo = new MutationObserver(() => apply())
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  })

  const onKeyDown = useCallback((e) => {
    if (!enabled) return
    if (![NEXT, PREV, 'Home', 'End'].includes(e.key)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const items = toolbarControls(ref.current)
    const i = items.indexOf(e.target)
    if (i === -1) return                       // not on one of this row's own controls
    let next = i
    if (e.key === NEXT) next = (i + 1) % items.length
    else if (e.key === PREV) next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else next = items.length - 1
    e.preventDefault()                         // also stops Left/Right changing a <select>
    if (next === i) return
    stopRef.current = items[next]
    apply()
    items[next].focus()
  }, [apply, enabled, NEXT, PREV])

  const onFocus = useCallback((e) => {
    if (!enabled) return
    const items = toolbarControls(ref.current)
    if (!items.includes(e.target) || stopRef.current === e.target) return
    stopRef.current = e.target
    apply()
  }, [apply, enabled])

  return { ref, onKeyDown, onFocus }
}
