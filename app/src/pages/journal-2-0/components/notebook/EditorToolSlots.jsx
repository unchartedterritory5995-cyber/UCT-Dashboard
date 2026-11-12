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
import { heldModule, useHeldModule } from '../../lib/heldModule'
import styles from './NoteFindBar.module.css'

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
  // Layout effect: focus moves in the press's own commit, before the next keystroke can reach the note.
  useLayoutEffect(() => { inputRef.current?.focus() }, [])
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
        <UIcon name="search" size={14} gold={false} />
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
        <span className={styles.count} aria-live="polite">{failed ? FIND_UNAVAILABLE : ''}</span>
        {failed && (
          <button type="button" className={styles.textBtn} onClick={onRetry}>Try again</button>
        )}
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close find" title="Close (Esc)">
          <UIcon name="x" size={13} gold={false} />
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
