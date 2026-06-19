/**
 * CompassOverview — compact horizontal command-center card.
 *
 * Surfaces:
 *  - Profile excerpt (truncated, with "Edit" link to scroll to profile editor)
 *  - This week's focus
 *  - Week-to-date (trades, R, $P&L)
 *  - Today (regime, trade count, EOD recap state)
 *  - Active interventions count + pending suggestions count
 *  - 3 most-recent trade reviews
 *
 * Renders null when overview is null (loading) or empty fresh account
 * with no profile + no trades.
 */

import UIcon from '../../../components/ui/UIcon'

export default function CompassOverview({ overview, onScrollToProfile }) {
  if (!overview) return null
  const {
    profile_excerpt, onboarded, this_weeks_focus, week_to_date, today,
    regime, active_interventions_count, pending_profile_suggestions_count,
    recent_trade_reviews,
  } = overview

  const wtdNetD = week_to_date?.net_pnl_dollar
  const wtdAvgR = week_to_date?.avg_r
  const todayPnlD = today?.net_pnl_dollar

  // Hide the card entirely on a fresh account with nothing to show
  const isEmpty = !onboarded && !profile_excerpt && !this_weeks_focus &&
                  (week_to_date?.trade_count ?? 0) === 0 &&
                  (today?.trade_count ?? 0) === 0 &&
                  recent_trade_reviews?.length === 0
  if (isEmpty) return null

  return (
    <section style={{
      background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 16px',
      margin: '12px 0 8px',
    }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ut-gold, #c9a84c)' }}>
          🧭 Compass overview
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {regime && <span>Regime: <strong>{regime}</strong> · </span>}
          {active_interventions_count > 0 && (
            <span style={{ color: 'var(--loss, #ef4444)' }}>
              {active_interventions_count} alert{active_interventions_count === 1 ? '' : 's'} ·{' '}
            </span>
          )}
          {pending_profile_suggestions_count > 0 && (
            <span style={{ color: 'var(--ut-gold, #c9a84c)' }}>
              {pending_profile_suggestions_count} suggestion{pending_profile_suggestions_count === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12, marginBottom: 8,
      }}>
        {/* Profile */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
            Profile {!onboarded && <span style={{ color: 'var(--ut-gold, #c9a84c)' }}>· not onboarded yet</span>}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-bright)', maxHeight: 60, overflow: 'hidden' }}>
            {profile_excerpt || <em style={{ color: 'var(--text-muted)' }}>No profile yet — Compass will build one as you interact.</em>}
          </div>
          {onScrollToProfile && (
            <button
              type="button"
              onClick={onScrollToProfile}
              style={{
                marginTop: 4, fontSize: 10, color: 'var(--text-muted)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 0, textDecoration: 'underline',
              }}
            >Edit profile →</button>
          )}
        </div>

        {/* This week */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
            This week's focus
          </div>
          {this_weeks_focus ? (
            <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-bright)' }}>
              {this_weeks_focus}
            </div>
          ) : (
            <em style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Generate a weekly review to set focus.
            </em>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            WTD: <strong>{week_to_date?.trade_count ?? 0}</strong>{' '}
            ({week_to_date?.wins ?? 0}W/{week_to_date?.losses ?? 0}L)
            {typeof wtdNetD === 'number' && (
              <span style={{
                marginLeft: 4,
                color: wtdNetD >= 0 ? '#22c55e' : '#ef4444',
              }}>
                {wtdNetD >= 0 ? '+' : ''}${Math.round(wtdNetD)}
              </span>
            )}
            {typeof wtdAvgR === 'number' && (
              <span style={{ marginLeft: 4 }}>
                · avg {wtdAvgR >= 0 ? '+' : ''}{wtdAvgR.toFixed(1)}R
              </span>
            )}
          </div>
        </div>

        {/* Today */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
            Today ({today?.date || '—'})
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-bright)' }}>
            <strong>{today?.trade_count ?? 0}</strong> trade{today?.trade_count === 1 ? '' : 's'}
            {typeof todayPnlD === 'number' && (
              <span style={{
                marginLeft: 4,
                color: todayPnlD >= 0 ? '#22c55e' : '#ef4444',
              }}>
                {todayPnlD >= 0 ? '+' : ''}${Math.round(todayPnlD)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            {today?.has_eod_recap
              ? '✓ EOD recap ready'
              : <>EOD recap: <em>scheduled 4:30 PM ET</em></>}
          </div>
        </div>
      </div>

      {recent_trade_reviews && recent_trade_reviews.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
            Recent trade reviews
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {recent_trade_reviews.map((r) => (
              <span key={r.id} style={{
                fontSize: 11, padding: '2px 8px',
                background: r.result === 'Win' ? 'rgba(34,197,94,0.10)' :
                           r.result === 'Loss' ? 'rgba(239,68,68,0.10)' :
                           'rgba(255,255,255,0.04)',
                border: '1px solid var(--border)', borderRadius: 999,
              }}>
                <strong>{r.symbol || '?'}</strong>
                {typeof r.r_multiple === 'number' && (
                  <span style={{
                    marginLeft: 4,
                    color: r.r_multiple >= 0 ? '#22c55e' : '#ef4444',
                  }}>
                    {r.r_multiple >= 0 ? '+' : ''}{r.r_multiple.toFixed(1)}R
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
