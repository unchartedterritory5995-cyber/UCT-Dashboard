import { useState } from 'react'
import { useSWRConfig } from 'swr'
import useDarkSection from './useDarkSection'
import { findStrategies, VIEWS } from './chainModels'
import { daysTo } from './ChainTools'
import styles from './optionsAnalytics.module.css'
import { formatPercent } from '../../lib/presentation/presentationPrimitives'

// lane/o-options-remainders — the chain-side surfaces under Research > Options:
//   FT-012 EdgePanel        theoretical value vs the quote mid    (OPTIONS_EDGE_RANKING_ENABLED)
//   FT-014 StrategyFinder   candidates per view, off this chain   (OPTIONS_STRATEGY_FINDER_ENABLED)
//   FT-072 SpreadBookPanel  the member's saved spreads            (OPTIONS_SPREAD_BOOK_ENABLED)
//
// ⛔ Each is its OWN dark surface: it reads its own route, and a 404 (switch off) or 402 renders
//    nothing. Arming one never shows another.
// ⛔ Every number is labelled computed and printed beside the server's own method sentence.
// ⛔ Read-only by charter: a candidate or a saved spread is a record, never an order.

const enc = encodeURIComponent
const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d))
// A fraction rendered as a percent through the shared formatter (em dash when absent).
const pct = (p) => formatPercent(p == null ? NaN : Number(p) * 100, { decimals: 1 })
const money = (v) => (v === Infinity || v === -Infinity ? 'unlimited' : `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString()}`)
// A candidate's identity: its expiration, view, structure and every leg (type, side, strike). The
// "Saved" tag is keyed on THIS, never on a row index -- re-sorting, or a chain refresh that reorders
// or drops a candidate, used to move the tag onto a structure that was never saved.
export const candidateKey = (view, expiration, c) =>
  [view, expiration || '', c.name, ...c.legs.map((l) => `${l.type}:${l.side}:${Number(l.strike)}`)].join('|')

const legText = (l) => `${l.side > 0 ? 'buy' : 'sell'}${Math.abs(l.side) > 1 ? ` ${Math.abs(l.side)}` : ''} ${num(l.strike)} ${l.type}`

// ── FT-012 ─────────────────────────────────────────────────────────────────────

function EdgeTable({ rows, testid }) {
  if (!rows.length) return <p className={styles.note}>None on this expiration.</p>
  return (
    <div className={styles.scroll}>
      <table className={styles.table} data-testid={testid}>
        <thead><tr><th>Contract</th><th>Mid</th><th>Theoretical</th><th>Edge</th><th>Edge %</th><th>Vendor IV</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.contract || `${r.type}-${r.strike}`}>
              <th>{r.type} {num(r.strike)}</th><td>{num(r.mid)}</td><td>{num(r.theoretical)}</td>
              <td className={r.edge >= 0 ? styles.gain : styles.loss}>{r.edge > 0 ? '+' : ''}{num(r.edge)}</td>
              <td>{r.edge_pct > 0 ? '+' : ''}{num(r.edge_pct, 1)}%</td><td>{pct(r.vendor_iv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EdgePanel({ sym, expiration }) {
  const { data, hidden, failed } = useDarkSection(sym ? `/api/research/options/${enc(sym)}/edge?expiration=${expiration || ''}` : null)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.buyer_edge))) return null
  return (
    <section className={styles.panel} data-testid="edge">
      <div className={styles.head}>
        <span className={styles.title}>Theoretical-value edge</span>
        <span className={styles.badge}>computed</span>
      </div>
      {failed ? <p className={styles.note}>The edge ranking is unavailable right now. That is a failed read, not "no edge".</p> : (
        <>
          <p className={styles.facts} data-testid="edge-inputs">
            {data.expiration}{data.days_to_expiry != null ? `, ${data.days_to_expiry} days` : ''} · 20-session realized volatility{' '}
            <b>{pct(data.realized_vol?.hv20)}</b>{data.realized_vol?.through ? ` through ${data.realized_vol.through}` : ''}
            {' '}· {data.evaluated} contracts valued
          </p>
          {data.note && <p className={styles.note} data-testid="edge-note">{data.note}</p>}
          <p className={styles.title}>Cheap against realized movement (buyer&apos;s edge)</p>
          <EdgeTable rows={data.buyer_edge} testid="edge-buyer" />
          <p className={styles.title}>Rich against realized movement (seller&apos;s edge)</p>
          <EdgeTable rows={data.seller_edge} testid="edge-seller" />
          <p className={styles.muted} data-testid="edge-history">{data.history?.win_rate_note}</p>
          <p className={styles.muted}>{data.method} Inputs: {data.inputs}.</p>
        </>
      )}
    </section>
  )
}

// ── FT-072 ─────────────────────────────────────────────────────────────────────

export const SPREAD_BOOK_URL = '/api/options/spread-book'

