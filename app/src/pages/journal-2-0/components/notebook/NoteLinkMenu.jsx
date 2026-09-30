/**
 * Wave D — `[[`-triggered internal-note-link autocomplete for the Notebook
 * TipTap editor.
 *
 * Deliberately modeled closely on SlashMenu.jsx's own `Suggestion`
 * extension (trigger char → fixed-position, viewport-clamped popup →
 * keyboard-navigable combobox → insert-on-select) rather than sharing a
 * literal helper module with it -- SlashMenu's items() is synchronous and
 * static, this one is async and network-backed (note search), and
 * factoring out a common core was judged not worth the risk of
 * destabilizing SlashMenu for this pass. The POSITIONING/ARIA behavior is
 * intentionally the same shape, just not literally the same code.
 *
 * ⛔ ONE EXCEPTION, added 2026-09-22: the combobox-role ARIA wiring
 * (`applyComboboxWiring`, `../../lib/comboboxWiring.js`) IS shared with
 * SlashMenu.jsx — it's a small, pure, zero-dependency DOM-attribute
 * function with no positioning/timing/async surface to destabilize, unlike
 * the "common core" the paragraph above declined to extract.
 */

import { Extension } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { applyComboboxWiring } from '../../lib/comboboxWiring'
import { SkeletonLine } from '../../../../components/Skeleton'
import styles from './NoteLinkMenu.module.css'

const SEARCH_DEBOUNCE_MS = 150
const SEARCH_LIMIT = 8

/**
 * The note search behind the `[[` menu, extracted so G-064's Ask insert picker
 * searches the SAME way (spec §3.3) instead of growing a second one. One search
 * sequence per returned function: a stale (superseded) query never fires its
 * own request and never regresses the list to an older result.
 */
export function makeNoteSearch({ debounceMs = SEARCH_DEBOUNCE_MS, limit = SEARCH_LIMIT } = {}) {
  let seq = 0
  let lastResults = []
  return (query) => {
    const q = (query || '').trim()
    const mySeq = ++seq
    if (!q) { lastResults = []; return [] }
    return new Promise((resolve) => {
      setTimeout(async () => {
        if (mySeq !== seq) { resolve(lastResults); return }
        try {
          const res = await fetch(
            `/api/j2/notes?q=${encodeURIComponent(q)}&limit=${limit}`,
            { credentials: 'include' },
          )
          const body = res.ok ? await res.json() : { notes: [] }
          if (mySeq === seq) lastResults = body.notes || []
        } catch {
          // keep lastResults -- a transient network error should not blank a
          // list the member was already looking at
        }
        resolve(lastResults)
      }, debounceMs)
    })
  }
}

// Exported (only) for NoteLinkMenu.test.jsx -- the real menu mounts through
// a TipTap Suggestion's imperative render(), which has no props-driven RTL
// entry point, so the presentational piece is tested directly instead.
export const NoteLinkList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const items = props.items
  const menuId = props.menuId || 'uct-note-link-menu'
  const ariaLabel = props.ariaLabel || 'Link to a note'

  useEffect(() => setSelectedIndex(0), [items])

  useEffect(() => {
    props.onActiveChange?.(items.length ? `${menuId}-opt-${selectedIndex}` : null)
  }, [selectedIndex, items, menuId]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (item) props.command(item)
        return true
      }
      return false
    },
  }))

  if (props.loading && !items.length) {
    // G-106 (Wave B lower-frequency sweep): a couple of skeleton rows
    // standing in for result items, instead of bare text -- same idiom as
    // FolderSidebar's search-results skeleton.
    return (
      <div className={styles.menu} role="listbox" id={menuId} aria-label={ariaLabel}>
        <div className={styles.empty} role="status" aria-label="Searching…">
          <SkeletonLine width="80%" height={12} />
          <SkeletonLine width="55%" height={12} />
        </div>
      </div>
    )
  }
  if (!items.length) {
    return (
      <div className={styles.menu} role="listbox" id={menuId} aria-label={ariaLabel}>
        <div className={styles.empty}>No matching notes</div>
      </div>
    )
  }

  return (
    <div className={styles.menu} role="listbox" id={menuId} aria-label={ariaLabel}>
      {/* G-064 — `disabled` is passed only by the Ask insert picker, while a
          create is in flight; the `[[` menu never sets it. It is semantic
          only: the caller's `command` guard is what makes a click a no-op. */}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          id={`${menuId}-opt-${i}`}
          aria-selected={i === selectedIndex}
          aria-disabled={props.disabled ? 'true' : undefined}
          className={`${styles.item} ${i === selectedIndex ? styles.itemActive : ''}`}
          onMouseDown={(e) => { e.preventDefault(); props.command(item) }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <UIcon name="link" size={12} style={{ verticalAlign: '-2px', marginRight: 6, flexShrink: 0 }} />
          <span className={styles.itemTitle}>{item.title || 'Untitled'}</span>
          {item.ticker && <span className={styles.itemMeta}>{item.ticker}</span>}
        </button>
      ))}
    </div>
  )
})
NoteLinkList.displayName = 'NoteLinkList'

