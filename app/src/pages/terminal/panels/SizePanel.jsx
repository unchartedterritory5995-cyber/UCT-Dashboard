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
// ⛔ NO ADR STOP SUGGESTION. No ADR value reaches the browser cheaply (it is not on the DES snapshot
// or the live-price payload), and a suggestion built on a second fetch is not worth its failure
// mode here, so none is offered.
//
// A long needs its stop below the entry, a short above. The side is a choice the member makes,
// labelled in words, and a stop on the wrong side is refused with a sentence, never sized.
import { useEffect, useId, useMemo, useState } from 'react'
import useLivePrices from '../../../hooks/useLivePrices'
import Input from '../../../components/ui/Input'
import { useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { DEFAULT_RISK_PCT, computeSize, parseNum } from './sizeMath'
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
  const live = s ? parseNum(prices?.[s]?.price) : null

  // Prefill the entry once from the live price; the member's own typing always wins.
  useEffect(() => {
    if (!s || entryTouched || entry !== '' || live === null || live <= 0) return
    setEntry(formatNumber(live, { decimals: 2, grouping: false }))
    setPrefilledAt(new Date().toISOString())
  }, [s, live, entryTouched, entry])

  useEffect(() => { saveSizePrefs({ account, riskPct }) }, [account, riskPct])

  usePanelFreshness(prefilledAt ? { source: 'Live price (entry prefill only)', observedAt: prefilledAt } : null)

  const result = useMemo(() => computeSize({ account, riskPct, entry, stop, side }), [account, riskPct, entry, stop, side])
  const blank = [account, entry, stop].some((v) => String(v).trim() === '')

  const field = (key, label, value, set, hint = null, onEdit = null) => (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`${ids}-${key}`}>{label}</label>
      <Input id={`${ids}-${key}`} className={styles.input} type="text" inputMode="decimal" autoComplete="off"
        value={value} onChange={(e) => { set(e.target.value); onEdit?.() }} data-testid={`terminal-size-${key}`} />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
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

      {blank ? (
        <p className={shared.muted} data-testid="terminal-size-prompt">Fill in the account, entry and stop to size the trade.</p>
      ) : !result.ok ? (
        <p className={shared.note} role="alert" data-testid="terminal-size-error">{result.error}</p>
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
