// The note's find bar and table toolbar, off the first open (go-live wave 1, fix round 1) and drawn at once when
// asked for (fix round 2). Each chunk is fetched when the editor is idle into a module-level slot
// (lib/heldModule.js), and these slots render the real component DIRECTLY once it is there, so Ctrl+F mounts the bar
// in the same commit as the press, as it did when the bar was imported statically. ⛔ Never React.lazy + <Suspense>
// here: a lazy component suspends on its first render even with its chunk in hand, and React holds the reveal back
// about 300 ms, long enough for the member's first letters to land in the note (lib/heldModule.js).
//
// Before the find bar's chunk is in hand (a cold press, a slow network) a stand-in is drawn in its place: the same
// field, with the bar's own name, which takes focus and keeps what is typed; the real bar takes over with that text
// as its query. A failed fetch never reloads the page and never reaches the editor's error boundary: the stand-in
// says Find could not be loaded and offers Try again; the table toolbar simply stays absent, and the next editor
// mount asks for it again.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { RELOAD_TO_RECOVER, heldModule, pageReload, useHeldModule } from '../../lib/heldModule'
// Final fix residual R2: the Notebook's toolbar icon size (the token lint allows 16 and 20 only).
import { TOOLBAR_ICON } from '../../lib/notebookIcons'
import styles from './NoteFindBar.module.css'
import slotStyles from './EditorToolSlots.module.css'

// A property, so a rail can hold or fail a fetch (jsdom cannot fetch a chunk), like `sourceSheetLoaders`.
export const editorToolLoaders = {
  findBar: () => import('./NoteFindBar'),
  tableToolbar: () => import('./TableToolbar'),
}
export const findBarModule = heldModule(() => editorToolLoaders.findBar())
export const tableToolbarModule = heldModule(() => editorToolLoaders.tableToolbar())

/** Ask for both chunks. A chunk already in hand costs nothing; one that failed is asked for again. */
export function warmEditorTools() {
  findBarModule.warm()
  tableToolbarModule.warm()
}

export const FIND_UNAVAILABLE = 'Find could not be loaded.'

function FindStandIn({ value, onChange, onClose, failed, onRetry }) {
  const inputRef = useRef(null)
  const retryRef = useRef(null)
  // Final fix (B2): Try again leaves the screen while the fetch runs, so the press first puts focus on the field (a
  // stable element: the real bar takes it from there when it lands); a repeat failure puts it back on Try again.
  const retryingRef = useRef(false)
  // Final fix (C5): a failure after the member's own Try again: the chunk is likely gone after a deploy.
  const [stale, setStale] = useState(false)
  // Layout effect: focus moves in the press's own commit, before the next keystroke can reach the note.
  useLayoutEffect(() => { inputRef.current?.focus() }, [])
  useLayoutEffect(() => {
    if (!failed || !retryingRef.current) return
    retryingRef.current = false
    setStale(true)
    retryRef.current?.focus()
  }, [failed])
  const retry = () => {
    retryingRef.current = true
    inputRef.current?.focus()
    onRetry?.()
  }
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose?.()
    } else if (e.key === 'Enter') {
      e.preventDefault()
    }
  }
  return (
    <div className={styles.bar} role="search" aria-label="Find in note" data-find-stand-in="">
      <div className={styles.row}>
        <UIcon name="search" {...TOOLBAR_ICON} />
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="searchbox"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find in note"
          aria-label="Find in note"
          autoComplete="off"
          spellCheck={false}
        />
        <span className={styles.count} aria-live="polite">
          {failed ? (stale ? `${FIND_UNAVAILABLE} ${RELOAD_TO_RECOVER}` : FIND_UNAVAILABLE) : ''}
        </span>
        {failed && (
          <button ref={retryRef} type="button" className={styles.textBtn} onClick={retry}>Try again</button>
        )}
        {failed && stale && (
          <button type="button" className={styles.textBtn} onClick={pageReload.run}>Reload</button>
        )}
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close find" title="Close (Esc)">
          <UIcon name="x" {...TOOLBAR_ICON} />
        </button>
      </div>
    </div>
  )
}

