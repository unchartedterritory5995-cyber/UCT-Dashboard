import { useEffect, useState } from 'react'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'
import { isoDayText } from './captureStamp'
import styles from './InternalCaptureEmbed.module.css'

/**
 * G-040 ruling 3 — the Model Book capture's journal renderer.
 *
 * ⭐ A REFERENCE, NOT A COPY. The capture stores the canonical stock (year +
 * symbol), the setup if one was selected, and the member's own annotation. The
 * stock and setup re-render from the Model Book store — curated, static data —
 * so a correction the firm makes there reaches the note.
 *
 * ⛔ A REMOVED ENTRY IS A TOMBSTONE, NEVER AN ERROR. When the stock (or the setup
 * the member picked) is no longer in the store, the card says so in plain words
 * with the title it was captured under, and keeps the member's annotation.
 *
 * ⛔ AND "COULD NOT READ" IS NOT "REMOVED". A failed request (offline, a paywall,
 * a 500) is a different fact from a 404 and is said differently: the entry may
 * well still exist. Reading an unreachable store as an empty one is exactly the
 * mistake this program has already paid for once.
 */

const STATE = Object.freeze({ LOADING: 'loading', OK: 'ok', REMOVED: 'removed', UNREACHABLE: 'unreachable' })

class NotFound extends Error {}

async function getJson(url, signal) {
  const res = await fetch(url, { credentials: 'include', signal })
  if (res.status === 404) throw new NotFound(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

/** Resolve a captured reference against the store: {stock, setup} | throws NotFound. */
export async function resolveModelBookRef(params, signal) {
  const year = params?.year
  const symbol = String(params?.symbol || '').toUpperCase()
  const list = await getJson(`/api/modelbook/stocks?year=${encodeURIComponent(year)}`, signal)
  const hit = (Array.isArray(list?.stocks) ? list.stocks : [])
    .find((s) => String(s?.symbol || '').toUpperCase() === symbol)
  if (!hit) throw new NotFound(symbol)
  const stock = await getJson(`/api/modelbook/stock/${encodeURIComponent(hit.id)}`, signal)
  if (!stock || stock.error) throw new NotFound(symbol)
  const wantsSetup = params.setupId != null || params.setupType
  if (!wantsSetup) return { stock, setup: null }
  const setups = Array.isArray(stock.setups) ? stock.setups : []
  // By the row it was, else by its canonical identity (type + date) — a setup the
  // firm re-saved under a new id is still the same setup.
  const setup = setups.find((s) => s?.id === params.setupId)
    || setups.find((s) => params.setupType && s?.setup_type === params.setupType && s?.label_date === params.setupDate)
  if (!setup) throw new NotFound(`${symbol} setup`)
  return { stock, setup }
}

const price = (v) => (Number.isFinite(Number(v)) && v !== null ? `$${Number(v).toFixed(2)}` : null)

export default function ModelBookEmbed({ attrs, height = 320 }) {
  const p = attrs?.params || {}
  const [state, setState] = useState({ kind: STATE.LOADING })
  const key = `${p.year}|${p.symbol}|${p.setupId ?? ''}|${p.setupType ?? ''}|${p.setupDate ?? ''}`

  useEffect(() => {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    let alive = true
    setState({ kind: STATE.LOADING })
    resolveModelBookRef(p, ctl?.signal)
      .then((got) => { if (alive) setState({ kind: STATE.OK, ...got }) })
      .catch((err) => {
        if (!alive) return
        setState({ kind: err instanceof NotFound ? STATE.REMOVED : STATE.UNREACHABLE })
      })
    return () => { alive = false; ctl?.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const title = p.title || `${p.symbol} ${p.year}`
  const annotation = p.annotation
    ? <p className={styles.annotation} data-testid="modelbook-embed-annotation">{p.annotation}</p>
    : null

  let body
  if (state.kind === STATE.REMOVED) {
    body = (
      <>
        <p className={styles.tombstone} data-testid="modelbook-embed-tombstone">
          This Model Book entry was removed.
        </p>
        <p className={styles.note}>Captured as: {title}</p>
      </>
    )
  } else if (state.kind === STATE.UNREACHABLE) {
    body = (
      <p className={styles.note} data-testid="modelbook-embed-unreachable">
        The Model Book could not be reached just now, so {title} is not shown. The entry was not
        {' '}reported removed — try again later.
      </p>
    )
  } else if (state.kind === STATE.LOADING) {
    body = <p className={styles.note}>Loading {title} from the Model Book…</p>
  } else {
    const { stock, setup } = state
    body = (
      <>
        <div className={styles.head}>
          <span className={styles.title} data-testid="modelbook-embed-title">
            {stock.symbol}{stock.company ? ` (${stock.company})` : ''} · {stock.year}
          </span>
          {Number.isFinite(stock.gain_pct) && (
            <span className={styles.sub}>{stock.gain_pct >= 0 ? '+' : ''}{Math.round(stock.gain_pct)}% that year</span>
          )}
        </div>
        {setup && (
          <dl className={styles.dl} data-testid="modelbook-embed-setup">
            <dt>Setup</dt><dd>{setup.setup_type}</dd>
            <dt>Date</dt><dd>{isoDayText(setup.label_date)}</dd>
            {setup.grade ? <><dt>Grade</dt><dd>{setup.grade}</dd></> : null}
            {price(setup.entry_price) ? <><dt>Entry</dt><dd>{price(setup.entry_price)}</dd></> : null}
            {price(setup.stop_price) ? <><dt>Stop</dt><dd>{price(setup.stop_price)}</dd></> : null}
            {price(setup.target_price) ? <><dt>Target</dt><dd>{price(setup.target_price)}</dd></> : null}
          </dl>
        )}
        {setup?.notes ? <p className={styles.note}>{setup.notes}</p> : null}
        {!setup && stock.thesis ? <p className={styles.note}>{stock.thesis}</p> : null}
      </>
    )
  }

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="modelbook-embed">
      <div className={styles.root}>
        {body}
        {annotation}
      </div>
    </div>
  )
}
