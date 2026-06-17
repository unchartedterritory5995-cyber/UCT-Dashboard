import { useEffect, useState, useCallback } from 'react'
import TileCard from '../../../components/TileCard'
import { useAuth } from '../../../context/AuthContext'
import styles from './BrokerConnectionsCard.module.css'

/**
 * Brokerage Connections (SnapTrade) — Settings panel.
 *
 * Flow: consent → SnapTrade Connection Portal (full redirect) → return to
 * /settings?broker=connected → refresh accounts. Premium-gated; status is
 * readable by anyone so the upsell + "not available" states render.
 */
export default function BrokerConnectionsCard() {
  const { isPaid, startCheckout } = useAuth()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showConsent, setShowConsent] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [error, setError] = useState(null)
  const [dupFlags, setDupFlags] = useState(null)   // null = not loaded
  const [syncResult, setSyncResult] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/j2/broker/status', { credentials: 'include' })
      if (r.ok) setStatus(await r.json())
    } catch {
      /* leave status null → render falls back to neutral state */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Returning from the SnapTrade portal → import the just-connected accounts.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('broker') !== 'connected') return
    let cancelled = false
    ;(async () => {
      setBusy(true)
      try {
        await fetch('/api/j2/broker/accounts/refresh', {
          method: 'POST', credentials: 'include',
        })
        // First connect → full historical backfill; show what landed.
        const r = await fetch('/api/j2/broker/sync?full=1', { method: 'POST', credentials: 'include' })
        if (r.ok) setSyncResult(summarizeSync(await r.json()))
      } catch {
        /* surfaced via status reload below */
      }
      params.delete('broker')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      if (!cancelled) { await load(); setBusy(false) }
    })()
    return () => { cancelled = true }
  }, [load])

  const startConnect = async () => {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/j2/broker/connect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          customRedirect: `${window.location.origin}/settings?broker=connected`,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.detail || 'Could not start the connection. Try again.')
        setBusy(false)
        return
      }
      const { redirectUri } = await r.json()
      window.location.href = redirectUri  // hand off to SnapTrade's portal
    } catch {
      setError('Could not start the connection. Try again.')
      setBusy(false)
    }
  }

  const toggleSync = async (acct) => {
    const next = !acct.syncEnabled
    await fetch(`/api/j2/broker/accounts/${acct.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncEnabled: next }),
    }).catch(() => {})
    load()
  }

  const syncNow = async (full = false) => {
    setBusy(true); setError(null)
    try {
      // full=1 re-fetches ALL history (catches activities SnapTrade backfilled
      // after the first sync, e.g. options); force=1 also bypasses the cooldown.
      const url = full ? '/api/j2/broker/sync?full=1&force=1' : '/api/j2/broker/sync'
      const r = await fetch(url, { method: 'POST', credentials: 'include' })
      if (r.ok) setSyncResult(summarizeSync(await r.json()))
    } catch {
      setError('Sync failed — try again shortly.')
    }
    await load()
    setBusy(false)
  }

  const loadDups = async () => {
    try {
      const r = await fetch('/api/j2/broker/dup-flags', { credentials: 'include' })
      if (r.ok) setDupFlags((await r.json()).flags || [])
    } catch { setDupFlags([]) }
  }

  const resolveDup = async (id, action) => {
    await fetch(`/api/j2/broker/dup-flags/${id}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => {})
    await loadDups()
    load()
  }

  const disconnect = async () => {
    if (!window.confirm(
      'Disconnect all brokerages? The live connection is removed.\n\n' +
      'Click OK to keep your imported trades in the journal, or Cancel to abort.'
    )) return
    // Second, explicit opt-in for the destructive option.
    const purgeTrades = window.confirm(
      'Also DELETE all broker-imported trades and positions?\n\n' +
      'OK = delete imported data too · Cancel = keep imported trades (recommended).'
    )
    setBusy(true)
    await fetch('/api/j2/broker/connections', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purgeTrades }),
    }).catch(() => {})
    setSyncResult(null)
    await load()
    setBusy(false)
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return <TileCard title="🔗 Brokerage Connections"><div className={styles.muted}>Loading…</div></TileCard>
  }

  if (!isPaid) {
    return (
      <TileCard title="🔗 Brokerage Connections">
        <div className={styles.section}>
          <p className={styles.lead}>
            Connect your brokerage and your trades, positions, and balances sync
            into Journal 2.0 automatically — no manual entry.
          </p>
          <p className={styles.muted}>Brokerage Sync is a premium feature.</p>
          <button className={styles.primaryBtn} onClick={() => startCheckout?.()}>
            Upgrade to connect
          </button>
        </div>
      </TileCard>
    )
  }

  if (status && status.snaptradeConfigured === false) {
    return (
      <TileCard title="🔗 Brokerage Connections">
        <div className={styles.section}>
          <p className={styles.muted}>
            Brokerage sync isn’t available on this server yet. Check back soon.
          </p>
        </div>
      </TileCard>
    )
  }

  const accounts = status?.accounts || []
  const connected = !!status?.connected

  return (
    <TileCard title="🔗 Brokerage Connections">
      <div className={styles.section}>
        {error && <div className={styles.error}>{error}</div>}

        {!connected && !showConsent && (
          <>
            <p className={styles.lead}>
              Connect a brokerage (read-only) and every buy, sell, position, and
              balance flows into your journal automatically.
            </p>
            <button className={styles.primaryBtn} disabled={busy}
                    onClick={() => setShowConsent(true)}>
              Connect a brokerage
            </button>
          </>
        )}

        {!connected && showConsent && (
          <div className={styles.consent}>
            <p className={styles.lead}>Before you connect</p>
            <ul className={styles.consentList}>
              <li>We request <strong>read-only</strong> access — we can never place trades.</li>
              <li>We import your positions, balances, and trade history.</li>
              <li>Connections are handled securely by <strong>SnapTrade</strong>; your broker login is never seen by us.</li>
              <li>You can disconnect anytime. Imported trades stay in your journal.</li>
            </ul>
            <label className={styles.consentCheck}>
              <input type="checkbox" checked={consentChecked}
                     onChange={e => setConsentChecked(e.target.checked)} />
              I authorize UCT Intelligence to access my brokerage data read-only via SnapTrade.
            </label>
            <div className={styles.row}>
              <button className={styles.primaryBtn} disabled={!consentChecked || busy}
                      onClick={startConnect}>
                {busy ? 'Opening…' : 'Continue to broker login'}
              </button>
              <button className={styles.ghostBtn} disabled={busy}
                      onClick={() => { setShowConsent(false); setConsentChecked(false) }}>
                Cancel
              </button>
            </div>
            <p className={styles.fine}>Powered by SnapTrade.</p>
          </div>
        )}

        {connected && (
          <>
            {accounts.length === 0 && (
              <p className={styles.muted}>
                {busy ? 'Importing your accounts…' : 'No accounts found yet.'}
              </p>
            )}
            {accounts.map(a => (
              <div key={a.id} className={styles.acctRow}>
                <div className={styles.acctMain}>
                  <span className={styles.acctName}>
                    {a.brokerageName || 'Brokerage'}{a.accountNumberMasked ? ` ${a.accountNumberMasked}` : ''}
                  </span>
                  <span className={styles.acctMeta}>
                    {a.status === 'broken'
                      ? <span className={styles.broken}>Reconnect needed</span>
                      : (a.lastSyncAt ? `Synced ${relTime(a.lastSyncAt)}` : 'Not synced yet')}
                  </span>
                </div>
                {a.status === 'broken' ? (
                  <button className={styles.primaryBtn} disabled={busy}
                          onClick={() => setShowConsent(true)}
                          title="Re-authorize this brokerage">
                    Reconnect
                  </button>
                ) : (
                  <label className={styles.toggle} title="Auto-sync this account">
                    <input type="checkbox" checked={a.syncEnabled} onChange={() => toggleSync(a)} />
                    <span>{a.syncEnabled ? 'On' : 'Off'}</span>
                  </label>
                )}
              </div>
            ))}
            {syncResult && (
              <p className={styles.muted} style={{ marginTop: 8 }}>
                Imported {syncResult.imported} trade{syncResult.imported === 1 ? '' : 's'}
                {' · '}{syncResult.positions} position{syncResult.positions === 1 ? '' : 's'}
                {syncResult.options ? ` · ${syncResult.options} option${syncResult.options === 1 ? '' : 's'}` : ''}
              </p>
            )}
            <div className={styles.row} style={{ marginTop: 12 }}>
              <button className={styles.primaryBtn} disabled={busy} onClick={() => syncNow(true)}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button className={styles.ghostBtn} disabled={busy} onClick={() => setShowConsent(true)}>
                Connect another
              </button>
              <button className={styles.dangerBtn} disabled={busy} onClick={disconnect}>
                Disconnect
              </button>
            </div>

            {/* Possible-duplicate review (manual trade vs broker import). */}
            {status?.dupFlagsPending > 0 && dupFlags === null && (
              <button className={styles.ghostBtn} style={{ marginTop: 12 }} onClick={loadDups}>
                Review {status.dupFlagsPending} possible duplicate{status.dupFlagsPending === 1 ? '' : 's'}
              </button>
            )}
            {Array.isArray(dupFlags) && dupFlags.length > 0 && (
              <div className={styles.dupWrap}>
                <p className={styles.lead}>Possible duplicate trades</p>
                <p className={styles.muted}>
                  These broker imports look like trades you logged manually. Merge keeps
                  the broker trade and folds in your manual notes; Dismiss keeps both.
                </p>
                {dupFlags.map(f => (
                  <div key={f.id} className={styles.dupRow}>
                    <div className={styles.dupPair}>
                      <span className={styles.dupSym}>
                        {f.broker.symbol} {f.broker.side} · {f.broker.shares} sh
                      </span>
                      <span className={styles.dupMeta}>
                        manual {f.manual.entry_date?.slice(0, 10)} ↔ broker {f.broker.entry_date?.slice(0, 10)}
                        {' · '}{Math.round(f.confidence * 100)}% match
                      </span>
                    </div>
                    <div className={styles.row}>
                      <button className={styles.primaryBtn} onClick={() => resolveDup(f.id, 'merge')}>Merge</button>
                      <button className={styles.ghostBtn} onClick={() => resolveDup(f.id, 'dismiss')}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(dupFlags) && dupFlags.length === 0 && (
              <p className={styles.muted} style={{ marginTop: 8 }}>No duplicates to review.</p>
            )}
            {/* "Connect another" re-uses the consent panel above when connected */}
            {showConsent && (
              <div className={styles.consent} style={{ marginTop: 12 }}>
                <label className={styles.consentCheck}>
                  <input type="checkbox" checked={consentChecked}
                         onChange={e => setConsentChecked(e.target.checked)} />
                  I authorize read-only access via SnapTrade.
                </label>
                <div className={styles.row}>
                  <button className={styles.primaryBtn} disabled={!consentChecked || busy} onClick={startConnect}>
                    {busy ? 'Opening…' : 'Continue'}
                  </button>
                  <button className={styles.ghostBtn} disabled={busy}
                          onClick={() => { setShowConsent(false); setConsentChecked(false) }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </TileCard>
  )
}

function summarizeSync(data) {
  const results = data?.results || {}
  let imported = 0, positions = 0, options = 0
  for (const v of Object.values(results)) {
    if (v && typeof v === 'object') {
      imported += v.imported || 0
      positions += v.positionsUpserted || 0
      options += v.optionsImported || 0
    }
  }
  return { imported, positions, options }
}

function relTime(iso) {
  try {
    const then = new Date(iso).getTime()
    const secs = Math.max(0, (Date.now() - then) / 1000)
    if (secs < 60) return 'just now'
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
  } catch {
    return ''
  }
}
