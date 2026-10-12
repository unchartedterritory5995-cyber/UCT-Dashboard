// The position sizing block (Notebook P2a, Task 11): the HOUSE formula only (spec §P2 item 5, R-P2-5,
// IR-S10). Every number it shows is either something the member typed into this block or something
// lib/blocks/houseSizing.js derives from app/src/constants/houseSizing.json; a missing input is a
// sentence, never a guessed value.
// ⛔ Its one write door is `setParams` (one editor transaction, blocks/useBlockParams.js). It READS
// settings and the regime through their hooks and never calls a hook's writer (PositionSizingBlock.test
// pins that `save` is never called; "Try again" calls the hook's `refresh`, a re-read).
// ⛔ IR-S9 / integrator ruling S9: the server writes a $100,000 placeholder into every new account, so
// an account size that is unset or still that placeholder is NOT the member's: nothing is sized against
// it. The block says why and offers a size for this note instead.
// ⛔ R-T11-1 C-1 / R-T11-2 N-1: with no SPECIFIC account selected (All Accounts, the first load before
// one is picked, or accounts that will not load) useJ2Settings reads the frozen legacy j2_settings row,
// which is not any account's size, so nothing is sized against it. THE RULE IS `accountId == null`
// (useJ2Settings' own accountId) and it stays that rule: an "is all accounts" key, here or lane A's, may
// only choose WHICH SENTENCE explains the missing size, never whether one exists. The accounts list's
// own state (loading, failed, empty) picks the sentence below. The M2 integration moves these reads
// into a read-only seam; this block does not build it.
// ⛔ R-T11-1 I-2: the account size is read LIVE (never stamped into params); the block says which
// account, and which amount, it sized against.
import { useEffect, useId, useState } from 'react'
import useJ2Settings from '../../../hooks/useJ2Settings'
import useJ2CurrentRegime from '../../../hooks/useJ2CurrentRegime'
import useJ2Accounts from '../../../hooks/useJ2Accounts'
import {
  houseSize, accountSizeFor, isPlaceholderAccount, articleFor,
  REGIME_OF, PLACEHOLDER_ACCOUNT_SIZE, MAX_ACCOUNT_RISK_PCT, PREFERRED_ACCOUNT_RISK_PCT,
} from '../../../lib/blocks/houseSizing'
import blockStyles from './Blocks.module.css'
import styles from './PositionSizingBlock.module.css'

