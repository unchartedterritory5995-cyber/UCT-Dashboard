// How a Depth panel dresses itself, by where it is mounted.
//
//   /research/:sym › Depth     card + its own title (the page names nothing else)
//   terminal DPTH panel        card + its own title (several panels share one frame)
//   terminal EVTS/FTD/… panel  no card, no title: the panel header already names it and
//                              the shell already insets the body, so a second frame and a
//                              second title are duplicates (terminal visual pass, lane 2)
//
// DepthTab provides DepthStackContext so a panel can tell "alone in a terminal panel"
// from "one of the DPTH stack".
import { createContext, useContext } from 'react'
import { useInTerminalPanel, PanelSkeleton } from '../../../components/terminal'
import styles from './Depth.module.css'

export const DepthStackContext = createContext(false)

/** `{ alone, panelClass, Title, Loading }` for one depth panel. */
export function useDepthChrome() {
  const inPanel = useInTerminalPanel()
  const inStack = useContext(DepthStackContext)
  const alone = Boolean(inPanel) && !inStack
  return {
    alone,
    panelClass: alone ? styles.panelFlat : styles.panel,
    showTitle: !alone,
    inPanel: Boolean(inPanel),
  }
}

/** The loading line: the terminal's one skeleton inside a panel, the muted line elsewhere. */
export function DepthLoading({ inPanel, label }) {
  if (inPanel) return <PanelSkeleton label={label} />
  return <div className={styles.note}>{label}…</div>
}

/** A 400 from a Depth route (depthFetch's `{ badRequest }`): the request named something that
 *  is not a ticker (`'$$' is not a ticker symbol`). Said in the server's own sentence, not as
 *  "not available right now" or a panel of "undefined" fields (audit 2026-10-08). */
export function DepthBadRequest({ sentence }) {
  return <div className={styles.note} data-testid="depth-bad-request">{sentence}</div>
}
