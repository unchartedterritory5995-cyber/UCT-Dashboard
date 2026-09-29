/**
 * TERM-077 / FB-A12-03 — "Save to My Lists", with the copy-or-link question
 * asked once and never guessed.
 *
 * Mounted from `pages/Watchlists.jsx` only while the server reports
 * `watchlist_copy_or_link_enabled`; the server is the authority on both the
 * gate and the choice (`POST /api/watchlists/{id}/save-as` refuses a missing
 * mode), so this dialog cannot create a list without one.
 */
import { useState } from 'react'
import Sheet from '../../components/mobile/Sheet'
import { originLine } from './watchlistOrigin'
import styles from './SaveListDialog.module.css'

const CHOICES = [
  {
    mode: 'copy',
    label: 'Copy',
    detail: 'A snapshot you own. Edit it freely; later changes to the source never reach it.',
  },
  {
    mode: 'link',
    label: 'Link',
    detail: 'Follows the source, which stays in charge. Read-only here; it shows when it last synced.',
  },
]

export function ListOrigin({ origin }) {
  const line = originLine(origin)
  if (!line) return null
  return (
    <div className={`${styles.origin}${line.stale ? ' ' + styles.originStale : ''}`} data-origin-mode={origin.mode}>
      {line.text}
    </div>
  )
}

export default function SaveListDialog({ source, onClose, onSaved }) {
  // ⛔ null, never a default: the member must pick.
  const [mode, setMode] = useState(null)
  const [name, setName] = useState(source?.name || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save() {
    if (!mode || busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/watchlists/${encodeURIComponent(source.id)}/save-as`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, name: name.trim() || null }),
      })
      if (!res.ok) {
        let detail = null
        try { detail = (await res.json())?.detail } catch { /* not JSON */ }
        setErr(typeof detail === 'string' ? detail : `Could not save (HTTP ${res.status})`)
        return
      }
      onSaved?.(await res.json())
    } catch {
      setErr('Could not save — network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} variant="auto" title="Save to My Lists" maxWidth={440}>
      <div className={styles.body}>
        <div className={styles.lede}>
          Save <strong>{source?.name}</strong> as a copy or a link. You choose once; it does not change later.
        </div>
        <fieldset className={styles.choices}>
          <legend className={styles.srOnly}>Copy or link</legend>
          {CHOICES.map(c => (
            <label key={c.mode} className={`${styles.choice}${mode === c.mode ? ' ' + styles.choiceOn : ''}`}>
              <input
                type="radio"
                name="wl-save-mode"
                value={c.mode}
                checked={mode === c.mode}
                onChange={() => setMode(c.mode)}
                aria-label={c.label}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{c.label}</span>
                <span className={styles.choiceDetail}>{c.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className={styles.nameRow}>
          <span className={styles.nameLabel}>Name</span>
          <input
            className={styles.nameInput}
            value={name}
            maxLength={60}
            onChange={e => setName(e.target.value)}
          />
        </label>
        {err && <div className={styles.err} role="alert">{err}</div>}
        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!mode || busy} onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  )
}
