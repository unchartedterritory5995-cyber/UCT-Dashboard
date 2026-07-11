/**
 * SyncTrustCenter — the "trust everything" surface for broker-connected
 * accounts (Journal 2.0 P3, Task B8). Consolidates + extends the slim
 * BrokerSyncStatus bar with, per broker account:
 *   - a health badge (green ok / amber warming|error|expiring / red broken)
 *     + brokerage name + masked number + "synced Xm ago",
 *   - a token-expiry / reconnect banner when the authorization is broken,
 *   - imported-vs-broker counts (broker ledger · trades · positions),
 *   - a collapsible sync audit log (recent sync-log rows), collapsed by default,
 *   - an orphaned-annotation reattach queue (only when there are orphans),
 *   - a link to the Settings dup-flags review (never re-implements the merge UI).
 *
 * HARD requirement (Global Constraint): HIDDEN for manual accounts — gate on
 * the active account's balanceSource. Mounting is always safe; the component
 * renders one muted line (or nothing) for non-broker accounts.
 *
 * No emoji — all iconography via <UIcon />.
 */
import { useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import { timeAgo, formatET } from '../../../../utils/timeAgo'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useSyncTrust from '../../hooks/useSyncTrust'
import styles from './SyncTrustCenter.module.css'

const statusFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}))

// Green (healthy) / amber (needs attention, not fatal) / red (reconnect).
function healthTone(a) {
  if (a.tokenState === 'broken' || a.status === 'broken') return 'red'
  if (a.tokenState === 'expiring' || a.warming || a.lastSyncStatus === 'error') return 'amber'
  if (a.tokenState === 'ok') return 'green'
  return 'amber'
}

function syncedLabel(a) {
  if (a.tokenState === 'broken' || a.status === 'broken') return 'reconnect needed'
  if (a.warming) return 'importing…'
  if (a.lastSyncAt) return `synced ${timeAgo(a.lastSyncAt)}`
  return 'not yet synced'
}

