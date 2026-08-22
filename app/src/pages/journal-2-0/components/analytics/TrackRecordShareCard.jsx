/**
 * TrackRecordShareCard — owner-side control for the public track-record link.
 *
 * The public page shows EVERYTHING (stats + dollars + recent trades — owner
 * decision), so this card says that in plain words before the user turns it
 * on. Rotate mints a new token (the old link dies instantly); revoke kills
 * the page entirely. URL built from lib/trackRecordLink.js — the same
 * authority the route derives from.
 */

import { useState } from 'react'
import useMobileSWR from '../../../../hooks/useMobileSWR'
import { buildTrackRecordUrl } from '../../lib/trackRecordLink'
import styles from './TrackRecordShareCard.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function TrackRecordShareCard() {
  const { data, mutate } = useMobileSWR('/api/j2/track-record-link', fetcher, {
    revalidateOnFocus: false, refreshInterval: 0,
  })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const call = async (method) => {
    setBusy(true)
    try {
      const r = await fetch('/api/j2/track-record-link', {
        method, credentials: 'include',
      })
      if (r.ok) mutate(await r.json(), { revalidate: false })
    } finally {
      setBusy(false)
    }
  }

  const url = data?.token ? buildTrackRecordUrl(data.token) : null

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard unavailable — the input stays selectable */ }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.blurb}>
        A public, read-only page of your verified track record — stats,
        dollar P&amp;L, equity curve, and recent trades. Anyone with the link
        can view it; your email and account details are never shown.
        Rotating or revoking kills the old link instantly.
      </p>

      {!data?.enabled ? (
        <button
          type="button" className={styles.primaryBtn} disabled={busy}
          onClick={() => call('POST')}
        >
          Create my public link
        </button>
      ) : (
        <>
          <div className={styles.linkRow}>
            <input
              className={styles.linkInput} readOnly value={url || ''}
              onFocus={(e) => e.target.select()}
              aria-label="Public track record URL"
            />
            <button type="button" className={styles.btn} onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div className={styles.actions}>
            <a className={styles.btn} href={url} target="_blank" rel="noreferrer">Open</a>
            <button type="button" className={styles.btn} disabled={busy}
              onClick={() => call('POST')}>
              Rotate link
            </button>
            <button type="button" className={styles.dangerBtn} disabled={busy}
              onClick={() => call('DELETE')}>
              Revoke
            </button>
          </div>
        </>
      )}
    </div>
  )
}
