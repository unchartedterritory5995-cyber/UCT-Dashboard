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

import { useEffect } from 'react'
import useTradeReview from '../hooks/useTradeReview'
import TradeReviewCard from './TradeReviewCard'
import CompassAssistButton from '../../../components/voice/CompassAssistButton'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { money, moneySigned, percent, rMultiple as fmtR, dateShort } from '../../../lib/journal-2-0'

export default function TradeDrawer({ trade, accountId, onClose }) {
  const isPhone = useIsPhone()
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

  // ESC key closes
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!trade) return null

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
            ✕
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
        </div>

        {/* Compass review section */}
        <div style={{ padding: '12px 18px', flex: 1 }}>
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
              🧭 Tell me about this trade
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
        </div>
      </aside>
    </>
  )
}
