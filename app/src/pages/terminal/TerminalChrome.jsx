// UCT Terminal — lane T4: the shell's chrome. Everything here is DARK behind
// `terminalChromeEnabled` (api/services/terminal_chrome.py, TERMINAL_CHROME_ENABLED); the
// shell mounts none of it while that key is absent from the auth payload.
//
//   StatusStrip        V7 — the L0 strip, always on screen (desktop and phone): the market
//                      session and its next boundary (S11, lib/marketClock), the ET clock,
//                      the board's data freshness (TERM-006, via panelFreshness.js), the
//                      connection, the active channel and its security, and unread alerts.
//   PanelFreshness     V8 — the SWR scope a panel renders inside, so the shell learns when
//                      that panel's data last ARRIVED (panelFreshness.js says why SWR).
//   PanelAsOf          V8 — the as-of clause in a panel header, decided by the authority.
//   PanelSwitcher      P14a — on the touch tier (<=1024px, owner ruling D-007: full phone
//                      parity), a tab per stored panel plus the board's layout controls.
//
// ⛔ NO NEW POLL. The alert count reads the bell's OWN SWR entry (AlertBell.jsx keys it
// `['/api/alerts?limit=20', userId]`) with no refreshInterval: the bell polls, the strip
// reads the cache. The clocks here are local timers that re-render only their own component.
import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import useSWR, { SWRConfig } from 'swr'
import { AuthContext } from '../../context/AuthContext'
import { nextBoundary, sessionState } from '../../lib/marketClock/marketClock'
import { formatTimeEt } from '../../lib/presentation/presentationPrimitives'
import { timeAgo } from '../../utils/timeAgo'
import { boardFreshness, freshnessMiddleware, panelAge } from './panelFreshness'
import styles from './TerminalShell.module.css'

const TICK_MS = 15_000

/** A component-local clock: re-renders ONLY the component that calls it. */
function useNow(tickMs = TICK_MS) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), tickMs)
    return () => clearInterval(t)
  }, [tickMs])
  return now
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

const SESSION_WORDS = { pre: 'Pre-market', regular: 'Market open', post: 'After hours', closed: 'Market closed' }

/** Pure: the session words the strip prints (S11 decides; this only names its answer). */
export function sessionText(now = new Date()) {
  const s = sessionState(now)
  const next = nextBoundary(now)
  const head = s.holidayName && s.session === 'closed' ? `Market closed (${s.holidayName})` : SESSION_WORDS[s.session]
  const tail = next ? `${next.label} ${formatTimeEt(next.at, { zoneSuffix: 'ET' })}` : null
  return { session: s.session, head, tail }
}

/** Pure: the freshness words for the strip. */
export function freshnessText({ stale, unreported, judged }) {
  if (!judged) return { tone: 'muted', text: 'No data panels' }
  if (stale) return { tone: 'warn', text: `${stale} panel${stale === 1 ? '' : 's'} past due` }
  if (unreported === judged) return { tone: 'muted', text: 'Data as-of not reported yet' }
  if (unreported) return { tone: 'ok', text: `Data fresh · ${unreported} not reported` }
  return { tone: 'ok', text: 'Data fresh' }
}

const alertsFetcher = ([url]) => fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : []))

function useUnreadAlerts() {
  const userId = useContext(AuthContext)?.user?.id ?? null
  const { data } = useSWR(userId ? ['/api/alerts?limit=20', userId] : null, alertsFetcher)
  return Array.isArray(data) ? data.filter((a) => !a.read).length : null
}

/** V7 — the L0 strip. `panels` = the visible panels as `{ id, name }` (resolved panel names);
 *  `channel` = the active channel record or null; `sym` its security. */
