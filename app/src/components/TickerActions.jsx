// TickerActions — universal context menu for any ticker symbol.
// Right-click (desktop) or long-press (touch) → color tagging, flag toggle,
// add to watchlist, set price alert. On touch it renders as a bottom-sheet.
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { useFlagged } from '../hooks/useFlagged'
import useTickerTags from '../hooks/useTickerTags'
import useWatchlistAlerts from '../hooks/useWatchlistAlerts'
import useTagColors from '../hooks/useTagColors'
import { useIsTouch } from '../hooks/useBreakpoint'
import Sheet from './mobile/Sheet'
import UIcon from './ui/UIcon'
import styles from './TickerActions.module.css'

export function useTickerActions() {
  const [menu, setMenu] = useState(null) // { sym, x, y }
  const [alertForm, setAlertForm] = useState(null) // { sym }
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')
  const [addToListSym, setAddToListSym] = useState(null)

  // Shared long-press timer state (one set of refs serves every call site)
  const lpTimer = useRef(null)
  const lpStart = useRef({ x: 0, y: 0 })
  const lpFiredAt = useRef(0)
  const clearLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }

  function openMenu(e, sym) {
    e.preventDefault?.()
    e.stopPropagation?.()
    const x = Math.min(e.clientX ?? 0, window.innerWidth - 220)
    const y = Math.min(e.clientY ?? 0, window.innerHeight - 350)
    setMenu({ sym: String(sym).toUpperCase(), x, y })
  }

  function closeMenu() { setMenu(null) }

  // Spread onto any ticker element to get touch long-press + desktop right-click.
  //   <span {...longPressProps(sym)} onContextMenu={e => openMenu(e, sym)}>…
  function longPressProps(sym) {
    return {
      onContextMenu: (e) => openMenu(e, sym),
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse') return
        lpStart.current = { x: e.clientX, y: e.clientY }
        clearLp()
        lpTimer.current = setTimeout(() => {
          try { navigator.vibrate?.(10) } catch { /* noop */ }
          lpFiredAt.current = e.timeStamp || performance.now()
          openMenu({ clientX: e.clientX, clientY: e.clientY }, sym)
        }, 450)
      },
      onPointerMove: (e) => {
        if (!lpTimer.current) return
        if (Math.abs(e.clientX - lpStart.current.x) > 10 || Math.abs(e.clientY - lpStart.current.y) > 10) clearLp()
      },
      onPointerUp: clearLp,
      onPointerCancel: clearLp,
      // Swallow the tap-click that follows a long-press so the element's own
      // onClick (e.g. "open modal") doesn't also fire.
      onClickCapture: (e) => {
        const now = e.timeStamp || performance.now()
        if (now - lpFiredAt.current < 600) { e.preventDefault(); e.stopPropagation() }
      },
    }
  }

  return { menu, openMenu, closeMenu, longPressProps, alertForm, setAlertForm, alertPrice, setAlertPrice, alertDir, setAlertDir, addToListSym, setAddToListSym }
}

const _listsFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []))

export default function TickerActionsMenu({ menu, onClose, lists, mutateLists }) {
  const navigate = useNavigate()
  const { toggle: toggleFlag, isFlagged } = useFlagged()
  const { tagColors: TAG_COLORS } = useTagColors()
  const { getTag, setTag, removeTag } = useTickerTags()
  const { createAlert, deleteAlert, getAlertsForSym, hasAlert } = useWatchlistAlerts()
  const isTouch = useIsTouch()
  const [showAlert, setShowAlert] = useState(false)
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDir, setAlertDir] = useState('above')
  const [showAddList, setShowAddList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [creating, setCreating] = useState(false)
  // "+ Add to list" used to depend on a `lists` prop that NO call site passed,
  // so every surface in the app rendered "No lists yet". The menu now fetches
  // the user's lists itself when the picker opens; an explicit prop still wins
  // (a caller that already holds fresh lists shouldn't trigger a second fetch).
  const { data: fetchedLists, mutate: mutateFetched } = useSWR(
    menu && showAddList && !lists ? '/api/watchlists' : null,
    _listsFetcher,
  )
  // Prebuilt (UCT-curated) lists are OWNED by the admin account, so the owner's own
  // fetch returns them too — ~30 UCT names (12 of them the dated Sunday Scans archive)
  // stacked above his personal lists. They are also config-managed: the boot seeder
  // reverts any symbol added by hand on the next boot. So the quick-add picker offers
  // only lists a person actually curates. (Members never receive prebuilt rows here.)
  const effLists = (lists || fetchedLists)?.filter(wl => !wl?.is_prebuilt)
  const effMutate = mutateLists || mutateFetched

  if (!menu) return null
  const { sym, x, y } = menu
  const flagged = isFlagged(sym)
  const currentTag = getTag(sym)

  async function handleAddToList(listId) {
    await fetch(`/api/watchlists/${listId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sym, notes: '' }),
    })
    if (effMutate) effMutate()
    setShowAddList(false)
    onClose()
  }

  // Inline "New list" — create a watchlist and drop the symbol in, without
  // leaving whatever page the reader is on.
  async function handleCreateList() {
    const name = newListName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const r = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.slice(0, 60), description: '', is_public: false }),
      })
      if (!r.ok) throw new Error('create failed')
      const created = await r.json()
      await handleAddToList(created.id)
      setNewListName('')
    } catch { /* leave the picker open so the user can retry */ } finally {
      setCreating(false)
    }
  }

  const body = (
    <>
      {/* Ask AI — makes AI Search reachable from EVERY ticker surface in the app.
          Deep-links to the standalone page with a grounded, day-recency question
          (regime + live quote + catalyst + patterns all fire on the ticker). */}
        <button
          className={styles.item}
          onClick={() => {
            navigate(`/ai-search?q=${encodeURIComponent(`What's the setup and catalyst on ${sym} right now?`)}`)
            onClose()
          }}
        >
          <UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Ask AI about {sym}
        </button>

        {/* Flag */}
        <button className={styles.item} onClick={() => { toggleFlag(sym); onClose() }}>
          <UIcon name="flag" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{flagged ? 'Unflag' : 'Flag'}
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
            {(effLists || []).map(wl => (
              <button key={wl.id} className={styles.listOption} onClick={() => handleAddToList(wl.id)}>
                {wl.name}
              </button>
            ))}
            {effLists && effLists.length === 0 && <span className={styles.noLists}>No lists yet</span>}
            {!effLists && <span className={styles.noLists}>Loading…</span>}
            <div className={styles.newListRow}>
              <input
                className={styles.newListInput}
                type="text"
                placeholder="New list…"
                value={newListName}
                maxLength={60}
                onChange={e => setNewListName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateList() }}
              />
              <button
                type="button"
                className={styles.newListBtn}
                disabled={!newListName.trim() || creating}
                onClick={handleCreateList}
              >
                {creating ? '…' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Alert */}
        {!showAlert ? (
          <button className={styles.item} onClick={() => setShowAlert(true)}>
            <UIcon name="bell" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{hasAlert(sym) ? 'Manage alerts' : 'Set alert'}
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
    </>
  )

  // Touch: bottom-sheet with big tap targets
  if (isTouch) {
    return (
      <Sheet open onClose={onClose} variant="bottom-sheet" title={sym}>
        <div className={styles.sheetBody}>{body}</div>
      </Sheet>
    )
  }

  // Desktop: anchored floating menu
  return (
    <div className={styles.backdrop} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}>
      <div className={styles.menu} style={{ top: y, left: x }} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>{sym}</div>
        {body}
      </div>
    </div>
  )
}