export default function SyncTrustCenter() {
  const { account } = useJ2SelectedAccount()
  const { trust, syncLog, orphans, reattach, isLoading } = useSyncTrust()
  const { data: statusData } = useSWR('/api/j2/broker/status', statusFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [logOpen, setLogOpen] = useState(false)

  // Global Constraint: hidden entirely for manual accounts. Use the robust
  // `=== 'manual'` gate (an all-accounts / unknown source falls through to the
  // trust check below, which self-hides when there's no broker).
  if (account?.balanceSource === 'manual') {
    return <p className={styles.manualLine}>Manual account — nothing to reconcile.</p>
  }
  if (isLoading && !trust) return null
  if (!trust || !trust.anyBroker) return null

  const accounts = trust.accounts || []
  const dupPending = statusData?.dupFlagsPending || 0

  return (
    <section className={styles.panel} aria-label="Sync Trust">
      <header className={styles.header}>
        <span className={styles.headIcon} aria-hidden="true"><UIcon name="shield" size={15} /></span>
        <h3 className={styles.title}>Sync Trust</h3>
      </header>

      {accounts.map((a) => {
        const tone = healthTone(a)
        const needsReconnect = a.tokenState === 'broken' || a.status === 'broken'
        const expiring = a.tokenState === 'expiring'
        return (
          <div key={a.brokerAccountId} className={styles.acct}>
            <div className={styles.acctHead}>
              <span
                className={`${styles.dot} ${styles[`dot_${tone}`]}`}
                aria-hidden="true"
              />
              <span className={styles.acctName}>
                {a.brokerageName || 'Brokerage'}
                {a.accountNumberMasked ? ` ${a.accountNumberMasked}` : ''}
              </span>
              <span className={styles.sep}>·</span>
              <span className={styles.acctSync}>{syncedLabel(a)}</span>
            </div>

            {(needsReconnect || expiring) && (
              <div className={styles.reconnect} role="alert">
                <span className={styles.reconnectIcon} aria-hidden="true">
                  <UIcon name="warning" size={14} gold={false} />
                </span>
                <span className={styles.reconnectText}>
                  {needsReconnect
                    ? 'Reconnect needed — your brokerage authorization is broken. '
                    : 'Reconnect soon — your brokerage authorization is expiring. '}
                  <a className={styles.reconnectLink} href="/settings">go to Settings</a>
                </span>
              </div>
            )}

            <div className={styles.counts}>
              <Stat label="Broker ledger" value={a.importedActivityCount} />
              <Stat label="Trades" value={a.tradeCount} />
              <Stat label="Positions" value={a.positionCount} />
            </div>
          </div>
        )
      })}

      {/* Reuse the Settings dup-flags review — never re-implement the merge UI. */}
      {dupPending > 0 && (
        <p className={styles.dupNote}>
          <span className={styles.dupIcon} aria-hidden="true"><UIcon name="copy" size={13} /></span>
          {dupPending} possible duplicate{dupPending === 1 ? '' : 's'} to review in{' '}
          <a className={styles.reconnectLink} href="/settings">Settings</a>.
        </p>
      )}

      {/* Sync audit log — collapsed by default. */}
      <div className={styles.logWrap}>
        <button
          type="button"
          className={styles.logToggle}
          aria-expanded={logOpen}
          onClick={() => setLogOpen((x) => !x)}
        >
          <span className={styles.logChevron} data-open={logOpen} aria-hidden="true">
            <UIcon name="chevronRight" size={13} />
          </span>
          Sync activity
          {syncLog.length > 0 && <span className={styles.logCount}>({syncLog.length})</span>}
        </button>
        {logOpen && (
          syncLog.length === 0 ? (
            <p className={styles.logEmpty}>No sync activity recorded yet.</p>
          ) : (
            <ul className={styles.logList}>
              {syncLog.map((row, i) => (
                <li key={i} className={styles.logRow}>
                  <span className={`${styles.logStatus} ${row.status === 'error' ? styles.logStatusErr : ''}`}>
                    {row.status || 'ok'}
                  </span>
                  <span className={styles.logWhen}>{formatET(row.startedAt) || '—'}</span>
                  <span className={styles.logNums}>
                    {(row.tradesImported || 0)} trades · {(row.positionsUpserted || 0)} positions
                    {row.optionsImported ? ` · ${row.optionsImported} options` : ''}
                  </span>
                  {row.error && <span className={styles.logErr}>{row.error}</span>}
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* Orphaned-annotation reattach queue — silence when there are none. */}
      {orphans.length > 0 && (
        <div className={styles.orphans}>
          <h4 className={styles.orphansTitle}>
            Orphaned annotations
            <span className={styles.orphansCount}>{orphans.length}</span>
          </h4>
          <p className={styles.orphansHint}>
            These notes/screenshots no longer point to a live trade (a broker
            re-slice or a deleted trade). Reattach each to a trade to keep it.
          </p>
          {orphans.map((o) => (
            <OrphanRow key={o.tradeRef} orphan={o} onReattach={reattach} />
          ))}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value ?? 0}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function OrphanRow({ orphan, onReattach }) {
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    const id = target.trim()
    if (!id || busy) return
    setBusy(true)
    setErr(null)
    try {
      await onReattach(orphan.tradeRef, id)
      setDone(true)
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.orphanRow}>
      <div className={styles.orphanMain}>
        <span className={styles.orphanSummary}>{orphan.summary || orphan.tradeRef}</span>
        {orphan.kind && <span className={styles.orphanKind}>{orphan.kind}</span>}
      </div>
      {done ? (
        <span className={styles.orphanDone}>
          <span aria-hidden="true"><UIcon name="check" size={13} gold={false} /></span> Reattached
        </span>
      ) : (
        <div className={styles.orphanForm}>
          <input
            className={styles.orphanInput}
            type="text"
            placeholder="Target trade id"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label={`Reattach ${orphan.summary || orphan.tradeRef} to trade id`}
          />
          <button
            type="button"
            className={styles.orphanBtn}
            disabled={!target.trim() || busy}
            onClick={submit}
          >
            {busy ? 'Reattaching…' : 'Reattach'}
          </button>
        </div>
      )}
      {err && <span className={styles.orphanErr} role="alert">{err}</span>}
    </div>
  )
}
