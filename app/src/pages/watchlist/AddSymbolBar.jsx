// AddSymbolBar — the pinned "put a ticker on a list" row at the top of the
// watchlist panel. Three controls, left to right:
//
//   [+ NVDA]   [ search ticker… ]   [ target list ▾ ]
//   quick-add   predictive combobox   picker + inline "＋ New list…"
//
// Before this existed, adding a symbol meant expanding a list, scrolling to its
// bottom, and typing into a bare input with no autocomplete; creating a list
// meant a modal. Both are one motion here, and neither scrolls away.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import TickerCombobox from '../../components/watchlist/TickerCombobox'
import UIcon from '../../components/ui/UIcon'
import styles from './AddSymbolBar.module.css'


const TARGET_KEY = 'uct.watchlist.addTarget'

function readStoredTarget() {
  try { return localStorage.getItem(TARGET_KEY) || null } catch { return null }
}
function writeStoredTarget(id) {
  try { localStorage.setItem(TARGET_KEY, id) } catch { /* private mode */ }
}

const AddSymbolBar = forwardRef(function AddSymbolBar({
  targets,          // [{ id, name, syms: Set<string> }] — Flagged first, then user lists
  selectedSym,      // symbol on the paired chart (this widget's colour group)
  onAdd,            // (targetId, sym) => Promise<{ duplicate?: boolean }>
  onCreateList,     // (name) => Promise<{ id, name } | null>
  // A Charts widget is SCOPED to a single list, so there is nothing to choose
  // between and a new list would be invisible the moment it's created. The
  // picker (and its "New list…" row) is therefore suppressed there; creating a
  // list lives on the widget's "Add a Watchlist" screen instead.
  showPicker = true,
}, ref) {
  const [targetId, setTargetId] = useState(() => readStoredTarget())
  const [menuOpen, setMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')      // announced via aria-live
  const comboRef = useRef(null)
  const menuRef = useRef(null)
  const newNameRef = useRef(null)

  // Resolve the stored target against what actually exists now (a list can be
  // deleted from under us, and on first run nothing is stored).
  const target = useMemo(() => {
    if (!targets.length) return null
    return targets.find(t => t.id === targetId) || targets[0]
  }, [targets, targetId])

  useImperativeHandle(ref, () => ({
    focus: () => comboRef.current?.focus(),
  }), [])

  // Transient confirmation ("NVDA added to Momentum Plays").
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(''), 2600)
    return () => clearTimeout(t)
  }, [status])

  // Close the target menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false); setCreating(false); setNewName('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => { if (creating) newNameRef.current?.focus() }, [creating])

  const addTo = useCallback(async (listId, sym, listName) => {
    if (!listId || !sym || busy) return
    setBusy(true)
    try {
      const res = await onAdd(listId, sym)
      setStatus(res?.duplicate
        ? `${sym} is already in ${listName}`
        : `${sym} added to ${listName}`)
    } catch {
      setStatus(`Could not add ${sym}`)
    } finally {
      setBusy(false)
    }
  }, [onAdd, busy])

  const handlePick = useCallback((sym) => {
    if (!target) { setStatus('Create a list first'); return }
    addTo(target.id, sym, target.name)
  }, [target, addTo])

  const chooseTarget = useCallback((t) => {
    setTargetId(t.id)
    writeStoredTarget(t.id)
    setMenuOpen(false)
    setCreating(false)
    setNewName('')
  }, [])

  const submitNewList = useCallback(async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const created = await onCreateList(name)
      if (!created?.id) { setStatus('Could not create list'); return }
      setTargetId(created.id)
      writeStoredTarget(created.id)
      setMenuOpen(false)
      setCreating(false)
      setNewName('')
      setStatus(`Created ${created.name}`)
      // Land the user in the input so the new list gets its first ticker.
      setTimeout(() => comboRef.current?.focus(), 0)
    } finally {
      setBusy(false)
    }
  }, [newName, onCreateList, busy])

  const quickSym = selectedSym ? String(selectedSym).toUpperCase() : null
  const quickAlready = !!(quickSym && target?.syms?.has(quickSym))

  return (
    <div className={styles.bar}>
      {quickSym && target && (
        <button
          type="button"
          className={`${styles.quick}${quickAlready ? ' ' + styles.quickDone : ''}`}
          disabled={quickAlready || busy}
          onClick={() => addTo(target.id, quickSym, target.name)}
          title={quickAlready
            ? `${quickSym} is already in ${target.name}`
            : `Add ${quickSym} to ${target.name}`}
          // Explicit label: the visible text is just the bare symbol, and a
          // narrow widget hides even that (see .quickSym in the container query),
          // so content alone would leave this button unnamed.
          aria-label={quickAlready
            ? `${quickSym} is already in ${target.name}`
            : `Add ${quickSym} to ${target.name}`}
        >
          <UIcon name={quickAlready ? 'check' : 'plus'} size={11} />
          <span className={styles.quickSym}>{quickSym}</span>
        </button>
      )}

      <TickerCombobox
        ref={comboRef}
        onPick={handlePick}
        existingSyms={target?.syms}
        targetLabel={target?.name}
        placeholder={target ? `Add to ${target.name}…` : 'Add symbol…'}
      />

      {showPicker && (
      <div className={styles.pickerWrap} ref={menuRef}>
        <button
          type="button"
          className={styles.picker}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
          title="Choose which list new symbols go to"
          // Content is just the list name, which reads as a label rather than a
          // control; spell out what the button does.
          aria-label={`Choose which list new symbols go to (currently ${target ? target.name : 'none'})`}
        >
          <span className={styles.pickerName}>{target ? target.name : 'No lists'}</span>
          <UIcon name="chevronDown" size={10} />
        </button>

        {menuOpen && (
          <div className={styles.menu} role="menu">
            {targets.map(t => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={`${styles.menuItem}${t.id === target?.id ? ' ' + styles.menuItemActive : ''}`}
                onClick={() => chooseTarget(t)}
              >
                <span className={styles.menuLabel}>{t.name}</span>
                <span className={styles.menuCount}>{t.syms?.size ?? 0}</span>
              </button>
            ))}

            <div className={styles.menuSep} role="separator" />

            {creating ? (
              <div className={styles.newRow}>
                <input
                  ref={newNameRef}
                  className={styles.newInput}
                  value={newName}
                  maxLength={60}
                  placeholder="List name"
                  aria-label="New watchlist name"
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); submitNewList() }
                    if (e.key === 'Escape') {
                      e.preventDefault(); e.stopPropagation()
                      setCreating(false); setNewName('')
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.newGo}
                  disabled={!newName.trim() || busy}
                  onClick={submitNewList}
                >Create</button>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.menuNew}`}
                onClick={() => setCreating(true)}
              >
                <UIcon name="plus" size={11} />
                <span className={styles.menuLabel}>New list…</span>
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Screen-reader + visual confirmation of the last add. */}
      <div className={styles.live} role="status" aria-live="polite">
        {status && <span className={styles.liveText}>{status}</span>}
      </div>
    </div>
  )
})

export default AddSymbolBar
