// Built widget views (wave 8, Task 8.14): the keyboard for a view's drillable marks (bars, points, cells, rows).
//
// The marks are ONE roving-tabindex group: one Tab stop for the whole view, the four arrow keys move between them
// (wrapping), Home and End jump to the ends, and Enter or Space drills the focused one. A click drills too. A view
// with no drill (a shared page, a read-only copy) passes no `drill` and gets plain marks: nothing to focus.
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
const SELECTOR = '[data-built-cell]'

export function useCellGroup() {
  const ref = useRef(null)
  const [active, setActive] = useState(0)
  // The group always has ONE Tab stop: when the mark that held it is gone (fewer rows after a refresh, or a mark
  // that cannot drill), the first mark takes it. A layout effect, so no frame is ever painted with no stop.
  useLayoutEffect(() => {
    const root = ref.current
    const items = root ? [...root.querySelectorAll(SELECTOR)] : []
    if (!items.length || items.some((n) => n.getAttribute('tabindex') === '0')) return
    const first = Number(items[0].getAttribute('data-built-index'))
    if (Number.isInteger(first)) setActive((prev) => (prev === first ? prev : first))
  })

  const onKeyDown = useCallback((e) => {
    const root = ref.current
    if (!root) return
    const items = [...root.querySelectorAll(SELECTOR)]
    const i = items.indexOf(e.target)
    if (i === -1 || !items.length) return
    let next
    if (Object.hasOwn(STEP, e.key)) next = (i + STEP[e.key] + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    items[next].focus()                       // its onFocus moves the Tab stop to it
  }, [])

  /** The props for mark `i`. `drill(el)` opens the drill-down for it (el is the mark, so focus can come back);
   *  `label` is what a screen reader hears. With no `drill` the mark is a plain labelled image. `native: true`
   *  keeps the element's own role and name (a table row stays a row and reads its cells). */
  const itemProps = (i, drill, label, { native = false } = {}) => {
    if (typeof drill !== 'function') return native ? {} : { role: 'img', 'aria-label': label }
    return {
      ...(native ? {} : { role: 'button', 'aria-label': label }),
      'data-built-cell': '',
      'data-built-index': i,
      tabIndex: i === active ? 0 : -1,
      onFocus: () => setActive(i),
      onClick: (e) => drill(e.currentTarget),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          drill(e.currentTarget)
        }
      },
    }
  }

  return { groupProps: { ref, onKeyDown }, itemProps }
}

/** The drill callback a view hands a mark: `onDrill(cell, what, el)` when the view drills and the row has a cell. */
export const drillFor = (onDrill, row, what) => (typeof onDrill === 'function' && row?.drill
  ? (el) => onDrill(row.drill, what, el)
  : null)
