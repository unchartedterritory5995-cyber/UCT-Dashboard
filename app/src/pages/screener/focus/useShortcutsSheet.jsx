import { useCallback, useState } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import styles from './FocusMenus.module.css'

// The Focus layout's keyboard shortcuts, listed once: the sheet below reads this, so the list
// a member is shown is the list the page's own handlers implement (useFocusSelection, the
// page's "/" key, and the "?" key bound here).
export const FOCUS_SHORTCUTS = [
  { keys: ['↑', '↓'], also: ['k', 'j'], does: 'Move through the list; the chart follows' },
  { keys: ['Enter'], does: 'Open the full chart' },
  { keys: ['W'], does: 'Add the stock to your watchlist' },
  { keys: ['Shift', 'F'], does: 'Flag or unflag the stock' },
  { keys: ['/'], does: 'Open the filters' },
  { keys: ['?'], does: 'Show this list' },
  { keys: ['Esc'], does: 'Close a menu, the filters or this list' },
]

const typing = t => {
  if (!t) return false
  if (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable) return true
  // isContentEditable is not computed everywhere (jsdom): read the attribute up the tree too.
  if (typeof t.closest === 'function' && t.closest('[contenteditable]:not([contenteditable="false"])')) return true
  const role = typeof t.getAttribute === 'function' ? t.getAttribute('role') : null
  return role === 'textbox' || role === 'combobox' || role === 'searchbox'
}

// Should this keydown open the sheet? "?" only: never while typing (an input, a textarea, a
// contenteditable), never with Ctrl/Cmd/Alt, never on a held key's auto-repeat, and never from
// inside a dialog or menu that is already open (the filters, a menu, this sheet).
export function isShortcutsKey(e) {
  if (!e || e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return false
  const t = e.target
  if (typing(t)) return false
  if (t && typeof t.closest === 'function' && t.closest('[role="dialog"],[role="menu"],[aria-modal="true"]')) return false
  return true
}

/**
 * B10/N6: the "?" key and the sheet it opens.
 *
 * ⛔ ELEMENT-SCOPED BY DESIGN. `onKeyDown` goes on the Focus layout's root element, so "?" is
 * the Focus layout's only while the layout is mounted AND focus is inside it — never a
 * document listener (the key-listener census in pages/command ratchets those, and a global "?"
 * would collide with any other surface's). It stops the event there, so while focus is inside
 * the layout the sheet takes precedence over anything listening further out.
 *
 * Returns { open, onKeyDown, sheet }: render `sheet` once, hand `open` to Help's
 * "Keyboard shortcuts", and put `onKeyDown` on the layout's root.
 */
export function useShortcutsSheet() {
  const [isOpen, setOpen] = useState(false)
  const open = useCallback(() => setOpen(true), [])
  const onKeyDown = useCallback(e => {
    if (!isShortcutsKey(e)) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(true)
  }, [])
  const sheet = (
    <Sheet open={isOpen} onClose={() => setOpen(false)} variant="auto" title="Keyboard shortcuts" ariaLabel="Keyboard shortcuts" maxWidth={420}>
      {isOpen && (
        <>
          <dl className={styles.keys} data-testid="focus-shortcuts">
            {FOCUS_SHORTCUTS.map(s => (
              <div key={s.does} className={styles.keyRow}>
                <dt>
                  {s.keys.map(k => <kbd key={k} className={styles.kbd}>{k}</kbd>)}
                  {s.also && <span className={styles.keysOr}>or {s.also.map(k => <kbd key={k} className={styles.kbd}>{k}</kbd>)}</span>}
                </dt>
                <dd>{s.does}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.keysNote}>Keys work while the results list has focus. Click a row or press Tab to reach it.</p>
        </>
      )}
    </Sheet>
  )
  return { open, onKeyDown, sheet }
}
