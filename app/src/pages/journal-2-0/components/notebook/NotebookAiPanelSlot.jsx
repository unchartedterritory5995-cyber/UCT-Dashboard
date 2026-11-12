// The notes list's AI section (NotebookAiPanel), off the Notebook's first open and drawn at once when "AI" is pressed
// (go-live wave 1, fix round 2). The chunk is fetched when the list is idle, and again when a pointer or focus reaches
// "AI", into a module-level slot (lib/heldModule.js); this slot renders the panel DIRECTLY once it is there, so the
// question field takes focus without React.lazy's first-render suspend (about 300 ms held back, even with the chunk in
// hand). Until it lands the section is not drawn yet; a fetch that fails says so in plain words with Try again, and
// never reloads the page (the list, its filters and scroll stay as they are).
import { useEffect } from 'react'
import { heldModule, useHeldModule } from '../../lib/heldModule'
import styles from './NotebookAiPanel.module.css'

// A property, so a rail can hold or fail the fetch (jsdom cannot fetch a chunk).
export const aiPanelLoaders = { panel: () => import('./NotebookAiPanel') }
export const aiPanelModule = heldModule(() => aiPanelLoaders.panel())
export const warmAiPanel = () => { aiPanelModule.warm() }

export const ASK_UNAVAILABLE = 'Ask could not be loaded.'

export default function NotebookAiPanelSlot(props) {
  const { status, Component } = useHeldModule(aiPanelModule)
  useEffect(() => { aiPanelModule.warm() }, [])
  if (Component) return <Component {...props} />
  if (status !== 'failed') return null
  return (
    <section id={props.id} className={styles.section} aria-label="Ask your Notebook" data-notebook-ai-panel="">
      <p role="alert">{ASK_UNAVAILABLE}</p>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={warmAiPanel}>Try again</button>
        {' '}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => props.onClose?.()}>Close</button>
      </div>
    </section>
  )
}
