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
 */

import { Extension } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NoteLinkMenu.module.css'

const SEARCH_DEBOUNCE_MS = 150
const SEARCH_LIMIT = 8

const NoteLinkList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const items = props.items
  const menuId = props.menuId || 'uct-note-link-menu'

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
    return (
      <div className={styles.menu} role="listbox" id={menuId} aria-label="Link to a note">
        <div className={styles.empty}>Searching…</div>
      </div>
    )
  }
  if (!items.length) {
    return (
      <div className={styles.menu} role="listbox" id={menuId} aria-label="Link to a note">
        <div className={styles.empty}>No matching notes</div>
      </div>
    )
  }

  return (
    <div className={styles.menu} role="listbox" id={menuId} aria-label="Link to a note">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          id={`${menuId}-opt-${i}`}
          aria-selected={i === selectedIndex}
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
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertNoteLink(props.id).run()
        },
        items: (() => {
          // One search sequence per plugin instance (module-scope inside
          // the closure, not the module itself, so multiple open notes/
          // editors never share state). A stale (superseded) query never
          // fires its own request and never regresses the list to an
          // older result -- see the file header for why this shape, not a
          // plain setTimeout debounce, was chosen.
          let seq = 0
          let lastResults = []
          return ({ query }) => {
            const q = (query || '').trim()
            const mySeq = ++seq
            if (!q) { lastResults = []; return [] }
            return new Promise((resolve) => {
              setTimeout(async () => {
                if (mySeq !== seq) { resolve(lastResults); return }
                try {
                  const res = await fetch(
                    `/api/j2/notes?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`,
                    { credentials: 'include' },
                  )
                  const body = res.ok ? await res.json() : { notes: [] }
                  if (mySeq === seq) lastResults = body.notes || []
                } catch {
                  // keep lastResults -- a transient network error should not
                  // blank a list the member was already looking at
                }
                resolve(lastResults)
              }, SEARCH_DEBOUNCE_MS)
            })
          }
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
            if (!editorDom) return
            if (id && !dismissed) {
              editorDom.setAttribute('aria-controls', MENU_ID)
              editorDom.setAttribute('aria-activedescendant', id)
            } else {
              editorDom.removeAttribute('aria-controls')
              editorDom.removeAttribute('aria-activedescendant')
            }
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
