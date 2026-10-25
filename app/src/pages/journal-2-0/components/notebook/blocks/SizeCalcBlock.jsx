// The position size calculator block (Notebook widgets wave 10, Task 10.20, ruling W10-R8): a member types a
// symbol, an entry, a stop and how much of the account to risk, and reads how many shares that is. Distinct from the
// house PositionSizingBlock (grade and regime ceilings). The arithmetic is lib/blocks/sizeCalc.js; nothing here
// guesses a number, and fewer than one share is a sentence, never "0 shares".
// ⛔ Its one write door is `setParams` (one editor transaction per input change, blocks/useBlockParams.js), and it
// stores ONLY what the member typed. The account size is read LIVE through hooks/usePositionSizingSources (never
// stamped into params); the account's max risk per trade is a PLACEHOLDER in the risk input, never written and never
// sized against until the member types a value.
// ⛔ IR-S9: an unset account size, or the server's placeholder, is not the member's, so nothing is sized against it;
// the block offers "Account size for this note" instead.
// ⛔ Wave 10 off (the latched notebook_widgets_w10_enabled): "Not available right now." and no inputs. The block makes
// no request of its own, so it learns the wave from the latched flag.
import { useEffect, useId, useState } from 'react'
import usePositionSizingSources from '../../../hooks/usePositionSizingSources'
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import { accountSizeFor } from '../../../lib/blocks/houseSizing'
import { sizeFor, pctOf, REASONS } from '../../../lib/blocks/sizeCalc'
import blockStyles from './Blocks.module.css'
import styles from './SizeCalcBlock.module.css'

/** Whole dollars at $10 and above; real cents below, so a small amount is never shown as "$0". */
const money = (x) => {
  const n = Number(x)
  const digits = Math.abs(n) < 10 ? 2 : 0
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
/** A percent that rounds to 0.00 but is not zero reads "under 0.01%", never "0%". */
const pct = (p) => (p > 0 ? `${p}%` : 'under 0.01%')
const num = (raw) => {
  if (raw === '' || raw == null) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
const positive = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null)
// The live region speaks the SETTLED result, not every keystroke (the house block's M-5).
const SETTLE_MS = 800

export const NOT_AVAILABLE = 'Not available right now.'

function Calculator({ params, setParams, editable }) {
  const ids = { symbol: useId(), entry: useId(), stop: useId(), risk: useId(), account: useId() }
  const { settings, settingsState, retrySettings, accountName } = usePositionSizingSources()

  const usable = settingsState === 'ready' ? settings : null
  const settingsOwn = accountSizeFor({ params: {}, settings: usable })     // null: unset, the placeholder, or no account
  const noteSize = positive(params.accountSize)
  const accountSize = noteSize ?? settingsOwn
  const loading = settingsState === 'loading' && noteSize == null
  const readFailed = settingsState === 'error' && noteSize == null
  const showNoteSize = noteSize != null || (settingsOwn == null && settingsState !== 'loading')
  const maxRisk = positive(usable?.maxRiskPerTradePct)
  const symbol = typeof params.symbol === 'string' ? params.symbol.trim().toUpperCase() : ''

  const write = (patch) => (editable ? setParams(patch) : false)

  const r = sizeFor({ entry: params.entry, stop: params.stop, riskPct: params.riskPct, accountSize })
  const riskPct = r.ok ? pctOf(r.riskDollars, accountSize) : null
  const first = r.ok
    ? `${r.shares} ${r.shares === 1 ? 'share' : 'shares'}${symbol ? ` of ${symbol}` : ''}, ${money(r.riskDollars)} at risk (${pct(riskPct)} of the account).`
    : null
  const second = r.ok ? `Position value: ${money(r.positionValue)} (${pct(r.positionPct)} of the account).` : null
  // While the account size is still being read, or the read failed, the account sentence would be a guess.
  const quiet = !r.ok && r.reason === REASONS.account && (loading || readFailed)
  const summary = r.ok ? first : quiet ? '' : r.reason
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(summary), SETTLE_MS)
    return () => clearTimeout(t)
  }, [summary])

  const sizedAgainst = noteSize != null
    ? `Sized against this note's ${money(noteSize)}.`
    : settingsOwn != null ? `Sized against ${accountName || 'your account'}: ${money(settingsOwn)}.` : null

  return (
    <div className={blockStyles.empty}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor={ids.symbol}>Symbol</label>
          <input id={ids.symbol} className={`${styles.input} ${styles.symbol}`} type="text" autoComplete="off"
            spellCheck={false} disabled={!editable} value={params.symbol ?? ''}
            onChange={(e) => write({ symbol: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.entry}>Entry</label>
          <input id={ids.entry} className={styles.input} type="number" inputMode="decimal" step="any" disabled={!editable}
            value={params.entry ?? ''} onChange={(e) => write({ entry: num(e.target.value) })} />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.stop}>Stop</label>
          <input id={ids.stop} className={styles.input} type="number" inputMode="decimal" step="any" disabled={!editable}
            value={params.stop ?? ''} onChange={(e) => write({ stop: num(e.target.value) })} />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.risk}>Risk per trade (%)</label>
          <input id={ids.risk} className={styles.input} type="number" inputMode="decimal" step="any" min="0" max="10"
            disabled={!editable} placeholder={maxRisk != null ? String(maxRisk) : undefined}
            value={params.riskPct ?? ''} onChange={(e) => write({ riskPct: num(e.target.value) })} />
        </div>
        {showNoteSize && (
          <div className={styles.field}>
            <label htmlFor={ids.account}>Account size for this note</label>
            <input id={ids.account} className={styles.input} type="number" inputMode="decimal" step="any" disabled={!editable}
              value={params.accountSize ?? ''} onChange={(e) => write({ accountSize: num(e.target.value) })} />
          </div>
        )}
      </div>

      {loading && <p className={blockStyles.muted}>Reading your account size…</p>}
      {readFailed && (
        <div className={styles.notice}>
          <p className={blockStyles.muted}>Your account size could not be read just now.</p>
          <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={retrySettings}>Try again</button>
        </div>
      )}
      {r.ok ? (
        <div className={styles.result}>
          <p>{first}</p>
          <p>{second}</p>
        </div>
      ) : (
        !quiet && <p className={blockStyles.muted}>{r.reason}</p>
      )}
      {sizedAgainst && <p className={blockStyles.muted}>{sizedAgainst}</p>}
      <p className="sr-only" aria-live="polite" data-testid="size-calc-announce">{announced}</p>
    </div>
  )
}

export default function SizeCalcBlock({ params = {}, setParams, editable }) {
  if (!widgetsWaveOn(10)) return <p className={blockStyles.muted}>{NOT_AVAILABLE}</p>
  return <Calculator params={params || {}} setParams={setParams} editable={editable} />
}
