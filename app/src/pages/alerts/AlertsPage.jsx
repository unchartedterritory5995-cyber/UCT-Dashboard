import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { mutate as globalMutate } from 'swr'
import useMobileSWR from '../../hooks/useMobileSWR'
import {
  useIndicatorAlerts, useAlertFires,
  toggleIndicatorAlert, deleteIndicatorAlert,
  snoozeIndicatorAlert, rearmIndicatorAlert, setIndicatorAlertChannels,
} from '../../hooks/useIndicatorAlerts'
import { useAuth } from '../../context/AuthContext'
import { useUserDefinitions } from '../../hooks/useUserDefinitions'
import {
  buildRows, countByKind, fireLine, defIdOf, KIND_LABEL,
  KIND_CONDITION, KIND_DRAWING, KIND_PRICE,
} from './alertRows'
import { chartsLinkPath } from '../../lib/chartDeepLink'
import { formatET } from '../../utils/timeAgo'
import UIcon from '../../components/ui/UIcon'
import styles from './AlertsPage.module.css'

// ─── THE ALERT CENTER ───────────────────────────────────────────────────────
//
// ⭐⭐ ONE SCREEN THAT ANSWERS FIVE QUESTIONS AT A GLANCE: what am I watching,
// where, when will it trigger, is it live, and when did it last fire. Everything
// else is one click away and nothing else is on the row.
//
// ⭐ IT IS ALMOST ENTIRELY A CLIENT FOR THINGS THAT ALREADY SHIPPED. `snooze`,
// `rearm`, `{id}/fires`, `toggle` and `delete` have been on the server —
// ownership-checked, returning 404 rather than 403 for a foreign row — with NO
// CALLER AT ALL. Nothing new was added to the backend for this page.
//
// ⛔⛔ AND IT REFUSES TO FLATTEN THE TWO LIFECYCLES. A price alert is one-shot:
// firing IS deactivation, and it has no state machine, no snooze, no re-arm and
// no fire history. Every row declares what it SUPPORTS (`alertRows.can`) and this
// screen offers exactly that — a "Mute" button on a price alert would be a control
// that cannot work, and calling a triggered one "waiting to reset" would be a lie
// about a row that is finished.

const wlFetcher = (url) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : []))
// ⚠️ THE SAME KEY THE ALERTS WIDGET ALREADY USES, so the two share one cache
// entry and every existing prefix-revalidation in the product covers this screen
// too. A second key would be a second thing to remember to refresh.
const WL_KEY = '/api/watchlist-alerts?active_only=false'
const revalidateWl = () =>
  globalMutate((k) => typeof k === 'string' && k.startsWith('/api/watchlist-alerts'))

/** The mute windows a trader actually reaches for. The server bounds 1..30 days. */
const MUTE_CHOICES = [
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 4, label: '4 hours' },
  { minutes: 60 * 24, label: 'Today' },
  { minutes: 60 * 24 * 7, label: '1 week' },
]

const FILTERS = ['all', KIND_CONDITION, KIND_PRICE, KIND_DRAWING]

