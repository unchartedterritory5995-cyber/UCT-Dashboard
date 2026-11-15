// The notes list's AI section (NotebookAiPanel), off the Notebook's first open and drawn at once when "AI" is pressed
// (go-live wave 1, fix round 2). The chunk is fetched when the list is idle, and again when a pointer or focus reaches
// "AI", into a module-level slot (lib/heldModule.js); this slot renders the panel DIRECTLY once it is there, so the
// question field takes focus without React.lazy's first-render suspend (about 300 ms held back, even with the chunk in
// hand). Until it lands the section is not drawn yet; a fetch that fails says so in plain words with Try again, and
// never reloads the page (the list, its filters and scroll stay as they are).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RELOAD_TO_RECOVER, heldModule, pageReload, useHeldModule } from '../../lib/heldModule'
import styles from './NotebookAiPanel.module.css'

// A property, so a rail can hold or fail the fetch (jsdom cannot fetch a chunk).
export const aiPanelLoaders = { panel: () => import('./NotebookAiPanel') }
export const aiPanelModule = heldModule(() => aiPanelLoaders.panel())
export const warmAiPanel = () => { aiPanelModule.warm() }

export const ASK_UNAVAILABLE = 'Ask could not be loaded.'
export const ASK_LOADING = 'Loading Ask…'

export default function NotebookAiPanelSlot(props) {
  const { status, Component } = useHeldModule(aiPanelModule)
  useEffect(() => { aiPanelModule.warm() }, [])
  const statusRef = useRef(null)
  const retryRef = useRef(null)
  // Final fix (B2): Try again leaves the screen while the fetch runs, so the press first puts focus on the status line
  // (this same frame stays drawn); the panel takes it from there when it lands (its question field), and a repeat
  // failure puts it back on Try again. (C5) That repeat failure also says to reload, with a Reload the member presses.
  const retryingRef = useRef(false)
  const [stale, setStale] = useState(false)
  const failed = status === 'failed'
  useLayoutEffect(() => {
    if (!failed || !retryingRef.current) return
    retryingRef.current = false
    setStale(true)
    retryRef.current?.focus()
  }, [failed])
  if (Component) return <Component {...props} />
  const retry = () => {
    retryingRef.current = true
    statusRef.current?.focus()
    warmAiPanel()
  }
  // Final fix (B1): a press before the chunk is in hand draws this frame at once, with the panel's own id (so the
  // button's aria-controls names a real element) and a status line; it becomes the panel when the chunk lands.
  return (
    <section id={props.id} className={styles.section} aria-label="Ask your Notebook" data-notebook-ai-panel=""
      aria-busy={failed ? undefined : 'true'}>
      <p ref={statusRef} tabIndex={-1} role={failed ? 'alert' : 'status'}>
        {failed ? (stale ? `${ASK_UNAVAILABLE} ${RELOAD_TO_RECOVER}` : ASK_UNAVAILABLE) : ASK_LOADING}
      </p>
      {failed && (
        <div>
          <button ref={retryRef} type="button" className="btn btn-secondary btn-sm" onClick={retry}>Try again</button>
          {stale && (
            <>
              {' '}
              <button type="button" className="btn btn-secondary btn-sm" onClick={pageReload.run}>Reload</button>
            </>
          )}
          {' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => props.onClose?.()}>Close</button>
        </div>
      )}
    </section>
  )
}
