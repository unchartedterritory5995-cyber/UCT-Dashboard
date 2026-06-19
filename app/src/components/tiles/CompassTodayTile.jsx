/**
 * CompassTodayTile — Compass status surface on the main Dashboard.
 *
 * Shows at-a-glance:
 *   - Today's focus message (composed at 7:30 AM ET, otherwise live)
 *   - Active intervention count (gold warning if any are firing)
 *   - The most recent proactive insight headline
 *   - A "Talk to Compass" CTA that opens a Realtime voice session
 *
 * This is the dashboard-level twin of CompassOverview (which lives on
 * the Compass tab). It makes the unified Compass product visible on
 * the FIRST page the user sees after login.
 */
import { useEffect, useState, useContext } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../TileCard'
import { VoiceContext } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import styles from './CompassTodayTile.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))


export default function CompassTodayTile() {
  // SWR pulls so the tile updates as the daemon posts new insights or
  // the user toggles proactive_speak. 60s refresh — gentle.
  const { data: insights } = useSWR(
    '/api/voice/insights?limit=20',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  return (
    <TileCard icon="compass" title="Compass · Today">
      <CompassTodayBody insights={insights?.insights || []} />
    </TileCard>
  )
}


function CompassTodayBody({ insights }) {
  const voice = useContext(VoiceContext)

  // Find today's focus (kind="daily_focus", most recent)
  const todayFocus = insights.find((i) => i.kind === 'daily_focus')
  // Most recent non-focus insight to surface a "last noticed" line
  const lastInsight = insights.find(
    (i) => i.kind !== 'daily_focus' && !i.dismissed_at,
  )
  // Count any active intervention insights from the last 24h
  const interventionKinds = new Set(['mistake_pattern', 'drift_warning'])
  const recentInterventionCount = insights.filter((i) => {
    if (!interventionKinds.has(i.kind)) return false
    if (i.dismissed_at) return false
    return true
  }).length

  const inVoiceSession = !!voice
    && voice.mode === 'c'
    && voice.status !== 'idle'
    && voice.status !== 'error'

  return (
    <div className={styles.body}>
      {recentInterventionCount > 0 && (
        <div className={styles.interventionBanner}>
          ⚠️ {recentInterventionCount} active{' '}
          {recentInterventionCount === 1 ? 'intervention' : 'interventions'}
          {' — '}
          <Link to="/journal" className={styles.interventionLink}>
            review on Compass
          </Link>
        </div>
      )}

      {todayFocus ? (
        <div className={styles.focusBlock}>
          <div className={styles.focusLabel}>Today's focus</div>
          <div className={styles.focusBody}>{todayFocus.body || todayFocus.headline}</div>
        </div>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No focus posted yet today.</div>
          <div className={styles.emptySub}>
            Compass posts your morning focus at 7:30 AM ET on weekdays.
            Ask "what's my focus today" any time.
          </div>
        </div>
      )}

      {lastInsight && (
        <div className={styles.recentLine}>
          <span className={styles.recentLabel}>Last noticed:</span>{' '}
          <span className={styles.recentText}>
            {lastInsight.symbol ? `${lastInsight.symbol} — ` : ''}
            {lastInsight.headline}
          </span>
        </div>
      )}

      <div className={styles.footer}>
        <TalkButton inSession={inVoiceSession} voiceAvailable={!!voice} />
        <Link to="/journal" className={styles.compassTabLink}>
          Open Compass tab →
        </Link>
      </div>
    </div>
  )
}


function TalkButton({ inSession, voiceAvailable }) {
  // useRealtimeSession depends on VoiceProvider; only mount when available.
  if (!voiceAvailable) return null
  return <TalkButtonInner inSession={inSession} />
}


function TalkButtonInner({ inSession }) {
  const { connect, disconnect } = useRealtimeSession()
  return (
    <button
      type="button"
      onClick={() => (inSession ? disconnect() : connect('compass'))}
      className={`${styles.talkBtn} ${inSession ? styles.talkBtnActive : ''}`}
      aria-label={inSession ? 'End voice conversation' : 'Talk to Compass'}
    >
      {inSession ? '◉ End call' : '🧭 Talk to Compass'}
    </button>
  )
}
