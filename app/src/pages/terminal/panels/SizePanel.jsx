// SIZE: a position-size and R calculator (wave 7, lane D). `SIZE` or `NVDA SIZE`.
//
// ⭐ PURE CLIENT MATH (panels/sizeMath.js). Type the account, risk % (1 by default), entry and stop;
// it answers shares, $ at risk, position $ and its share of the account, and the 1R / 2R / 3R
// targets. With a ticker the entry is prefilled ONCE from the shared live-price store (the same
// one-poll pool every panel uses); typing over it wins and a later tick never overwrites it.
//
// ⛔ NO SERVER PREFERENCE. Account size and risk % are remembered in this browser only
// (localStorage, inside try/catch); entry and stop are per trade and never stored.
//
// ADR STOP SUGGESTION (wave 9, lane 2). With a ticker, one small read of `/api/bars/{sym}?tf=D&bars=30`
// (the chart's own edge-cached endpoint) gives the ADR% (sizeMath.adrFromBars: 20 completed daily
// bars). The panel offers "Suggested stop: $X (1 ADR below entry, ADR n.n%)" with a button; it is
// NEVER applied on its own. A `no_data` answer, a 404 or too few bars says there is no ADR; a
// warming answer (503, or `warming: true`) says try again, with Retry. Without a ticker: nothing.
//
// A long needs its stop below the entry, a short above. The side is a choice the member makes,
// labelled in words, and a stop on the wrong side is refused with a sentence, never sized.
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import useLivePrices from '../../../hooks/useLivePrices'
import Input from '../../../components/ui/Input'
import { useInTerminalPanel, usePanelFreshness, panelAsOf } from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import jsonFetcher from '../../../utils/jsonFetcher'
import { DEFAULT_RISK_PCT, adrFromBars, adrStop, computeSize, parseNum } from './sizeMath'
import { barDateKey } from './relativeMath'
import { etClock } from './useCloses'
import shared from './myNamesPanel.module.css'
import styles from './sizePanel.module.css'

export const SIZE_STORE_KEY = 'uct.terminal.size.v1'

/** Account and risk % from this browser, or the defaults. Never throws. */
export function loadSizePrefs() {
  try {
    const raw = window.localStorage.getItem(SIZE_STORE_KEY)
    const v = raw ? JSON.parse(raw) : null
    return {
      account: v && v.account != null ? String(v.account) : '',
      riskPct: v && v.riskPct != null ? String(v.riskPct) : String(DEFAULT_RISK_PCT),
    }
  } catch {
    return { account: '', riskPct: String(DEFAULT_RISK_PCT) }
  }
}

function saveSizePrefs(prefs) {
  try { window.localStorage.setItem(SIZE_STORE_KEY, JSON.stringify(prefs)) } catch { /* private window: keep it in state only */ }
}

/** The daily bars URL the ADR is read from: 30 bars covers 20 completed sessions plus slack. */
export const adrUrl = (sym) => `/api/bars/${encodeURIComponent(sym)}?tf=D&bars=30`

/** Pure: the ET date of a still-forming daily bar to leave out of the ADR (today before 4:00 PM ET). */
export function formingDate(now = new Date()) {
  const { date, minutes } = etClock(now)
  return minutes < 16 * 60 ? date : null
}

/** `{ phase: 'idle'|'loading'|'ready'|'none'|'warming'|'error', adr, retry }` for one ticker. */
export function useAdr(sym) {
  const [attempt, setAttempt] = useState(0)
  const key = sym ? `${sym}#${attempt}` : null
  const [state, setState] = useState({ key: null })
  useEffect(() => {
    if (!sym) return undefined
    let live = true
    const settle = (next) => { if (live) setState({ key, ...next }) }
    jsonFetcher(adrUrl(sym), { credentials: 'include' }).then((body) => {
      if (body?.warming === true || body?.error === 'warming') return settle({ phase: 'warming' })
      if (body?.no_data) return settle({ phase: 'none' })
      const adr = adrFromBars(body, { forming: formingDate(), barDate: barDateKey })
      return settle(adr ? { phase: 'ready', adr } : { phase: 'none' })
    }).catch((e) => {
      if (e?.status === 503) settle({ phase: 'warming' })
      else if (e?.status === 404) settle({ phase: 'none' })
      else settle({ phase: 'error' })
    })
    return () => { live = false }
  }, [sym, key])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  if (!sym) return { phase: 'idle', adr: null, retry }
  return state.key === key ? { phase: state.phase, adr: state.adr || null, retry } : { phase: 'loading', adr: null, retry }
}