export function FindBarSlot({ editor, initialReplace = false, onClose }) {
  const { status, Component } = useHeldModule(findBarModule)
  // What the member typed into the stand-in, handed to the real bar as its first query.
  const [held, setHeld] = useState('')
  // The press asks too: the idle warm may not have run yet, or may have failed while offline.
  useEffect(() => { findBarModule.warm() }, [])
  if (Component) {
    return <Component editor={editor} initialReplace={initialReplace} onClose={onClose} initialTerm={held} />
  }
  return (
    <FindStandIn
      value={held}
      onChange={setHeld}
      onClose={onClose}
      failed={status === 'failed'}
      onRetry={() => { findBarModule.warm() }}
    />
  )
}

export function TableToolbarSlot({ editor }) {
  const { Component } = useHeldModule(tableToolbarModule)
  return Component ? <Component editor={editor} /> : null
}

// ── The Insert palette (WidgetPalette), held the same way (follow-up B fix round 1, item 5) ──────────────────────────
// It was `lazyChunk` + <Suspense>: a member who pressed Insert and typed a ticker at once could write into the note
// while the reveal was held back. Now: fetched once the editor is idle and when a pointer or focus reaches Insert;
// with the chunk in hand the palette mounts in the press's own commit; before it lands a frame is drawn at once that
// takes focus (so nothing typed reaches the note) and becomes the palette when it lands; a failed fetch says so, with a
// Reload the member presses. Escape or Close in the frame close it and hand focus back to the door.
export const widgetPaletteLoaders = { palette: () => import('./WidgetPalette') }
export const widgetPaletteModule = heldModule(() => widgetPaletteLoaders.palette())
export const warmWidgetPalette = () => { widgetPaletteModule.warm() }
export const INSERT_UNAVAILABLE = 'Insert could not be loaded.'
export const INSERT_LOADING = 'Loading Insert…'

// The frame itself takes focus (kept small: it is on the editor's first open). Fix round 2: in a PASSIVE effect, and
// again one frame later if something took it: on a phone the palette is opened from the "+" menu, a Sheet, whose
// passive cleanup hands focus back to "+" after any layout effect of ours (the real palette focuses passively too).
// It sits in the palette's own absolute slot (EditorToolSlots.module.css), so the chrome never grows. Close (the real
// palette's own name) or Escape closes it and hands focus back to the door ("Insert", or "+" on a phone).
function PaletteFrame({ failed, onClose, returnFocusTo }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    el?.focus()
    const t = requestAnimationFrame(() => { if (el && !el.contains(document.activeElement)) el.focus() })
    return () => cancelAnimationFrame(t)
  }, [])
  const close = () => {
    onClose?.()
    returnFocusTo?.current?.focus?.()
  }
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  }
  return (
    <div ref={ref} tabIndex={-1} className={slotStyles.paletteFrame} role="dialog" aria-label="Insert widget"
      data-palette-stand-in="" onKeyDown={onKeyDown}>
      <span className={slotStyles.paletteFrameText} role={failed ? 'alert' : 'status'}>
        {failed ? `${INSERT_UNAVAILABLE} ${RELOAD_TO_RECOVER}` : INSERT_LOADING}
      </span>
      {failed && <button type="button" className={slotStyles.paletteFrameBtn} onClick={pageReload.run}>Reload</button>}
      <button type="button" className={slotStyles.paletteFrameBtn} onClick={close} aria-label="Close insert panel">
        <UIcon name="x" {...TOOLBAR_ICON} />
      </button>
    </div>
  )
}

export function WidgetPaletteSlot(props) {
  const { status, Component } = useHeldModule(widgetPaletteModule)
  // The press asks too: the idle warm may not have run yet, or may have failed while offline.
  useEffect(() => { widgetPaletteModule.warm() }, [])
  if (Component) return <Component {...props} />
  return <PaletteFrame failed={status === 'failed'} onClose={props.onClose} returnFocusTo={props.returnFocusTo} />
}
