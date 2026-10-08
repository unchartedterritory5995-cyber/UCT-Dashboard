/**
 * useRovingTabIndex — the roving-tabindex keyboard pattern (WAI-ARIA toolbar /
 * tabs families) for a static-order list of sibling links/buttons.
 *
 * Wave 13, lane 13Q-4. The click-budget instrument (13Q-1/2/3) found that
 * reaching anything BEHIND the shared app chrome (NavBar's ~19-23 links, the
 * Journal's own top tab bar) costs a full forward Tab walk through every one
 * of those links one at a time, because none of them is compacted into a
 * single Tab stop. This hook is the fix: it makes the WHOLE group ONE Tab
 * stop (every item but one carries tabIndex=-1) and lets Arrow keys / Home /
 * End move focus — and the roving stop — among the group's own items.
 *
 * It deliberately does NOT touch role or activation:
 *  - Native roles are untouched. A rendered <a> stays a link, a rendered
 *    <button> stays a button — this hook only ever sets `tabIndex` and a
 *    `data-roving-item` marker, never `role`. (The toolbar pattern, unlike
 *    the tabs pattern, does not require relabelling its children's roles —
 *    that is why it is the fit here, over a `role="tablist"/"tab"` rebuild,
 *    for a list whose items are genuine page links.)
 *  - Enter/Space activation is whatever the native element already does
 *    (anchor navigation, button click) — nothing here intercepts a key other
 *    than the four roving ones, so Enter reaches the browser exactly as
 *    before.
 *
 * Usage:
 *   const { containerProps, itemProps } = useRovingTabIndex({ orientation: 'vertical' })
 *   <nav {...containerProps}>
 *     {items.map((item) => <Link key={item.to} {...itemProps(item.to)} to={item.to} />)}
 *   </nav>
 *
 * A disabled item (e.g. a real `disabled` button for a locked/teaser entry —
 * already unreachable by Tab on its own, and `.focus()` on it is a no-op)
 * passes `{ disabled: true }` as the second `itemProps` argument so arrow
 * keys skip over it rather than landing on it and going nowhere.
 *
 * Which item starts — and stays, until the member moves focus inside the
 * group themselves — as the single Tab stop is whichever item carries
 * `aria-current="page"` at render time (exactly what react-router's own
 * NavLink already sets on the active route; this hook introduces no second
 * notion of "which one is current"), else the first item. That is the rail
 * requirement "focus lands on the active item when tabbing in": a member who
 * tabs into the group for the first time, or after navigating elsewhere and
 * back without having used the arrow keys, lands on the page they are on.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const ALL_SELECTOR = '[data-roving-item]'

export default function useRovingTabIndex({ orientation = 'horizontal' } = {}) {
  const containerRef = useRef(null)
  const [rovingKey, setRovingKey] = useState(null)
  const movedRef = useRef(false)

  const getItems = useCallback(() => {
    const root = containerRef.current
    return root ? Array.from(root.querySelectorAll(ALL_SELECTOR)) : []
  }, [])

  // Re-derive the default roving stop (the active route, else the first
  // item) on every render — but only until the member has moved focus
  // inside the group themselves. Runs with no dependency array on purpose:
  // the "active" item can change for reasons entirely outside this
  // component's own props (a command-palette navigation, a hotkey chord),
  // and the only authority for "which one is active" is the DOM attribute
  // react-router already maintains. The functional setState below is a
  // no-op when the key is unchanged, so this cannot loop.
  //
  // A LAYOUT effect, not a passive one (landing 12-15, R5 finding I2). The first render has no
  // stop yet (`rovingKey` is null, so every item is tabIndex -1). A passive effect fixes that a
  // moment AFTER the commit is on screen, and a group that mounts outside a user event (a lazy
  // chunk resolving, a fetch landing) was observable in between with no Tab stop at all: a
  // keyboard user tabbing right then skips the whole group. React applies a state update made in
  // a layout effect before the commit can be painted or observed, so that moment no longer exists.
  // Rail: useRovingTabIndex.test.jsx, "a group that mounts late is never observable with no Tab stop".
  useLayoutEffect(() => {
    const nodes = getItems()
    if (!nodes.length) return
    // W14-keys: a moved stop is kept only while its item is still in the group. An item can
    // leave (a get-started step that is done renders as text, not a control), and a stop
    // naming an item that is gone leaves EVERY item at tabIndex -1: the group would drop out
    // of the Tab order entirely.
    if (movedRef.current && nodes.some((n) => n.getAttribute('data-roving-item') === rovingKey)) return
    movedRef.current = false
    const active = nodes.find((n) => n.getAttribute('aria-current') === 'page')
    const key = (active || nodes[0]).getAttribute('data-roving-item')
    setRovingKey((prev) => (prev === key ? prev : key))
  })

  const itemProps = useCallback(
    (key, { disabled = false } = {}) => ({
      'data-roving-item': key,
      'data-roving-disabled': disabled ? 'true' : undefined,
      tabIndex: key === rovingKey ? 0 : -1,
      onFocus: () => {
        movedRef.current = true
        setRovingKey((prev) => (prev === key ? prev : key))
      },
    }),
    [rovingKey],
  )

  const onKeyDown = useCallback(
    (e) => {
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
      if (![nextKey, prevKey, 'Home', 'End'].includes(e.key)) return
      const nodes = getItems()
      if (!nodes.length) return
      const i = nodes.indexOf(e.target)
      if (i === -1) return // the keypress did not originate on one of THIS group's own items

      const enabled = (idx) => nodes[idx]?.getAttribute('data-roving-disabled') !== 'true'
      const step = (from, dir) => {
        let idx = from
        for (let n = 0; n < nodes.length; n += 1) {
          idx = (idx + dir + nodes.length) % nodes.length
          if (enabled(idx)) return idx
        }
        return from
      }

      let next = i
      if (e.key === nextKey) next = step(i, 1)
      else if (e.key === prevKey) next = step(i, -1)
      else if (e.key === 'Home') next = enabled(0) ? 0 : step(-1, 1)
      else if (e.key === 'End') next = enabled(nodes.length - 1) ? nodes.length - 1 : step(nodes.length, -1)

      if (next === i) return
      e.preventDefault()
      const node = nodes[next]
      const key = node.getAttribute('data-roving-item')
      movedRef.current = true
      setRovingKey(key)
      node.focus()
    },
    [getItems, orientation],
  )

  return {
    containerRef,
    containerProps: { ref: containerRef, onKeyDown },
    itemProps,
  }
}