/** POST one spread; resolves {saved} or {error} (a sentence). */
export async function saveSpread(body) {
  let r
  try {
    r = await fetch(SPREAD_BOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return { error: 'The Spread Book could not be reached.' }
  }
  let j = null
  try { j = await r.json() } catch { /* a non-JSON body is a failure below */ }
  if (!r.ok || !j) return { error: (j && typeof j.detail === 'string') ? j.detail : `The spread was not saved (${r.status}).` }
  return { saved: j }
}

/** A finder candidate as the book's record of what was seen. */
export function spreadBody(sym, c, expiration) {
  return {
    underlying: sym, strategy: c.name, label: `${sym} ${c.name} ${expiration || ''}`.trim(),
    legs: c.legs.map((l) => ({ type: l.type, side: l.side, strike: l.strike, expiration: l.expiration || expiration, price: l.premium })),
    entry: { net: c.cost / 100, session: new Date().toISOString().slice(0, 10), source: 'strategy finder', basis: 'mid of bid and ask, one contract per leg' },
  }
}

export function SpreadBookPanel() {
  const { data, hidden, failed } = useDarkSection(SPREAD_BOOK_URL)
  const { mutate } = useSWRConfig()
  const [err, setErr] = useState(null)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.spreads))) return null
  async function remove(id) {
    setErr(null)
    let r
    try { r = await fetch(`${SPREAD_BOOK_URL}/${enc(id)}`, { method: 'DELETE' }) } catch { r = null }
    if (!r || !r.ok) setErr('That spread could not be deleted.')
    mutate(SPREAD_BOOK_URL)
  }
  return (
    <section className={styles.panel} data-testid="spread-book">
      <div className={styles.head}>
        <span className={styles.title}>Spread Book</span>
        <span className={styles.badge}>saved</span>
        {data && <span className={styles.muted}>{data.count} of {data.max}</span>}
      </div>
      {failed ? <p className={styles.note}>The Spread Book is unavailable right now. That does not mean it is empty.</p> : (
        <>
          {data.spreads.length ? (
            <ul className={styles.list}>
              {data.spreads.map((s) => (
                <li key={s.id} data-testid="spread-book-row">
                  <b>{s.label}</b>: {s.legs.map((l) => `${legText(l)} ${l.expiration}${l.price != null ? ` @ ${num(l.price)}` : ''}`).join(' / ')}
                  {s.entry?.net != null ? ` · ${s.entry.net < 0 ? 'credit' : 'debit'} ${num(Math.abs(s.entry.net))}` : ''}
                  <span className={styles.muted}> · seen {s.entry?.session || s.created_at.slice(0, 10)}</span>
                  <button type="button" className={styles.input} aria-label={`Delete ${s.label}`} onClick={() => remove(s.id)}>×</button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.note}>No saved spreads yet. Save one from the strategy finder.</p>}
          {err && <p className={styles.note}>{err}</p>}
          <p className={styles.muted}>{data.basis}</p>
        </>
      )}
    </section>
  )
}

// ── FT-014 ─────────────────────────────────────────────────────────────────────

export function StrategyFinder({ sym, rows, spot, expiration, atmIv }) {
  const { data, hidden, failed } = useDarkSection(sym ? `/api/research/options/${enc(sym)}/strategy-finder` : null)
  const book = useDarkSection(SPREAD_BOOK_URL)
  const { mutate } = useSWRConfig()
  const [view, setView] = useState('bullish')
  const [sort, setSort] = useState('pop')
  const [saved, setSaved] = useState({})
  if (hidden || (!data && !failed) || (data && !data.views)) return null
  const days = daysTo(expiration)
  const found = data ? findStrategies(view, rows, { spot, iv: Number(atmIv), days, sort }) : null
  const canSave = Array.isArray(book.data?.spreads)
  async function onSave(c) {
    const k = candidateKey(view, expiration, c)
    const out = await saveSpread(spreadBody(sym, c, expiration))
    setSaved((prev) => ({ ...prev, [k]: out.error || 'Saved to the Spread Book.' }))
    if (!out.error) mutate(SPREAD_BOOK_URL)
  }
  return (
    <section className={styles.panel} data-testid="strategy-finder">
      <div className={styles.head}>
        <span className={styles.title}>Strategy finder</span>
        <span className={styles.badge}>computed</span>
        <span className={styles.seg} role="group" aria-label="Market view">
          {VIEWS.map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}
        </span>
        <select className={styles.select} aria-label="Sort candidates" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="pop">by probability of profit</option>
          <option value="reward">by reward to risk</option>
        </select>
      </div>
      {failed ? <p className={styles.note}>The strategy finder is unavailable right now.</p> : (
        <>
          <p className={styles.muted}>{data.views[view]}</p>
          {found.candidates.length ? (
            <div className={styles.scroll}>
              <table className={styles.table} data-testid="finder-candidates">
                <thead><tr><th>Structure</th><th>Legs</th><th>Net</th><th>Max profit</th><th>Max loss</th><th>Breakeven</th><th>PoP</th>{canSave && <th />}</tr></thead>
                <tbody>
                  {found.candidates.slice(0, 12).map((c) => {
                    const k = candidateKey(view, expiration, c)
                    return (
                    <tr key={k}>
                      <th>{c.name}</th>
                      <td>{c.legs.map(legText).join(' / ')}</td>
                      <td>{c.cost >= 0 ? `pay ${money(c.cost)}` : `collect ${money(-c.cost)}`}</td>
                      <td>{money(c.maxProfit)}</td><td>{money(c.maxLoss)}</td>
                      <td>{c.breakevens.map((b) => b.toFixed(2)).join(' / ') || '—'}</td>
                      <td>{pct(c.pop)}</td>
                      {canSave && (
                        <td>
                          {saved[k]
                            ? <span className={styles.muted}>{saved[k]}</span>
                            : <button type="button" className={styles.input} onClick={() => onSave(c)}>Save</button>}
                        </td>
                      )}
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className={styles.note}>No {view} structure could be priced off this chain.</p>}
          {found.skipped > 0 && (
            <p className={styles.muted} data-testid="finder-skipped">
              {found.skipped} structure{found.skipped === 1 ? '' : 's'} left out: a leg had no two-sided quote.
            </p>
          )}
          <p className={styles.muted}>{data.method} {data.assumptions}</p>
        </>
      )}
    </section>
  )
}