export const NoteLinkMenuExtension = Extension.create({
  name: 'noteLinkMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        // `@tiptap/suggestion`'s Suggestion() defaults every instance to the
        // SAME internal plugin key unless given an explicit one -- with
        // SlashMenu's own `/`-triggered Suggestion() already registered on
        // an editor, a second default-keyed instance throws
        // "Adding different instances of a keyed plugin" the moment both
        // extensions are active together (found live, via this file's own
        // test suite). A distinct key is required, not optional, whenever a
        // second Suggestion plugin coexists with SlashMenu's.
        pluginKey: new PluginKey('noteLinkMenu'),
        char: '[[',
        startOfLine: false,
        // ⛔⛔ THE MECHANISM (lane LK): without this, `@tiptap/suggestion`'s
        // default `allowSpaces: false` uses a match regex that stops at the
        // first whitespace (`findSuggestionMatch.ts`: `[^\s\[]*` when spaces
        // are disallowed). A note TITLE is almost always more than one word
        // ("Beta thesis AMD"), so the moment a member typed the space after
        // the first word, the match was LOST -- the plugin's own
        // `view.update()` sees `stopped = true` and calls `onExit`
        // SYNCHRONOUSLY, in the very same transaction that inserted the
        // space, tearing the popup down (`NoteLinkMenu`'s `onExit` removes it
        // from the DOM) long before the note search's 150ms-debounced GET or
        // the editor's ~800ms-debounced autosave PUT could ever resolve. Both
        // of those requests still fire (their timers were already queued) and
        // land into a dead renderer, which is what made the autosave PUT look
        // causally related when it was only adjacent in time -- see
        // `NoteEditorPage.noteLinkSuggest.test.jsx` for the captured
        // sequence and the two-request (search + autosave) control that
        // proves neither one is the actual cause once this is set.
        // SlashMenu's own `/`-triggered Suggestion sets this for the exact
        // same reason (its own comment, a few lines up in that file); this
        // menu's whole purpose is searching human-authored, usually
        // multi-word titles, so it needs it even more.
        allowSpaces: true,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertNoteLink(props.id).run()
        },
        items: (() => {
          // One search sequence per plugin instance (never shared between
          // open notes/editors) -- see makeNoteSearch.
          const search = makeNoteSearch()
          return ({ query }) => search(query)
        })(),
        render: () => {
          let component
          let popup
          let dismissed = false
          let getRect = null
          let editorDom = null
          const MENU_ID = 'uct-note-link-menu'

          const position = () => {
            if (!popup || dismissed) return
            const rect = getRect?.()
            if (!rect) return
            const menuW = popup.offsetWidth || 0
            const menuH = popup.offsetHeight || 0
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuW - 8))
            let top = rect.bottom + 6
            if (menuH && top + menuH > window.innerHeight - 8) {
              const above = rect.top - 6 - menuH
              top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - menuH)
            }
            popup.style.left = `${left}px`
            popup.style.top = `${top}px`
          }
          const onViewportChange = () => position()

          const setActiveDescendant = (id) => {
            applyComboboxWiring(editorDom, { menuId: MENU_ID, activeId: id, showing: Boolean(id && !dismissed) })
          }

          return {
            onStart: (props) => {
              dismissed = false
              getRect = props.clientRect
              editorDom = props.editor?.view?.dom || null
              component = new ReactRenderer(NoteLinkList, {
                props: { ...props, menuId: MENU_ID, onActiveChange: setActiveDescendant },
                editor: props.editor,
              })
              popup = document.createElement('div')
              popup.className = styles.popupWrap
              popup.style.position = 'fixed'
              popup.style.zIndex = 9999
              popup.appendChild(component.element)
              document.body.appendChild(popup)
              position()
              requestAnimationFrame(position)
              window.addEventListener('scroll', onViewportChange, true)
              window.addEventListener('resize', onViewportChange)
            },
            onUpdate(props) {
              getRect = props.clientRect
              component?.updateProps({ ...props, menuId: MENU_ID, onActiveChange: setActiveDescendant })
              position()
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                dismissed = true
                if (popup) popup.style.display = 'none'
                setActiveDescendant(null)
                return true
              }
              if (dismissed) return false
              return component?.ref?.onKeyDown?.(props) ?? false
            },
            onExit() {
              window.removeEventListener('scroll', onViewportChange, true)
              window.removeEventListener('resize', onViewportChange)
              setActiveDescendant(null)
              popup?.remove()
              component?.destroy()
              popup = null
              component = null
            },
          }
        },
      }),
    ]
  },
})
