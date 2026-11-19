// UPDG: analyst upgrades, downgrades and price-target changes, market-wide (data wave 1).
//
// ⭐ NO NEW ROUTE. `GET /api/analyst-actions` (api/routers/engine_data.py over
// api/services/engine.py `get_analyst_actions`) answers
//   { upgrades: [...], downgrades: [...], pt_changes: [...], summary: { upgrades, downgrades, pt_changes } }
// from the `analyst_actions` list of the last morning wire pushed to this server. Each item is
// `{ ticker, action, firm, from_rating, to_rating, price_target }`. The server sorts by the action
// word (upgrade / upgraded / initiates / initiated; downgrade / downgraded; raises pt / lowers pt)
// and keeps at most 12 upgrades, 12 downgrades and 15 target changes. No screen read it before this.
//
// ⛔ THE ROUTE DOES NOT SAY WHICH MORNING THE LIST IS FROM. It is cached for an hour and dropped
// when a wire is pushed, but until today's wire lands it serves the PREVIOUS wire's list (the wire
// file persists), and the payload carries no date. So this panel never calls the list "today's":
// it reports a date only when the payload has one (`wire_date` / `date` / `generated_at` at the top,
// or an item's own `at`), and otherwise says the list is undated and when it is replaced.
// ⛔ A failed read is an error with Retry, never "no analyst actions".
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCurrency, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { ariaSortFor, nextSort, sortCaretFor, sortRows } from '../../../lib/presentation/dataGrid'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import styles from './marketPanels.module.css'

export const UPGRADES_URL = '/api/analyst-actions'
const POLL_MS = 5 * 60 * 1000
const SOURCE = 'UCT morning wire (analyst actions)'

/** The kinds the list can be cut by. `bucket` is the payload key; `token` is what the chip writes
 *  into the command (`UPDG UP`); `cap` is the most the server keeps of that kind. */
export const UPGRADE_KINDS = Object.freeze({
  all: { chip: 'All', plural: 'analyst actions', bucket: null, token: null, cap: null },
  upgrades: { chip: 'Upgrades', plural: 'upgrades', bucket: 'upgrades', token: 'UP', cap: 12 },
  downgrades: { chip: 'Downgrades', plural: 'downgrades', bucket: 'downgrades', token: 'DOWN', cap: 12 },
  targets: { chip: 'Target changes', plural: 'target changes', bucket: 'pt_changes', token: 'PT', cap: 15 },
})
const KIND_WORDS = {
  ALL: 'all',
  UP: 'upgrades', UPGRADE: 'upgrades', UPGRADES: 'upgrades',
  DOWN: 'downgrades', DN: 'downgrades', DOWNGRADE: 'downgrades', DOWNGRADES: 'downgrades',
  PT: 'targets', TARGET: 'targets', TARGETS: 'targets',
}

/** Pure: the kind a prop or a typed word names; anything unknown is the whole list. */
export function normKind(raw) {
  return KIND_WORDS[String(raw ?? '').trim().toUpperCase()] || 'all'
}
/** Pure: the arguments a kind writes into the panel's command (the whole list is the bare command). */
export const upgradesCommandArgs = (kind) => (UPGRADE_KINDS[normKind(kind)].token ? [UPGRADE_KINDS[normKind(kind)].token] : [])

/** The action word the wire sends, as a member reads it. `tone` is the direction of the call. */
const ACTIONS = {
  upgrade: { label: 'Upgrade', tone: 'up' },
  upgraded: { label: 'Upgrade', tone: 'up' },
  initiates: { label: 'New coverage', tone: null },
  initiated: { label: 'New coverage', tone: null },
  downgrade: { label: 'Downgrade', tone: 'down' },
  downgraded: { label: 'Downgrade', tone: 'down' },
  'raises pt': { label: 'Target raised', tone: 'up' },
  'lowers pt': { label: 'Target lowered', tone: 'down' },
}
const text = (v) => String(v ?? '').trim()
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '')
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Pure: a price target as a number (`120`, `"$1,250.50"`), or null when it is not one number. */
export function targetNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  const s = text(raw).replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

/** Pure: a date or time the payload sent, as a calendar date (`2026-11-16`) or an ISO instant, or
 *  null. A time zone is never guessed. */
