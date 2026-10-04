// ALRT — the alert centre (TERMINAL-NEXT gap 6).
//
// ONE read (`GET /api/terminal/alerts`, api/services/alert_centre.py) lists every alert the
// member owns across the four stores — price, indicator, screen (FT-027) and the S7 taxonomy
// (whose `document-arrival` rows are their FILING WATCH) — plus recent fires from `alert_fires`,
// the durable record (never `user_alerts`).
//
// ⛔ EVERY WRITE GOES THROUGH THE ENDPOINT THAT ALREADY OWNS THE ROW (`actionRequest`):
//   price      create  POST /api/watchlist-alerts           delete  DELETE /api/watchlist-alerts/:id
//   indicator  pause/resume POST /api/indicator-alerts/:id/toggle   delete DELETE /api/indicator-alerts/:id
//   screen     pause/resume POST /api/screener/spec-alerts/:id/suspend|resume   (never deleted)
//   filing     pause  DELETE /api/alerts/taxonomy/document-arrival/:id  (SUSPENDS, keeps the row)
//              resume POST   /api/alerts/taxonomy/document-arrival {ticker}  (reactivates, A3)
// No row is offered an action its owner has no endpoint for (a price alert has no pause; a
// screen alert is never deleted; other S7 types are managed where they were created).
// ⛔ A DELETE IS TWO TAPS: the member's own explicit action on their own row, confirmed.
// ⛔ A SECTION THAT COULD NOT BE READ SAYS SO. An outage never reads as "you have no alerts".
import { useCallback, useEffect, useMemo, useState } from 'react'
import jsonFetcher from '../../../utils/jsonFetcher'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import FieldError from '../../../components/ui/FieldError'
import {
  formatDateTimeEt, formatNumberMax, formatPriceDisclosure,
} from '../../../lib/presentation/presentationPrimitives'
import styles from './AlertCentrePanel.module.css'

export const ALERTS_URL = '/api/terminal/alerts'
export const FILING_TYPE = 'document-arrival'

const KIND_LABEL = {
  price: 'Price alerts', indicator: 'Indicator alerts', screen: 'Screen alerts',
  filing: 'Filing watch', s7: 'Other alerts',
}
export const KIND_ORDER = ['price', 'indicator', 'screen', 'filing', 's7']
const STATE_LABEL = { active: 'Armed', paused: 'Paused', fired: 'Fired' }
const UNREAD_LABEL = {
  price: 'price alerts', indicator: 'indicator alerts', screen: 'screen alerts',
  s7: 'filing watches and other alerts',
}

