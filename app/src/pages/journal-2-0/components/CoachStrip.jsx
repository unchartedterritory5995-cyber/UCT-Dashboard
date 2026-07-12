/**
 * CoachStrip — the ONE consolidated coach strip on Today (P4 B2).
 *
 * Folds the five per-component "banner pile" that used to mount inconsistently
 * across the journal (NudgesBanner + InterventionBanner + BrokerReviewNudge +
 * EODRecapBanner + DisciplineLockBanner) into a SINGLE calm, severity-ordered
 * strip of consistent rows. Each row: a kind-icon + message + optional
 * deep-link + optional dismiss/snooze (preserving each source's own semantics).
 *
 * Union of advisory signals (severity order, most urgent first):
 *   1. discipline lock          (useJ2DisciplineState)      — deep-link Compass
 *   2. active interventions     (overview.interventions)    — dismiss + Compass
 *      (ordered danger → warning → info within the group)
 *   3. broker-review needed     (overview.broker_unreviewed_count) — Trade Journal
 *   4. nudges (loss/win/stale)  (overview.nudges)           — snooze (localStorage)
 *   5. unviewed EOD recap       (useJ2UnviewedEOD)          — read + markViewed
 *
 * P0 poller collapse: signals 2–4 used to run THREE separate 60s pollers
 * (useInterventions + useJ2Nudges + /api/j2/broker/unreviewed). They now ride
 * the single Compass-overview payload (the ONE 60s poll TodaySurface already
 * mounts) — get_overview carries `interventions` / `nudges` /
 * `broker_unreviewed_count`, so Today drops to ≤4 recurring requests/user
 * (positions · options · discipline · overview). Dismiss POSTs to the
 * interventions endpoint then refreshes overview (list_active drops dismissed).
 *
 * Calm surface: renders `null` when there is nothing to show — Today must never
 * show an empty coach strip.
 *
 * No emoji — every glyph is a gold <UIcon/>.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2UnviewedEOD from '../hooks/useJ2UnviewedEOD'
import useJ2EODRecaps from '../hooks/useJ2EODRecaps'
import useJ2DisciplineState from '../hooks/useJ2DisciplineState'
import useCompassOverview from '../hooks/useCompassOverview'
import { compassScope } from '../hooks/compassScope'
import { useFeatureFlag } from '../featureFlags'
import styles from './CoachStrip.module.css'

// Nudge snooze — SHARE the exact localStorage key family NudgesBanner uses so a
// snooze on Today also silences the Open Positions strip (and vice-versa).
const SNOOZE_MS = 60 * 60 * 1000 // 1 hour
const NUDGE_SNOOZE_PREFIX = 'uct.j2.nudges.dismissed.'

// Deep-link routes (new 5-surface shell — A2).
const TRADES_CLOSED = '/journal/trades?seg=closed'
const TRADES_OPEN = '/journal/trades?seg=open'
const COMPASS = '/journal/compass'
const ACCOUNTS = '/journal/accounts'

const INTERVENTION_ICON = { danger: 'noEntry', warning: 'warning', info: 'sparkle' }
const SEV_RANK = { danger: 0, warning: 1, info: 2 }

const brokerTrustFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { accounts: [] }))

function readSnoozed(accountId) {
  if (!accountId) return {}
  try {
    const raw = localStorage.getItem(NUDGE_SNOOZE_PREFIX + accountId)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeSnoozed(accountId, map) {
  if (!accountId) return
  try {
    localStorage.setItem(NUDGE_SNOOZE_PREFIX + accountId, JSON.stringify(map))
  } catch {
    /* ignore quota errors */
  }
}