export function stampOf(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString()
  }
  const s = text(raw)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  // A clock time with no zone (`2026-11-16 07:40:00`) could be Eastern or the wire machine's own:
  // only its calendar date is kept.
  const naive = /^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}/.exec(s)
  return naive ? naive[1] : null
}

/**
 * Pure: the payload as rows, in the server's order (upgrades, then downgrades, then target changes).
 * Each row: `{ key, order, kind, sym, firm, action, tone, from, to, rating, target, targetText, at }`.
 * `counts` is per kind; `builtOn` is the date or instant the payload gives for the list (its own
 * top-level date, else the newest item time), or null; `wireStatus` is the server's own verdict on
 * that date (`fresh` / `stale` / `unknown`) when it sends one.
 */
export function analystActions(body) {
  const rows = []
  for (const [kind, meta] of Object.entries(UPGRADE_KINDS)) {
    if (!meta.bucket) continue
    for (const a of (Array.isArray(body?.[meta.bucket]) ? body[meta.bucket] : [])) {
      const sym = text(a?.ticker).toUpperCase()
      if (!sym) continue
      const word = text(a.action).toLowerCase()
      const known = ACTIONS[word]
      const from = text(a.from_rating) || null
      const to = text(a.to_rating) || null
      const target = targetNumber(a.price_target)
      rows.push({
        key: `${kind}-${sym}-${text(a.firm)}-${rows.length}`,
        order: rows.length,
        kind,
        sym,
        firm: text(a.firm) || null,
        action: known ? known.label : sentence(word) || 'Not given',
        tone: known ? known.tone : null,
        from,
        to,
        rating: from && to ? `${from} to ${to}` : to || (from ? `From ${from}` : null),
        target,
        targetText: target == null ? text(a.price_target) || null : null,
        at: stampOf(a.at),
      })
    }
  }
  const counts = { all: rows.length, upgrades: 0, downgrades: 0, targets: 0 }
  for (const r of rows) counts[r.kind] += 1
  const newestAt = rows.reduce((best, r) => (r.at && (!best || r.at > best) ? r.at : best), null)
  const status = text(body?.wire_status).toLowerCase()
  return {
    rows,
    counts,
    builtOn: stampOf(body?.wire_date) || stampOf(body?.date) || stampOf(body?.generated_at) || newestAt,
    wireStatus: ['fresh', 'stale', 'unknown'].includes(status) ? status : null,
  }
}

/** Pure: the rows of one kind (`all` is every row), order kept. */
export const rowsOfKind = (rows, kind) => (normKind(kind) === 'all' ? rows : rows.filter((r) => r.kind === normKind(kind)))

const COLUMNS = [
  { key: 'sym', label: 'Symbol', title: 'Click a symbol to load it into the linked panels' },
  { key: 'firm', label: 'Firm', phoneHide: true },
  { key: 'action', label: 'Action' },
  { key: 'rating', label: 'Rating', title: 'The rating before and after, where the firm gave both' },
  { key: 'target', label: 'Price target' },
]
const valueOf = (key, r) => r[key]
const isNumeric = (key) => key === 'target' || key === 'order'
const firstDirFor = (key) => (key === 'target' ? 'desc' : 'asc')
const byOrder = (a, b) => a.order - b.order
const LIST_ORDER = { key: 'order', dir: 'asc' }

