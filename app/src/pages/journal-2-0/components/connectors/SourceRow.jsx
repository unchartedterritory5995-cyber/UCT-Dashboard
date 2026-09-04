/**
 * SourceRow — one connected note source (spec §8: "per-source rows
 * (freshness tone, counts, Sync now, pause, disconnect)").
 *
 * Disconnect uses the "arm, click again to confirm" idiom already used in
 * this codebase (TradeScreenshots.jsx's onDeleteClick) rather than
 * `window.confirm` — same 2-step shape, easier to test, no native dialog.
 * A `DELETE /{provider}` on this repo's contract is provider-scoped (spec
 * §8), so disconnecting any one source disconnects the whole provider; the
 * confirm copy says so when the provider has more than one source.
 *
 * `onReconnect` (member-reachability fix, 2026-09-04): `freshnessLabel`
 * below has always rendered "reconnect needed" for `status === 'broken'`,
 * but nothing in this row could ever act on it — Sync now just re-runs the
 * same failing credentials, and the only other control was Disconnect. The
 * backend already supports healing a broken connector without disconnecting
 * first (`connections.upsert_connector` / the OAuth callback both flip
 * `'broken' -> 'active'` on a fresh connect — see
 * `note_connectors/connections.py`'s own docstring), so the label was
 * promising a recovery path this row had no button for — the exact
 * "built, green, and unreachable" shape this codebase keeps re-shipping.
 * `onReconnect` re-opens the SAME connect flow (token modal / OAuth
 * consent) the provider tile's initial "Connect" button uses.
 */
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { timeAgo } from '../../../../utils/timeAgo'
import styles from './ConnectedAppsCard.module.css'

function freshnessTone(source) {
  if (source.status === 'broken' || source.lastSyncStatus === 'error') return 'red'
  if (!source.syncEnabled) return 'amber'
  // ⛔ `lastSyncError` on its own has to move the dot. The engine records a
  // PARTIAL failure as status "ok" plus per-note error text — by design, since
  // the batch really did commit what it could. But that left a source that
  // failed to store some of the member's notes showing a GREEN dot with the
  // reason hidden in text below it, which is the green-dot-over-a-failure
  // shape this surface keeps producing.
  if (source.warmingUntil || source.lastSyncStatus === 'warning' || source.lastSyncError) return 'amber'
  if (source.lastSyncAt) return 'green'
  return 'amber'
}

function freshnessLabel(source) {
  if (source.status === 'broken') return 'reconnect needed'
  if (!source.syncEnabled) return 'sync paused'
  // A pass that fetched notes and stored NONE of them sets lastSyncAt like
  // any other, so this read "synced 2 minutes ago" over a warning saying
  // nothing landed — literally true, and the line a member scans first.
  // The amber dot and the reason below carry the truth; the label must not
  // argue with them.
  if (source.lastSyncStatus === 'warning') {
    return source.lastSyncAt
      ? `finished with problems ${timeAgo(source.lastSyncAt)}`
      : 'finished with problems'
  }
  // ⛔ The same argument as the warning branch, for the state that had no
  // branch at all. A source can be `lastSyncStatus === 'error'` WITHOUT being
  // `broken` — every transient/rate-limited/unhandled total failure lands
  // there — and it fell through to "synced 5 minutes ago" while
  // `freshnessTone` above dotted it RED. The label and the dot contradicted
  // each other, and the label is the half a member reads.
  if (source.lastSyncStatus === 'error') {
    return source.lastSyncAt
      ? `sync failed ${timeAgo(source.lastSyncAt)}`
      : 'sync failed'
  }
  // A partial failure keeps status "ok" but carries per-note error text; say
  // so rather than reporting a clean "synced" over notes that did not land.
  if (source.lastSyncError) {
    return source.lastSyncAt
      ? `synced with problems ${timeAgo(source.lastSyncAt)}`
      : 'synced with problems'
  }
  if (source.lastSyncAt) return `synced ${timeAgo(source.lastSyncAt)}`
  return 'not synced yet'
}

