import { useCallback, useState } from 'react'
import useSWR from 'swr'
import TileCard from '../../../components/TileCard'

/**
 * Browser Capture connections — the member's revoke door (§16).
 *
 * ⛔ THIS IS THE REVOCATION THAT COUNTS. "Forget this connection" inside the
 * extension only clears the extension's own copy; the credential stays valid
 * server-side, so a stolen copy would still work. Disconnecting HERE marks the
 * row revoked and every capture with it fails on the next request. The
 * distinction is stated in both places rather than left for a member to
 * discover, because a revoke that quietly did not revoke is worse than no
 * button at all.
 *
 * Revocation is per credential: it logs nobody out, rotates no shared secret,
 * and touches no other device.
 */

const URL = '/api/j2/capture/connections'

const fetcher = (u) => fetch(u, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
})

function when(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function BrowserCaptureCard() {
  const { data, error, isLoading, mutate } = useSWR(URL, fetcher, { revalidateOnFocus: false })
  const [busyId, setBusyId] = useState(null)
  const [failed, setFailed] = useState(null)

  const connections = data?.connections || []

  const disconnect = useCallback(async (id) => {
    setBusyId(id); setFailed(null)
    try {
      const res = await fetch(`${URL}/${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!res.ok) throw new Error(String(res.status))
      await mutate()
    } catch {
      setFailed(id)
    } finally {
      setBusyId(null)
    }
  }, [mutate])

  return (
    <TileCard icon="link" title="Browser Capture">
      {isLoading && <div style={{ opacity: 0.7 }}>Loading…</div>}
      {error && <div style={{ opacity: 0.7 }}>Could not load your connections.</div>}

      {!isLoading && !error && connections.length === 0 && (
        <div style={{ opacity: 0.75, lineHeight: 1.6 }}>
          Not connected. Install the UCT Browser Capture extension and choose
          Connect to save research from any page into your Notebook.
        </div>
      )}

      {connections.map((c) => (
        <div key={c.id} data-testid="browser-capture-connection"
             style={{
               display: 'flex', alignItems: 'center', justifyContent: 'space-between',
               gap: 12, padding: '10px 0',
               borderTop: '1px solid var(--color-border, rgba(255,255,255,0.1))',
             }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {c.label}{' '}
              <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
                {c.expired ? 'Expired' : 'Connected'}
              </span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {/* Enough to tell two installations apart and revoke the right
                  one — a date the member recognises, never token material. */}
              Connected {when(c.createdAt) || '—'}
              {c.lastUsedAt ? ` · last used ${when(c.lastUsedAt)}` : ' · not used yet'}
              {c.expiresAt ? ` · expires ${when(c.expiresAt)}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-danger"
                  disabled={busyId === c.id}
                  onClick={() => disconnect(c.id)}>
            {busyId === c.id ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ))}

      {failed && (
        <div role="alert" style={{ marginTop: 8, color: 'var(--color-danger, #f87171)' }}>
          Could not disconnect. Try again.
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7, lineHeight: 1.6 }}>
        A Browser Capture connection can save links and passages into your
        Notebook. It cannot read your notes, see your trades, or sign in as you.
        Disconnecting here revokes it everywhere.
      </div>
    </TileCard>
  )
}
