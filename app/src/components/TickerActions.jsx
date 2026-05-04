// TickerActions — universal right-click context menu for any ticker symbol
// Provides: color tagging, flag toggle, add to watchlist, set price alert
import { useState } from 'react'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import useTagColors from '../hooks/useTagColors'
import styles from './TickerActions.module.css'

export function useTickerActions() {
  const [menu, setMenu] = useState(null) // { sym, x, y }
  const [alertForm, setAlertForm] = useState(null) // { sym }
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')
  const [addToListSym, setAddToListSym] = useState(null)

  function openMenu(e, sym) {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 220)
    const y = Math.min(e.clientY, window.innerHeight - 350)
    setMenu({ sym: sym.toUpperCase(), x, y })
  }

  function closeMenu() { setMenu(null) }

  return { menu, openMenu, closeMenu, alertForm, setAlertForm, alertPrice, setAlertPrice, alertDir, setAlertDir, addToListSym, setAddToListSym }
}

export default function TickerActionsMenu({ menu, onClose, lists, mutateLists }) {
  const { toggle: toggleFlag, isFlagged } = useFlagged()
  const { tagColors: TAG_COLORS } = useTagColors()
  const { getTag, setTag, removeTag } = useTickerTags()
  const { createAlert, deleteAlert, getAlertsForSym, hasAlert } = useWatchlistAlerts()
  const [showAlert, setShowAlert] = useState(false)
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')
  const [showAddList, setShowAddList] = useState(false)

  if (!menu) return null
  const { sym, x, y } = menu
  const flagged = isFlagged(sym)
  const currentTag = getTag(sym)

  async function handleAddToList(listId) {
    await fetch(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sym, notes: '' }),
    })
    if (mutateLists) mutateLists()
    setShowAddList(false)
    onClose()
  }

  return (
    <div className={styles.backdrop} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}>
      <div className={styles.menu} style={{ top: y, left: x }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>{sym}</div>

        {/* Flag */}
        <button className={styles.item} onClick={() => { toggleFlag(sym); onClose() }}>
          {flagged ? '⚑ Unflag' : '⚑ Flag'}
        </button>

        {/* Tags */}
        <div className={styles.tagSection}>
          <span className={styles.tagLabel}>Tag</span>
          <div className={styles.swatches}>
            {TAG_COLORS.map(tc => (
              <button
                key={tc.key}
                className={`${styles.swatch}${currentTag === tc.key ? ' ' + styles.swatchActive : ''}`}
                style={{ background: tc.hex }}
                title={tc.label}
                onClick={() => { currentTag === tc.key ? removeTag(sym) : setTag(sym, tc.key); onClose() }}
              />
            ))}
          </div>
        </div>

        {/* Add to list */}
        {!showAddList ? (
          <button className={styles.item} onClick={() => setShowAddList(true)}>+ Add to list</button>
        ) : (
          <div className={styles.listPicker}>
            {(lists || []).map(wl => (
              <button key={wl.id} className={styles.listOption} onClick={() => handleAddToList(wl.id)}>
                {wl.name}
              </button>
            ))}
            {(!lists || lists.length === 0) && <span className={styles.noLists}>No lists yet</span>}
          </div>
        )}

        {/* Alert */}
        {!showAlert ? (
          <button className={styles.item} onClick={() => setShowAlert(true)}>
            🔔 {hasAlert(sym) ? 'Manage alerts' : 'Set alert'}
          </button>
        ) : (
          <div className={styles.alertSection}>
            <div className={styles.alertRow}>
              <select className={styles.alertSelect} value={alertDir} onChange={e => setAlertDir(e.target.value)}>
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input
                className={styles.alertInput}
                type="number"
                step="0.01"
                placeholder="$0.00"
                value={alertPrice}
                onChange={e => setAlertPrice(e.target.value)}
                autoFocus
              />
              <button
                className={styles.alertSet}
                disabled={!alertPrice || parseFloat(alertPrice) <= 0}
                onClick={() => { createAlert(sym, parseFloat(alertPrice), alertDir); setAlertPrice(''); setShowAlert(false); onClose() }}
              >Set</button>
            </div>
            {getAlertsForSym(sym).map(a => (
              <div key={a.id} className={styles.alertItem}>
                <span>{a.direction} ${a.target_price.toFixed(2)}</span>
                <button className={styles.alertDel} onClick={() => deleteAlert(a.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
