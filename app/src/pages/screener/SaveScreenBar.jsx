import { useState, useRef, useEffect } from 'react'
import useSavedScreens from './hooks/useSavedScreens'
import styles from './ScannerPro.module.css'

// Prompt-free saved-screens menu: starters + saved (apply / rename / delete) +
// an inline "save current" input.
export default function SaveScreenBar({ currentSpec, onApply }) {
  const { saved, starters, create, update, remove } = useSavedScreens()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameId, setRenameId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const apply = s => { onApply(s.spec); setOpen(false) }
  const saveCurrent = async () => {
    const name = newName.trim()
    if (!name) return
    await create(name, currentSpec)
    setNewName('')
  }
  const commitRename = async id => {
    const name = renameVal.trim()
    if (name) await update(id, { name })
    setRenameId(null); setRenameVal('')
  }

  return (
    <div className={styles.saveMenuWrap} ref={wrapRef}>
      <button type="button" className={styles.saveBtn} onClick={() => setOpen(o => !o)}>
        Screens ▾
      </button>
      {open && (
        <div className={styles.saveMenuPop} role="menu">
          {starters.length > 0 && (
            <div className={styles.saveMenuSection}>
              <div className={styles.saveMenuHdr}>Starters</div>
              {starters.map(s => (
                <div key={s.id} className={styles.saveMenuItem}>
                  <button type="button" className={styles.saveMenuName} onClick={() => apply(s)}>{s.name}</button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.saveMenuSection}>
            <div className={styles.saveMenuHdr}>My screens</div>
            {saved.length === 0 && <div className={styles.saveMenuEmpty}>None saved yet</div>}
            {saved.map(s => (
              <div key={s.id} className={styles.saveMenuItem}>
                {renameId === s.id ? (
                  <input className={styles.saveMenuInput} autoFocus value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && commitRename(s.id)}
                    onBlur={() => commitRename(s.id)} />
                ) : (
                  <button type="button" className={styles.saveMenuName} onClick={() => apply(s)}>{s.name}</button>
                )}
                <span className={styles.saveMenuAct}>
                  <button type="button" aria-label={`Rename ${s.name}`}
                    onClick={() => { setRenameId(s.id); setRenameVal(s.name) }}>✎</button>
                  <button type="button" aria-label={`Delete ${s.name}`}
                    onClick={() => remove(s.id)}>✕</button>
                </span>
              </div>
            ))}
          </div>
          <div className={styles.saveMenuFoot}>
            <input className={styles.saveMenuInput} placeholder="Name this screen…"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrent()} />
            <button type="button" className={styles.saveBtn} onClick={saveCurrent}>Save current</button>
          </div>
        </div>
      )}
    </div>
  )
}
