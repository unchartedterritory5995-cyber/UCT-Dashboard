/**
 * TradeDrawer — slide-over panel showing detail for a single closed trade.
 *
 * Props:
 *   trade: null | trade object (from useJ2Trades)
 *   accountId: string | null  (from useJ2SelectedAccount)
 *   onClose(): void
 *
 * Hosts the "Tell me about this trade" Compass review surface.
 */

import { useEffect, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useTradeReview from '../hooks/useTradeReview'
import TradeReviewCard from './TradeReviewCard'
import CompassAssistButton from '../../../components/voice/CompassAssistButton'
import UIcon from '../../../components/ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { money, moneySigned, percent, rMultiple as fmtR, dateShort } from '../../../lib/journal-2-0'
import { useIsPaid } from '../../../context/AuthContext'
import { sendCaptureToJournal } from '../lib/sendToJournal'

const _excFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function TradeDrawer({ trade, accountId, onClose }) {
  const isPhone = useIsPhone()
  const isPaid = useIsPaid()
  // Option strategies: their excursion keys on id:<strategy id> and is served
  // by /strategies/{id}/excursion. Contract tier only ('option_daily') gets
  // surfaced — 'underlying'/'insufficient' rows add nothing to this compact
  // drawer, so those render exactly as before.
  const { data: optExcursion } = useMobileSWR(
    trade?.isOption && trade?.id ? `/api/j2/strategies/${trade.id}/excursion` : null,
    _excFetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )
  const {
    review, isLoading: reviewLoading,
    generate: generateReview,
    regenerate: regenerateReview,
    feedback: reviewFeedback,
    forget: forgetReview,
    reset: resetReview,
    error: reviewError,
  } = useTradeReview(accountId)

  // Reset review whenever the selected trade changes or drawer closes.
  useEffect(() => {
    resetReview()
  }, [trade?.id, resetReview])

  // Phase 4D-4C.2: "Save trade to notebook" — a short-lived local toast,
  // same pattern as ChartWidget's ctxToast (the only other real caller of
  // sendCaptureToJournal in the app).
  const [captureToast, setCaptureToast] = useState(null)
  useEffect(() => {
    if (!captureToast) return undefined
    const t = setTimeout(() => setCaptureToast(null), 2400)
    return () => clearTimeout(t)
  }, [captureToast])

  // ESC key closes
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!trade) return null

  // Explicit user intent only: this fires ONLY on the button click below,
  // never merely because the drawer is open (Section 5's distinction —
  // opening a trade != creating a note about it). `trade.tradeRef` is the
  // SAME id:/ext: identity trade_ref_for_row already computes server-side
  // (equity via _row_to_trade, options via _row_to_strategy) — never
  // recomputed here, and never a ticker+date guess.
  const handleSaveToNotebook = async () => {
    // `trade.symbol` is a synthesized display label for options ("SPY Oct 16
    // $110C") — never a valid chart/bars-API ticker. `trade.underlying` is
    // the real one (equity rows have no `underlying`, so `symbol` is correct
    // there).
    const chartSymbol = trade.underlying || trade.symbol
    const msg = await sendCaptureToJournal('chart', {
      symbol: chartSymbol,
      tf: 'D',
      to: trade.exitDate || undefined,
    }, {
      target: 'newNote',
      label: `${trade.symbol} trade`,
      extra: {
        tradeRef: trade.tradeRef || null,
        caption: `${trade.symbol}${trade.side ? ` — ${trade.side}` : ''} trade`,
      },
    })
    setCaptureToast(msg)
  }

  const net = trade.pnlDollarNet ?? trade.pnlDollar
  const isWin = (net ?? 0) > 0
  const isLoss = (net ?? 0) < 0

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.45)',
        }}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Trade detail — ${trade.symbol}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 201,
          width: isPhone ? '100vw' : 440, maxWidth: isPhone ? '100vw' : '92vw',
          background: 'var(--bg-surface, #161b22)',
          borderLeft: isPhone ? 'none' : '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          paddingBottom: isPhone ? 'env(safe-area-inset-bottom)' : undefined,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, background: 'var(--bg-surface, #161b22)', zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-bright)' }}>
              {trade.symbol}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: trade.side === 'Long' ? '#22c55e' : '#ef4444',
            }}>
              {trade.side?.toUpperCase()}
            </span>
            {trade.result && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                background: trade.result === 'Win' ? 'rgba(34,197,94,0.15)'
                  : trade.result === 'Loss' ? 'rgba(239,68,68,0.12)'
                    : 'rgba(200,200,200,0.1)',
                color: trade.result === 'Win' ? '#22c55e'
                  : trade.result === 'Loss' ? '#ef4444'
                    : 'var(--text-muted)',
              }}>
                {trade.result}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer',
              lineHeight: 1, padding: '2px 6px',
            }}
          >
            <UIcon name="x" size={20} />
          </button>
        </div>

        {/* Trade detail grid */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px',
          }}>
            {[
              ['Entry', money(trade.entryPrice)],
              ['Exit', money(trade.exitPrice)],
              ['Entry Date', dateShort(trade.entryDate)],
              ['Exit Date', dateShort(trade.exitDate)],
              ['Shares', trade.shares != null ? trade.shares.toLocaleString() : '—'],
              ['Setup', trade.setup || '—'],
              ['P&L $', (
                <span style={{ color: isWin ? '#22c55e' : isLoss ? '#ef4444' : 'inherit' }}>
                  {moneySigned(trade.pnlDollar)}
                </span>
              )],
              ['Net P&L', (
                <span style={{ color: isWin ? '#22c55e' : isLoss ? '#ef4444' : 'inherit' }}>
                  {moneySigned(net)}
                </span>
              )],
              ['P&L %', percent(trade.pnlPercent, { signed: true, dp: 2 })],
              ['R', fmtR(trade.rMultiple)],
              // Contract-tier excursion (premium-based) — options only.
              ...(optExcursion?.dataQuality === 'option_daily' ? [
                ['Exit efficiency', (
                  <span title="Captured premium move ÷ best premium move (contract daily bars)">
                    {optExcursion.exitEfficiency == null
                      ? '—'
                      : percent(optExcursion.exitEfficiency, { isRatio: true })}
                  </span>
                )],
                ['True R', (
                  optExcursion.trueR == null ? (
                    <span title="Never traded against your entry — no adverse premium move to measure risk by">—</span>
                  ) : (
                    <span
                      title="P&L measured against the premium's actual worst drawdown — no stop required"
                      style={{ color: optExcursion.trueR > 0 ? '#22c55e' : optExcursion.trueR < 0 ? '#ef4444' : 'inherit' }}
                    >
                      {`${optExcursion.trueR >= 0 ? '+' : ''}${optExcursion.trueR.toFixed(2)}R`}
                    </span>
                  )
                )],
              ] : []),
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-bright)', fontWeight: 500 }}>
                  {val ?? '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Phase 4D-4C.2: explicit capture, not an AI-cost feature —
              available to every user, not gated on isPaid. */}
          <button
            type="button"
            onClick={handleSaveToNotebook}
            style={{
              width: '100%', padding: '7px 14px', fontSize: 12, fontWeight: 600,
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 6,
              cursor: 'pointer', marginTop: 10,
            }}
          >
            <UIcon name="camera" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Save trade to notebook
          </button>
          {captureToast && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
              {captureToast}
            </div>
          )}
        </div>

        {/* Compass review section — paid-only (AI-cost feature) */}
        <div style={{ padding: '12px 18px', flex: 1 }}>
          {isPaid && (<>
          <TradeReviewCard
            review={review}
            isLoading={reviewLoading}
            onFeedback={(v) => review && reviewFeedback(review.id, v)}
            onRegenerate={() => review && regenerateReview(review.id)}
            onForget={() => review && forgetReview(review.id)}
          />

          {reviewError && (
            <div style={{ fontSize: 12, color: '#ef4444', margin: '6px 0' }}>
              {reviewError}
            </div>
          )}

          {!review && !reviewLoading && (
            <button
              type="button"
              onClick={() => trade && trade.id && generateReview(trade.id)}
              disabled={!trade || !trade.id}
              style={{
                width: '100%', padding: '8px 14px', fontSize: 12, fontWeight: 600,
                background: 'rgba(201,168,76,0.10)', color: 'var(--ut-gold, #c9a84c)',
                border: '1px solid rgba(201,168,76,0.5)', borderRadius: 6,
                cursor: 'pointer', margin: '6px 0',
              }}
            >
              <UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Tell me about this trade
            </button>
          )}

          {/* Voice conversation about this trade */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
            <CompassAssistButton
              pageHint={`TradeDrawer · ${trade.symbol} ${trade.side || ''} · `
                + `entered ${dateShort(trade.entryDate)} at ${money(trade.entryPrice)}`
                + ` · exited ${dateShort(trade.exitDate)} at ${money(trade.exitPrice)}`
                + ` · ${moneySigned(net)} (${percent(trade.pnlPercent, { signed: true, dp: 1 })})`
                + (trade.setup ? ` · setup: ${trade.setup}` : '')}
              label="🎙️ Talk about this trade"
            />
          </div>
          </>)}
        </div>
      </aside>
    </>
  )
}
