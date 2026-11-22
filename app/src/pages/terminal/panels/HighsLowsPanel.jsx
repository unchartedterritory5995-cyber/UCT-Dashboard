// HILO: stocks making new highs and new lows of the day, live (data wave 1).
//
// ⭐ NO NEW ROUTE. `GET /api/nhnl/live` (api/routers/nhnl.py over api/services/nhnl_live.py) is the
// scanner the /charts "New Highs / Lows" widget reads. It answers
//   { window, date, asof, ticks, active, highs_total, lows_total, group, value, categories, highs, lows }
// where a stock row is `{ sym, price, pct, count, ts, dir, pick }`: one row per stock, busiest first,
// `count` being how many times it has made a new high (or low) this session and `pct` its change
// against the prior close. With `group=sector|industry|theme` and no `value` the rows are GROUPS
// (`{ sym: <group name>, count: <stocks in it at a new high>, group: true, pick }`); with a `value`
// they are that one group's stocks.
//
// ⛔ THESE ARE HIGHS AND LOWS OF THE DAY, NOT 52-WEEK HIGHS AND LOWS. The scanner counts each time a
// stock prints a new high or low of the SESSION: `window` is `pre` (4:00 to 9:30 AM Eastern), `rth`
// (9:30 AM to 4:00 PM), `post` (4:00 to 8:00 PM) or `closed`, and each session keeps its own count.
// The panel says so in its lede and its method sentence.
// ⛔ `active` IS THE SERVER'S OWN WORD FOR "THE SCANNER IS RUNNING". It is false when the market is
// closed and when NHNL_SCANNER_ENABLED is off (the lists are then empty with zero totals). Neither is
// drawn as "nothing made a new high": closed says closed, switched off says switched off.
// ⛔ A failed read is an error with Retry. The read keeps the previous view's answer while the next
// loads (SWR keepPreviousData), so only an answer whose own `group` / `value` echo matches is drawn.
//
// The poll follows `active`: every 15 seconds while the scanner runs, every 5 minutes while it does
// not. It goes through marketRead.js (the terminal's one bare-SWR reader), and SWR skips ticks while
// the app is hidden.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import HighsLowsPulse from './HighsLowsPulse'
import styles from './marketPanels.module.css'
import bars from './barCells.module.css'

export const NHNL_LIVE_URL = '/api/nhnl/live'
/** Rows asked for per side (the route allows 1 to 600). */
export const HILO_LIMIT = 50
const LIVE_POLL_MS = 15 * 1000
const IDLE_POLL_MS = 5 * 60 * 1000
const SOURCE = 'UCT new highs and lows scanner'
const ABSENT = 'Not given'
/** The name the server gives a stock it cannot place in a sector, industry or theme. */
const UNPLACED = '—'

/** Which lists show. `token` is what the chip writes into the command (`HILO LOWS`). */
export const HILO_SIDES = Object.freeze({
  both: { chip: 'Highs and lows', token: null },
  highs: { chip: 'Highs', token: 'HIGHS' },
  lows: { chip: 'Lows', token: 'LOWS' },
})
/** What is ranked: stocks, or the route's three group dimensions. `param` is the route's `group`. */
export const HILO_GROUPS = Object.freeze({
  stocks: { chip: 'Stocks', param: null, token: null, head: 'Stock', one: 'stock', many: 'stocks', all: 'All stocks' },
  sector: { chip: 'Sectors', param: 'sector', token: 'SECTOR', head: 'Sector', one: 'sector', many: 'sectors', all: 'All sectors' },
  industry: { chip: 'Industries', param: 'industry', token: 'INDUSTRY', head: 'Industry', one: 'industry', many: 'industries', all: 'All industries' },
  theme: { chip: 'Themes', param: 'theme', token: 'THEME', head: 'Theme', one: 'theme', many: 'themes', all: 'All themes' },
})
/** The route's `window`, as a member reads it. */
export const HILO_SESSIONS = Object.freeze({
  rth: { badge: 'Regular session', of: 'of the day' },
  pre: { badge: 'Pre-market', of: 'of the pre-market session' },
  post: { badge: 'After hours', of: 'of the after-hours session' },
  closed: { badge: 'Market closed', of: 'of the session' },
})

