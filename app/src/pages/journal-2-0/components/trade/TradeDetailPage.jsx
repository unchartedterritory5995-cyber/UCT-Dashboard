/**
 * Unified closed-trade detail page at /journal-2-0/trade/:id — the flagship of
 * P1b. Replaces the quick-peek drawer for equity trades with a full page:
 *   1. Outcome header  — symbol/side/result, net P&L, P&L%, R (or Add-stop),
 *                        hold time, exit-efficiency slot (P2)
 *   2. Chart card      — StockChart framed to the holding window + TF pills,
 *                        entry/exit markers + entry/stop lines (this trade only)
 *   3. The story       — setup, mistake/emotion tags, notes, screenshots mount
 *   4. Executions      — collapsed <details>: broker ledger or manual entry/exit
 *   5. Compass         — paid-gated post-mortem (ported from TradeDrawer)
 *   6. Prev/next       — ‹ › + j/k + Arrow keys + Esc, honoring table filters
 *
 * Mirrors PositionDetailPage's structure, hooks, skeleton + CSS conventions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import ShareToFloor from '../../../../components/community/ShareToFloor'
import useSWR from 'swr'
import StockChart from '../../../../components/StockChart'
import { SkeletonLine } from '../../../../components/Skeleton'
import useJ2Trades from '../../hooks/useJ2Trades'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useJ2Settings from '../../hooks/useJ2Settings'
import useTradeReview from '../../hooks/useTradeReview'
import TradeReviewCard from '../TradeReviewCard'
import TagChipPicker from '../TagChipPicker'
import { filtersFromSearchParams } from '../../hooks/useJ2Filters'
import { money, moneySigned, percent, dateShort } from '../../../../lib/journal-2-0'
import { useIsPaid } from '../../../../context/AuthContext'
import UIcon from '../../../../components/ui/UIcon'
import { useFeatureFlag } from '../../featureFlags'
import { renderTradeCardPng } from '../../lib/tradeCardPng'
import { downloadBlob, copyBlobToClipboard } from '../../../../components/chart/chartScreenshot'
import { outcomeModel, buildTradeMarkers, neighborIds } from './tradePageModel'
import TradeScreenshots from './TradeScreenshots'
import AdherenceChecklist from './AdherenceChecklist'
import styles from './TradeDetailPage.module.css'

// Exit-efficiency honest-state copy. EFFICIENCY_TITLE = the pending default
// (kept for the "not yet computed" state + shown in the chart footer then).
const EFFICIENCY_TITLE = 'Excursion analysis coming — computed nightly from intraday bars'
const PENDING_TITLE = 'Analyzed nightly — excursion lands ~3 AM ET'
const INSUFFICIENT_TITLE = 'Insufficient intraday bars for this trade'
const NO_EXCURSION_TITLE = 'No favorable excursion'
const EFFICIENCY_METHOD_TITLE =
  'Exit efficiency = captured move ÷ max favorable move, from intraday excursion bars'
// Options carry only the UNDERLYING's price excursion (no option-price entry/stop),
// so there is no exit-efficiency % to show — the header renders a plain dash.
const UNDERLYING_TITLE =
  'Options use the underlying-price excursion — no exit-efficiency % is computed'

// bar_resolution tf-code (or dataQuality tier) → short human label for the
// "bar-approx · 5m" caption on real values.
function barResLabel(excursion) {
  const byCode = { 1: '1m', 5: '5m', D: 'daily' }
  const byTier = { intraday_1m: '1m', intraday_5m: '5m', daily: 'daily' }
  return byCode[excursion?.barResolution] || byTier[excursion?.dataQuality] || null
}

const TF_TABS = [
  { code: '5', label: '5m' },
  { code: '30', label: '30m' },
  { code: '60', label: '1h' },
  { code: 'D', label: 'D' },
  { code: 'W', label: 'W' },
]

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

async function patchJson(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `${res.status}`
    try { const j = await res.json(); if (j?.detail) msg = j.detail } catch { /* non-JSON */ }
    throw new Error(msg)
  }
  return res.json()
}

function signClass(n) {
  if (!Number.isFinite(n)) return ''
  return n > 0 ? styles.pos : n < 0 ? styles.neg : ''
}

/**
 * "Save image" / "Copy image" — renders a branded dark/gold shareable PNG of
 * THIS trade (dependency-free canvas draw in lib/tradeCardPng) then hands it to
 * the reused chartScreenshot helpers (downloadBlob / copyBlobToClipboard).
 * Gated on the `tradePng` feature flag → renders null when off (instant
 * per-browser kill). Surfaces a tiny inline error instead of crashing the page.
 */