/** SQLite `CURRENT_TIMESTAMP` text ("YYYY-MM-DD HH:MM:SS", UTC) or epoch seconds → epoch seconds. */
export function toEpoch(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${String(v).replace(' ', 'T')}Z`)
  return Number.isFinite(ms) ? ms / 1000 : null
}

function priceRow(a) {
  const kindWord = a.alert_type === 'trendline' ? 'trendline' : a.alert_type === 'line' ? 'line' : 'price'
  return {
    key: `price:${a.id}`, kind: 'price', id: a.id, sym: a.sym,
    text: `${a.sym} ${a.direction} ${formatPriceDisclosure(a.target_price)}`,
    meta: kindWord === 'price' ? 'Price alert' : `Bound to a chart ${kindWord}`,
    state: a.is_active ? 'active' : 'fired',
    at: toEpoch(a.is_active ? a.created_at : (a.triggered_at || a.created_at)),
    actions: ['delete'],
  }
}

function indicatorRow(a) {
  const what = a.instance_label || a.indicator
  const thr = a.threshold == null ? '' : ` ${formatNumberMax(a.threshold)}`
  return {
    key: `indicator:${a.id}`, kind: 'indicator', id: a.id, sym: a.sym,
    text: `${a.sym} ${what} ${a.condition}${thr}`,
    meta: `Timeframe ${a.tf}`,
    state: a.active ? 'active' : 'paused',
    at: toEpoch(a.created_at),
    actions: [a.active ? 'pause' : 'resume', 'delete'],
  }
}

function screenRow(a) {
  return {
    key: `screen:${a.id}`, kind: 'screen', id: a.id, sym: null,
    text: a.name || 'Untitled screen',
    meta: `Nightly · told when names ${a.mode === 'enter' ? 'enter' : a.mode === 'leave' ? 'leave' : 'enter or leave'}`,
    state: a.suspended ? 'paused' : 'active',
    at: toEpoch(a.created_at),
    actions: [a.suspended ? 'resume' : 'pause'],
  }
}

function s7Row(p) {
  const scope = p.entity_scope || {}
  const sym = scope.symbol || null
  const filing = p.type_id === FILING_TYPE
  const params = p.params || {}
  const form = filing && params.form_type ? ` (${params.form_type})` : ''
  return {
    key: `s7:${p.id}`, kind: filing ? 'filing' : 's7', id: p.id, sym,
    text: filing ? `${sym || scope.id} new SEC filings${form}` : `${p.type_id} · ${sym || scope.id || p.id}`,
    meta: filing ? 'Filing watch' : 'Managed where it was created',
    state: p.suspended_at ? 'paused' : 'active',
    at: toEpoch(p.created_at),
    actions: filing && sym ? [p.suspended_at ? 'resume' : 'pause'] : [],
  }
}

const ROWS_OF = { price: priceRow, indicator: indicatorRow, screen: screenRow, s7: s7Row }

/** Pure: the server's sections → one row list per kind, plus which sections could not be read. */
export function alertSections(data) {
  const out = Object.fromEntries(KIND_ORDER.map((k) => [k, []]))
  const unavailable = []
  for (const [section, toRow] of Object.entries(ROWS_OF)) {
    const s = data?.[section]
    if (!s || s.status === 'unavailable') { unavailable.push(section); continue }
    for (const item of Array.isArray(s.items) ? s.items : []) {
      const row = toRow(item)
      out[row.kind].push(row)
    }
  }
  return { rows: out, unavailable, screenOff: data?.screen?.status === 'not_enabled' }
}

/** Pure: the EXISTING endpoint a row action goes through. null = this row has no such action. */
export function actionRequest(row, action) {
  if (!row || !row.actions.includes(action)) return null
  const id = encodeURIComponent(row.id)
  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  switch (`${row.kind}:${action}`) {
    case 'price:delete': return { url: `/api/watchlist-alerts/${id}`, init: { method: 'DELETE' } }
    case 'indicator:pause':
    case 'indicator:resume': return { url: `/api/indicator-alerts/${id}/toggle`, init: { method: 'POST' } }
    case 'indicator:delete': return { url: `/api/indicator-alerts/${id}`, init: { method: 'DELETE' } }
    case 'screen:pause': return { url: `/api/screener/spec-alerts/${id}/suspend`, init: { method: 'POST' } }
    case 'screen:resume': return { url: `/api/screener/spec-alerts/${id}/resume`, init: { method: 'POST' } }
    case 'filing:pause': return { url: `/api/alerts/taxonomy/document-arrival/${id}`, init: { method: 'DELETE' } }
    case 'filing:resume': return { url: '/api/alerts/taxonomy/document-arrival', init: json({ ticker: row.sym }) }
    default: return null
  }
}

/** Pure: the create-price-alert request, or the reason it cannot be sent. */
export function priceAlertRequest(sym, direction, priceText) {
  const s = String(sym || '').trim().toUpperCase()
  if (!s) return { error: 'Link this panel to a security first.' }
  const price = Number(String(priceText || '').trim())
  if (!String(priceText || '').trim() || !Number.isFinite(price) || price <= 0) {
    return { error: 'Enter a price above zero.' }
  }
  if (direction !== 'above' && direction !== 'below') return { error: 'Choose above or below.' }
  return {
    url: '/api/watchlist-alerts',
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sym: s, target_price: price, direction }) },
  }
}

const ACTION_LABEL = { pause: 'Pause', resume: 'Resume', delete: 'Delete' }

function fireText(f) {
  const d = f.detail || {}
  const what = d.title || d.form || d.form_type || f.trigger_type
  return `${f.entity_ref || ''} ${what || ''}`.trim()
}

function channelsText(f) {
  const ch = f.delivery_channels && typeof f.delivery_channels === 'object' ? Object.keys(f.delivery_channels) : []
  return ch.length ? `Sent: ${ch.join(', ')}` : (f.delivered_at ? 'Delivered' : 'Not yet delivered')
}

function AlertRow({ row, busy, error, onAction }) {
  const [confirming, setConfirming] = useState(false)
  const at = formatDateTimeEt(row.at)
  return (
    <li className={styles.row} data-testid={`alrt-row-${row.key}`} data-state={row.state}>
      <span className={styles.state}>{STATE_LABEL[row.state]}</span>
      <span className={styles.rowMain}>
        <span className={styles.rowText}>{row.text}</span>
        <span className={styles.rowMeta}>{row.meta}{at ? ` · ${at}` : ''}</span>
        {error && <span className={styles.error} role="alert">{error}</span>}
      </span>
      <span className={styles.rowActions}>
        {row.actions.filter((a) => a !== 'delete').map((a) => (
          <button key={a} type="button" className={styles.btn} disabled={busy}
            aria-label={`${ACTION_LABEL[a]} ${row.text}`} onClick={() => onAction(row, a)}>
            {ACTION_LABEL[a]}
          </button>
        ))}
        {row.actions.includes('delete') && !confirming && (
          <button type="button" className={styles.btn} disabled={busy}
            aria-label={`Delete ${row.text}`} onClick={() => setConfirming(true)}>Delete</button>
        )}
        {confirming && (
          <>
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy}
              aria-label={`Confirm delete ${row.text}`}
              onClick={() => { setConfirming(false); onAction(row, 'delete') }}>Confirm delete</button>
            <button type="button" className={styles.btn} aria-label={`Keep ${row.text}`}
              onClick={() => setConfirming(false)}>Keep</button>
          </>
        )}
      </span>
    </li>
  )
}

function PriceAlertForm({ sym, onCreated }) {
  const [direction, setDirection] = useState('above')
  const [price, setPrice] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!sym) {
    return <p className={styles.note}>Link this panel to a security (or type <kbd>NVDA ALRT</kbd>) to create a price alert here.</p>
  }
  const submit = async (e) => {
    e.preventDefault()
    const req = priceAlertRequest(sym, direction, price)
    if (req.error) { setError(req.error); return }
    setBusy(true)
    setError(null)
    try {
      await jsonFetcher(req.url, req.init)
      setPrice('')
      onCreated()
    } catch {
      setError(`Could not create the alert for ${sym}. Nothing was saved; try again.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={styles.form} onSubmit={submit} data-testid="alrt-create">
      <div className={styles.field}>
        <label className={styles.label} htmlFor="alrt-direction">When {sym} trades</label>
        <Select id="alrt-direction" className={styles.control} value={direction}
          onChange={(e) => setDirection(e.target.value)}
          options={[{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }]} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="alrt-price">Price</label>
        <Input id="alrt-price" type="number" inputMode="decimal" step="any" min="0"
          className={styles.control} value={price} error={error || undefined}
          onChange={(e) => setPrice(e.target.value)} />
        <FieldError forId="alrt-price" className={styles.error}>{error}</FieldError>
      </div>
      <button type="submit" className={styles.btn} disabled={busy}>Add price alert for {sym}</button>
    </form>
  )
}

