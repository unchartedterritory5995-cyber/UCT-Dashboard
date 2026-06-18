/**
 * Dedicated day-detail page at /journal-2-0/calendar/:date.
 * Two-column layout (desktop): mini-cal + trades-on-day sidebar |
 * day metrics + trades table + (Steps 4-6) notes/attachments/rules.
 */

import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import useJ2DayDetail from '../../hooks/useJ2DayDetail'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import usePreferences, { parsePref } from '../../../../hooks/usePreferences'
import useJ2DayNotesMutation from '../../hooks/useJ2DayNotesMutation'
import MiniMonthNav from './MiniMonthNav'
import DayReflection from './DayReflection'
import DayAttachments from './DayAttachments'
import DayRulesChecklist from './DayRulesChecklist'
import OptionStrategiesSection from '../options/OptionStrategiesSection'
import { buildStrategyLabel } from '../../lib/optionCalcs'
import {
  fmtSignedDollar,
  fmtSignedPct,
  fmtSignedR,
} from '../../lib/calendar'
import styles from './DayDetailPage.module.css'

function buildOptionsActivitySummary(strategies) {
  if (!strategies) return ''
  const lines = []
  const closed = strategies.closed || []
  const expiring = strategies.expiring || []
  if (closed.length > 0) {
    lines.push(`Closed ${closed.length} option ${closed.length === 1 ? 'strategy' : 'strategies'}:`)
    for (const s of closed) {
      const pnl = s.pnlDollar == null ? '—'
        : `${s.pnlDollar >= 0 ? '+' : ''}$${Math.abs(s.pnlDollar).toFixed(2)}`
      const r = s.rMultiple == null ? ''
        : ` (${s.rMultiple >= 0 ? '+' : ''}${s.rMultiple.toFixed(2)}R)`
      lines.push(`- ${buildStrategyLabel(s)} → ${pnl}${r} · ${s.result || s.status}`)
    }
  }
  if (expiring.length > 0) {
    if (lines.length) lines.push('')
    lines.push(`Expiring today (${expiring.length}):`)
    for (const s of expiring) {
      lines.push(`- ${buildStrategyLabel(s)}`)
    }
  }
  return lines.join('\n')
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime())
}

