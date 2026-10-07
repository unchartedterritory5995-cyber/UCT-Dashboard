// CORR — correlation matrix of daily returns (feature-gaps-2026-10-06 #3).
//
// How concentrated a set of swing positions really is: five semis are one bet, not five. Unusual
// Whales `/correlation`, Bloomberg `PC`. Nothing in the app computed this before (the CLAUDE.md
// data-sources row claiming a "Correlation Matrix" has no code behind it on this branch).
//
//   NVDA CORR AMD MSFT TSLA      four names, 3 months of daily returns
//   CORR XLK XLE XLU 6M          a bare list, six months
//   NVDA CORR                    NVDA vs SPY and QQQ
//
// Pearson on daily simple returns, each pair over the sessions BOTH traded. A pair with fewer
// than MIN_CORR_SESSIONS common returns shows "n/a", never a number.
import { useEffect, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState } from '../../../components/terminal'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import useCloses from './useCloses'
import { LOOKBACK_SESSIONS, MIN_CORR_SESSIONS, collectSymbols, correlationMatrix, withArgsKey } from './relativeMath'
import styles from './comparePanels.module.css'

export const CORR_MAX = 10
export const CORR_WINDOWS = ['1M', '3M', '6M', '1Y']
export const CORR_DEFAULT_PEERS = ['SPY', 'QQQ']

/** Pure: the names CORR compares. One name alone is compared with SPY and QQQ. */
export function corrSymbols(sym, props = {}) {
  const asked = collectSymbols(sym, props, CORR_MAX)
  if (asked.length === 1) for (const p of CORR_DEFAULT_PEERS) if (!asked.includes(p)) asked.push(p)
  return asked
}

/** Pure: a cell's background — accent for positive, info for negative, strength by |r|.
 *  Neither green nor red: correlation is not "up" or "down" (non-goals NG-19). */
export function corrTint(r) {
  if (r == null) return undefined
  const pct = Math.round(Math.min(1, Math.abs(r)) * 55)
  return `color-mix(in srgb, var(${r >= 0 ? '--accent' : '--info'}) ${pct}%, transparent)`
}

/** Pure: the plain-language read of the strongest pair. */
export function corrVerdict(read) {
  if (!read?.most) return null
  const r = read.most.r
  const strength = r >= 0.8 ? 'move almost as one' : r >= 0.6 ? 'move largely together' : r >= 0.3 ? 'are loosely related' : 'move mostly independently'
  return `${read.most.a} and ${read.most.b} ${strength} (r = ${formatNumber(r, { decimals: 2 })}).`
}

export default function CorrPanel({ sym, lookback, ...props }) {
  const withKey = withArgsKey(props)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const syms = useMemo(() => corrSymbols(sym, props), [sym, withKey])
  const [win, setWin] = useState(CORR_WINDOWS.includes(lookback) ? lookback : '3M')
  useEffect(() => { if (CORR_WINDOWS.includes(lookback)) setWin(lookback) }, [lookback])
  const state = useCloses(syms.length >= 2 ? syms : [], 'D')
  const read = useMemo(() => {
    if (state.phase !== 'ready') return null
    const live = syms.filter((s) => state.series[s])
    return live.length >= 2 ? correlationMatrix(state.series, live, LOOKBACK_SESSIONS[win]) : null
  }, [state, syms, win])

  if (!syms.length) {
    return (
      <PanelState kind="input" title="CORR needs at least one ticker." testId="terminal-corr-input">
        Type <kbd>NVDA CORR AMD MSFT</kbd> or <kbd>CORR XLK XLE XLU 6M</kbd>.
      </PanelState>
    )
  }
  if (state.phase !== 'ready') return <PanelSkeleton label={`Loading ${syms.join(', ')}`} testId="terminal-corr-loading" />
  if (!read) {
    const why = state.failed.length ? `Could not read ${state.failed.join(', ')} just now.` : 'Fewer than two names could be read.'
    return <PanelState kind="error" title={why} testId="terminal-corr-error">CORR needs at least two names with price history. Run it again to retry.</PanelState>
  }
  return (
    <div className={styles.wrap} data-testid="terminal-corr">
      <div className={styles.toolbar} role="group" aria-label="Window">
        {CORR_WINDOWS.map((w) => (
          <button key={w} type="button" className={styles.chip} aria-pressed={w === win} onClick={() => setWin(w)}>{w}</button>
        ))}
      </div>
      {corrVerdict(read) && <p className={styles.lede} data-testid="terminal-corr-verdict">{corrVerdict(read)}</p>}
      {read.least && read.least !== read.most && (
        <p className={styles.lede} data-testid="terminal-corr-least">
          Least related: {read.least.a} and {read.least.b} (r = {formatNumber(read.least.r, { decimals: 2 })}).
        </p>
      )}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-corr-matrix">
          <thead>
            <tr><th scope="col" aria-label="Symbol" />{read.syms.map((s) => <th key={s} scope="col">{s}</th>)}<th scope="col">Avg r</th></tr>
          </thead>
          <tbody>
            {read.syms.map((a, i) => (
              <tr key={a}>
                <th scope="row" className={styles.symCell}>{a}</th>
                {read.matrix[i].map((c, j) => (
                  <td key={read.syms[j]} data-testid={`corr-${a}-${read.syms[j]}`}
                    className={`${styles.corrCell} ${i === j ? styles.corrDiag : ''} ${c.r == null ? styles.corrNa : ''}`}
                    style={i === j ? undefined : { background: corrTint(c.r) }}
                    title={c.r == null ? `${c.n} common sessions: too few` : `${c.n} common sessions`}>
                    {i === j ? '1' : c.r == null ? 'n/a' : formatNumber(c.r, { decimals: 2 })}
                  </td>
                ))}
                <td>{formatNumber(read.avg[i].avg, { decimals: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.failed.length > 0 && (
        <p className={styles.note} role="status" data-testid="terminal-corr-failed">Could not read {state.failed.join(', ')} just now; not in the matrix.</p>
      )}
      <p className={styles.muted}>
        Pearson correlation of daily returns over the last {LOOKBACK_SESSIONS[win]} sessions, each pair on the
        sessions both names traded. A pair with fewer than {MIN_CORR_SESSIONS} shared sessions reads n/a.
        1 = move together, 0 = unrelated, −1 = opposite. High correlation across a book means one bet, not several.
      </p>
    </div>
  )
}
