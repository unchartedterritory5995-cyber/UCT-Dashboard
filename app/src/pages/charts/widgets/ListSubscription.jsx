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
// First (and only) source kind: `scan` — a Scanner widget's preset scan, published by
// ScannerResults on `list-ref:<colour>`. The next kinds (themes, saved screens) add a
// resolver to SOURCE_RESOLVERS; a kind with no resolver is "unavailable", by name.
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
}
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
export function subscriptionLine(sub, { state, count, readAt } = {}) {
  const label = sub?.label || sub?.value || 'this list'
  if (sub?.mode === SUB_MODE.FREEZE) {
    return `Frozen copy of ${label} · taken ${fmtEt(sub.at)} · ${plural(count ?? (sub.symbols || []).length)} · does not update`
  }
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
        ? `Tracking ${label} · live · the source holds no stocks right now`
        : `Tracking ${label} · live · ${plural(count)} · read ${fmtEt(readAt)}`
  }
}

/**
 * The offer: shown above the list picker while this widget's colour group holds a list
 * it can subscribe to. Two buttons, no default. Freeze reads the source once and refuses
 * (by name) to freeze what it could not read or what holds nothing.
 */
export function SubscribeOffer({ color, offered, onSubscribe }) {
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
      })
    } catch (e) {
      setErr(`Could not freeze ${label}: the source could not be read (${e.message}). Nothing was saved.`)
    } finally {
      setBusy(false)
    }
  }, [busy, endpoint, label, offered, onSubscribe])

  return (
    <div className={styles.offer} role="group" aria-label={`Use group ${color}'s list here`}>
      <div className={styles.offerText}>
        Group {color} is showing the scan <strong>{label}</strong>. Use it in this list as:
      </div>
      <div className={styles.offerBtns}>
        <button type="button" className={styles.offerBtn} onClick={track} disabled={busy}>
          Track it <span className={styles.offerHint}>follows the scan live</span>
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
  const line = subscriptionLine(sub, { state, count: symbols.length, readAt })
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
