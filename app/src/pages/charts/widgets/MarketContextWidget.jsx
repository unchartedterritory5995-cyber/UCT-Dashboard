/**
 * Market Context widget — the market's state in one read: phase, UCT Exposure,
 * breadth, distribution days, participation. Live off `GET /api/breadth`, the
 * morning wire's own payload (the same well `journal_two/regime.py` drinks
 * from), so the board, the wire and a note can never disagree.
 *
 * ⛔ THIS IS A FREEZE, NOT A RE-FETCH — and the case is stronger than breadth's.
 * `/api/breadth` takes no date: it serves the CURRENT wire payload and nothing
 * else. `wire_data.json` is OVERWRITTEN by each morning's run, so there is no
 * archive to query even in principle — yesterday's exposure score and market
 * phase are gone the moment today's wire lands. (`/api/breadth-monitor?end=`
 * IS date-addressable, but it is a different store with different numbers: the
 * 4:15 collector's row, not the wire's. Re-fetching from it would answer a
 * similar question with a different answer and call it the same reading.) So
 * the Send-to-Journal door freezes what is on screen and the registry's
 * `reconstructable` renders it verbatim forever.
 *
 * ⛔ `powerTrend` IS NULL ON PURPOSE — owner direction 2026-04-17, "rule not yet
 * defined". It renders as an em dash. Do not derive one, do not hide the row:
 * the row is the record that the reading is undefined, not missing.
 *
 * ⚰️ The predecessor this replaces — `api/services/journal_two/market_context.py`
 * and its `GET /api/j2/market-context` — was REMOVED end-to-end on 2026-04-18
 * (`f245bd3c9`). `docs/feature-blending-guide.md` §14/§15 still describe it and
 * every path they cite is dead. Two of the six fields that doc names,
 * `rallyDay` and `powerTrend`, had NO source even when it shipped:
 * `build_snapshot` read `get_breadth()["rally_day_count"]`, and
 * `_normalize_breadth` has never emitted that key. `rallyDay` is not carried
 * here — a row that can only ever be an em dash for a reason nobody recorded is
 * not a reading. `powerTrend` is, because its null IS an owner ruling.
 *
 * The shape/derivation half lives in ./marketContextModel.js.
 */
import { useCallback, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import CaptureMenu from '../../journal-2-0/components/CaptureMenu'
import UIcon from '../../../components/ui/UIcon'
import { CONTEXT_ROWS, readingsFrom, finite } from './marketContextModel'
import styles from './MarketContextWidget.module.css'

// ⭐ The fetcher stamps the moment the payload LANDED — the wire payload dates
// the RUN (`wire_date`), not the read. Stamping here keeps the render pure and
// costs no cascading render, and the instant travels with the payload it
// describes so it can never attach to a different one.
const fetcher = (url) => fetch(url)
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => (d ? { ...d, _fetchedAt: Date.now() } : d))

const BREADTH_URL = '/api/breadth'

function fmtEtTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    })
  } catch { return null }
}

export default function MarketContextWidget({
  // Frozen-embed mode (journal host): `frozen` carries {readings, wireDate,
  // updated} — the captured market state verbatim. There are no per-widget
  // options today, so the /charts binding passes none (the aisearch idiom:
  // a widget receives what it uses, and growing a setting is a DECISION the
  // registry rail makes visible).
  frozen = null, readOnly = false, journalDoor = true,
}) {
  const { data } = useMobileSWR(frozen ? null : BREADTH_URL, fetcher, {
    refreshInterval: 300_000, dedupingInterval: 60_000, revalidateOnFocus: false,
  })

  const readings = useMemo(() => {
    if (frozen) return (frozen.readings && typeof frozen.readings === 'object') ? frozen.readings : null
    return data ? readingsFrom(data) : null
  }, [frozen, data])

  const wireDate = frozen
    ? (frozen.wireDate || null)
    : (typeof data?.wire_date === 'string' ? data.wire_date : null)

  const updated = frozen
    ? (frozen.updated || null)
    : (data?._fetchedAt ? `${fmtEtTime(data._fetchedAt)} ET` : null)

  const [journalMsg, setJournalMsg] = useJournalToast()
  const [captureMenu, setCaptureMenu] = useState(null)

  // Freeze exactly what the widget shows right now — shared by the one-click
  // default send AND the destination picker, so both paths capture the
  // identical payload rather than re-deriving it a second time at Send.
  const buildCapture = useCallback(() => ({
    readings, wireDate, updated,
  }), [readings, wireDate, updated])

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.title}>Market Context</span>
        <span className={styles.spacer} />
        {journalDoor && !readOnly && readings && (
          <>
            <button
              type="button" className={styles.iconBtn}
              onClick={async () => {
                setJournalMsg('sending…')
                setJournalMsg(await sendCaptureToJournal('marketcontext', buildCapture(), { label: 'Market context' }))
              }}
              title="Send this market context to Journal"
              aria-label="Send this market context to Journal"
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
            widgetId="marketcontext"
            capture={captureMenu.capture}
            label="Market context"
            onSent={setJournalMsg}
          />
        )}
      </div>

      {!readings && (
        <div className={styles.hint}>
          {frozen ? 'No market context was captured.' : (data === undefined ? 'Loading market context…' : 'No market context yet.')}
        </div>
      )}

      {readings && (
        <div className={styles.list}>
          {CONTEXT_ROWS.map((r) => {
            const v = readings[r.key]
            // `== null` on purpose (the TradesTable idiom): an absent reading
            // and a deliberately-null one both render the em dash.
            const missing = v == null || v === ''
            const d = r.delta ? readings[r.delta] : null
            const dirCls = finite(d) == null || d === 0 ? '' : (d > 0 ? styles.pos : styles.neg)
            return (
              <div key={r.key} className={styles.row}>
                <span className={styles.rowLabel}>{r.label}</span>
                {!missing && finite(d) != null && d !== 0 && (
                  <span className={`${styles.rowDelta} ${dirCls}`}>{d > 0 ? `+${d}` : String(d)}</span>
                )}
                <span className={styles.rowValue}>
                  {missing ? <span className={styles.dash}>—</span> : r.fmt(v)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.footerUpdated}>
          {wireDate ? `Wire ${wireDate}` : 'Wire —'}{updated ? ` · updated ${updated}` : ''}
        </span>
      </div>
    </div>
  )
}
