/**
 * Journal 2.0 — mobile quick-log FAB (Task B5).
 *
 * A phone-only floating "+ Log" button that opens the same two-choice add flow
 * as the header LogTradeButton (Log open position → AddPositionModal · Log
 * closed trade → AddTradeModal), reusing the existing modals + the same
 * POST /api/j2/positions | /api/j2/trades write path. On desktop the header
 * "+ Log Trade" button serves, so this FAB is CSS-hidden (`display:none`);
 * `@media (max-width:640px)` reveals it — NOT a JS `useIsPhone` branch
 * (first-paint-stale trap).
 *
 * Placement (non-colliding — see B5): `position:fixed` in the BOTTOM-LEFT
 * column, ABOVE the app-wide fixed `MobileTabBar` (bottom:0) and ABOVE the
 * feedback "?" widget (which docks bottom-left at ~70px on touch). The voice
 * orb lives bottom-RIGHT, so the left column above feedback is clear. The split
 * menu opens UPWARD (the FAB sits at the screen bottom).
 *
 * Its own component (not a second <LogTradeButton/>): a duplicate LogTradeButton
 * would mount a second button with the same "Log Trade" accessible name +
 * a downward-opening menu that runs off-screen at the viewport bottom. This FAB
 * has a distinct label ("Log a trade"), an upward menu, and reuses the shared
 * modals + write path.
 *
 * No emoji — the "+" is a `UIcon` glyph (feedback_no_generic_emoji).
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import UIcon from '../../components/ui/UIcon'
import useJ2Settings from './hooks/useJ2Settings'
import useJ2SelectedAccount from './hooks/useJ2SelectedAccount'
import AddPositionModal from './components/AddPositionModal'
import AddTradeModal from './components/AddTradeModal'
import Toast from './components/Toast'
import styles from './JournalLayout.module.css'

async function jsonPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) msg = data.detail
    } catch { /* non-JSON body */ }
    throw new Error(msg)
  }
  return res.json()
}

export default function JournalLogFab() {
  const navigate = useNavigate()
  const { mutate } = useSWRConfig()
  const { settings } = useJ2Settings()
  const { accountId, account, accounts } = useJ2SelectedAccount()

  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState(null) // 'position' | 'trade' | null
  const [toast, setToast] = useState(null)

  const acctName = account?.name || accounts?.[0]?.name

  const openPosition = useCallback(() => { setMenuOpen(false); setModal('position') }, [])
  const openTrade = useCallback(() => { setMenuOpen(false); setModal('trade') }, [])
  const closeModal = useCallback(() => setModal(null), [])

  const resolveAccountId = useCallback(
    (payload) => payload.accountId || accountId || accounts?.[0]?.id || null,
    [accountId, accounts],
  )

  const handleCreatePosition = useCallback(async (payload) => {
    const acctId = resolveAccountId(payload)
    await jsonPost('/api/j2/positions', { ...payload, accountId: acctId })
    await mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/positions'))
    setToast({ message: `Logged ${payload.symbol} ${payload.side?.toLowerCase?.() || ''} position`.trim(), tone: 'success' })
    navigate('/journal/trades?seg=open')
  }, [resolveAccountId, mutate, navigate])

  const handleCreateTrade = useCallback(async (payload) => {
    const acctId = resolveAccountId(payload)
    const res = await jsonPost('/api/j2/trades', { ...payload, accountId: acctId })
    await mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/trades'))
    // Closed-trade attribution feeds Analytics — let it recompute.
    mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/analytics'))
    setToast({ message: `Logged ${res.symbol} closed trade`, tone: 'success' })
    navigate('/journal/trades?seg=closed')
  }, [resolveAccountId, mutate, navigate])

  return (
    <div className={styles.logFab}>
      <button
        type="button"
        className={styles.logFabBtn}
        onClick={() => setMenuOpen((x) => !x)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Log a trade"
      >
        <UIcon name="plus" size={17} aria-hidden="true" />
        <span>Log</span>
      </button>

      {menuOpen && (
        <>
          <div
            className={styles.menuBackdrop}
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`${styles.menu} ${styles.logFabMenu}`}
            role="menu"
            aria-label="Quick log a trade"
          >
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={openPosition}
            >
              <UIcon name="equity" size={14} aria-hidden="true" />
              Log open position
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={openTrade}
            >
              <UIcon name="journal" size={14} aria-hidden="true" />
              Log closed trade
            </button>
          </div>
        </>
      )}

      {modal === 'position' && settings && (
        <AddPositionModal
          settings={settings}
          onSave={handleCreatePosition}
          onClose={closeModal}
          accountName={acctName}
        />
      )}
      {modal === 'trade' && settings && (
        <AddTradeModal
          settings={settings}
          onSave={handleCreateTrade}
          onClose={closeModal}
          accountName={acctName}
          accountId={accountId}
        />
      )}

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />
    </div>
  )
}
