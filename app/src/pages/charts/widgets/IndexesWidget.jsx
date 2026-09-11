/**
 * Indexes widget — the six market readings (SPY · QQQ · DIA · IWM · BTC · VIX)
 * as a tile grid, live off `/api/snapshot` — the same payload FuturesStrip and
 * MorningWireIndexes already read, so the numbers on the board, the wire header
 * and a note can never disagree.
 *
 * ⛔ THE LEVELS ARE A FREEZE, NOT A RE-FETCH. `/api/snapshot` answers exactly
 * one question — "what are the indexes RIGHT NOW" — and takes no date. There is
 * no endpoint in this app that can return SPY's level as it stood at 1:26 PM on
 * a past Thursday, and the daily bar store would answer a DIFFERENT question
 * (that session's CLOSE) than the intraday reading a member deliberately
 * captured. So the Send-to-Journal door freezes the shown readings and the
 * registry's `reconstructable` renders them verbatim forever. Same shape as
 * breadth, for the same reason.
 *
 * The shape/derivation half lives in ./indexesModel.js — the live board and a
 * frozen note embed resolve through the same functions.
 */
import { useCallback, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { fetchSnapshot } from './widgetSnapshotFetcher'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import CaptureMenu from '../../journal-2-0/components/CaptureMenu'
import UIcon from '../../../components/ui/UIcon'
import { INDEX_SYMBOLS, INDEX_LABELS, chgDirection, rowsFromSnapshot } from './indexesModel'
import styles from './IndexesWidget.module.css'

// ⭐ The fetcher stamps the moment the payload LANDED. `/api/snapshot` carries
// no timestamp of its own and the footer must always show a time, so the stamp
// has to come from a clock — and reading one during render is impure while
// reading one in an effect costs a cascading render. Stamping here does
// neither, and it is strictly more correct: the instant travels WITH the
// payload it describes, so it can never end up attached to a different one.
const fetcher = (url) => fetchSnapshot(url)

const SNAPSHOT_URL = '/api/snapshot'

/** ET wall-clock 'h:mm AM/PM' for a fetch instant, or null. */
function fmtEtTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    })
  } catch { return null }
}

export default function IndexesWidget({
  opts, onOptsChange,
  // Frozen-embed mode (journal host): `frozen` carries {rows, updated} — the
  // captured readings verbatim. readOnly strips the per-tile hide and its
  // restore control (both write workspace opts, which a note must never do).
  frozen = null, readOnly = false, journalDoor = true,
}) {
  const { data } = useMobileSWR(frozen ? null : SNAPSHOT_URL, fetcher, {
    refreshInterval: 10_000, dedupingInterval: 5_000, revalidateOnFocus: false,
  })

  // Per-widget hidden symbols (persist through the workspace layout save path).
  const hidden = useMemo(
    () => new Set(Array.isArray(opts?.hiddenSymbols) ? opts.hiddenSymbols : []),
    [opts],
  )
  const hideSym = useCallback((sym) => {
    if (hidden.has(sym)) return
    onOptsChange?.({ ...(opts || {}), hiddenSymbols: [...hidden, sym] })
  }, [opts, onOptsChange, hidden])
  // ⛔ The recovery path ships in the same commit as the control that hides.
  // A dismissable tile with no way back is a defect however good the copy is.
  const showAll = useCallback(() => {
    onOptsChange?.({ ...(opts || {}), hiddenSymbols: [] })
  }, [opts, onOptsChange])

  // The rows on screen. Frozen mode renders the captured array verbatim; live
  // mode derives them from the snapshot. ONE array feeds the render AND the
  // capture, so a note can never freeze a set the member wasn't looking at.
  const rows = useMemo(
    () => (frozen ? (Array.isArray(frozen.rows) ? frozen.rows : []) : rowsFromSnapshot(data, hidden)),
    [frozen, data, hidden],
  )

  const updated = frozen
    ? (frozen.updated || null)
    : (data?._fetchedAt ? `${fmtEtTime(data._fetchedAt)} ET` : null)

  const [journalMsg, setJournalMsg] = useJournalToast()
  const [captureMenu, setCaptureMenu] = useState(null)

  // Freeze exactly what the widget shows right now — shared by the one-click
  // default send AND the destination picker, so both paths capture the
  // identical payload rather than re-deriving it a second time at Send.
  const buildCapture = useCallback(() => ({
    hiddenSymbols: Array.isArray(opts?.hiddenSymbols) ? opts.hiddenSymbols : [],
    rows,
    updated,
  }), [opts, rows, updated])

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.title}>Indexes</span>
        <span className={styles.spacer} />
        {!readOnly && hidden.size > 0 && (
          <button type="button" className={styles.restore} onClick={showAll}>
            Show all ({hidden.size} hidden)
          </button>
        )}
        {journalDoor && !readOnly && rows.length > 0 && (
          <>
            <button
              type="button" className={styles.iconBtn}
              onClick={async () => {
                setJournalMsg('sending…')
                setJournalMsg(await sendCaptureToJournal('indexes', buildCapture(), { label: 'Indexes' }))
              }}
              title="Send these index levels to Journal"
              aria-label="Send these index levels to Journal"
            ><UIcon name="journal" size={13} /></button>
            <button
              type="button" className={styles.iconBtn}
              onClick={(e) => setCaptureMenu({
                anchor: { x: e.clientX, y: e.clientY }, capture: buildCapture(),
              })}
              title="Send to Journal — choose where"
              aria-label="Send to Journal — choose where"
            ><UIcon name="chevronDown" size={13} /></button>
          </>
        )}
        <JournalToast msg={journalMsg} />
        {captureMenu && (
          <CaptureMenu
            open
            onClose={() => setCaptureMenu(null)}
            anchor={captureMenu.anchor}
            widgetId="indexes"
            capture={captureMenu.capture}
            label="Indexes"
            onSent={setJournalMsg}
          />
        )}
      </div>

      {rows.length === 0 && (
        <div className={styles.hint}>
          {frozen
            ? 'No index readings were captured.'
            : (hidden.size === INDEX_SYMBOLS.length
                ? 'All indexes hidden — use Show all to bring them back.'
                : (data ? 'No index readings yet.' : 'Loading indexes…'))}
        </div>
      )}

      {rows.length > 0 && (
        <div className={styles.grid}>
          {rows.map((r) => {
            const dir = chgDirection(r.chg)
            return (
              <div key={r.sym} className={styles.tile}>
                {!readOnly && (
                  <button
                    type="button"
                    className={styles.tileX}
                    onClick={() => hideSym(r.sym)}
                    title={`Hide ${r.sym}`}
                    aria-label={`Hide ${r.sym}`}
                  ><UIcon name="x" size={9} gold={false} /></button>
                )}
                <span className={styles.tileSym}>{r.sym}</span>
                <span className={styles.tileLabel}>{INDEX_LABELS[r.sym] || ''}</span>
                <span className={styles.tilePrice}>{r.price ?? '—'}</span>
                <span className={`${styles.tileChg}${dir ? ' ' + styles[dir] : ''}`}>
                  {r.chg ?? '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.footerUpdated}>{updated ? `Updated ${updated}` : 'Live'}</span>
      </div>
    </div>
  )
}
