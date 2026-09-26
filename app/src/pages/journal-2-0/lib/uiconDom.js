/**
 * A `UIcon` mounted into a plain DOM element — for ProseMirror node views
 * written as DOM (callout, toggle), which cannot render React themselves.
 *
 * ⛔ THE GLYPH IS UICON'S OWN, NEVER A HAND COPY. The toggle's chevron is a
 * hand-drawn SVG "matching UIcon's geometry" because nothing else was
 * available; a second copy of a glyph is a second authority over what it looks
 * like. This renders the real component, so a glyph change in the registry
 * reaches every node view the day it lands.
 *
 * Rendered synchronously (`flushSync`) so a node view's DOM is complete the
 * moment it is created; torn down on a microtask, because a node view can be
 * destroyed while React is itself committing (the editor unmounting) and a
 * synchronous unmount there is refused.
 */
import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import UIcon from '../../../components/ui/UIcon'

export function mountUIcon(container, name, props = {}) {
  const root = createRoot(container)
  let alive = true
  const render = (next) => {
    if (!alive) return
    const el = createElement(UIcon, { name: next, size: 16, gold: false, ...props })
    try {
      flushSync(() => root.render(el))
    } catch {
      root.render(el) // already inside a React commit: render on its own schedule
    }
  }
  render(name)
  return {
    update: render,
    destroy() {
      if (!alive) return
      alive = false
      queueMicrotask(() => { try { root.unmount() } catch { /* already gone */ } })
    },
  }
}