export default function UpgradesPanel({ kind: kindProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const read = useMarketRead(UPGRADES_URL, { refreshInterval: POLL_MS })
  const base = useMemo(() => analystActions(read.body), [read.body])
  // A new `UPDG DOWN` remounts the panel (the shell keys the body on code + args), so the typed
  // kind only ever seeds the state.
  const [kind, setKind] = useState(() => normKind(kindProp))
  const [sort, setSort] = useState(LIST_ORDER)
  const rows = useMemo(() => sortRows(rowsOfKind(base.rows, kind), sort, { valueOf, isNumeric, tiebreak: byOrder }), [base.rows, kind, sort])
  const report = panelAsOf(SOURCE, base.builtOn)
  const builtText = report.age?.asOfDate || null
  usePanelFreshness(base.rows.length ? report : null)
  usePanelSymbolRows(rows.map((r) => r.sym), UPGRADE_KINDS[kind].plural, { total: base.counts[kind] })

  // The chip writes itself into the command (`UPDG DOWN`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => { setKind(next); writeBack(upgradesCommandArgs(next)) }

  if (read.loading) return <PanelSkeleton label="Loading analyst actions" testId="terminal-updg-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, 'Analyst actions')} testId="terminal-updg-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no analyst actions. Retry${inPanel?.code ? `, or run ${inPanel.code} again` : ''}.`}
      </PanelState>
    )
  }
  if (!base.rows.length) {
    return (
      <PanelState kind="empty" title="No analyst actions to show yet." testId="terminal-updg-empty"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Check again</button>}>
        The list comes with the morning wire, before the open on trading days, and it is empty until a wire arrives. This
        panel checks again every few minutes.
      </PanelState>
    )
  }

  const capped = Object.entries(UPGRADE_KINDS).filter(([k, m]) => m.cap && base.counts[k] >= m.cap).map(([, m]) => m.plural)
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-updg" data-kind={kind}>
      <div className={styles.toolbar} role="toolbar" aria-label="Analyst actions controls">
        <div className={styles.group} role="group" aria-label="Kind">
          {Object.entries(UPGRADE_KINDS).map(([key, m]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === kind} onClick={() => pick(key)}
              data-testid={`terminal-updg-kind-${key}`}>{m.chip} ({base.counts[key]})</button>
          ))}
        </div>
        {sort.key !== 'order' ? (
          <button type="button" className={styles.chip} onClick={() => setSort(LIST_ORDER)} data-testid="terminal-updg-sort-reset">List order</button>
        ) : null}
      </div>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, 'Analyst actions')} Showing the last read.</p>}
      {base.wireStatus === 'stale' && (
        <p className={styles.note} role="status" data-testid="terminal-updg-stale">
          {builtText ? `This list is from the morning wire of ${builtText}. ` : 'This list is from an earlier morning wire. '}
          Today&apos;s list has not arrived yet.
        </p>
      )}
      {!rows.length ? (
        <PanelState kind="empty" compact title={`No ${UPGRADE_KINDS[kind].plural} in this list.`} testId="terminal-updg-none">
          Pick another kind to see the rest.
        </PanelState>
      ) : (
        <div className={styles.tableBox} data-fold="550">
          <table className={styles.table} data-testid="terminal-updg-table" aria-label={`${sentence(UPGRADE_KINDS[kind].plural)}, sortable`}>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th scope="col" key={c.key} title={c.title} aria-sort={ariaSortFor(sort, c.key, 'none')}
                    className={c.phoneHide ? styles.phoneHide : undefined}>
                    <button type="button" className={styles.sortBtn} onClick={() => setSort((s) => nextSort(s, c.key, firstDirFor))}
                      data-testid={`terminal-updg-sort-${c.key}`}>
                      {c.label}
                      {sortCaretFor(sort, c.key) ? <span aria-hidden="true">{` ${sortCaretFor(sort, c.key)}`}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} data-testid={`terminal-updg-row-${r.sym}`} data-kind={r.kind}>
                  <td>
                    <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                    <PanelSymbol sym={r.sym} className={styles.sym} />
                  </td>
                  <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.firm || 'Not given'}</td>
                  <td className={r.tone === 'up' ? styles.up : r.tone === 'down' ? styles.down : undefined}>{r.action}</td>
                  <td className={styles.wrapCell}>{r.rating || 'Not given'}</td>
                  <td>{r.target != null ? formatCurrency(r.target) : r.targetText || 'Not given'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.muted} data-testid="terminal-updg-method">
        Analyst rating and price-target changes from the UCT morning wire, across the whole market. The server keeps up to{' '}
        {UPGRADE_KINDS.upgrades.cap} upgrades (new coverage is counted with them), {UPGRADE_KINDS.downgrades.cap} downgrades
        and {UPGRADE_KINDS.targets.cap} target changes
        {capped.length ? `, so there may be more ${listWords(capped)} than shown` : ''}.
        {builtText
          ? ` List dated ${builtText}.`
          : ' The server does not say which morning this list is from; it is replaced when the next morning wire arrives, before the open on trading days.'}
        {' '}Click a symbol to load it into the linked panels; type a row number to do the same.
        {read.receivedAt ? ` Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