function TradeCardActions({ trade }) {
  const flagOn = useFeatureFlag('tradePng')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!flagOn) return null

  const onSave = async () => {
    setError(null)
    setBusy(true)
    try {
      const blob = await renderTradeCardPng(trade)
      downloadBlob(blob, `${trade?.symbol || 'trade'}-trade.png`)
    } catch {
      setError('Couldn’t build the image.')
    } finally {
      setBusy(false)
    }
  }

  const onCopy = async () => {
    setError(null)
    setBusy(true)
    try {
      const blob = await renderTradeCardPng(trade)
      const ok = await copyBlobToClipboard(blob)
      if (!ok) setError('Copy isn’t supported in this browser — use Save image.')
    } catch {
      setError('Couldn’t copy the image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.cardActionsWrap}>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.cardActionBtn}
          onClick={onSave}
          disabled={busy}
        >
          <UIcon name="download" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Save image
        </button>
        <button
          type="button"
          className={styles.cardActionBtn}
          onClick={onCopy}
          disabled={busy}
        >
          <UIcon name="copy" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Copy image
        </button>
      </div>
      {error && <div className={styles.cardActionError} role="alert">{error}</div>}
    </div>
  )
}

export default function TradeDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [tf, setTf] = useState('D')
  const [notesDraft, setNotesDraft] = useState('')
  const [addingStop, setAddingStop] = useState(false)
  const [stopInput, setStopInput] = useState('')
  const [patchError, setPatchError] = useState(null)
  const notesRef = useRef(null)

  const { data, isLoading, mutate } = useSWR(
    id ? `/api/j2/trades/${encodeURIComponent(id)}` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const trade = data?.trade || null
  const brokerActivities = data?.brokerActivities || []

  const { trades } = useJ2Trades()
  const { accountId } = useJ2SelectedAccount()
  const { settings } = useJ2Settings()
  const isPaid = useIsPaid()

  // Compass post-mortem (ported from TradeDrawer.jsx:160-204).
  const {
    review, isLoading: reviewLoading,
    generate: generateReview,
    regenerate: regenerateReview,
    feedback: reviewFeedback,
    forget: forgetReview,
    reset: resetReview,
    error: reviewError,
  } = useTradeReview(accountId)
  useEffect(() => { resetReview() }, [id, resetReview])

  // Fire-and-forget page-open telemetry per trade viewed. Keyed on `id` (not
  // []) so prev/next browsing — which changes the param without remounting —
  // counts each trade opened, matching the "trade-page opens per session" goal.
  useEffect(() => {
    if (!id) return
    fetch('/api/j2/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ event: 'trade_page_open' }),
    }).catch(() => {})
  }, [id])

  // Seed / reset per-trade local drafts when the LOADED trade changes — keyed
  // on trade?.id (not the route id) so notes populate once the async fetch
  // resolves, and reseed on prev/next navigation. An optimistic PATCH keeps the
  // same trade.id, so it never clobbers the user's in-progress edit.
  useEffect(() => {
    setNotesDraft(trade?.notes || '')
    setAddingStop(false)
    setStopInput('')
    setPatchError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade?.id])

  // Neighbors honor the SAME URL filters the table linked with.
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const { prevId, nextId } = useMemo(
    () => neighborIds(trades, filters, id),
    [trades, filters, id],
  )

  const go = useCallback(
    (targetId) => {
      if (targetId) navigate(`/journal-2-0/trade/${targetId}${location.search}`)
    },
    [navigate, location.search],
  )

  // Keyboard: j/ArrowRight → next, k/ArrowLeft → prev, Esc → back. Skips while
  // typing (input/textarea/select/contentEditable) — MiniMonthNav.jsx pattern.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return
      if (e.key === 'Escape') { navigate(-1); return }
      if (e.key === 'ArrowRight' || e.key === 'j') go(nextId)
      else if (e.key === 'ArrowLeft' || e.key === 'k') go(prevId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prevId, nextId, go, navigate])

  // Optimistic PATCH: write local override immediately, reconcile from the
  // server's recomputed trade, roll back to server truth on error (mirrors
  // TradeJournalTab's inline setup tagging).
  const patchTrade = useCallback(
    async (patch, optimistic) => {
      setPatchError(null)
      mutate((cur) => (cur ? { ...cur, trade: { ...cur.trade, ...optimistic } } : cur), { revalidate: false })
      try {
        const updated = await patchJson(`/api/j2/trades/${encodeURIComponent(id)}`, patch)
        mutate((cur) => (cur ? { ...cur, trade: updated } : cur), { revalidate: false })
      } catch (e) {
        setPatchError(String(e.message || e))
        mutate()  // revalidate → server truth
      }
    },
    [id, mutate],
  )

  const backTo = `/journal?j2tab=journal${location.search ? `&${location.search.slice(1)}` : ''}`

  if (!id) {
    return (
      <div className={styles.page}>
        <Link to={backTo} className={styles.back}>← Trade Journal</Link>
        <p className={styles.missing}>No trade selected.</p>
      </div>
    )
  }

  if (isLoading && !data) {
    return (
      <div className={styles.page}>
        <Link to={backTo} className={styles.back}>← Trade Journal</Link>
        <header className={styles.identityRow}>
          <SkeletonLine width="120px" height={26} />
          <SkeletonLine width="80px" height={14} />
        </header>
        <SkeletonLine width="100%" height={90} />
        <SkeletonLine width="100%" height={420} />
      </div>
    )
  }

  if (!trade) {
    return (
      <div className={styles.page}>
        <Link to={backTo} className={styles.back}>← Trade Journal</Link>
        <p className={styles.missing}>
          This trade isn’t available. It may have been deleted, or it’s an options
          strategy — those open in the Trade Journal drawer.
        </p>
      </div>
    )
  }

  // P2 excursion — camelCase dict from the trade-detail endpoint (Task 5), or
  // null when the nightly job hasn't computed it yet.
  const excursion = data?.excursion || null
  const out = outcomeModel(trade, excursion)
  const isLong = trade.side === 'Long'
  const isDateOnly = !String(trade.entryDate || '').includes('T')
  const chart = buildTradeMarkers(trade, tf, excursion)
  const isBroker = trade.source === 'broker'

  // Chart-footer legend hint: keep EFFICIENCY_TITLE while pending (null), swap
  // to the methodology once a real excursion exists.
  const legendHint = (() => {
    if (excursion == null) return { text: EFFICIENCY_TITLE, title: EFFICIENCY_TITLE }
    if (excursion.dataQuality === 'insufficient') {
      return {
        text: 'No intraday bars for this trade — exit efficiency unavailable.',
        title: INSUFFICIENT_TITLE,
      }
    }
    const res = barResLabel(excursion)
    return {
      text: `MFE / MAE overlay · exit efficiency = captured ÷ max favorable move${res ? ` · bar-approx ${res}` : ''}`,
      title: EFFICIENCY_METHOD_TITLE,
    }
  })()

  const setupOptions = (() => {
    const base = settings?.setups || []
    if (trade.setup && !base.includes(trade.setup)) return [trade.setup, ...base]
    return base
  })()

  const submitStop = () => {
    const v = Number(stopInput)
    if (!Number.isFinite(v) || v <= 0) { setPatchError('Enter a stop price above 0.'); return }
    // A stop equal to entry is the "no stop logged" sentinel (R stays null), so
    // saving it would silently re-render the same "R: —" state. Reject it with
    // a clear hint instead of a confusing no-op.
    if (trade?.entryPrice != null && v === Number(trade.entryPrice)) {
      setPatchError('Stop must differ from entry price.'); return
    }
    patchTrade({ originalStop: v }, { originalStop: v })
    setAddingStop(false)
  }

  return (
    <div className={styles.page}>
      {/* Top bar: back link + prev/next */}
      <div className={styles.topBar}>
        <Link to={backTo} className={styles.back}>← Trade Journal</Link>
        <div className={styles.navBtns}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => go(prevId)}
            disabled={!prevId}
            aria-label="Previous trade"
          >‹</button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => go(nextId)}
            disabled={!nextId}
            aria-label="Next trade"
          >›</button>
        </div>
      </div>

      {/* ── 1. Outcome header ─────────────────────────────────────────── */}
      <header className={styles.identityRow}>
        <h1 className={styles.sym}>{trade.symbol}</h1>
        <span className={`${styles.sideBadge} ${isLong ? styles.long : styles.short}`}>
          {(trade.side || '').toUpperCase()}
        </span>
        {trade.result && (
          <span className={`${styles.resultBadge} ${
            trade.result === 'Win' ? styles.resWin
              : trade.result === 'Loss' ? styles.resLoss : styles.resBe
          }`}>
            {trade.result}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <TradeCardActions trade={trade} />
          <ShareToFloor card={{ kind: 'trade', tradeId: id }} label="Share to Floor" />
        </span>
      </header>

      <div className={styles.outcomeGrid}>
        <div className={styles.outcomeCell}>
          <div className={styles.outcomeLabel}>Net P&amp;L</div>
          <div className={`${styles.outcomeValueBig} ${signClass(out.netPnl)}`}>
            {moneySigned(out.netPnl)}
          </div>
        </div>
        <div className={styles.outcomeCell}>
          <div className={styles.outcomeLabel}>P&amp;L %</div>
          <div className={`${styles.outcomeValue} ${signClass(out.pnlPct)}`}>
            {percent(out.pnlPct, { dp: 2, signed: true })}
          </div>
        </div>
        <div className={styles.outcomeCell}>
          <div className={styles.outcomeLabel}>R-multiple</div>
          {out.noStop ? (
            <div className={styles.rNoStop}>
              <span className={styles.outcomeValueMuted}>R: — (no stop logged)</span>
              {!addingStop ? (
                <button type="button" className={styles.addStopBtn} onClick={() => setAddingStop(true)}>
                  + Add stop
                </button>
              ) : (
                <span className={styles.stopForm}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={styles.stopInput}
                    value={stopInput}
                    onChange={(e) => setStopInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitStop() }}
                    aria-label="Original stop price"
                    autoFocus
                  />
                  <button type="button" className={styles.stopSave} onClick={submitStop}>Save</button>
                  <button
                    type="button"
                    className={styles.stopCancel}
                    onClick={() => { setAddingStop(false); setStopInput('') }}
                  >Cancel</button>
                </span>
              )}
            </div>
          ) : (
            <div className={`${styles.outcomeValue} ${signClass(out.r)}`}>{out.rLabel}</div>
          )}
        </div>
        <div className={styles.outcomeCell}>
          <div className={styles.outcomeLabel}>Hold time</div>
          <div className={styles.outcomeValue}>{out.holdLabel}</div>
        </div>
        <div className={styles.outcomeCell}>
          <div className={styles.outcomeLabel}>Exit efficiency</div>
          {/* Honest state machine — efficiency is neutral-gold (not a P&L, so
              never green/red). pending → N/A → underlying-based → real %. */}
          {excursion == null ? (
            <div className={styles.outcomeValueMuted} title={PENDING_TITLE}>Pending</div>
          ) : excursion.dataQuality === 'insufficient' ? (
            <div className={styles.outcomeValueMuted} title={INSUFFICIENT_TITLE}>N/A</div>
          ) : excursion.dataQuality === 'underlying' ? (
            // Options: only the underlying-price excursion exists, so there is no
            // exit-efficiency %. Show a muted dash + explanatory title rather than
            // a bare "—" under the confusing "captured ÷ favorable" tooltip.
            <div className={styles.effWrap}>
              <div className={styles.outcomeValueMuted} title={UNDERLYING_TITLE}>
                {out.exitEfficiency == null
                  ? '—'
                  : percent(out.exitEfficiency, { isRatio: true })}
              </div>
              <div className={styles.effMeta}>underlying-based</div>
            </div>
          ) : out.exitEfficiency == null ? (
            <div className={styles.outcomeValueMuted} title={NO_EXCURSION_TITLE}>—</div>
          ) : (
            <div className={styles.effWrap}>
              <div className={styles.effValue} title={EFFICIENCY_METHOD_TITLE}>
                {percent(out.exitEfficiency, { isRatio: true })}
              </div>
              {barResLabel(excursion) && (
                <div className={styles.effMeta}>{`bar-approx · ${barResLabel(excursion)}`}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Chart card ─────────────────────────────────────────────── */}
      <div className={styles.chartCard}>
        <div className={styles.tfBar} role="tablist" aria-label="Chart timeframe">
          {TF_TABS.map((t) => (
            <button
              key={t.code}
              type="button"
              role="tab"
              aria-selected={tf === t.code}
              className={tf === t.code ? styles.tfBtnActive : styles.tfBtn}
              onClick={() => setTf(t.code)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.chartWrap}>
          {/* hideJournalOverlay: this page draws ITS trade's markers via the
              markers/priceLines props; the auto j2 overlay (every trade on the
              symbol) would otherwise duplicate this trade + add unrelated ones. */}
          <StockChart
            sym={trade.symbol}
            tf={tf}
            height="100%"
            markers={chart.markers}
            priceLines={chart.priceLines}
            entryDate={trade.entryDate}
            exitDate={trade.exitDate}
            liveUpdates={false}
            showDrawingTools={false}
            hideJournalOverlay
          />
        </div>
        <div className={styles.chartFoot}>
          <span className={styles.legendHint} title={legendHint.title}>{legendHint.text}</span>
          {isDateOnly && (
            <span className={styles.caption}>
              Daily chart — no execution times logged.{' '}
              <button
                type="button"
                className={styles.captionLink}
                onClick={() => {
                  notesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  notesRef.current?.focus()
                }}
              >
                Add context in notes ↓
              </button>
            </span>
          )}
        </div>
      </div>

      {patchError && <div className={styles.errorLine} role="alert">Couldn’t save: {patchError}</div>}

      {/* ── 3. The story ──────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>The story</h2>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="trade-setup">Setup</label>
          <select
            id="trade-setup"
            className={styles.select}
            value={trade.setup || ''}
            onChange={(e) => patchTrade({ setup: e.target.value || null }, { setup: e.target.value || null })}
          >
            <option value="">— No setup —</option>
            {setupOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Adherence — this setup's rule checklist, graded per-trade (P5-A4).
            Feature-flag-gated (renders null when 'adherence' is off). */}
        <AdherenceChecklist trade={trade} settings={settings} />

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Mistakes</span>
          <TagChipPicker
            available={settings?.mistakeTags || []}
            selected={trade.mistakeTags || []}
            onChange={(next) => patchTrade({ mistakeTags: next }, { mistakeTags: next })}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Emotions</span>
          <TagChipPicker
            available={settings?.emotionTags || []}
            selected={trade.emotionTags || []}
            onChange={(next) => patchTrade({ emotionTags: next }, { emotionTags: next })}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="trade-notes">Notes</label>
          <textarea
            id="trade-notes"
            ref={notesRef}
            className={styles.textarea}
            rows={4}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => {
              if ((notesDraft || '') !== (trade.notes || '')) {
                patchTrade({ notes: notesDraft }, { notes: notesDraft })
              }
            }}
            placeholder="What was the thesis? What happened? What would you do differently?"
          />
        </div>

        {/* Screenshots — paste / drop / browse chart captures for this trade. */}
        <div className={styles.field} data-trade-screenshots-mount>
          <span className={styles.fieldLabel}>Screenshots</span>
          <TradeScreenshots tradeId={id} />
        </div>
      </section>

      {/* ── 4. Executions ─────────────────────────────────────────────── */}
      <details className={styles.execDetails}>
        <summary className={styles.execSummary}>Executions</summary>
        {isBroker && brokerActivities.length > 0 ? (
          <>
            <table className={styles.execTable}>
              <thead>
                <tr><th>Type</th><th>Units</th><th>Price</th><th>Date</th></tr>
              </thead>
              <tbody>
                {brokerActivities.map((a) => (
                  <tr key={a.id}>
                    <td>{a.activityType || '—'}</td>
                    <td>{a.units != null ? a.units : '—'}</td>
                    <td>{a.price != null ? money(a.price) : '—'}</td>
                    <td>{dateShort(a.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.execCaption}>
              Matched by symbol + holding window — the broker record is the source of truth.
            </p>
          </>
        ) : (
          <table className={styles.execTable}>
            <thead>
              <tr><th>Type</th><th>Shares</th><th>Price</th><th>Date</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Entry</td>
                <td>{trade.shares != null ? trade.shares : '—'}</td>
                <td>{money(trade.entryPrice)}</td>
                <td>{dateShort(trade.entryDate)}</td>
              </tr>
              <tr>
                <td>Exit</td>
                <td>{trade.shares != null ? trade.shares : '—'}</td>
                <td>{money(trade.exitPrice)}</td>
                <td>{dateShort(trade.exitDate)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </details>

      {/* ── 5. Compass post-mortem (paid-gated) ───────────────────────── */}
      {isPaid && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Compass post-mortem</h2>
          <TradeReviewCard
            review={review}
            isLoading={reviewLoading}
            onFeedback={(v) => review && reviewFeedback(review.id, v)}
            onRegenerate={() => review && regenerateReview(review.id)}
            onForget={() => review && forgetReview(review.id)}
          />
          {reviewError && <div className={styles.errorLine}>{reviewError}</div>}
          {!review && !reviewLoading && (
            <button
              type="button"
              className={styles.compassBtn}
              onClick={() => trade.id && generateReview(trade.id)}
              disabled={!trade.id}
            >
              <UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Tell me about this trade
            </button>
          )}
        </section>
      )}
    </div>
  )
}