const GRADES = ['A+', 'A', 'B']
/** Whole dollars at $10 and above; real cents below, so a small risk is never shown as "$0". */
const money = (x) => {
  const n = Number(x)
  const digits = Math.abs(n) < 10 ? 2 : 0
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
/** A percent that rounds to 0.00 but is not zero reads "under 0.01%", never "0%". */
const pct = (p) => (p > 0 ? `${p}%` : 'under 0.01%')
const sharesWord = (n) => `${n} ${n === 1 ? 'share' : 'shares'}`
const num = (raw) => {
  if (raw === '' || raw == null) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
const knownRegime = (id) => (id && Object.hasOwn(REGIME_OF, id) ? id : null)
// A reason another line of the block already says (the regime line, the account notice) is not repeated.
const SAID_ELSEWHERE = new Set(['regime', 'account'])
// M-5: the live region speaks the SETTLED result, not every keystroke in Entry or Stop.
const SETTLE_MS = 800

export default function PositionSizingBlock({ params = {}, setParams, editable }) {
  const ids = { entry: useId(), stop: useId(), grade: useId(), account: useId() }
  const { settings, isLoading, error, refresh, accountName, accountId } = useJ2Settings()
  const accts = useJ2Accounts()
  const { regime: cur } = useJ2CurrentRegime()

  const todayId = knownRegime(cur?.regime)
  const storedId = knownRegime(params.regimeId)
  const regimeId = storedId || todayId
  const regime = regimeId ? REGIME_OF[regimeId] : null
  const asOf = storedId ? params.regimeAsOf : cur?.asOf
  const grade = params.grade || 'A'

  // The account size, and why there is none. Order: no specific account (C-1) · a failed read (M-2) ·
  // still loading (neither the member's size nor "unset") · the placeholder or an unset size (S9).
  const noAccount = accountId == null
  const readFailed = !noAccount && settings == null && !!error
  const usable = noAccount || readFailed ? null : settings
  const settingsKnown = noAccount || readFailed || settings != null || !isLoading
  const settingsOwn = accountSizeFor({ params: {}, settings: usable })
  const needsOwnSize = settingsKnown && settingsOwn == null
  const noteSize = num(params.accountSize) > 0 ? num(params.accountSize) : null
  const accountSize = accountSizeFor({ params, settings: usable })
  const sizedAgainst = noteSize != null
    ? `Sized against this note's ${money(noteSize)}.`
    : settingsOwn != null ? `Sized against ${accountName || 'your account'}: ${money(settingsOwn)}.` : null

  // The first change to a block that carries no regime stamps the regime it was sized in (R-W0-2:
  // the stamp's date is the regime read's own, never one made up here). The account size is NOT stamped.
  const stamp = todayId ? { regimeId: todayId, regimeAsOf: cur?.asOf || '' } : {}
  const write = (patch) => (editable ? setParams({ ...patch, ...(storedId ? {} : stamp) }) : false)

  const r = houseSize({ entry: params.entry, stop: params.stop, accountSize, grade, regime })
  // N-6: "under $0.01" inside a sentence; a list line that STARTS with it capitalises its first letter.
  const riskMoney = r.ok ? (r.riskDollars > 0 ? money(r.riskDollars) : 'under $0.01') : null
  const summary = r.ok ? `${sharesWord(r.shares)}, ${riskMoney} at risk.` : r.skip ? r.reason : ''
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(summary), SETTLE_MS)
    return () => clearTimeout(t)
  }, [summary])

  return (
    <div className={blockStyles.empty}>
      <div className={styles.fields}>
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
          <label htmlFor={ids.grade}>Setup grade</label>
          <select id={ids.grade} className={styles.select} disabled={!editable} value={grade}
            onChange={(e) => write({ grade: e.target.value })}>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      {(needsOwnSize || noteSize != null) && (
        <div className={styles.notice}>
          {needsOwnSize && noteSize == null && (
            noAccount ? (
              accts?.error ? (
                <>
                  <p className={blockStyles.muted}>Your accounts could not be loaded just now.</p>
                  {typeof accts.refresh === 'function' && (
                    <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => accts.refresh()}>Try again</button>
                  )}
                </>
              ) : accts?.isLoading || !accts ? (
                <p className={blockStyles.muted}>Loading your accounts…</p>
              ) : (accts.accounts || []).length === 0 ? (
                <p className={blockStyles.muted}>You have no accounts yet. Enter a size for this note.</p>
              ) : (
                <p className={blockStyles.muted}>Pick one account to size against, or enter a size for this note.</p>
              )
            ) : readFailed ? (
              <>
                <p className={blockStyles.muted}>Your account size could not be read just now.</p>
                {typeof refresh === 'function' && (
                  <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => refresh()}>Try again</button>
                )}
              </>
            ) : (
              <>
                <p className={blockStyles.muted}>
                  {isPlaceholderAccount(settings)
                    ? `Your account size is still the ${money(PLACEHOLDER_ACCOUNT_SIZE)} default, so this block does not size against it.`
                    : 'Your account size is not set yet.'}
                </p>
                <p className={blockStyles.muted}>Set your account size in Settings.</p>
              </>
            )
          )}
          <div className={styles.field}>
            <label htmlFor={ids.account}>Account size for this note</label>
            <input id={ids.account} className={styles.input} type="number" inputMode="decimal" step="any" disabled={!editable}
              value={params.accountSize ?? ''} onChange={(e) => write({ accountSize: num(e.target.value) })} />
          </div>
        </div>
      )}
      {!settingsKnown && noteSize == null && <p className={blockStyles.muted}>Reading your account size…</p>}
      {sizedAgainst && <p className={blockStyles.muted}>{sizedAgainst}</p>}

      <p className={blockStyles.muted}>
        {regime ? `Sized for ${articleFor(regime)} ${regime} market${asOf ? ` (as of ${asOf})` : ''}.` : 'The market regime is not known yet.'}
      </p>
      {todayId && storedId && storedId !== todayId && (
        <>
          <p className={blockStyles.muted}>{`Today's market is ${REGIME_OF[todayId]}.`}</p>
          {editable && (
            <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams(stamp)}>
              {`Use today's regime (${REGIME_OF[todayId]})`}
            </button>
          )}
        </>
      )}

      {r.ok ? (
        <ul className={styles.result} aria-label="Position size">
          <li>{`House size: ${r.sizePct}% of the account`}</li>
          <li>{sharesWord(r.shares)}</li>
          <li>{`${money(r.positionDollars)} position`}</li>
          {r.positionPct !== r.sizePct && <li>{`Whole shares: ${pct(r.positionPct)} of the account`}</li>}
          <li>{`${riskMoney[0].toUpperCase()}${riskMoney.slice(1)} at risk (${pct(r.riskPct)} of the account)`}</li>
          {r.riskPct > PREFERRED_ACCOUNT_RISK_PCT && r.riskPct <= MAX_ACCOUNT_RISK_PCT && (
            <li className={blockStyles.muted}>{`Above the house preference of under ${PREFERRED_ACCOUNT_RISK_PCT}% risk per trade.`}</li>
          )}
          <li className={blockStyles.muted}>
            {r.boundBy === 'risk'
              ? `Capped by the ${MAX_ACCOUNT_RISK_PCT}% account-risk limit.`
              : `The ${regime} ceiling for ${articleFor(grade)} ${grade} setup.`}
          </li>
        </ul>
      ) : (
        !SAID_ELSEWHERE.has(r.code) && <p className={blockStyles.muted}>{r.reason}</p>
      )}
      <p className="sr-only" aria-live="polite" data-testid="sizing-announce">{announced}</p>
    </div>
  )
}
