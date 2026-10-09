// THMS: the UCT theme leaderboard, leaders and laggards by period (wave 7, lane C).
//
// ⭐ NO NEW ROUTE, NO SECOND THEME MODEL. It reads `/api/theme-performance` with the same key and
// fetcher IMOV uses (one cached read for a board holding both) and the same owner-basket rule
// (imovModel `ownerSyms`): a theme's figure is the Theme Tracker's own `group_return` for the
// period when it has one, else the plain mean of its curated members' returns. Engine-suggested
// members never move it.
//
// The Theme Tracker tile (components/tiles/ThemeTracker.jsx) is not embedded: it fetches without the
// error guard (a failed read draws as an empty list), shows a missing return as +0.00%, and colours
// text with the candle hues. /theme-tracker is a redirect, so it cannot be a door either.
// A theme opens IMOV beside the board (which names drive it).
import { useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useMarketOpen from '../../../hooks/useMarketOpen'
import jsonFetcher from '../../../utils/jsonFetcher'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import {
  PanelCommand, PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, usePanelRerun,
} from '../../../components/terminal'
import { formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { DEFAULT_WINDOW, IMOV_WINDOWS, POLL_MS, THEMES_URL, imovCommand, normSym, ownerSyms, themeKey, themesOf } from './imovModel'
import { failureText } from './marketRead'
import styles from './marketPanels.module.css'

const SWR_OPTS = { refreshInterval: POLL_MS, marketHoursOnly: true, keepPreviousData: true, revalidateOnFocus: false }

/** The periods the Theme Tracker shows → the `returns` key theme_performance writes for each. */
export const THEME_PERIODS = Object.freeze({ '1D': '1d', '1W': '1w', '1M': '1m', '3M': '3m', '1Y': '1y', YTD: 'ytd' })

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Pure: a theme's return for a period: its published `group_return`, else the mean of its curated
 *  members' returns, else null (never 0: "no return yet" is not "flat"). */
export function themeReturn(theme, key) {
  const published = num(theme?.group_return?.[key])
  if (published != null) return published
  const owners = ownerSyms(theme)
  const vals = (theme?.holdings || [])
    .filter((h) => h?.sym && owners.has(normSym(h.sym)))
    .map((h) => num(h.returns?.[key]))
    .filter((v) => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** Pure: leaders (>= 0, best first), laggards (< 0, worst first) and the themes with no return. */
export function themeBoard(themes, key) {
  const scored = themes.map((t) => ({ theme: t, key: themeKey(t), name: t.name || themeKey(t), etf: t.ticker || null,
    members: ownerSyms(t).size, ret: themeReturn(t, key) }))
  const priced = scored.filter((r) => r.ret != null)
  const byName = (a, b) => String(a.name).localeCompare(String(b.name))
  return {
    leaders: priced.filter((r) => r.ret >= 0).sort((a, b) => b.ret - a.ret || byName(a, b)),
    laggards: priced.filter((r) => r.ret < 0).sort((a, b) => a.ret - b.ret || byName(a, b)),
    unpriced: scored.filter((r) => r.ret == null).map((r) => r.name),
  }
}

function BoardTable({ title, rows, period, testId }) {
  if (!rows.length) return null
  const imovWin = IMOV_WINDOWS[period] ? period : DEFAULT_WINDOW
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={testId}>
        <caption className={styles.caption}>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Theme</th>
            <th scope="col" title="The theme's reference ETF" className={styles.phoneHide}>ETF</th>
            <th scope="col" className={styles.phoneHide}>Names</th>
            <th scope="col">{period}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid={`terminal-thms-row-${r.key}`}>
              <td>
                <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                <PanelCommand cmd={imovCommand({ theme: r.theme, win: imovWin })} label={`Open IMOV for ${r.name}`}>{r.name}</PanelCommand>
              </td>
              <td className={styles.phoneHide}>{r.etf || ''}</td>
              <td className={styles.phoneHide}>{r.members}</td>
              <td className={r.ret > 0 ? styles.up : r.ret < 0 ? styles.down : undefined}>{formatPercent(r.ret, { decimals: 2, signed: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ThemeBoardPanel({ win: winProp = null }) {
  const inPanel = useInTerminalPanel()
  const market = useMarketOpen()
  const rerun = usePanelRerun()
  const [period, setPeriod] = useState(THEME_PERIODS[winProp] ? winProp : '1D')
  const perf = useMobileSWR(THEMES_URL, jsonFetcher, SWR_OPTS)
  const themes = useMemo(() => themesOf(perf.data), [perf.data])
  const board = useMemo(() => themeBoard(themes, THEME_PERIODS[period]), [themes, period])

  const asOf = perf.data?.live_as_of || perf.data?.generated_at || null
  const closed = !market.isOpen && !market.isPremarket && !market.isExtended
  usePanelFreshness(asOf && themes.length
    ? { source: 'UCT theme tracker (Massive prices)', freshnessClass: closed ? 'end_of_day' : 'real_time', asOf, sessionState: sessionModel(market) }
    : null)

  // A window the command line takes (1D 1W 1M 3M) is written back into this panel's command, so a
  // reload, `?cmd=` and history keep it; 1Y and YTD are chips only.
  const pick = (p) => {
    setPeriod(p)
    if (rerun && IMOV_WINDOWS[p]) rerun(p === '1D' ? 'THMS' : `THMS ${p}`)
  }

  if (!perf.data && !perf.error) return <PanelSkeleton label="Loading theme returns" testId="terminal-thms-loading" />
  if (!perf.data && perf.error) {
    const locked = perf.error?.status === 402
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(perf.error, 'Theme performance')} testId="terminal-thms-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={() => perf.mutate()}>Retry</button>}>
        {locked ? null : 'Retry, or run THMS again.'}
      </PanelState>
    )
  }
  if (!themes.length) {
    return (
      <PanelState kind="empty" title="Theme returns are still being computed." testId="terminal-thms-computing">
        The theme service is building today&apos;s returns. This panel fills in on its own when they land.
      </PanelState>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-thms" data-period={period}>
      <div className={styles.toolbar} role="toolbar" aria-label="THMS controls">
        <div className={styles.group} role="group" aria-label="Period">
          {Object.keys(THEME_PERIODS).map((p) => (
            <button key={p} type="button" className={styles.chip} aria-pressed={p === period} onClick={() => pick(p)}
              data-testid={`terminal-thms-period-${p}`}>{p}</button>
          ))}
        </div>
      </div>
      {perf.error && <p className={styles.note} role="status">{failureText(perf.error, 'Theme performance')} Showing the last read.</p>}
      {!board.leaders.length && !board.laggards.length ? (
        <PanelState kind="empty" compact testId="terminal-thms-empty" title={`No theme has a ${period} return yet.`}>Try another period.</PanelState>
      ) : (
        <div className={styles.split}>
          <BoardTable title={`Leading (${board.leaders.length})`} rows={board.leaders} period={period} testId="terminal-thms-leaders" />
          <BoardTable title={`Lagging (${board.laggards.length})`} rows={board.laggards} period={period} testId="terminal-thms-laggards" />
        </div>
      )}
      {board.unpriced.length > 0 && (
        <p className={styles.muted} data-testid="terminal-thms-unpriced">
          {board.unpriced.length} theme{board.unpriced.length === 1 ? ' has' : 's have'} no {period} return yet and
          {board.unpriced.length === 1 ? ' is' : ' are'} not ranked.
        </p>
      )}
      <p className={styles.muted} data-testid="terminal-thms-method">
        Each theme is UCT&apos;s own equal-weight basket of its curated names, the same figure the Theme Tracker shows. 1D is
        the live move; longer periods are the live price against each name&apos;s close at the start of the period. Click a
        theme to open IMOV beside the board and see which names drive it.
        {asOf ? ` Prices as of ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