const SIDE_WORDS = {
  HIGHS: 'highs', HIGH: 'highs', HI: 'highs', NH: 'highs', UP: 'highs',
  LOWS: 'lows', LOW: 'lows', LO: 'lows', NL: 'lows', DOWN: 'lows',
}
const GROUP_WORDS = {
  SECTOR: 'sector', SECTORS: 'sector', INDUSTRY: 'industry', INDUSTRIES: 'industry', THEME: 'theme', THEMES: 'theme',
}
/** Pure: the side a prop or a typed word names; anything unknown is both lists. */
export const normSide = (raw) => SIDE_WORDS[String(raw ?? '').trim().toUpperCase()] || 'both'
/** Pure: the grouping a prop or a typed word names; anything unknown is stocks. */
export const normGroup = (raw) => GROUP_WORDS[String(raw ?? '').trim().toUpperCase()] || 'stocks'

/** Pure: the read for a view. `value` (one sector, industry or theme) only applies with a group. */
export function highsLowsUrl({ group = null, value = null, limit = HILO_LIMIT, minPrice = 0 } = {}) {
  const g = normGroup(group)
  const q = new URLSearchParams({ limit: String(limit) })
  if (Number(minPrice) > 0) q.set('min_price', String(minPrice))
  if (g !== 'stocks') {
    q.set('group', g)
    if (value) q.set('value', String(value))
  }
  return `${NHNL_LIVE_URL}?${q.toString()}`
}

/** Pure: the arguments a view writes into the panel's command (both lists of stocks is the bare command). */
export const highsLowsCommandArgs = ({ side = null, group = null } = {}) => [HILO_SIDES[normSide(side)].token, HILO_GROUPS[normGroup(group)].token].filter(Boolean)

