/**
 * "+ Log Trade" — persistent header action (Task A5).
 *
 * A single prominent header button that opens a small split menu with the two
 * kinds of manual entry J2 supports:
 *   - "Log open position"  → <AddPositionModal>  (POST /api/j2/positions)
 *   - "Log closed trade"   → <AddTradeModal>     (POST /api/j2/trades)
 *
 * Reuses the existing modals + `useJ2SelectedAccount` (the account the new
 * row is attached to) + `useJ2Settings` (sizing/setup/stop defaults) — mirrors
 * the GlobalAddPositionProvider recipe. After a successful log it revalidates
 * the relevant SWR key so the Trades surface reflects the write immediately,
 * toasts, and navigates to the surface that now shows the row.
 *
 * The menu is a lightweight self-contained popover (backdrop + absolute panel)
 * — deliberately NOT ContextPopover, to keep it inline (no portal / no
 * visibility-hidden measurement / no first-paint-stale useIsTouch coupling) so
 * the two-choice split is deterministic across desktop + phone.
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

export default function LogTradeButton() {
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

  // No global `a`/`t` keyboard aliases here: the Trades surface's own tabs
  // (OpenPositionsTab binds `a`, TradeJournalTab binds `t`) already own those
  // add-flow shortcuts, and react-hotkeys-hook fires ALL handlers for a combo —
  // a global binding on this header (mounted on every surface) would double-fire
  // and open two stacked add modals on the Trades surface (duplicate-write risk).
  // The persistent "+ Log Trade" header button covers every surface via click.

  const resolveAccountId = useCallback(
    (payload) => payload.accountId || accountId || accounts?.[0]?.id || null,
    [accountId, accounts],
  )

  // AddPositionModal calls onClose itself after onSave resolves — so these
  // handlers only do the write + revalidate + confirm; they must NOT close.
  const handleCreatePosition = useCallback(async (payload) => {
    const acctId = resolveAccountId(payload)
    await jsonPost('/api/j2/positions', { ...payload, accountId: acctId })
    await mutate((key) => typeof key === 'string' && key.startsWith('/api/j2/positions'))
    setToast({ message: `Logged ${payload.symbol} ${payload.side.toLowerCase()} position`, tone: 'success' })
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
    <div className={styles.logTradeWrap}>
      <button
        type="button"
        className={styles.logTradeBtn}
        onClick={() => setMenuOpen((x) => !x)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Log a trade"
      >
        <UIcon name="plus" size={15} aria-hidden="true" />
        <span>Log Trade</span>
      </button>

      {menuOpen && (
        <>
          <div
            className={styles.menuBackdrop}
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className={styles.menu} role="menu" aria-label="Log a trade">
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