export default function AlertsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const { alerts: indicatorAlerts, refresh } = useIndicatorAlerts()
  // ⭐⭐ `useMobileSWR`, NOT BARE `useSWR` — the choice the polling rail exists to
  // force. This screen is one a trader leaves OPEN, so the wrapper's two
  // behaviours are exactly what it needs: it stops polling entirely on a hidden
  // tab, and it halves the tick on a touch client. `marketHoursOnly` further
  // slows it 10× when the market is fully closed, which is when an alert list is
  // least likely to change.
  const { data: wl } = useMobileSWR(user ? WL_KEY : null, wlFetcher,
    { refreshInterval: 30000, dedupingInterval: 10000, marketHoursOnly: true })

  const [kind, setKind] = useState('all')
  const [openHistory, setOpenHistory] = useState(null)
  const [muteFor, setMuteFor] = useState(null)
  const [notice, setNotice] = useState(null)

  // ⭐⭐ THE MEMBER'S OWN FORMULA NAMES. An alert row carries only the ADDRESS,
  // and the server's `instance_label` echoes it back for a user formula — so
  // without this the Alert Center shows `u_0b81da2b98a9.value` where it should
  // say "Trend Up". Found by looking at the rendered page.
  const { rows: defRows } = useUserDefinitions()
  const nameOf = useMemo(() => {
    const byId = new Map()
    for (const r of defRows) {
      const d = r.definition || {}
      const nm = (d.meta && d.meta.name) || d.name
      if (r.def_id && nm) byId.set(r.def_id, nm)
    }
    return (a) => byId.get(defIdOf(a.indicator)) || null
  }, [defRows])

  const rows = useMemo(
    () => buildRows(indicatorAlerts, Array.isArray(wl) ? wl : [], { nameOf }),
    [indicatorAlerts, wl, nameOf],
  )
  const counts = useMemo(() => countByKind(rows), [rows])
  const shown = kind === 'all' ? rows : rows.filter((r) => r.kind === kind)

  // ⭐ `?focus=` is how the chart's "Manage in Alerts" lands on the right row —
  // a query parameter rather than scroll state, so the link survives a reload and
  // can be shared back into the same place.
  const focusId = params.get('focus')

  const say = (kindOf, text) => setNotice({ kind: kindOf, text })

  const onToggle = useCallback(async (row) => {
    await toggleIndicatorAlert(row.id)
    refresh()
  }, [refresh])

  const onMute = useCallback(async (row, minutes, label) => {
    setMuteFor(null)
    const res = await snoozeIndicatorAlert(row.id, minutes)
    // ⛔ THE SERVER'S OWN REFUSAL, forwarded. It refuses an out-of-range window
    // rather than clamping it, and re-wording that here would be a second
    // authority on a bound this screen does not own.
    if (!res.ok) { say('error', res.error); return }
    refresh()
    say('ok', `${row.what} muted for ${label.toLowerCase()}.`)
  }, [refresh])

  const onRearm = useCallback(async (row) => {
    const res = await rearmIndicatorAlert(row.id)
    if (!res.ok) { say('error', res.error); return }
    refresh()
    say('ok', `${row.what} is watching again.`)
  }, [refresh])

  /**
   * Turn a channel on or off for one alert.
   *
   * ⛔ THE SERVER'S ANSWER IS WHAT RENDERS. It drops a channel it cannot honour
   * rather than refusing the request, so re-rendering from an optimistic local
   * guess would show a member a delivery they are not getting.
   */
  const onChannel = useCallback(async (row, name, on) => {
    const next = on
      ? [...new Set([...row.channels, name])]
      : row.channels.filter((c) => c !== name)
    const res = await setIndicatorAlertChannels(row.id, next)
    if (!res.ok) { say('error', res.error); return }
    refresh()
    say('ok', on ? `${row.what} will also email you.` : `${row.what} will not email you.`)
  }, [refresh])

  const onDelete = useCallback(async (row) => {
    if (row.kind === KIND_PRICE || row.kind === KIND_DRAWING) {
      await fetch(`/api/watchlist-alerts/${row.id}`, { method: 'DELETE', credentials: 'same-origin' })
      revalidateWl()
    } else {
      await deleteIndicatorAlert(row.id)
      refresh()
    }
    say('ok', 'Alert deleted.')
  }, [refresh])

  // ⭐⭐ BACK TO THE CHART, THROUGH THE ONE MODULE THAT KNOWS HOW. `chartDeepLink`
  // already spells the link a surface BUILDS and the params `ChartsWorkspace`
  // READS as one fact — and the workspace applies them through its own
  // authorities (`setGroupSym`, `applyTfToCharts`) and then STRIPS them, so the
  // URL is a one-shot instruction rather than a second source of truth.
  //
  // ⛔ A HAND-TYPED `?sym=` HERE WOULD BE EXACTLY THE DRIFT THAT MODULE EXISTS TO
  // PREVENT: it would agree on the day it was written and stop agreeing later.
  const onOpenChart = useCallback((row) => {
    navigate(chartsLinkPath({ symbol: row.sym, tf: row.tf }))
  }, [navigate])

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Alerts</h1>
        <span className={styles.count}>
          {rows.length === 0 ? '' : `${rows.length} total`}
        </span>
        <span className={styles.headSpacer} />
      </div>

      <div className={styles.filters} role="tablist" aria-label="Alert types">
        {FILTERS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={`${styles.filter} ${kind === k ? styles.filterOn : ''}`}
            onClick={() => setKind(k)}
          >
            {k === 'all' ? 'All' : KIND_LABEL[k]}
            <b>{counts[k] ?? 0}</b>
          </button>
        ))}
      </div>

      {notice && (
        <div className={`${styles.notice} ${notice.kind === 'error' ? styles.noticeErr : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      )}

      {shown.length === 0 ? (
        <div className={styles.empty}>
          <b>{rows.length === 0 ? 'No alerts yet' : 'Nothing of this type'}</b>
          {rows.length === 0
            ? 'Open a chart, add a condition, and click its bell — UCT will watch it for you even when the chart is closed.'
            : 'Try another type above.'}
        </div>
      ) : (
        <div className={styles.rows}>
          {shown.map((row) => (
            <Row
              key={row.key}
              row={row}
              focused={String(row.id) === String(focusId)}
              historyOpen={openHistory === row.key}
              muteOpen={muteFor === row.key}
              onHistory={() => setOpenHistory(openHistory === row.key ? null : row.key)}
              onMuteMenu={() => setMuteFor(muteFor === row.key ? null : row.key)}
              onMute={onMute}
              onToggle={onToggle}
              onRearm={onRearm}
              onDelete={onDelete}
              onChannel={onChannel}
              emailAvailable={!!user?.email}
              onOpenChart={onOpenChart}
              onClearFocus={() => { params.delete('focus'); setParams(params, { replace: true }) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({
  row, focused, historyOpen, muteOpen, emailAvailable,
  onHistory, onMuteMenu, onMute, onToggle, onRearm, onDelete, onChannel, onOpenChart, onClearFocus,
}) {
  const toneClass = {
    ok: styles.toneOk, muted: styles.toneMuted, fired: styles.toneFired, fault: styles.toneFault,
  }[row.status.tone] || styles.toneOk
  const paused = row.raw && row.raw.active === false
  const emailOn = row.channels.includes('email')

  return (
    <div
      className={`${styles.row} ${toneClass}`}
      data-kind={row.kind}
      data-tone={row.status.tone}
      data-alert-id={row.id}
      style={focused ? { borderColor: 'var(--ut-gold, #dcbb5e)' } : undefined}
      onMouseDown={focused ? onClearFocus : undefined}
    >
      <span className={styles.stripe} aria-hidden="true" />

      <div className={styles.main}>
        <div className={styles.line1}>
          <span className={styles.sym}>{row.sym}</span>
          <span className={styles.what} title={row.what}>{row.what}</span>
          {row.trigger && <span className={styles.trigger}>{row.trigger}</span>}
          {row.tfText && <span className={styles.tf}>{row.tfText}</span>}
        </div>
        <div className={styles.line2}>
          <span className={styles.state}>{row.status.label}</span>
          {row.status.detail && (
            <>
              <span className={styles.sep}>·</span>
              <span className={styles.detail}>{row.status.detail}</span>
            </>
          )}
          {row.lastFired && (
            <>
              <span className={styles.sep}>·</span>
              <span>{`last fired ${formatET(row.lastFired)}`}</span>
            </>
          )}
          {/* ⭐ SAID ONLY WHEN IT IS TRUE. "In UCT" is every alert's baseline and
              printing it on every row would be noise; email is the exception and
              therefore the thing worth a word. */}
          {emailOn && (
            <>
              <span className={styles.sep}>·</span>
              <span>emailing you</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button" className={styles.rowBtn}
          aria-label={`Open ${row.sym} on a chart`} title="Open on chart"
          onClick={() => onOpenChart(row)}
        ><UIcon name="chart" size={13} /></button>

        {row.can.history && (
          <button
            type="button" className={styles.rowBtn}
            aria-label={`History for ${row.what}`} title="History"
            aria-expanded={historyOpen}
            onClick={onHistory}
          ><UIcon name="clock" size={13} /></button>
        )}

        {/* ⭐ EMAIL IS A TOGGLE ON THE ROW, because it is the one delivery choice
            V1 exposes and burying it behind an edit screen would make a two-state
            switch feel like a settings trip. In UCT is not shown: it is always on,
            and a control that cannot be turned off is not a control.
            ⚠️ ABSENT WHEN THE ACCOUNT HAS NO ADDRESS — an enabled toggle that
            silently never delivers is the defect this lane exists to prevent. */}
        {row.can.channels && emailAvailable && (
          <button
            type="button" className={styles.rowBtn}
            aria-pressed={emailOn}
            aria-label={emailOn ? `Stop emailing ${row.what}` : `Also email ${row.what}`}
            title={emailOn ? 'Email on' : 'Email off'}
            onClick={() => onChannel(row, 'email', !emailOn)}
          ><UIcon name="document" size={13} /></button>
        )}

        {/* ⚠️ RE-ARM IS NOT GIVEN EQUAL WEIGHT TO PAUSE. An alert comes back BY
            ITSELF when the condition goes false; this is the advanced case of
            asking for it now, so it appears only where it does something. */}
        {row.can.rearm && (
          <button
            type="button" className={styles.rowBtn}
            aria-label={`Watch ${row.what} again now`} title="Watch again now"
            onClick={() => onRearm(row)}
          ><UIcon name="refresh" size={13} /></button>
        )}

        {row.can.mute && (
          <span className={styles.menuWrap}>
            <button
              type="button" className={styles.rowBtn}
              aria-label={`Mute ${row.what}`} title="Mute for…"
              aria-haspopup="menu" aria-expanded={muteOpen}
              onClick={onMuteMenu}
            ><UIcon name="volumeOff" size={13} /></button>
            {muteOpen && (
              <div className={styles.menu} role="menu">
                {MUTE_CHOICES.map((c) => (
                  <button
                    key={c.minutes} type="button" role="menuitem" className={styles.menuItem}
                    onClick={() => onMute(row, c.minutes, c.label)}
                  >{c.label}</button>
                ))}
              </div>
            )}
          </span>
        )}

        {row.can.pause && (
          <button
            type="button" className={styles.rowBtn}
            aria-pressed={paused}
            aria-label={paused ? `Resume ${row.what}` : `Pause ${row.what}`}
            title={paused ? 'Resume' : 'Pause'}
            onClick={() => onToggle(row)}
          ><UIcon name={paused ? 'play' : 'pause'} size={13} /></button>
        )}

        <button
          type="button" className={styles.rowBtn}
          aria-label={`Delete ${row.what}`} title="Delete"
          onClick={() => onDelete(row)}
        ><UIcon name="trash" size={13} /></button>
      </div>

      {historyOpen && <History row={row} />}
    </div>
  )
}

/**
 * One alert's own fire history.
 *
 * ⛔ THE MEMBER SEES THE BAR AND THE VERB. `fire_key`, the comparator and the
 * 0.5 threshold stay internal — `fireLine` owns that translation so this
 * component never learns the encoding.
 */
function History({ row }) {
  const { fires, isLoading } = useAlertFires(row.id, 25)
  if (isLoading) return <div className={styles.history}><span className={styles.fire}>Loading…</span></div>
  if (!fires.length) {
    return (
      <div className={styles.history}>
        <span className={styles.fire}>Nothing yet — this alert has not fired.</span>
      </div>
    )
  }
  return (
    <div className={styles.history}>
      {fires.map((f) => {
        const line = fireLine(f, row)
        return (
          <div key={f.id} className={styles.fire}>
            <span className={styles.fireWhen}>{line.when ? formatET(line.when) : '—'}</span>
            {line.barText && <span>{line.barText}</span>}
            <span>{line.verb}</span>
            {line.failedChannels.length > 0 && (
              <span className={styles.fireFail}>
                {`${line.failedChannels.join(', ')} not delivered`}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
