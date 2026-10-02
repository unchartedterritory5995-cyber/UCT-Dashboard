// COV-10 — a Watchlist widget SUBSCRIBES to a list its colour group publishes, and the
// member says, at import, whether the subscription is FROZEN or TRACKING.
//
//   * FREEZE — a copy of the source's members at that moment, stored in the widget's own
//     opts with the time it was taken. Never re-resolved. The widget says so.
//   * TRACK  — the source stays authoritative: re-resolved every 30s. The widget says
//     how current it is.
//
// ⛔ THERE IS NO DEFAULT MODE (the TERM-077 rule, Bloomberg's mechanism): the offer is
// two buttons and nothing is subscribed until one is pressed.
//
// ⛔ A TRACKING LIST WHOSE SOURCE CANNOT BE READ SAYS SO. It never renders as an empty
// list: with nothing ever read it shows "Source unavailable: <why>" and no table; with
// an earlier read it keeps those members and says when they were read and why the
// source is now unreadable. An empty list is shown only when the source answered that
// it holds nothing — and then the line says that, in words.
//
// Source kinds, each one resolver in SOURCE_RESOLVERS (a kind with no resolver is
// "unavailable", by name):
//   * `scan`   — a Scanner widget's preset scan, published by ScannerResults on `list-ref:<colour>`;
//   * `theme`  — the theme open in a Themes widget, published by ThemesWidget; its holdings are
//                resolved server-side through theme_db (owner + engine overlay);
//   * `screen` — one of the member's SAVED SCREENS, run on the nightly snapshot. No widget on the
//                board shows a saved screen, so the Watchlist widget offers it itself
//                (`ScreenSourceOffer`), with the same two buttons.
// The `theme` and `screen` endpoints answer 404 WITH A REASON for a source that is gone, never an
// empty list (api/routers/charts_list_sources.py).
import { useCallback, useEffect, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Watchlists from '../../Watchlists'
import { WL_COLS_LS } from '../../watchlist/watchlistTemplates'
import { SCAN_ENDPOINTS } from './scanEndpoints'
import { ChartsSymContext } from '../ChartsSymContext'
import styles from './ListSubscription.module.css'

export const SUB_MODE = Object.freeze({ FREEZE: 'freeze', TRACK: 'track' })

/** list-ref source → (value) → endpoint URL, or null when this board cannot read it. */
const SOURCE_RESOLVERS = {
  scan: (value) => SCAN_ENDPOINTS[value] || null,
  theme: (value) => (value ? `/api/charts/list-sources/theme/${encodeURIComponent(value)}` : null),
  screen: (value) => (/^[1-9]\d*$/.test(String(value ?? '')) ? `/api/charts/list-sources/screen/${value}` : null),
}

/** How each source kind is named on the offer and on a tracking line. `fresh` says what
 *  "current" means for it: a scan is live, a saved screen is its nightly result. */
const SOURCE_META = {
  scan: { noun: 'the scan', follows: 'follows the scan live', fresh: 'live' },
  theme: { noun: 'the theme', follows: "follows the theme's holdings", fresh: 'current holdings' },
  screen: { noun: 'the saved screen', follows: 'follows its nightly results', fresh: 'nightly results' },
}
const metaOf = (source) => SOURCE_META[source] || { noun: 'the list', follows: 'follows the source', fresh: 'live' }
export const SUBSCRIBABLE_SOURCES = Object.freeze(Object.keys(SOURCE_RESOLVERS))

export function endpointFor(source, value) {
  const r = SOURCE_RESOLVERS[source]
  return r ? r(value) : null
}

const NO_SYMS = []

function symsOf(data) {
  const rows = Array.isArray(data?.results) ? data.results : NO_SYMS
  const out = []
  const seen = new Set()
  for (const r of rows) {
    const s = String(r?.sym || '').trim().toUpperCase()
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

/** Read the source ONCE. Resolves `{ data }` or rejects with an Error whose message is
 *  the reason, worded for the member (it is rendered). */
async function readSource(url) {
  let res
  try {
    res = await fetch(url, { credentials: 'include' })
  } catch {
    throw new Error('network error')
  }
  if (!res.ok) {
    // A list-sources route says WHY in `detail` ("That saved screen no longer exists.");
    // carry it, so the member reads the reason and not only a status code.
    let detail = ''
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail.trim().replace(/\.$/, '')
    } catch { /* no body: the status is the reason */ }
    throw new Error(detail ? `HTTP ${res.status} · ${detail}` : `HTTP ${res.status}`)
  }
  let data
  try { data = await res.json() } catch { throw new Error('the answer was not readable') }
  if (!data || typeof data !== 'object' || (!Array.isArray(data.results) && data.status !== 'computing')) {
    throw new Error('the answer was not a list')
  }
  return data
}

const trackFetcher = ([url]) => readSource(url)

export function fmtEt(iso) {
  if (!iso) return ''
  try {
    return `${new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })} ET`
  } catch { return '' }
}

const plural = (n) => `${n} ${n === 1 ? 'stock' : 'stocks'}`
/** A source that matched more than one page says so: never a silent partial list. */
const countText = (n, total) => (Number.isInteger(total) && total > n ? `${plural(n)} (the first ${n} of ${total})` : plural(n))

/**
 * What a TRACKING list may claim, from what the source read returned. Pure.
 *   unavailable — nothing has ever been read (unknown source, or every read failed)
 *   stale       — the latest read failed; earlier members are still on screen
 *   loading     — the first read is in flight
 *   building    — the source answered "computing" with nothing yet
 *   live        — the source answered with a list (possibly empty — said in words)
 */
export function trackState({ endpoint, data, error }) {
  if (!endpoint) return { kind: 'unavailable', reason: 'it is not a list this board can read any more' }
  if (error && !data) return { kind: 'unavailable', reason: `it could not be read (${error.message || 'error'})` }
  if (error && data) return { kind: 'stale', reason: error.message || 'error' }
  if (!data) return { kind: 'loading' }
  if (data.status === 'computing' && symsOf(data).length === 0) return { kind: 'building' }
  return { kind: 'live' }
}

/** The one-line statement the widget makes about its subscription. Pure. */
export function subscriptionLine(sub, { state, count, readAt, total } = {}) {
  const label = sub?.label || sub?.value || 'this list'
  if (sub?.mode === SUB_MODE.FREEZE) {
    return `Frozen copy of ${label} · taken ${fmtEt(sub.at)} · ${countText(count ?? (sub.symbols || []).length, sub.total)} · does not update`
  }
  const fresh = metaOf(sub?.source).fresh
  switch (state?.kind) {
    case 'unavailable':
      return `Tracking ${label} · SOURCE UNAVAILABLE: ${state.reason}. Nothing is shown because nothing could be read; this is not an empty list.`
    case 'stale':
      return `Tracking ${label} · SOURCE UNREADABLE (${state.reason}) · showing the ${plural(count)} last read ${fmtEt(readAt)}`
    case 'loading':
      return `Tracking ${label} · reading the source…`
    case 'building':
      return `Tracking ${label} · the source is still building; nothing to show yet`
    default:
      return count === 0
        ? `Tracking ${label} · ${fresh} · the source holds no stocks right now`
        : `Tracking ${label} · ${fresh} · ${countText(count, total)} · read ${fmtEt(readAt)}`
  }
}

/**
 * The offer: shown above the list picker while this widget's colour group holds a list
 * it can subscribe to. Two buttons, no default. Freeze reads the source once and refuses
 * (by name) to freeze what it could not read or what holds nothing.
 */
export function SubscribeOffer({ color, offered, onSubscribe, intro = null }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const label = offered.label || offered.value
  const endpoint = endpointFor(offered.source, offered.value)

  const track = useCallback(() => {
    onSubscribe({ mode: SUB_MODE.TRACK, source: offered.source, value: offered.value, label, at: new Date().toISOString() })
  }, [offered, label, onSubscribe])

  const freeze = useCallback(async () => {
    if (busy) return
    setErr(null)
    if (!endpoint) { setErr(`Could not freeze ${label}: it is not a list this board can read. Nothing was saved.`); return }
    setBusy(true)
    try {
      const data = await readSource(endpoint)
      const symbols = symsOf(data)
      if (!symbols.length) {
        setErr(`${label} holds no stocks right now${data.status === 'computing' ? ' (still building)' : ''}, so there is nothing to freeze. Nothing was saved.`)
        return
      }
      onSubscribe({
        mode: SUB_MODE.FREEZE, source: offered.source, value: offered.value, label,
        at: new Date().toISOString(), asOf: data.as_of || null, symbols,
        ...(Number.isInteger(data.total) && data.total > symbols.length ? { total: data.total } : {}),
      })
    } catch (e) {
      setErr(`Could not freeze ${label}: the source could not be read (${e.message}). Nothing was saved.`)
    } finally {
      setBusy(false)
    }
  }, [busy, endpoint, label, offered, onSubscribe])

  const meta = metaOf(offered.source)
  return (
    <div className={styles.offer} role="group" aria-label={intro ? `Use ${label} here` : `Use group ${color}'s list here`}>
      <div className={styles.offerText}>
        {intro || `Group ${color} is showing ${meta.noun}`} <strong>{label}</strong>. Use it in this list as:
      </div>
      <div className={styles.offerBtns}>
        <button type="button" className={styles.offerBtn} onClick={track} disabled={busy}>
          Track it <span className={styles.offerHint}>{meta.follows}</span>
        </button>
        <button type="button" className={styles.offerBtn} onClick={freeze} disabled={busy}>
          {busy ? 'Freezing…' : 'Freeze a copy'} <span className={styles.offerHint}>its stocks as of now, never changes</span>
        </button>
      </div>
      {err && <div className={styles.offerErr} role="alert">{err}</div>}
    </div>
  )
}

/** A subscribed list: the statement line, then the real watchlist table in scan mode. */
export function SubscribedList({ sub, activeRef, widgetKey, scopedSymContext, settingsOverride, onSettingsPersist, onExit }) {
  const tracking = sub.mode === SUB_MODE.TRACK
  const endpoint = tracking ? endpointFor(sub.source, sub.value) : null
  // ⛔ A TUPLE KEY, never the bare URL: ScannerResults polls that URL with a fetcher that
  // maps a failure to `null` data, and a shared SWR cache entry would hand this list a
  // null it cannot tell from "still loading". Same server cost (the server recomputes at
  // most ~once a minute); a distinct cache entry whose failure is an error.
  const { data, error } = useMobileSWR(
    tracking && endpoint ? [endpoint, 'cov10-track'] : null,
    trackFetcher,
    { refreshInterval: 30_000, dedupingInterval: 15_000, revalidateOnFocus: false },
  )
  const state = tracking ? trackState({ endpoint, data, error }) : null

  // When the members on screen were read. Stamped when a read lands, kept through a
  // later failed read so a stale list can say how old it is.
  const [readAt, setReadAt] = useState(null)
  useEffect(() => { if (data) setReadAt(new Date().toISOString()) }, [data])

  const trackedSyms = useMemo(() => symsOf(data), [data])
  const symbols = tracking ? trackedSyms : (Array.isArray(sub.symbols) ? sub.symbols : NO_SYMS)
  const total = tracking && Number.isInteger(data?.total) ? data.total : undefined
  const line = subscriptionLine(sub, { state, count: symbols.length, readAt, total })
  const unavailable = state?.kind === 'unavailable'
  const warn = unavailable || state?.kind === 'stale'

  return (
    <div className={styles.wrap} data-sub-mode={sub.mode} data-sub-state={state?.kind || 'frozen'}>
      <div className={`${styles.line}${warn ? ' ' + styles.lineWarn : ''}`} role={warn ? 'alert' : undefined}>
        <span className={styles.badge}>{tracking ? 'TRACKING' : 'FROZEN'}</span>
        <span className={styles.lineText}>{line}</span>
      </div>
      {unavailable ? (
        <div className={styles.unavailable}>
          <button type="button" className={styles.backBtn} onClick={onExit}>‹ Lists</button>
        </div>
      ) : (
        <div className={styles.body}>
          <ChartsSymContext.Provider value={scopedSymContext}>
            <Watchlists
              embedded
              pickList="__scan__"
              scanSymbols={symbols}
              pickName={sub.label || sub.value}
              backLabel="‹ Lists"
              onExitPick={onExit}
              activeRef={activeRef}
              widgetKey={widgetKey}
              colStorageKey={`${WL_COLS_LS}.listSub`}
              settingsOverride={settingsOverride}
              onSettingsPersist={onSettingsPersist}
              scanEmptyText={state?.kind === 'loading' ? 'Loading…'
                : state?.kind === 'building' ? 'The source is still building.'
                  : 'The source holds no stocks right now.'}
            />
          </ChartsSymContext.Provider>
        </div>
      )}
    </div>
  )
}

/**
 * COV-10 follow-up — offer one of the member's SAVED SCREENS as a list source. Collapsed to one
 * button until asked (no request is made before that). Then the member's screens, and once one
 * is chosen the same two-button SubscribeOffer, no default. A screens list that cannot be read
 * says why, by name; it is never shown as "no screens".
 */
export function ScreenSourceOffer({ onSubscribe }) {
  const [phase, setPhase] = useState('closed') // closed | loading | ready | error
  const [screens, setScreens] = useState([])
  const [why, setWhy] = useState('')
  const [chosen, setChosen] = useState(null)

  const open = useCallback(async () => {
    setPhase('loading')
    let res
    try {
      res = await fetch('/api/screener/saved-screens', { credentials: 'include' })
    } catch {
      setWhy('Your saved screens could not be read (network error).'); setPhase('error'); return
    }
    if (res.status === 402) { setWhy('Saved screens need a paid plan.'); setPhase('error'); return }
    let body = null
    try { body = await res.json() } catch { body = null }
    if (!res.ok || !Array.isArray(body?.saved)) {
      setWhy(`Your saved screens could not be read (${res.ok ? 'the answer was not a list' : `HTTP ${res.status}`}).`)
      setPhase('error'); return
    }
    setScreens(body.saved); setPhase('ready')
  }, [])

  if (phase === 'closed') {
    return (
      <div className={styles.offer}>
        <button type="button" className={styles.offerBtn} onClick={open}>
          Track or freeze one of my saved screens…
        </button>
      </div>
    )
  }
  return (
    <div className={styles.offer} data-testid="screen-source-offer">
      {phase === 'loading' && <div className={styles.offerText}>Reading your saved screens…</div>}
      {phase === 'error' && <div className={styles.offerErr} role="alert">{why}</div>}
      {phase === 'ready' && screens.length === 0 && (
        <div className={styles.offerText}>You have no saved screens yet. Save one in the Screener first.</div>
      )}
      {phase === 'ready' && screens.length > 0 && (
        <label className={styles.offerText}>
          Saved screen{' '}
          <select aria-label="Saved screen" value={chosen?.value || ''}
            onChange={(e) => {
              const s = screens.find(x => String(x.id) === e.target.value)
              setChosen(s ? { source: 'screen', value: String(s.id), label: s.name } : null)
            }}>
            <option value="">Choose…</option>
            {screens.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
        </label>
      )}
      {chosen && (
        <SubscribeOffer key={chosen.value} offered={chosen} onSubscribe={onSubscribe} intro="Your saved screen" />
      )}
    </div>
  )
}
