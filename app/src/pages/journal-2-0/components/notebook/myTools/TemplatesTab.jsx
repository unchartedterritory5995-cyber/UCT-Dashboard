import { managerHref } from './myToolsLib'
import styles from './myTools.module.css'

/**
 * My tools, the Templates tab (follow-up C, one room for templates): templates are managed in Manage templates now
 * (its Active, Archived and Recently deleted views; the member's plain templates too). The tab stays in the tab row so
 * nobody loses their place, and holds one sentence and one button: "Open Manage templates" closes My tools and opens
 * the manager (the notes list's `?styles=1` door, which NotebookTab reads once and takes out of the URL).
 *
 * The list this tab used to draw lives in TemplateList.jsx, which the manager renders (one implementation).
 *
 * ⛔ LAZY: mounted only by MyToolsSheet (reached only through openMyTools.js, a dynamic import).
 */
export const TEMPLATES_MOVED = 'Templates are managed in one place now.'
export const OPEN_MANAGER = 'Open Manage templates'
/** Through the app router's `navigate` when the door that opened My tools passed one; else the router's own history
 *  move, told with `popstate` (My tools is on its own root, outside the router: lib/noteHref.js's pattern).
 *  Fix round 1 (2g): on the notes page itself the move REPLACES the entry (and NotebookTab then takes `styles` back out
 *  with a replace of its own), so Back never lands on an entry that reopens or keeps the manager. That case always uses
 *  the history move, because not every door's `navigate` passes a replace on. From another page it pushes: Back
 *  leaves the notes page, and the manager with it. */
function openManager(navigate) {
  const to = managerHref()
  if (typeof window === 'undefined') return
  const replace = window.location?.pathname === '/journal/notebook'
  if (!replace && typeof navigate === 'function') { navigate(to); return }
  if (!window.history?.pushState) return
  const prev = window.history.state
  const at = prev && typeof prev === 'object' && Number.isInteger(prev.idx) ? prev.idx : -1
  const state = { usr: null, key: Math.random().toString(36).slice(2, 10), idx: replace ? Math.max(at, 0) : at + 1 }
  if (replace) window.history.replaceState(state, '', to)
  else window.history.pushState(state, '', to)
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

export default function TemplatesTab({ navigate = null, onCloseAll }) {
  return (
    <div className={styles.stateBox} data-testid="my-tools-templates">
      <p className={styles.sentence}>{TEMPLATES_MOVED}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.btnPrimary}
          onClick={() => { onCloseAll?.(); openManager(navigate) }}>
          {OPEN_MANAGER}
        </button>
      </div>
    </div>
  )
}
