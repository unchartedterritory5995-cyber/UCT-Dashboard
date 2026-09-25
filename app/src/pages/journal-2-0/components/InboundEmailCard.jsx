import { useCallback, useState } from 'react'
import useSWR from 'swr'
import TileCard from '../../../components/TileCard'
import UIcon from '../../../components/ui/UIcon'
import styles from './InboundEmailCard.module.css'

/**
 * Wave 7 lane G (G3) — Settings → Email to Notebook: the member's private
 * `notes+…@` address, and the one control that retires it.
 *
 * ⛔ THE ADDRESS IS A KEY. Anyone who has it can put notes in this Notebook's
 * Inbox, so the card says so, and "Make a new address" says — before it is
 * pressed — that the old address stops working at once.
 *
 * ⛔ DARK MEANS ABSENT. While `NOTEBOOK_INBOUND_EMAIL_ENABLED` is off every route
 * answers 404 and this card renders nothing.
 */

const URL = '/api/j2/inbound-email/address'

async function fetcher(u) {
  const r = await fetch(u, { credentials: 'include' })
  if (r.status === 404) return { dark: true }
  if (r.status === 402) return { unpaid: true }
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

export default function InboundEmailCard() {
  const { data, error, isLoading, mutate } = useSWR(URL, fetcher, { revalidateOnFocus: false })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState(null)

  const copy = useCallback(async () => {
    if (!data?.address) return
    try {
      await navigator.clipboard.writeText(data.address)
      setCopied(true)
    } catch {
      setMessage('Could not copy automatically — select the address and copy it by hand.')
    }
  }, [data])

  const rotate = useCallback(async () => {
    setBusy(true); setMessage(null); setCopied(false)
    try {
      const res = await fetch(URL, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      await mutate(await res.json(), { revalidate: false })
      setConfirming(false)
      setMessage('New address made. The old one no longer works.')
    } catch {
      setMessage('Could not make a new address. Try again.')
    } finally {
      setBusy(false)
    }
  }, [mutate])

  if (data?.dark) return null

  return (
    <TileCard icon="upload" title="Email to Notebook">
      <p className={styles.lead}>
        Forward or send any email to your private address and it becomes a note in your
        Notebook’s Inbox folder, with its attachments. Keep the address to yourself —
        anyone who has it can add notes here.
      </p>

      {isLoading && <div className={styles.muted}>Loading…</div>}
      {error && <div className={styles.muted}>Could not load your address.</div>}
      {data?.unpaid && (
        <div className={styles.muted}>Email to Notebook needs a paid plan.</div>
      )}

      {data?.address && (
        <>
          <div className={styles.tokenRow}>
            <input
              className={styles.tokenInput}
              readOnly
              value={data.address}
              aria-label="Your Notebook email address"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn-secondary" onClick={copy}>
              <UIcon name="copy" size={14} gold={false} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {confirming ? (
            <div className={styles.made} role="group" aria-label="Make a new address">
              <p className={styles.warn}>
                Your current address will stop working immediately. Mail sent to it after
                this is dropped, not delivered.
              </p>
              <div className={styles.makeRow}>
                <button type="button" className="btn btn-danger" disabled={busy} onClick={rotate}>
                  {busy ? 'Making…' : 'Make a new address'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy}
                        onClick={() => setConfirming(false)}>
                  Keep this one
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
              Make a new address…
            </button>
          )}
        </>
      )}

      {message && <div role="status" className={styles.muted}>{message}</div>}
    </TileCard>
  )
}
