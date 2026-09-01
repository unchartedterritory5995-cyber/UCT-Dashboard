import { createContext, useContext } from 'react'

// The ONE app menu on touch. Layout owns the MoreSheet and provides its opener
// here; MobileNav's top-left hamburger uses it directly (prop), and the phone
// chart shell — where the top bar hides itself — reaches it through this
// context from the symbol strip's Menu button. There is deliberately no second
// menu component anywhere: after the bottom tab bar's removal (owner call,
// 2026-09-01 — it duplicated the top-left menu route-for-route), every touch
// navigation path is a trigger for the SAME MoreSheet.
export const MoreSheetContext = createContext(null)

/** () => void opener, or null outside Layout (tests, isolated mounts) —
 *  consumers hide their trigger when null rather than rendering a dead door. */
export function useOpenMoreSheet() {
  return useContext(MoreSheetContext)
}