/** Pure: is this answer the one for this view? (The route echoes `group` and `value`.) */
export function isAnswerFor(body, { group = null, value = null } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const g = normGroup(group)
  const wantGroup = g === 'stocks' ? null : g
  return (body.group ?? null) === wantGroup && (body.value ?? null) === (wantGroup && value ? String(value) : null)
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
/** The scanner stamps microseconds (`...T10:31:02.123456-05:00`); a browser is only promised three. */
const stamp = (v) => (typeof v === 'string' && v ? v.replace(/(\.\d{3})\d+/, '$1') : null)

function sideRows(list, side, grouped) {
  const out = []
  const seen = new Set()
  for (const e of (Array.isArray(list) ? list : [])) {
    const raw = String(e?.sym ?? '').trim()
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    const base = { key: `${side}-${raw}`, order: out.length, count: num(e.count) ?? 0, at: stamp(e.ts) }
    out.push(grouped
      ? { ...base, name: raw, label: raw === UNPLACED ? 'Not classified' : raw, fund: e.pick ? String(e.pick).trim().toUpperCase() : null }
      : { ...base, sym: raw.toUpperCase(), price: num(e.price), pct: num(e.pct) })
  }
  return out
}

/**
 * Pure: the payload as a board.
 *   window      `rth` | `pre` | `post` | `closed` (null when the payload names none)
 *   active      the server's own word that the scanner is running now
 *   date, asOf  the session date and the scanner's last reading (an ISO instant)
 *   group       `stocks` | `sector` | `industry` | `theme`; `value` the one group drilled into
 *   grouped     true when the rows are groups (a group overview), false when they are stocks
 *   highs, lows rows, busiest first: a stock `{ sym, price, pct, count, at }`, or a group
 *               `{ name, label, count, at, fund }` where `count` is how many of its stocks qualify
 *   highsTotal, lowsTotal   how many rows the whole view holds (the lists are cut at the limit)
 */
export function highsLowsBoard(body) {
  const ok = !!body && typeof body === 'object' && !Array.isArray(body)
  const group = ok ? normGroup(body.group) : 'stocks'
  const value = ok && group !== 'stocks' && body.value ? String(body.value) : null
  const grouped = group !== 'stocks' && !value
  const highs = sideRows(ok ? body.highs : null, 'highs', grouped)
  const lows = sideRows(ok ? body.lows : null, 'lows', grouped)
  const win = ok ? String(body.window || '').toLowerCase() : ''
  return {
    window: HILO_SESSIONS[win] ? win : null,
    active: ok && body.active === true,
    date: ok && body.date ? String(body.date) : null,
    asOf: ok ? stamp(body.asof) : null,
    group,
    value,
    grouped,
    highs,
    lows,
    highsTotal: Math.max(highs.length, (ok && num(body.highs_total)) || 0),
    lowsTotal: Math.max(lows.length, (ok && num(body.lows_total)) || 0),
  }
}

const count = (n) => formatNumber(n, { decimals: 0 })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

function StockTable({ side, rows, total, offset }) {
  const high = side === 'highs'
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={`terminal-hilo-${side}`}>
        <caption className={styles.caption}>{high ? 'New highs' : 'New lows'} ({count(total)})</caption>
        <thead>
          <tr>
            <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
            <th scope="col">Price</th>
            <th scope="col" title="Against the prior close">Change</th>
            <th scope="col" title={`How many times it has made a new ${high ? 'high' : 'low'} this session`}>Times</th>
            <th scope="col" className={styles.phoneHide} title={`When it last made a new ${high ? 'high' : 'low'}, Eastern time`}>Last</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`terminal-hilo-${side}-row-${r.sym}`}>
              <td>
                <span className={styles.rowNum} aria-hidden="true">{offset + i + 1}</span>
                <PanelSymbol sym={r.sym} className={styles.sym} />
              </td>
              <td>{formatCurrency(r.price, { absent: ABSENT })}</td>
              <td className={tone(r.pct)}>{formatPercent(r.pct, { decimals: 2, signed: true, absent: ABSENT })}</td>
              <td>{count(r.count)}</td>
              <td className={styles.phoneHide}>{formatTimeEt(r.at, { absent: ABSENT })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupTable({ side, rows, total, words, onDrill }) {
  const high = side === 'highs'
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={`terminal-hilo-${side}`}>
        <caption className={styles.caption}>{words.chip} with stocks at new {high ? 'highs' : 'lows'} ({count(total)})</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.wrapCell}>{words.head}</th>
            <th scope="col" title={`How many of its stocks have made a new ${high ? 'high' : 'low'} this session`}>Stocks</th>
            <th scope="col" className={styles.phoneHide} title="When one last did, Eastern time">Last</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`terminal-hilo-${side}-group-${i}`}>
              <td className={styles.wrapCell}>
                <button type="button" className={styles.linkBtn} onClick={() => onDrill(r.name)} title={`Show the stocks in ${r.label}`}>
                  {r.label}
                </button>
              </td>
              <td>{count(r.count)}</td>
              <td className={styles.phoneHide}>{formatTimeEt(r.at, { absent: ABSENT })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function HighsLowsPanel({ side: sideProp = null, group: groupProp = null, value: valueProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  // A new `HILO LOWS SECTOR` remounts the panel (the shell keys the body on code + args), so the
  // typed words only ever seed the state.
  const [side, setSide] = useState(() => normSide(sideProp))
  const [group, setGroup] = useState(() => normGroup(groupProp))
  const [value, setValue] = useState(() => (normGroup(groupProp) !== 'stocks' && valueProp ? String(valueProp) : null))
  // The server says whether the scanner is running; the poll slows down while it is not. `running`
  // is adjusted during render from the last answer (no effect, so no extra pass through an old value).
  const [running, setRunning] = useState(true)
  const read = useMarketRead(highsLowsUrl({ group, value }), { refreshInterval: running ? LIVE_POLL_MS : IDLE_POLL_MS })
  const runningNow = read.body ? read.body.active === true : true
  if (runningNow !== running) setRunning(runningNow)
  // Only an answer for THIS view is drawn (the previous view's is kept while this one loads).
  const body = isAnswerFor(read.body, { group, value }) ? read.body : null
  const board = useMemo(() => highsLowsBoard(body), [body])

  const words = HILO_GROUPS[group]
  const session = HILO_SESSIONS[board.window] || HILO_SESSIONS.closed
  const showHighs = side !== 'lows'
  const showLows = side !== 'highs'
  const live = !!body && board.active
  const anyRows = (showHighs && board.highs.length > 0) || (showLows && board.lows.length > 0)
  usePanelFreshness(live ? panelAsOf(SOURCE, board.asOf) : null)
  // Numbered rows are the stock rows on screen, highs first; a group overview has none.
  const shownSyms = live && !board.grouped
    ? [...(showHighs ? board.highs : []), ...(showLows ? board.lows : [])].map((r) => r.sym)
    : []
  usePanelSymbolRows(shownSyms, 'new highs and lows', {
    total: (showHighs ? board.highsTotal : 0) + (showLows ? board.lowsTotal : 0),
  })

  // A chip writes itself into the command (`HILO LOWS SECTOR`) where the registry takes the words,
  // so a reload keeps it; otherwise it is plain component state (commandWriteBack.js). While one
  // group is open (a drill the command does not carry) the side stays local, so it is not lost.
  const pickSide = (next) => { setSide(next); if (!value) writeBack(highsLowsCommandArgs({ side: next, group })) }
  const pickGroup = (next) => { setGroup(next); setValue(null); writeBack(highsLowsCommandArgs({ side, group: next })) }

  if (!body && read.error && !canRetry(read.error)) {
    return <PanelState kind="locked" title={failureText(read.error, 'New highs and lows')} testId="terminal-hilo-error" />
  }
  if (body && !board.active && board.window === 'closed') {
    return (
      <PanelState kind="empty" title="The market is closed." testId="terminal-hilo-closed">
        New highs and lows are counted from 4:00 AM to 8:00 PM Eastern on trading days, with a separate count for the
        pre-market, the regular session and after hours. This panel fills in when the next session starts.
      </PanelState>
    )
  }
  if (body && !board.active) {
    return (
      <PanelState kind="locked" title="The new highs and lows scanner is not running on this server right now." testId="terminal-hilo-off">
        That is not the same as no stock making a new high or low. The lists fill in once the scanner is switched on.
      </PanelState>
    )
  }

  let state = null
  if (!body && !read.error) {
    state = <PanelSkeleton label="Loading new highs and lows" testId="terminal-hilo-loading" />
  } else if (!body) {
    state = (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, 'New highs and lows')} testId="terminal-hilo-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as a quiet market. Retry, or pick another view.
      </PanelState>
    )
  } else if (!anyRows) {
    const what = side === 'lows' ? 'low' : side === 'highs' ? 'high' : 'high or low'
    state = (
      <PanelState kind="empty" compact testId="terminal-hilo-empty"
        title={value
          ? `No stock in ${value === UNPLACED ? 'this group' : value} has made a new ${what} yet this session.`
          : `Nothing has made a new ${what} yet this session.`}>
        The lists fill as prices move. The first reading of a session only sets each stock&apos;s starting high and low.
      </PanelState>
    )
  }

  const totalBoth = board.highsTotal + board.lowsTotal
  const highShare = totalBoth > 0 ? Math.round((board.highsTotal / totalBoth) * 1000) / 10 : 0
  const totals = board.grouped
    ? `${count(board.highsTotal)} ${board.highsTotal === 1 ? `${words.one} has` : `${words.many} have`} a stock at a new high ${session.of}, ${count(board.lowsTotal)} at a new low.`
    : `${count(board.highsTotal)} ${board.highsTotal === 1 ? 'stock' : 'stocks'} at a new high ${session.of}, ${count(board.lowsTotal)} at a new low.`
  const cut = (shown, total, what) => (total > shown ? `Showing the busiest ${count(shown)} of ${count(total)} ${what}. ` : '')
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-hilo" data-side={side} data-group={group}
      data-session={board.window || ''}>
      <div className={styles.toolbar} role="toolbar" aria-label="New highs and lows controls">
        <div className={styles.group} role="group" aria-label="Lists">
          {Object.entries(HILO_SIDES).map(([key, s]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === side} onClick={() => pickSide(key)}
              data-testid={`terminal-hilo-side-${key}`}>{s.chip}</button>
          ))}
        </div>
        <div className={styles.group} role="group" aria-label="Rank by">
          {Object.entries(HILO_GROUPS).map(([key, g]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === group} onClick={() => pickGroup(key)}
              data-testid={`terminal-hilo-group-${key}`}>{g.chip}</button>
          ))}
        </div>
        {value ? (
          <button type="button" className={styles.chip} onClick={() => setValue(null)} data-testid="terminal-hilo-back">{words.all}</button>
        ) : null}
      </div>
      {state || (
        <>
          {read.error && <p className={styles.note} role="status">{failureText(read.error, 'New highs and lows')} Showing the last read.</p>}
          <div className={styles.head}>
            <span className={`${styles.badge} ${styles.badge_flat}`} data-testid="terminal-hilo-session">{session.badge}</span>
            <span className={styles.lede} data-testid="terminal-hilo-totals">
              {value ? `${value === UNPLACED ? 'Not classified' : value}: ` : ''}
              {totals}
            </span>
          </div>
          {totalBoth > 0 ? (
            <div className={bars.splitBar} aria-hidden="true" data-testid="terminal-hilo-split">
              <span className={bars.splitUp} style={{ width: `${highShare}%` }} />
              <span className={bars.splitDown} style={{ width: `${Math.round((100 - highShare) * 10) / 10}%` }} />
            </div>
          ) : null}
          {/* Its own read and its own states: a failed chart never fails the lists (HighsLowsPulse.jsx). */}
          <HighsLowsPulse scoped={group !== 'stocks'} />
          <div className={`${styles.split} ${styles.splitRoomy}`}>
            {showHighs && board.highs.length > 0 && (board.grouped
              ? <GroupTable side="highs" rows={board.highs} total={board.highsTotal} words={words} onDrill={setValue} />
              : <StockTable side="highs" rows={board.highs} total={board.highsTotal} offset={0} />)}
            {showLows && board.lows.length > 0 && (board.grouped
              ? <GroupTable side="lows" rows={board.lows} total={board.lowsTotal} words={words} onDrill={setValue} />
              : <StockTable side="lows" rows={board.lows} total={board.lowsTotal} offset={showHighs ? board.highs.length : 0} />)}
          </div>
          {showHighs && !board.highs.length ? <p className={styles.muted} data-testid="terminal-hilo-no-highs">No new highs yet this session.</p> : null}
          {showLows && !board.lows.length ? <p className={styles.muted} data-testid="terminal-hilo-no-lows">No new lows yet this session.</p> : null}
          <p className={styles.muted} data-testid="terminal-hilo-method">
            {showHighs ? cut(board.highs.length, board.highsTotal, board.grouped ? `${words.many} with new highs` : 'new highs') : ''}
            {showLows ? cut(board.lows.length, board.lowsTotal, board.grouped ? `${words.many} with new lows` : 'new lows') : ''}
            These are new highs and lows {session.of}, not 52-week highs and lows. The UCT scanner watches every stock in the
            UCT universe (funds are left out) and counts each time one sets a new high or low; the pre-market, the regular
            session and after hours each keep their own count.{' '}
            {board.grouped
              ? `Each ${words.one} is ranked by how many of its stocks have done so. Click a ${words.one} to see its stocks.`
              : 'Busiest first: Times is that count, and Change is against the prior close. A sign (+/−) marks every change, so color is never the only signal. Click a symbol to load it into the linked panels; type a row number to do the same.'}
            {board.asOf ? ` Scanner read at ${formatTimeEt(board.asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
