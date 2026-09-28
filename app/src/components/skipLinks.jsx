import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

/**
 * The app's skip links (WCAG 2.4.1, Bypass Blocks) — wave 10 follow-up F4, finding A2R-01.
 *
 * ⛔ THE SHELL'S FIRST TAB STOP IS "Skip to main content". Before this the first stop was the
 * logo, and a keyboard member on the Notebook pressed Tab 36 times to reach the Notebook's own
 * skip link, past the 22 sidebar links and the Journal's header.
 *
 * `Layout.jsx` renders the app link and, right after it, an empty SLOT. A page with a skip link
 * of its own renders it through `SkipLinkPortal`, which puts it in that slot when the page is
 * inside the shell — so it becomes the SECOND Tab stop, directly after "Skip to main content" —
 * and inline where it always was when the page renders alone (a unit test, a page outside the
 * shell). The page keeps owning its link: its text, its target and its handler never move.
 */

/** The id of the shell's `<main>`: the target of "Skip to main content". */
export const MAIN_CONTENT_ID = 'main-content'

/** The slot element (or null outside the shell, or before the shell has committed). */
export const SkipLinkSlotContext = createContext(null)

/** Render a page's own skip link in the shell's slot when there is one, else in place. */
export function SkipLinkPortal({ children }) {
  const slot = useContext(SkipLinkSlotContext)
  return slot ? createPortal(children, slot) : children
}
