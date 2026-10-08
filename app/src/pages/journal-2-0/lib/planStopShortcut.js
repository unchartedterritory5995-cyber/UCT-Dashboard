/**
 * Finish program, lane KEYS3 (Q21): one key from anywhere inside an open trade plan to the
 * stop's alert. Ctrl+Alt+S (Cmd+Option+S on a Mac).
 *
 * Why a key: a level row is four Tab stops (price, role, alert direction, Arm) and the stop is
 * the lowest line, so the last row: 12 Tabs from where opening the plan puts focus. A row cannot
 * be one arrow-key stop, because its price field and its role radios both own the arrow keys.
 *
 * The same convention as Ctrl+Alt+B (bulkActionsShortcut.js) and Ctrl+Alt+D (dailyNote.js): the
 * PHYSICAL key (`e.code`: Option changes what a Mac types), Ctrl OR Cmd, and never AltGr, which
 * several layouts send as Ctrl+Alt and which types a real character.
 *
 * It moves focus and nothing else. Arming is the button's own Enter.
 *
 * ⛔ ONE OWNER OF THE BINDING. The shortcut registry allows one live registration per id, and a
 * note can hold several charts with their plans open at once. So the plans share ONE
 * registration here (bound while at least one plan is open), and the plan that holds focus is
 * the one that answers. Declared in pages/command/shortcutRegistry.js as
 * `notebook.planStopAlert`; never a raw key listener.
 */
import { useEffect } from 'react'
import { registerShortcuts } from '../../command/shortcutRegistry'
import { isMacPlatform } from './platform'

export function isPlanStopShortcut(e) {
  if (!e || !e.altKey || e.shiftKey) return false
  if (!(e.ctrlKey || e.metaKey)) return false
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return false
  return e.code === 'KeyS'
}

/** The chord as a member reads it: the plan's own hint line. */
export function planStopChordLabel() {
  return isMacPlatform() ? 'Cmd+Option+S' : 'Ctrl+Alt+S'
}

/** For `aria-keyshortcuts` on the stop's alert button (both platforms' spellings). */
export const PLAN_STOP_ARIA_KEYS = 'Control+Alt+S Meta+Alt+S'

const openPlans = new Set()      // each: () => the plan's root element (or null)
let unbind = null

function onChord(e) {
  if (!isPlanStopShortcut(e)) return
  const at = typeof document !== 'undefined' ? document.activeElement : null
  if (!at) return
  for (const getRoot of openPlans) {
    const root = getRoot()
    if (!root || !root.contains(at)) continue
    const row = root.querySelector('[data-level-role="stop"]')
    // the alert button; where the alert is already armed (or cannot be), the stop's price
    const target = row && (row.querySelector('[data-plan-arm]') || row.querySelector('[data-level-price]'))
    if (!target) return
    e.preventDefault()
    target.focus()
    return
  }
}

/** Mount in a plan panel: bound while `open`. `rootRef` is the panel's own element. */
export function usePlanStopShortcut(rootRef, open) {
  useEffect(() => {
    if (!open) return undefined
    const getRoot = () => rootRef.current
    openPlans.add(getRoot)
    if (!unbind) unbind = registerShortcuts({ 'notebook.planStopAlert': onChord })
    return () => {
      openPlans.delete(getRoot)
      if (openPlans.size === 0 && unbind) { unbind(); unbind = null }
    }
  }, [rootRef, open])
}