function fmtCountdown(unlockAt) {
  if (!unlockAt) return null
  const ms = new Date(unlockAt).getTime() - Date.now()
  if (ms <= 0) return null
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export default function CoachStrip({ accountId: accountIdProp }) {
  const selected = useJ2SelectedAccount()
  const accountId = accountIdProp !== undefined ? accountIdProp : selected.accountId

  const navigate = useNavigate()

  // ── the union of advisory sources ──────────────────────────────────────────
  // P0 poller collapse: nudges, interventions, and the broker-review count are
  // FOLDED into the single Compass-overview payload (the ONE 60s poll on Today),
  // so CoachStrip no longer runs three separate 60s pollers for them. Read-only
  // on Today: overview's interventions come from list_active (NO rule
  // evaluation), so Today stays a calm, side-effect-free landing.
  const celebrateOn = useFeatureFlag('celebrate')
  const { overview, refresh: refreshOverview } = useCompassOverview(accountId)
  const nudgesState = overview?.nudges ?? null
  const interventions = useMemo(() => overview?.interventions ?? [], [overview])
  const reviewTotal = overview?.broker_unreviewed_count ?? 0

  const { unviewed } = useJ2UnviewedEOD(accountId)
  const { markViewed } = useJ2EODRecaps(accountId)
  const { state: disciplineState } = useJ2DisciplineState(accountId)

  // Broker connection health (tokenState). A broken/expiring authorization means
  // the live numbers may be stale — surface a re-auth nudge. Trust is NOT already
  // polled on Today, so fetch it ONCE on mount (NO refreshInterval — this must
  // never become a recurring poller). Same read the Sync Trust Center uses; SWR
  // dedups the key across the tab.
  const { data: trustData } = useSWR('/api/j2/broker/trust', brokerTrustFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  // Dismiss an intervention: POST to the dismiss endpoint, then refresh the
  // overview (list_active filters dismissed rows, so it drops on the next
  // fetch). Optimistic local removal keeps the row from lingering until then.
  const dismissIntervention = useCallback((id) => {
    if (!id) return
    const scope = compassScope(accountId)
    refreshOverview(
      (cur) => (cur
        ? { ...cur, interventions: (cur.interventions || []).filter((x) => x.id !== id) }
        : cur),
      { revalidate: false },
    )
    fetch(`/api/j2/accounts/${scope}/coach/interventions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    }).catch(() => { /* best-effort */ }).finally(() => { refreshOverview() })
  }, [accountId, refreshOverview])

  // ── local dismiss state ─────────────────────────────────────────────────────
  const [snoozed, setSnoozed] = useState(() => readSnoozed(accountId))
  const [reviewDismissed, setReviewDismissed] = useState(false)
  const [eodDismissed, setEodDismissed] = useState(false)

  useEffect(() => {
    setSnoozed(readSnoozed(accountId))
    setReviewDismissed(false)
    setEodDismissed(false)
  }, [accountId])

  const snoozeNudge = useCallback((key) => {
    setSnoozed((prev) => {
      const next = { ...prev, [key]: Date.now() + SNOOZE_MS }
      writeSnoozed(accountId, next)
      return next
    })
  }, [accountId])

  const openTo = useCallback((to, onOpen) => {
    if (onOpen) { try { onOpen() } catch { /* swallow */ } }
    navigate(to)
  }, [navigate])

  // First broker account whose authorization is broken/expiring → re-auth nudge.
  const brokenBroker = useMemo(() => {
    const accts = trustData?.accounts
    if (!Array.isArray(accts)) return null
    const bad = accts.find(
      (a) => a?.tokenState === 'broken' || a?.tokenState === 'expiring' || a?.status === 'broken',
    )
    return bad ? (bad.brokerageName || 'Brokerage') : null
  }, [trustData])

  // ── build the severity-ordered row list ─────────────────────────────────────
  const items = useMemo(() => {
    const now = Date.now()
    const out = []

    // 1. discipline lock (most urgent) — one row per active reason.
    if (disciplineState?.locked && Array.isArray(disciplineState.reasons)) {
      disciplineState.reasons.forEach((r, i) => {
        const countdown = fmtCountdown(r.unlockAt)
        out.push({
          key: `lock-${r.type || i}`,
          kind: 'lock',
          sev: 'danger',
          icon: 'noEntry',
          label: 'Trade entry locked',
          message: countdown ? `${r.message} — unlocks in ${countdown}` : r.message,
          to: COMPASS,
          openLabel: 'Open Compass',
        })
      })
    }

    // 2. active interventions — danger → warning → info.
    if (Array.isArray(interventions)) {
      const sorted = [...interventions].sort(
        (a, b) => (SEV_RANK[a.severity] ?? 1) - (SEV_RANK[b.severity] ?? 1),
      )
      sorted.forEach((iv) => {
        const sev = SEV_RANK[iv.severity] !== undefined ? iv.severity : 'warning'
        out.push({
          key: `iv-${iv.id}`,
          kind: 'intervention',
          sev,
          icon: INTERVENTION_ICON[sev] || 'warning',
          label: 'Compass heads-up',
          message: iv.message,
          to: COMPASS,
          openLabel: 'Open Compass',
          action: {
            label: 'Dismiss',
            ariaLabel: 'Dismiss intervention',
            onClick: () => { dismissIntervention(iv.id) },
          },
        })
      })
    }

    // 2b. broker connection re-auth (trust). A broken/expiring authorization
    // undermines the live numbers, so it sits high — just under interventions.
    if (brokenBroker) {
      out.push({
        key: 'broker-reauth',
        kind: 'reauth',
        sev: 'warning',
        icon: 'warning',
        label: 'Broker connection',
        message: `Your ${brokenBroker} connection needs re-auth — trades may be stale.`,
        to: ACCOUNTS,
        openLabel: 'Reconnect',
      })
    }

    // 3. broker-review needed (count folded into the overview payload).
    if (reviewTotal > 0 && !reviewDismissed) {
      out.push({
        key: 'broker-review',
        kind: 'review',
        sev: 'warning',
        icon: 'edit',
        label: 'Needs a setup tag',
        message: `${reviewTotal} broker-imported ${reviewTotal === 1 ? 'item needs' : 'items need'} a setup tag — add one to start journaling ${reviewTotal === 1 ? 'it' : 'them'}.`,
        to: TRADES_CLOSED,
        openLabel: 'Tag in Trade Journal',
        action: {
          label: 'Dismiss',
          ariaLabel: 'Dismiss broker-review nudge',
          onClick: () => setReviewDismissed(true),
        },
      })
    }

    // 4. nudges (loss / win / stale) — snooze-gated.
    if (nudgesState) {
      const { lossStreakCount = 0, winStreakCount = 0, staleCount = 0, thresholds } = nudgesState
      const T = thresholds || { loss: 3, win: 5, staleDays: 30 }
      const notSnoozed = (k) => !(typeof snoozed[k] === 'number' && snoozed[k] > now)
      if (lossStreakCount >= T.loss && notSnoozed('loss')) {
        out.push({
          key: 'nudge-loss',
          kind: 'nudge',
          sev: 'danger',
          icon: 'noEntry',
          message: `${lossStreakCount} down today. Take 15?`,
          action: { label: 'Snooze 1h', ariaLabel: 'Snooze loss-streak nudge', onClick: () => snoozeNudge('loss') },
        })
      }
      if (winStreakCount >= T.win && notSnoozed('win')) {
        out.push({
          key: 'nudge-win',
          kind: 'nudge',
          sev: 'success',
          icon: 'star-fill',
          message: `${winStreakCount} in a row. Don't size up out of euphoria.`,
          action: { label: 'Snooze 1h', ariaLabel: 'Snooze win-streak nudge', onClick: () => snoozeNudge('win') },
        })
      }
      if (staleCount > 0 && notSnoozed('stale')) {
        out.push({
          key: 'nudge-stale',
          kind: 'nudge',
          sev: 'warning',
          icon: 'clock',
          message: `${staleCount} position${staleCount === 1 ? '' : 's'} held ${T.staleDays}+ days with no notes — review these.`,
          to: TRADES_OPEN,
          openLabel: 'Review positions',
          action: { label: 'Snooze 1h', ariaLabel: 'Snooze stale-positions nudge', onClick: () => snoozeNudge('stale') },
        })
      }
    }

    // 5. unviewed EOD recap (least urgent).
    if (unviewed && !eodDismissed) {
      const day = unviewed.day || unviewed.metadata?.day
      const markThisViewed = () => { Promise.resolve(markViewed(unviewed.id)).catch(() => {}) }
      out.push({
        key: 'eod',
        kind: 'eod',
        sev: 'info',
        icon: 'compass',
        label: 'Compass recap',
        message: day ? `Compass wrapped the ${day} session — read it.` : 'Compass wrapped your last session — read it.',
        to: COMPASS,
        openLabel: 'Read recap',
        onOpen: markThisViewed,
        action: {
          label: 'Dismiss',
          ariaLabel: 'Dismiss EOD recap',
          onClick: () => { markThisViewed(); setEodDismissed(true) },
        },
      })
    }

    // 6. celebrations (P6-7) — positive success rows, appended last (least
    // urgent, purely affirmative). Each is a once-per achievement from the
    // overview payload: goal hit, win streak, clean discipline day, 100%-
    // adherence trade. Flag-gated. The existing win-streak caution row (euphoria
    // warning) is complementary, not contradictory, so both may coexist.
    if (celebrateOn && Array.isArray(overview?.celebrations)) {
      overview.celebrations.forEach((c) => {
        if (!c || !c.key || !c.message) return
        out.push({
          key: `celebration-${c.key}`,
          kind: 'celebration',
          sev: 'success',
          icon: 'star-fill',
          label: 'Milestone',
          message: c.message,
        })
      })
    }

    return out
  }, [
    disciplineState, interventions, brokenBroker, reviewTotal, reviewDismissed, nudgesState,
    snoozed, unviewed, eodDismissed, dismissIntervention, snoozeNudge, markViewed,
    celebrateOn, overview,
  ])

  // Calm surface: nothing to show → render nothing.
  if (items.length === 0) return null

  return (
    <div className={styles.strip} data-testid="coach-strip" role="region" aria-label="Coach">
      {items.map((it) => (
        <div
          key={it.key}
          className={`${styles.row} ${styles[it.sev] || ''}`}
          data-testid="coach-row"
          data-kind={it.kind}
          role="status"
        >
          <span className={styles.icon} aria-hidden="true"><UIcon name={it.icon} size={15} /></span>
          <div className={styles.body}>
            {it.label && <div className={styles.label}>{it.label}</div>}
            <div className={styles.msg}>{it.message}</div>
          </div>
          {it.to && (
            <button
              type="button"
              className={styles.openBtn}
              onClick={() => openTo(it.to, it.onOpen)}
            >
              {it.openLabel}
              <UIcon name="chevronRight" size={13} style={{ verticalAlign: '-2px', marginLeft: 3 }} />
            </button>
          )}
          {it.action && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={it.action.onClick}
              aria-label={it.action.ariaLabel}
            >
              {it.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