export default function SourceRow({ source, providerSourceCount = 1, onSync, onTogglePause, onDisconnect, onReconnect }) {
  const [syncing, setSyncing] = useState(false)
  const [pauseBusy, setPauseBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const armTimer = useRef(null)

  useEffect(() => () => clearTimeout(armTimer.current), [])

  const tone = freshnessTone(source)
  // `source.counts` is always a fully-shaped object — normalizeStatus
  // (useNoteConnectors.js) guarantees it, so no `|| {}` fallback here.
  const counts = source.counts
  const conflicts = counts.conflicts || 0
  const sourceDeleted = counts.sourceDeleted || 0

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await onSync(source)
    } catch {
      /* the row's own lastSyncError/status reflects the failure on refresh */
    } finally {
      setSyncing(false)
    }
  }

  const handleTogglePause = async () => {
    if (pauseBusy) return
    setPauseBusy(true)
    try {
      await onTogglePause(source)
    } finally {
      setPauseBusy(false)
    }
  }

  const handleDisconnectClick = () => {
    if (armed) {
      clearTimeout(armTimer.current)
      setArmed(false)
      onDisconnect(source)
    } else {
      setArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmed(false), 4000)
    }
  }

  return (
    <div className={styles.sourceRow}>
      <div className={styles.sourceHead}>
        <span className={`${styles.dot} ${styles[`dot_${tone}`]}`} aria-hidden="true" />
        <span className={styles.sourceName}>{source.displayName || source.remoteId}</span>
        <span className={styles.sep}>·</span>
        <span className={styles.sourceSync}>{freshnessLabel(source)}</span>
      </div>

      <div className={styles.counts}>
        <Stat label="Created" value={counts.notesCreated} />
        <Stat label="Updated" value={counts.notesUpdated} />
        {conflicts > 0 && <Stat label="Conflicts" value={conflicts} warn />}
        {sourceDeleted > 0 && <Stat label="Removed" value={sourceDeleted} warn />}
      </div>

      {/* A count with no path to act on it is not reachable, just visible
          (task brief: reachability, not rendering). A conflict is a real,
          normal Notebook note — the engine tags BOTH the original and the
          new version `sync-conflict` (note_connectors/engine.py's own
          `_reroute_resolved_body_to_sibling`) rather than silently overwriting —
          so the resolution path already exists (the Notebook's own tag
          filter), it was just never named here. */}
      {conflicts > 0 && (
        <p className={styles.conflictHint}>
          Conflicting versions are tagged <code>sync-conflict</code> in your
          Notebook — open the Tags panel to review and keep the one you want.
        </p>
      )}

      {/* Same reachability rule as the conflict hint above: a severed note is
          NOT deleted from the Notebook — the engine only appends the
          `source-deleted` tag and stops tracking it (engine.py's
          `_tag_note_source_deleted`), keeping the body intact. Saying so
          matters twice over: it tells the member their writing survived the
          remote deletion, and it names the tag that finds it. */}
      {sourceDeleted > 0 && (
        <p className={styles.conflictHint}>
          Removed in the source app — tagged <code>source-deleted</code> in your
          Notebook. Nothing was erased: open the Tags panel to keep or delete them.
        </p>
      )}

      {source.lastSyncError && <p className={styles.sourceErr}>{source.lastSyncError}</p>}

      <div className={styles.sourceActions}>
        {source.status === 'broken' && onReconnect && (
          <button type="button" className="btn btn-primary" onClick={() => onReconnect(source)}>
            Reconnect
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={syncing} onClick={handleSync}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <label className={styles.toggle} title="Pause background sync">
          <input
            type="checkbox"
            checked={!!source.syncEnabled}
            disabled={pauseBusy}
            onChange={handleTogglePause}
          />
          <span>{source.syncEnabled ? 'On' : 'Paused'}</span>
        </label>
        <button
          type="button"
          className={`${styles.dangerBtn} ${armed ? styles.dangerArmed : ''}`}
          onClick={handleDisconnectClick}
          title={
            providerSourceCount > 1
              ? 'Disconnects every source for this provider'
              : 'Disconnect this source'
          }
        >
          <UIcon name="x" size={13} gold={false} />
          {armed ? 'Click again to disconnect' : 'Disconnect'}
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statValue} ${warn ? styles.statWarn : ''}`}>{value ?? 0}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}