const money = (v) => formatCurrency(v, { grouping: true, absent: 'n/a' })
const priceText = (v) => formatCurrency(v, { absent: 'n/a' })

export default function SizePanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase() || null
  const inPanel = useInTerminalPanel()
  const ids = useId()
  const [prefs] = useState(loadSizePrefs)
  const [account, setAccount] = useState(prefs.account)
  const [riskPct, setRiskPct] = useState(prefs.riskPct)
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [side, setSide] = useState('long')
  const [entryTouched, setEntryTouched] = useState(false)
  const [prefilledAt, setPrefilledAt] = useState(null)

  const { prices, error: priceError } = useLivePrices(s ? [s] : [])
  const adr = useAdr(s)
  const live = s ? parseNum(prices?.[s]?.price) : null

  // Prefill the entry once from the live price; the member's own typing always wins.
  useEffect(() => {
    if (!s || entryTouched || entry !== '' || live === null || live <= 0) return
    setEntry(formatNumber(live, { decimals: 2, grouping: false }))
    setPrefilledAt(new Date().toISOString())
  }, [s, live, entryTouched, entry])

  useEffect(() => { saveSizePrefs({ account, riskPct }) }, [account, riskPct])

  usePanelFreshness(prefilledAt ? panelAsOf('Live price (entry prefill only)', prefilledAt) : null)

  const result = useMemo(() => computeSize({ account, riskPct, entry, stop, side }), [account, riskPct, entry, stop, side])
  const blank = [account, entry, stop].some((v) => String(v).trim() === '')
  const suggested = adr.phase === 'ready' ? adrStop({ entry, adrPct: adr.adr.adrPct, side }) : null
  const adrText = adr.phase === 'ready' ? formatNumber(adr.adr.adrPct, { decimals: 1 }) : null
  // The refusal sentence can be about any of the four numbers, so every field points at it.
  const errorId = `${ids}-error`
  const showError = !blank && !result.ok

  const field = (key, label, value, set, hint = null, onEdit = null) => (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`${ids}-${key}`}>{label}</label>
      <Input id={`${ids}-${key}`} className={styles.input} type="text" inputMode="decimal" autoComplete="off"
        aria-describedby={[hint ? `${ids}-${key}-hint` : null, showError ? errorId : null].filter(Boolean).join(' ') || undefined}
        value={value} onChange={(e) => { set(e.target.value); onEdit?.() }} data-testid={`terminal-size-${key}`} />
      {hint ? <span className={styles.hint} id={`${ids}-${key}-hint`}>{hint}</span> : null}
    </div>
  )

  let entryHint = null
  if (s && prefilledAt && !entryTouched) entryHint = `Live price for ${s}`
  else if (s && !entryTouched && entry === '' && live === null) {
    entryHint = priceError ? `No live price for ${s} right now; type the entry.` : `Waiting for a live price for ${s}.`
  }

  return (
    <div className={`${shared.wrap} ${inPanel ? shared.inPanel : ''}`} data-testid="terminal-size">
      <p className={shared.lede}>
        {s ? `Size a trade in ${s}. ` : ''}Risk a fixed share of the account between entry and stop.
      </p>

      <div className={shared.group} role="group" aria-label="Trade side">
        <button type="button" className={shared.chip} aria-pressed={side === 'long'} onClick={() => setSide('long')}
          data-testid="terminal-size-side-long">Long (stop below entry)</button>
        <button type="button" className={shared.chip} aria-pressed={side === 'short'} onClick={() => setSide('short')}
          data-testid="terminal-size-side-short">Short (stop above entry)</button>
      </div>

      <form className={styles.form} onSubmit={(e) => e.preventDefault()} aria-label="Position size inputs">
        {field('account', 'Account size ($)', account, setAccount)}
        {field('risk', 'Risk per trade (%)', riskPct, setRiskPct, `Default ${DEFAULT_RISK_PCT}%`)}
        {field('entry', 'Entry price ($)', entry, setEntry, entryHint, () => setEntryTouched(true))}
        {field('stop', 'Stop price ($)', stop, setStop)}
      </form>

      {s ? (
        <div className={styles.adr} role="status" data-testid="terminal-size-adr" data-phase={adr.phase}>
          {adr.phase === 'loading' ? <span>Measuring the ADR for {s}.</span> : null}
          {adr.phase === 'none' ? <span>No ADR stop: not enough daily history for {s}.</span> : null}
          {adr.phase === 'warming' || adr.phase === 'error' ? (
            <>
              <span>{adr.phase === 'warming' ? `Daily history for ${s} is still loading.` : `Could not read the ADR for ${s} just now.`}</span>
              <button type="button" className={shared.chip} onClick={adr.retry} data-testid="terminal-size-adr-retry">Retry</button>
            </>
          ) : null}
          {adr.phase === 'ready' && suggested === null ? (
            <span>ADR {adrText}%. Enter an entry to see a stop one ADR away.</span>
          ) : null}
          {adr.phase === 'ready' && suggested !== null ? (
            <>
              <span data-testid="terminal-size-adr-text">
                Suggested stop: {priceText(suggested)} (1 ADR {side === 'short' ? 'above' : 'below'} entry, ADR {adrText}%)
              </span>
              <button type="button" className={shared.chip} data-testid="terminal-size-adr-apply"
                onClick={() => setStop(formatNumber(suggested, { decimals: 2, grouping: false }))}>Use this stop</button>
            </>
          ) : null}
        </div>
      ) : null}

      {blank ? (
        <p className={shared.muted} data-testid="terminal-size-prompt">Fill in the account, entry and stop to size the trade.</p>
      ) : !result.ok ? (
        <p className={shared.note} role="alert" id={errorId} data-testid="terminal-size-error">{result.error}</p>
      ) : (
        <div data-testid="terminal-size-result">
          <div className={shared.head}>
            <span className={`${styles.side} ${result.side === 'short' ? styles.sideShort : styles.sideLong}`} data-testid="terminal-size-side">
              {result.side === 'short' ? 'Short' : 'Long'}
            </span>
            <span className={styles.big} data-testid="terminal-size-shares">{formatNumber(result.shares, { decimals: 0 })} shares</span>
          </div>
          <div className={shared.tableBox}>
            <table className={shared.table} aria-label="Position size" data-testid="terminal-size-table">
              <tbody>
                <tr><th scope="row">$ at risk</th><td>{money(result.dollarRisk)} ({formatPercent(result.riskPctActual, { decimals: 2 })} of account)</td></tr>
                <tr><th scope="row">Risk per share (1R)</th><td>{priceText(result.perShare)} ({formatPercent(result.stopPct, { decimals: 2 })} of entry)</td></tr>
                <tr><th scope="row">Position size</th><td>{money(result.position)}</td></tr>
                <tr><th scope="row">Share of account</th><td>{formatPercent(result.positionPct, { decimals: 1 })}</td></tr>
              </tbody>
            </table>
          </div>
          {result.overAccount ? (
            <p className={shared.note} role="status" data-testid="terminal-size-margin">The position is larger than the account, so it needs margin.</p>
          ) : null}
          <div className={shared.tableBox}>
            <table className={shared.table} aria-label="R multiple targets" data-testid="terminal-size-targets">
              <thead>
                <tr><th scope="col">Target</th><th scope="col">Price</th><th scope="col">Profit</th></tr>
              </thead>
              <tbody>
                {result.targets.map((t) => (
                  <tr key={t.r} data-testid={`terminal-size-target-${t.r}R`}>
                    <td>{t.r}R</td>
                    <td>{priceText(t.price)}</td>
                    <td>{money(t.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className={shared.muted} data-testid="terminal-size-method">
        Shares round down so the risk never exceeds the budget. Account and risk % are remembered in this browser only.
      </p>
    </div>
  )
}
