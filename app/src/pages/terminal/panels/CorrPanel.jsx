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
import { BoardFromList, PanelSkeleton, PanelState, usePanelFreshness, usePanelSymbolRows } from '../../../components/terminal'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import useCloses, { closesProvenance } from './useCloses'
import { MIN_CORR_SESSIONS, collectSymbols, correlationMatrix, corrWindow, withArgsKey } from './relativeMath'
import styles from './comparePanels.module.css'

export const CORR_MAX = 10
// Every window the `lookback` arg accepts (args.js) is a window this panel draws: 2Y and YTD
// were parsed and then silently ignored (accuracy audit 2026-10-06, design note 4). The D read is
// 600 bars (useCloses.BARS_FOR_TF), enough for 2Y's 504 returns.
export const CORR_WINDOWS = ['1M', '3M', '6M', '1Y', '2Y', 'YTD']
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

/** Pure: how a correlation reads in words. A strongly NEGATIVE r is a strong relationship (the
 *  two move opposite), never "independent" (audit 2026-10-08: `CORR SPY SH` read "SPY and SH move
 *  mostly independently (r = -0.99)"). */
export function corrStrength(r) {
  if (r >= 0.8) return 'move almost as one'
  if (r >= 0.6) return 'move largely together'
  if (r >= 0.3) return 'are loosely related'
  if (r <= -0.8) return 'move almost exactly opposite'
  if (r <= -0.6) return 'largely move opposite'
  if (r <= -0.3) return 'lean opposite'
  return 'move mostly independently'
}

/** Pure: the plain-language read of the strongest pair. */
export function corrVerdict(read) {
  if (!read?.most) return null
  const r = read.most.r
  return `${read.most.a} and ${read.most.b} ${corrStrength(r)} (r = ${formatNumber(r, { decimals: 2 })}).`
}

/** Pure: the second line under the verdict. "Least related" is the pair CLOSEST TO ZERO; a pair
 *  at r = -1 is the most opposite pair, not the least related one, so when a clearly negative
 *  pair exists it is named as that instead. Null when no other pair than the strongest exists. */
export function corrSecondLine(read) {
  if (!read?.most || !read.matrix) return null
  const pairs = []
  for (let i = 0; i < read.syms.length; i++) {
    for (let j = i + 1; j < read.syms.length; j++) {
      const r = read.matrix[i][j]?.r
      if (r != null) pairs.push({ a: read.syms[i], b: read.syms[j], r })
    }
  }
  const rest = pairs.filter((p) => !(p.a === read.most.a && p.b === read.most.b))
  if (!rest.length) return null
  const fmt = (p) => `${p.a} and ${p.b} (r = ${formatNumber(p.r, { decimals: 2 })}).`
  const opposite = rest.reduce((m, p) => (p.r < m.r ? p : m))
  if (opposite.r <= -0.3) return `Most opposite: ${fmt(opposite)}`
  const least = rest.reduce((m, p) => (Math.abs(p.r) < Math.abs(m.r) ? p : m))
  return `Least related: ${fmt(least)}`
}

/** Pure: the method note's window, in words. */
export function windowPhrase(win) {
  if (win === 'YTD') return 'since January 1 (year to date)'
  return `over the last ${corrWindow(win, {}, []).sessions} sessions`
}

export default function CorrPanel({ sym, lookback, ...props }) {
  const withKey = withArgsKey(props)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const syms = useMemo(() => corrSymbols(sym, props), [sym, withKey])
  const [win, setWin] = useState(CORR_WINDOWS.includes(lookback) ? lookback : '3M')
  useEffect(() => { if (CORR_WINDOWS.includes(lookback)) setWin(lookback) }, [lookback])
  // A typed window this panel cannot draw is SAID, never silently replaced.
  const unapplied = lookback && !CORR_WINDOWS.includes(lookback) ? lookback : null
  const state = useCloses(syms.length >= 2 ? syms : [], 'D')
  // TERM-019: the panel header names the bar store and the newest close on screen.
  usePanelFreshness(closesProvenance(state, 'D'))
  const read = useMemo(() => {
    if (state.phase !== 'ready') return null
    const live = syms.filter((s) => state.series[s])
    if (live.length < 2) return null
    const { sessions, since } = corrWindow(win, state.series, live)
    return correlationMatrix(state.series, live, sessions, { since })
  }, [state, syms, win])
  // Row <GO>: the matrix's rows, in order, each load that name (`$SYM`); the names in the matrix
  // are the list a "Board of" opens. Nothing is published until a matrix is on screen.
  const shownSyms = usePanelSymbolRows(read ? read.syms : [], `CORR ${win}`)

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
        <BoardFromList syms={shownSyms} label={`CORR ${win}`} testId="terminal-corr-board" />
      </div>
      {unapplied && (
        <p className={styles.note} role="status" data-testid="terminal-corr-unapplied">
          Window {unapplied} is not available here; showing {win}.
        </p>
      )}
      {corrVerdict(read) && <p className={styles.lede} data-testid="terminal-corr-verdict">{corrVerdict(read)}</p>}
      {corrSecondLine(read) && (
        <p className={styles.lede} data-testid="terminal-corr-least">{corrSecondLine(read)}</p>
      )}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-corr-matrix" aria-label={`Correlation matrix, ${win} of daily returns`}>
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
        Pearson correlation of daily returns {windowPhrase(win)}, each pair on the
        sessions both names traded (hover a cell for its count). A pair with fewer than {MIN_CORR_SESSIONS} shared sessions reads n/a.
        1 = move together, 0 = unrelated, −1 = opposite. High correlation across a book means one bet, not several.
      </p>
    </div>
  )
}
