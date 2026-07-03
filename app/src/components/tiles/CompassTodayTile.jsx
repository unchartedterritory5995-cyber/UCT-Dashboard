/**
 * CompassTodayTile — "Compass noticed" surface on the main Dashboard.
 *
 * Shows, when there is something to show:
 *   - Today's focus message (composed at 7:30 AM ET, otherwise live)
 *   - Active intervention count (gold warning if any are firing)
 *   - A grouped, dismissible feed of what Compass noticed today (stop
 *     watches, earnings proximity, regime flips, etc. — Awareness Engine
 *     M1 producers, plus any existing insight kinds) grouped by kind
 *   - A "Talk to Compass" CTA that opens a Realtime voice session
 *
 * Renders NOTHING (returns null) while loading or when there is no focus
 * message and zero undismissed insights — this is a calm/surgical surface,
 * not permanent dashboard chrome.
 */
import { useContext, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../TileCard'
import { VoiceContext } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import UIcon from '../ui/UIcon'
import styles from './CompassTodayTile.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const KIND_LABELS = {
  stop_hit: 'At Stop',
  stop_proximity: 'Nearing Stop',
  earnings_proximity: 'Earnings',
  regime_flip: 'Regime',
  regime_shift: 'Regime',
  watchlist_alert: 'Watchlist',
  scanner_match: 'Scanner',
  mistake_pattern: 'Discipline',
  drift_warning: 'Discipline',
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || 'Compass'
}

// Only surface RECENT insights. /api/voice/insights returns every undismissed
// row regardless of age, and dismissal is the only removal path — so without a
// cutoff, (a) stale pre-existing rows from months ago would make the tile
// appear even while the awareness engine is dark, and (b) an old
// "reports earnings today" would still read "today" days later. 36h keeps
// "yesterday afternoon" visible while dropping anything genuinely stale.
const RECENCY_MS = 36 * 60 * 60 * 1000
function isRecent(ins) {
  const raw = ins?.created_at
  if (!raw) return true // no timestamp -> don't hide (be permissive)
  const iso = String(raw).includes('T') ? raw : `${String(raw).replace(' ', 'T')}Z`
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return true // unparseable -> don't hide
  return Date.now() - t < RECENCY_MS
}

function groupByKind(insights) {
  const groups = new Map()
  for (const ins of insights) {
    const key = ins.kind || 'other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(ins)
  }
  return [...groups.entries()]
}

export default function CompassTodayTile() {
  // SWR pulls so the tile updates as the awareness engine posts new insights
  // or the user dismisses one. 60s refresh — gentle.
  const { data, mutate } = useSWR(
    '/api/voice/insights?limit=20',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  const insights = data?.insights || []
  const todayFocus = insights.find(
    (i) => i.kind === 'daily_focus' && !i.dismissed_at && isRecent(i),
  )
  const noticed = useMemo(
    () => insights.filter((i) => i.kind !== 'daily_focus' && !i.dismissed_at && isRecent(i)),
    [insights],
  )

  // Still loading, OR loaded with nothing to show — render nothing (calm,
  // not another empty tile on an already-busy dashboard).
  if (!data || (!todayFocus && noticed.length === 0)) {
    return null
  }

  return (
    <TileCard icon="compass" title="Compass · Today">
      <CompassTodayBody todayFocus={todayFocus} noticed={noticed} mutate={mutate} />
    </TileCard>
  )
}

function CompassTodayBody({ todayFocus, noticed, mutate }) {
  const voice = useContext(VoiceContext)
  const [dismissing, setDismissing] = useState(() => new Set())

  const interventionKinds = new Set(['mistake_pattern', 'drift_warning'])
  const recentInterventionCount = noticed.filter((i) => interventionKinds.has(i.kind)).length

  const handleDismiss = useCallback(async (id) => {
    setDismissing((prev) => new Set(prev).add(id))
    // Optimistic: mark it dismissed locally so it drops out of `noticed`
    // immediately, then confirm with the server and revalidate.
    mutate(
      (current) => {
        if (!current?.insights) return current
        return {
          ...current,
          insights: current.insights.map((i) =>
            i.id === id ? { ...i, dismissed_at: new Date().toISOString() } : i,
          ),
        }
      },
      { revalidate: false },
    )
    let ok = false
    try {
      const r = await fetch(`/api/voice/insights/${id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      })
      ok = r.ok
    } catch {
      ok = false // network failure — fetch rejected
    } finally {
      // On failure the revalidation below re-surfaces the (still-undismissed)
      // row, so we MUST re-enable its dismiss button — otherwise it reappears
      // permanently greyed-out with no way to retry until a full reload.
      if (!ok) {
        setDismissing((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
      mutate()
    }
  }, [mutate])

  const inVoiceSession = !!voice
    && voice.mode === 'c'
    && voice.status !== 'idle'
    && voice.status !== 'error'

  const groups = groupByKind(noticed)

  return (
    <div className={styles.body}>
      {recentInterventionCount > 0 && (
        <div className={styles.interventionBanner}>
          <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{recentInterventionCount} active{' '}
          {recentInterventionCount === 1 ? 'intervention' : 'interventions'}
          {' — '}
          <Link to="/journal" className={styles.interventionLink}>
            review on Compass
          </Link>
        </div>
      )}

      {todayFocus && (
        <div className={styles.focusBlock}>
          <div className={styles.focusLabel}>Today's focus</div>
          <div className={styles.focusBody}>{todayFocus.body || todayFocus.headline}</div>
        </div>
      )}

      {groups.length > 0 && (
        <div className={styles.feedSection}>
          {groups.map(([kind, items]) => (
            <div key={kind} className={styles.feedGroup}>
              <div className={styles.feedGroupLabel}>{kindLabel(kind)}</div>
              {items.map((ins) => (
                <div key={ins.id} className={styles.feedItem}>
                  <div className={styles.feedItemMain}>
                    <div className={styles.feedItemHeadline}>
                      {ins.symbol && <span className={styles.feedItemSym}>{ins.symbol}</span>}
                      {ins.headline}
                    </div>
                    {ins.body && <div className={styles.feedItemBody}>{ins.body}</div>}
                  </div>
                  <button
                    type="button"
                    className={styles.dismissBtn}
                    aria-label={`Dismiss: ${ins.headline}`}
                    disabled={dismissing.has(ins.id)}
                    onClick={() => handleDismiss(ins.id)}
                  >
                    <UIcon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))}
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
      {inSession ? '◉ End call' : <><UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Talk to Compass</>}
    </button>
  )
}