export default function AlertCentrePanel({ sym }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: null })
  const [busyKey, setBusyKey] = useState(null)
  const [rowErrors, setRowErrors] = useState({})

  const load = useCallback(() => {
    let live = true
    jsonFetcher(ALERTS_URL)
      .then((data) => { if (live) setState({ phase: 'ready', data, error: null }) })
      .catch((error) => { if (live) setState((s) => (s.data ? s : { phase: 'error', data: null, error })) })
    return () => { live = false }
  }, [])
  useEffect(() => load(), [load])

  const sections = useMemo(() => alertSections(state.data), [state.data])

  const onAction = useCallback(async (row, action) => {
    const req = actionRequest(row, action)
    if (!req) return
    setBusyKey(row.key)
    setRowErrors((e) => { const n = { ...e }; delete n[row.key]; return n })
    try {
      await jsonFetcher(req.url, req.init)
      load()
    } catch {
      setRowErrors((e) => ({ ...e, [row.key]: `${ACTION_LABEL[action]} did not go through. Nothing changed; try again.` }))
    } finally {
      setBusyKey(null)
    }
  }, [load])

  if (state.phase === 'loading') return <div className={styles.root}><p className={styles.note}>Loading your alerts…</p></div>
  if (state.phase === 'error') {
    const status = state.error?.status
    return (
      <div className={styles.root} role="status" data-testid="alrt-error">
        <p className={styles.note}>
          {status === 404 ? 'ALRT is not enabled for your account yet.'
            : status === 402 ? 'The alert centre is part of the paid plan.'
              : 'Could not load your alerts just now. Run ALRT again to retry.'}
        </p>
      </div>
    )
  }

  const { rows, unavailable, screenOff } = sections
  const total = KIND_ORDER.reduce((n, k) => n + rows[k].length, 0)
  const fires = state.data?.fires || {}
  const fireItems = Array.isArray(fires.items) ? fires.items : []

  return (
    <div className={styles.root} data-testid="alrt">
      <div className={styles.head}>
        <p className={styles.summary} data-testid="alrt-summary">
          {total === 0 && unavailable.length === 0 ? 'You have no alerts yet.' : `${total} alert${total === 1 ? '' : 's'}`}
        </p>
        <button type="button" className={styles.btn} onClick={load}>Refresh</button>
      </div>

      <section className={styles.section} aria-labelledby="alrt-new">
        <h3 className={styles.sectionTitle} id="alrt-new">New price alert</h3>
        <PriceAlertForm sym={sym ? String(sym).toUpperCase() : null} onCreated={load} />
      </section>

      {unavailable.length > 0 && (
        <p className={styles.warn} role="status" data-testid="alrt-unavailable">
          Could not read {unavailable.map((k) => UNREAD_LABEL[k]).join(', ')} just now.
          This is not &ldquo;none&rdquo;; refresh to retry.
        </p>
      )}

      {KIND_ORDER.map((kind) => (rows[kind].length > 0 || (kind === 'screen' && screenOff)) && (
        <section key={kind} className={styles.section} aria-labelledby={`alrt-h-${kind}`}>
          <h3 className={styles.sectionTitle} id={`alrt-h-${kind}`}>{KIND_LABEL[kind]}</h3>
          {kind === 'screen' && screenOff && <p className={styles.note}>Standing screen alerts are not switched on yet.</p>}
          <ul className={styles.list} data-testid={`alrt-list-${kind}`}>
            {rows[kind].map((row) => (
              <AlertRow key={row.key} row={row} busy={busyKey === row.key}
                error={rowErrors[row.key]} onAction={onAction} />
            ))}
          </ul>
        </section>
      ))}

      <section className={styles.section} aria-labelledby="alrt-fires">
        <h3 className={styles.sectionTitle} id="alrt-fires">Recent fires</h3>
        {fires.status === 'unavailable' && (
          <p className={styles.warn} role="status">The fire history could not be read just now. This is not &ldquo;nothing fired&rdquo;.</p>
        )}
        {fires.status === 'ok' && fireItems.length === 0 && <p className={styles.note}>Nothing has fired yet.</p>}
        <ul className={styles.list} data-testid="alrt-fires-list">
          {fireItems.map((f) => (
            <li key={f.id} className={styles.row} data-read={f.read_at ? 'true' : 'false'}>
              <span className={styles.rowMain}>
                <span className={styles.rowText}>{fireText(f)}</span>
                <span className={styles.rowMeta}>{formatDateTimeEt(f.fired_at) || ''} · {channelsText(f)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
