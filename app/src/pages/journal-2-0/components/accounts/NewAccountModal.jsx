/**
 * Create Account modal — name, color picker, broker, starting balance,
 * + optional copy-settings-from picker.
 */

import { useEffect, useState } from 'react'
import { useSWRConfig } from 'swr'
import useJ2Accounts from '../../hooks/useJ2Accounts'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { COLOR_KEYS, ACCOUNT_COLORS, nextAvailableColor } from '../../lib/accountColors'
import styles from './NewAccountModal.module.css'

export default function NewAccountModal({ onClose }) {
  const { accounts } = useJ2Accounts()
  const { setAccount } = useJ2SelectedAccount()
  const { mutate } = useSWRConfig()

  const usedColors = accounts.map((a) => a.color)
  const [name, setName] = useState('')
  const [color, setColor] = useState(() => nextAvailableColor(usedColors))
  const [broker, setBroker] = useState('')
  const [startingBalance, setStartingBalance] = useState(25_000)
  const [copyFrom, setCopyFrom] = useState(accounts[0]?.id || '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!Number.isFinite(Number(startingBalance)) || Number(startingBalance) <= 0) {
      setError('Starting balance must be > 0.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/j2/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          color,
          broker: broker.trim() || null,
          startingBalance: Number(startingBalance),
          copySettingsFrom: copyFrom || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status}`)
      }
      const created = await res.json()
      // Invalidate caches + auto-select the new account
      mutate('/api/j2/accounts')
      mutate('/api/j2/accounts/comparison')
      setAccount(created.id)
      onClose?.()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <form className={styles.modal} onSubmit={submit}>
        <div className={styles.header}>
          <h2 className={styles.title}>New Account</h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>Name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Earnings Plays"
              maxLength={60}
              className={styles.input}
              autoFocus
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Color *</span>
            <div className={styles.colorGrid} role="radiogroup" aria-label="Account color">
              {COLOR_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`${styles.swatch} ${color === k ? styles.swatchActive : ''}`}
                  style={{ background: ACCOUNT_COLORS[k].hex }}
                  onClick={() => setColor(k)}
                  aria-label={ACCOUNT_COLORS[k].label}
                  aria-pressed={color === k}
                  title={ACCOUNT_COLORS[k].label}
                />
              ))}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Broker</span>
            <input
              type="text"
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              placeholder="e.g. Schwab, IBKR (optional)"
              className={styles.input}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Starting balance *</span>
            <div className={styles.prefixInput}>
              <span className={styles.prefix}>$</span>
              <input
                type="number"
                min="1"
                step="any"
                value={startingBalance}
                onChange={(e) => setStartingBalance(e.target.value)}
                className={styles.numberInput}
              />
            </div>
          </label>

          {accounts.length > 0 && (
            <label className={styles.field}>
              <span className={styles.label}>Copy settings from</span>
              <select
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
                className={styles.select}
              >
                <option value="">— System defaults —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <span className={styles.hint}>
                Clones default-stop, breakeven range, and setups list.
                Privacy (community sharing) always defaults to off.
              </span>
            </label>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={styles.primary} disabled={saving}>
            {saving ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </form>
    </div>
  )
}
