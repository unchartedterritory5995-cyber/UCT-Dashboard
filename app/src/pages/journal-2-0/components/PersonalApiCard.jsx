import { useCallback, useState } from 'react'
import useSWR from 'swr'
import TileCard from '../../../components/TileCard'
import UIcon from '../../../components/ui/UIcon'
import styles from './PersonalApiCard.module.css'

/**
 * Wave 7 lane G (G1) — Settings → Personal API: make, see and revoke the tokens
 * an iOS Shortcut (or any HTTP tool) uses to add to the Notebook.
 *
 * ⛔ THE TOKEN IS SHOWN ONCE. The server keeps only its digest and never lists
 * it again, so this card holds the freshly made value in component state only,
 * says plainly that it will not be shown again, and forgets it on Done.
 *
 * ⛔ DARK MEANS ABSENT. While `NOTEBOOK_PERSONAL_API_ENABLED` is off every route
 * answers 404, and this card renders nothing at all — no disabled teaser. Nor BEFORE
 * that answer (wave 7 whole-branch fix, frontend review M-2): a first request still in
 * flight, or one that failed with anything but a 404, leaves the gate unknown and the card
 * absent; its own error sentence appears only once the gate is known ON.
 *
 * Revoking works for a member whose plan lapsed (the server does not paid-gate
 * list or revoke); only making a new token needs a paid plan.
 */

const URL = '/api/j2/personal/tokens'

async function fetcher(u) {
  const r = await fetch(u, { credentials: 'include' })
  if (r.status === 404) return { dark: true }
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

async function detailOf(res, fallback) {
  try {
    const d = await res.json()
    return typeof d?.detail === 'string' ? d.detail : fallback
  } catch {
    return fallback
  }
}

function when(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function PersonalApiCard() {
  const { data, error, isLoading, mutate } = useSWR(URL, fetcher, { revalidateOnFocus: false })
  const [label, setLabel] = useState('')
  const [making, setMaking] = useState(false)
  const [made, setMade] = useState(null)          // {token, label, expiresAt} — shown once
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState(null)

  const make = useCallback(async (e) => {
    e?.preventDefault?.()
    setMaking(true); setMessage(null); setCopied(false)
    try {
      const res = await fetch(URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
      })
      if (!res.ok) {
        setMessage(res.status === 402
          ? 'Making a Personal API token needs a paid plan.'
          : await detailOf(res, 'Could not make a token. Try again.'))
        return
      }
      const d = await res.json()
      setMade({ token: d.token, label: d.label, expiresAt: d.expiresAt })
      setLabel('')
      await mutate()
    } catch {
      setMessage('Could not make a token. Try again.')
    } finally {
      setMaking(false)
    }
  }, [label, mutate])

  const copy = useCallback(async () => {
    if (!made?.token) return
    try {
      await navigator.clipboard.writeText(made.token)
      setCopied(true)
    } catch {
      setMessage('Could not copy automatically — select the token and copy it by hand.')
    }
  }, [made])

  const revoke = useCallback(async (id) => {
    setBusyId(id); setMessage(null)
    try {
      const res = await fetch(`${URL}/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!res.ok) {
        setMessage(await detailOf(res, 'Could not revoke that token. Try again.'))
        return
      }
      await mutate()
    } catch {
      setMessage('Could not revoke that token. Try again.')
    } finally {
      setBusyId(null)
    }
  }, [mutate])

  // ⛔ M-2: no answer yet, or a first answer that was not a 404 -- the gate is unknown.
  if (data === undefined || data.dark) return null
  const tokens = data?.tokens || []

  return (
    <TileCard icon="bolt" title="Personal API">
      <p className={styles.lead}>
        A Personal API token lets an iOS Shortcut or any HTTP tool create notes, add to a
        note, or add to today’s daily note. It cannot read your notes, see your trades, or
        sign in as you. Each token lasts a year unless you revoke it.
      </p>

      {error && <div className={styles.muted}>Could not load your tokens.</div>}

      {made ? (
        <div className={styles.made} role="status" data-testid="personal-api-new-token">
          <div className={styles.madeTitle}>
            New token{made.label ? ` — ${made.label}` : ''}
          </div>
          <p className={styles.warn}>
            Copy it now. For your security it will not be shown again.
          </p>
          <div className={styles.tokenRow}>
            <input
              className={styles.tokenInput}
              readOnly
              value={made.token}
              aria-label="Your new Personal API token"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn-secondary" onClick={copy}>
              <UIcon name="copy" size={14} gold={false} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button type="button" className={`btn btn-ghost ${styles.done}`}
                  onClick={() => { setMade(null); setCopied(false) }}>
            Done
          </button>
        </div>
      ) : (
        !isLoading && !error && (
          <form className={styles.makeRow} onSubmit={make}>
            <input
              className={styles.labelInput}
              value={label}
              maxLength={80}
              placeholder="Name it, e.g. iPhone Shortcuts"
              aria-label="Token name"
              onChange={(e) => setLabel(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={making}>
              {making ? 'Making…' : 'Make a token'}
            </button>
          </form>
        )
      )}

      {tokens.map((t) => (
        <div key={t.id} className={styles.row} data-testid="personal-api-token">
          <div className={styles.rowText}>
            <div className={styles.rowTitle}>
              {t.label}{' '}
              <span className={styles.rowState}>{t.expired ? 'Expired' : 'Active'}</span>
            </div>
            <div className={styles.rowMeta}>
              Made {when(t.createdAt) || '—'}
              {t.lastUsedAt ? ` · last used ${when(t.lastUsedAt)}` : ' · not used yet'}
              {t.expiresAt ? ` · expires ${when(t.expiresAt)}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-danger"
                  disabled={busyId === t.id}
                  aria-label={`Revoke ${t.label}`}
                  onClick={() => revoke(t.id)}>
            {busyId === t.id ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      ))}

      {message && <div role="alert" className={styles.alert}>{message}</div>}
    </TileCard>
  )
}