export function StatusStrip({ panels, store, channel, sym }) {
  const now = useNow()
  const online = useOnline()
  const unread = useUnreadAlerts()
  const ses = sessionText(now)
  const fresh = freshnessText(boardFreshness(panels, store, { now }))
  return (
    <div className={styles.strip} role="status" aria-label="Terminal status" data-testid="terminal-strip">
      <span className={styles.stripItem} data-testid="terminal-strip-session" data-session={ses.session}>
        <span className={styles.stripDot} data-tone={ses.session === 'regular' ? 'ok' : 'muted'} aria-hidden="true" />
        {ses.head}
        {ses.tail && <span className={styles.stripSub}> · {ses.tail}</span>}
      </span>
      <span className={styles.stripItem} data-testid="terminal-strip-clock">{formatTimeEt(now, { zoneSuffix: 'ET' })}</span>
      <span className={styles.stripItem} data-testid="terminal-strip-freshness" data-tone={fresh.tone}>{fresh.text}</span>
      <span className={styles.stripItem} data-testid="terminal-strip-connection" data-tone={online ? 'ok' : 'warn'}>
        {online ? 'Online' : 'Offline — showing the last data received'}
      </span>
      {channel && (
        <span className={styles.stripItem} data-testid="terminal-strip-channel" style={{ '--dot': channel.color || 'var(--border)' }}>
          <span className={styles.stripChannelDot} aria-hidden="true" />
          {channel.name}: {sym || 'no security'}
        </span>
      )}
      {unread != null && (
        <span className={styles.stripItem} data-testid="terminal-strip-alerts" data-tone={unread ? 'warn' : 'muted'}>
          {unread ? `${unread > 9 ? '9+' : unread} unread alert${unread === 1 ? '' : 's'}` : 'No unread alerts'}
        </span>
      )}
    </div>
  )
}

/** V8 — the SWR scope one panel's subtree renders inside. */
export function PanelFreshness({ store, panelId, children }) {
  const value = useMemo(() => ({ use: [freshnessMiddleware(store, panelId)] }), [store, panelId])
  return <SWRConfig value={value}>{children}</SWRConfig>
}

/** V8 — the as-of clause in a panel header. Re-renders when ITS panel fetches, and on its
 *  own tick so a panel that stops fetching crosses its threshold without a new fetch. */
export function PanelAsOf({ store, panelId, name }) {
  const asOf = useSyncExternalStore(
    (fn) => store.subscribe(panelId, fn),
    () => store.get(panelId),
    () => store.get(panelId),
  )
  const now = useNow()
  const v = panelAge(name, asOf, { now })
  if (!v) return null
  if (v.reason === 'no_timestamp') {
    return (
      <span className={styles.asOf} data-testid={`terminal-asof-${panelId}`} data-state="unreported"
        title="This panel has not reported a data fetch the terminal can see">as-of not reported</span>
    )
  }
  const at = formatTimeEt(asOf, { zoneSuffix: 'ET' })
  return v.mustShow ? (
    <span className={`${styles.asOf} ${styles.asOfStale}`} role="note" data-testid={`terminal-asof-${panelId}`} data-state="stale"
      title={`Older than this ${v.cadence} panel may show silently`}>
      as of {at} · {timeAgo(asOf)}
    </span>
  ) : (
    <span className={styles.asOf} data-testid={`terminal-asof-${panelId}`} data-state="fresh">as of {at}</span>
  )
}

/** P14a — a tab per stored panel (1..count), the add-a-panel tab, and the Layout door. */
export function PanelSwitcher({ panels, focus, count, maxVisible, labelOf, onFocus, onAdd, onLayout }) {
  return (
    <div className={styles.switcher} role="tablist" aria-label="Panels" data-testid="terminal-switcher">
      {panels.map((p, i) => (
        <button key={p.id} type="button" role="tab" aria-selected={i === focus}
          className={`${styles.switchTab} ${i === focus ? styles.switchTabOn : ''}`}
          onClick={() => onFocus(i)} data-testid={`terminal-switch-${i}`}>
          <span className={styles.switchNum}>{i + 1}</span>
          <span className={styles.code}>{labelOf(p) || 'empty'}</span>
        </button>
      ))}
      {count < maxVisible && (
        <button type="button" className={styles.switchTab} onClick={onAdd}
          aria-label="Add a panel" data-testid="terminal-switch-add">+</button>
      )}
      <button type="button" className={styles.switchTab} onClick={onLayout} data-testid="terminal-switch-layout">Layout</button>
    </div>
  )
}