function formatLongDate(date) {
  const [y, m, d] = date.split('-').map(Number)
  const local = new Date(Date.UTC(y, m - 1, d))
  return local.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function DayDetailPage() {
  const { date } = useParams()
  const { accountId, account } = useJ2SelectedAccount()
  const isBroker =
    !!account && account.balanceSource && account.balanceSource !== 'manual'
  const { prefs } = usePreferences()
  const effectiveBasis = isBroker
    ? parsePref(prefs.j2_calendar_pnl_basis, 'account')
    : 'closed'
  const valid = isValidDate(date || '')
  const { metrics, trades, strategies, notes, isLoading, error } = useJ2DayDetail(valid ? date : null, accountId, effectiveBasis)
  const { save, saving, error: saveError } = useJ2DayNotesMutation(valid ? date : null)
  const notesText = notes?.notes ?? ''
  const prepText = notes?.prepNotes ?? ''
  const midDayText = notes?.midDayNotes ?? ''
  const recapText = notes?.recapNotes ?? ''
  const attachments = notes?.attachments ?? []
  const rules = notes?.rules ?? []

  if (!valid) {
    return (
      <div className={styles.notFound}>
        <h2>Day not found</h2>
        <p>"{date}" isn't a valid YYYY-MM-DD date.</p>
        <Link to="/journal" className={styles.backLink}>← Back to Calendar</Link>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <Link to="/journal?j2tab=calendar" className={styles.backLink}>← Calendar</Link>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <MiniMonthNav date={date} />
          <TradesOnDay trades={trades} />
        </aside>

        <main className={styles.main}>
          <h1 className={styles.title}>{formatLongDate(date)}</h1>

          {error && (
            <div className={styles.errorBanner} role="alert">
              Couldn't load day: {String(error.message || error)}
            </div>
          )}

          <DayMetricsRow metrics={metrics} />

          <DayTradesTable trades={trades} isLoading={isLoading} />

          {strategies?.closed?.length > 0 && (
            <OptionStrategiesSection
              strategies={strategies.closed}
              variant="closed"
            />
          )}

          {strategies?.expiring?.length > 0 && (
            <OptionStrategiesSection
              strategies={strategies.expiring}
              variant="open"
            />
          )}

          <DayReflection
            initialNotes={notesText}
            initialPrep={prepText}
            initialMidDay={midDayText}
            initialRecap={recapText}
            attachments={attachments}
            rules={rules}
            onSave={save}
            saving={saving}
            error={saveError}
            optionsActivity={buildOptionsActivitySummary(strategies)}
            date={date}
          />

          <DayAttachments
            date={date}
            notes={notesText}
            prepNotes={prepText}
            midDayNotes={midDayText}
            recapNotes={recapText}
            attachments={attachments}
            rules={rules}
            onSave={save}
            saving={saving}
          />

          <DayRulesChecklist
            notes={notesText}
            prepNotes={prepText}
            midDayNotes={midDayText}
            recapNotes={recapText}
            attachments={attachments}
            rules={rules}
            onSave={save}
            saving={saving}
          />
        </main>
      </div>
    </div>
  )
}

function DayMetricsRow({ metrics }) {
  if (!metrics) return null
  const winRatePct = metrics.winRate != null
    ? `${(metrics.winRate * 100).toFixed(0)}%`
    : '—'
  return (
    <>
    {metrics.basis === 'account' && (
      <div className={styles.basisBreakdown}>
        <span
          className={`${styles.basisHeadline} ${
            metrics.accountBalanceChange > 0 ? styles.pos
              : metrics.accountBalanceChange < 0 ? styles.neg : ''
          }`}
        >
          Account balance {fmtSignedDollar(metrics.accountBalanceChange)}
        </span>
        <span className={styles.basisDetail}>
          Realized {fmtSignedDollar(metrics.realizedPnl)} · Open positions{' '}
          {fmtSignedDollar(metrics.unrealizedChange)}
        </span>
      </div>
    )}
    <div className={styles.metricsRow}>
      <Stat label="Net P&L" value={fmtSignedDollar(metrics.netPnlDollar)}
            positive={metrics.netPnlDollar > 0} negative={metrics.netPnlDollar < 0} />
      <Stat label="P&L %" value={fmtSignedPct(metrics.pnlPercent)}
            positive={metrics.pnlPercent > 0} negative={metrics.pnlPercent < 0} />
      <Stat label="R-sum" value={fmtSignedR(metrics.rSum)}
            positive={metrics.rSum > 0} negative={metrics.rSum < 0} />
      <Stat label="Trades" value={metrics.tradeCount} />
      <Stat label="Winners" value={metrics.winners} />
      <Stat label="Losers" value={metrics.losers} />
      <Stat label="Win Rate" value={winRatePct} />
    </div>
    </>
  )
}

function Stat({ label, value, positive, negative }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span
        className={`${styles.statValue} ${positive ? styles.pos : ''} ${negative ? styles.neg : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

function TradesOnDay({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className={styles.tradesList}>
        <div className={styles.tradesHeader}>Trades on day</div>
        <div className={styles.tradesEmpty}>None.</div>
      </div>
    )
  }
  return (
    <div className={styles.tradesList}>
      <div className={styles.tradesHeader}>{trades.length} trade{trades.length === 1 ? '' : 's'}</div>
      {trades.map((t) => (
        <div key={t.id} className={styles.tradeRow}>
          <span className={styles.tradeSym}>{t.symbol}</span>
          <span className={`${styles.tradeSide} ${t.side === 'Long' ? styles.sideLong : styles.sideShort}`}>
            {t.side}
          </span>
          <span
            className={`${styles.tradePnl} ${t.pnlDollar > 0 ? styles.pos : t.pnlDollar < 0 ? styles.neg : ''}`}
          >
            {fmtSignedDollar(t.pnlDollar)}
          </span>
        </div>
      ))}
    </div>
  )
}

function DayTradesTable({ trades, isLoading }) {
  if (isLoading && (!trades || trades.length === 0)) {
    return <p className={styles.hint}>Loading trades…</p>
  }
  if (!trades || trades.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No trades on this day.</p>
        <p className={styles.emptyHint}>Future days are clickable too — write the plan before you trade it.</p>
      </div>
    )
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Setup</th>
            <th className={styles.thRight}>Shares</th>
            <th className={styles.thRight}>Entry</th>
            <th className={styles.thRight}>Exit</th>
            <th className={styles.thRight}>P&amp;L $</th>
            <th className={styles.thRight}>P&amp;L %</th>
            <th className={styles.thRight}>R</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td><strong>{t.symbol}</strong></td>
              <td>
                <span className={`${styles.sideBadge} ${t.side === 'Long' ? styles.sideLong : styles.sideShort}`}>
                  {t.side}
                </span>
              </td>
              <td>{t.setup || <span className={styles.dash}>—</span>}</td>
              <td className={styles.tdRight}>{t.shares}</td>
              <td className={styles.tdRight}>${t.entryPrice.toFixed(2)}</td>
              <td className={styles.tdRight}>${t.exitPrice.toFixed(2)}</td>
              <td className={`${styles.tdRight} ${t.pnlDollar > 0 ? styles.pos : t.pnlDollar < 0 ? styles.neg : ''}`}>
                {fmtSignedDollar(t.pnlDollar)}
              </td>
              <td className={`${styles.tdRight} ${t.pnlPercent > 0 ? styles.pos : t.pnlPercent < 0 ? styles.neg : ''}`}>
                {fmtSignedPct(t.pnlPercent)}
              </td>
              <td className={styles.tdRight}>{t.rMultiple == null ? <span className={styles.dash}>—</span> : fmtSignedR(t.rMultiple)}</td>
              <td>
                <span className={`${styles.resultBadge} ${
                  t.result === 'Win' ? styles.resWin : t.result === 'Loss' ? styles.resLoss : styles.resBe
                }`}>{t.result}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
