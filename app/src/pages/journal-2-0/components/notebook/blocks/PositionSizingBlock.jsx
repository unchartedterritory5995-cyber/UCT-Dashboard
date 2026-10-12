// The position sizing block (Notebook P2a, Task 11): the HOUSE formula only (spec §P2 item 5, R-P2-5,
// IR-S10). Every number it shows is either something the member typed into this block or something
// lib/blocks/houseSizing.js derives from app/src/constants/houseSizing.json; a missing input is a
// sentence, never a guessed value.
// ⛔ Its one write door is `setParams` (one editor transaction, blocks/useBlockParams.js). It READS
// settings and the regime through their hooks and never calls a hook's writer (PositionSizingBlock.test
// pins that `save` is never called).
// ⛔ IR-S9 / integrator ruling S9: the server writes a $100,000 placeholder into every new account, so
// an account size that is unset or still that placeholder is NOT the member's: nothing is sized against
// it. The block says why and offers a size for this note instead.
import { useId } from 'react'
import useJ2Settings from '../../../hooks/useJ2Settings'
import useJ2CurrentRegime from '../../../hooks/useJ2CurrentRegime'
import {
  houseSize, accountSizeFor, isPlaceholderAccount, articleFor,
  REGIME_OF, PLACEHOLDER_ACCOUNT_SIZE, MAX_ACCOUNT_RISK_PCT,
} from '../../../lib/blocks/houseSizing'
import blockStyles from './Blocks.module.css'
import styles from './PositionSizingBlock.module.css'

const GRADES = ['A+', 'A', 'B']
const money = (x) => `$${Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const num = (raw) => {
  if (raw === '' || raw == null) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
const knownRegime = (id) => (id && Object.hasOwn(REGIME_OF, id) ? id : null)
// A reason another line of the block already says (the regime line, the account notice) is not repeated.
const SAID_ELSEWHERE = new Set(['regime', 'account'])

export default function PositionSizingBlock({ params = {}, setParams, editable }) {
  const ids = { entry: useId(), stop: useId(), grade: useId(), account: useId() }
  const { settings, isLoading } = useJ2Settings()
  const { regime: cur } = useJ2CurrentRegime()

  const todayId = knownRegime(cur?.regime)
  const storedId = knownRegime(params.regimeId)
  const regimeId = storedId || todayId
  const regime = regimeId ? REGIME_OF[regimeId] : null
  const asOf = storedId ? params.regimeAsOf : cur?.asOf
  const grade = params.grade || 'A'

  // S9: settings that have not answered yet are neither the member's size nor "unset".
  const settingsKnown = settings != null || !isLoading
  const settingsOwn = accountSizeFor({ params: {}, settings })
  const needsOwnSize = settingsKnown && settingsOwn == null
  const noteSize = num(params.accountSize)
  const accountSize = accountSizeFor({ params, settings })

  // The first change to a block that carries no regime stamps the regime it was sized in (R-W0-2:
  // the stamp's date is the regime read's own, never one made up here).
  const stamp = todayId ? { regimeId: todayId, regimeAsOf: cur?.asOf || '' } : {}
  const write = (patch) => (editable ? setParams({ ...patch, ...(storedId ? {} : stamp) }) : false)

  const r = houseSize({ entry: params.entry, stop: params.stop, accountSize, grade, regime })
  const why = isPlaceholderAccount(settings)
    ? `Your account size is still the ${money(PLACEHOLDER_ACCOUNT_SIZE)} default, so this block does not size against it.`
    : 'Your account size is not set yet.'

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
            <>
              <p className={blockStyles.muted}>{why}</p>
              <p className={blockStyles.muted}>Set your account size in Settings.</p>
            </>
          )}
          <div className={styles.field}>
            <label htmlFor={ids.account}>Account size for this note</label>
            <input id={ids.account} className={styles.input} type="number" inputMode="decimal" step="any" disabled={!editable}
              value={params.accountSize ?? ''} onChange={(e) => write({ accountSize: num(e.target.value) })} />
          </div>
        </div>
      )}
      {!settingsKnown && noteSize == null && <p className={blockStyles.muted}>Reading your account size…</p>}

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

      <div aria-live="polite">
        {r.ok ? (
          <ul className={styles.result} aria-label="Position size">
            <li>{`${r.sizePct}% of the account`}</li>
            <li>{`${r.shares} ${r.shares === 1 ? 'share' : 'shares'}`}</li>
            <li>{`${money(r.positionDollars)} position`}</li>
            <li>{`${money(r.riskDollars)} at risk (${r.riskPct}% of the account)`}</li>
            <li className={blockStyles.muted}>
              {r.boundBy === 'risk'
                ? `Capped by the ${MAX_ACCOUNT_RISK_PCT}% account-risk limit.`
                : `The ${regime} ceiling for ${articleFor(grade)} ${grade} setup.`}
            </li>
          </ul>
        ) : (
          !SAID_ELSEWHERE.has(r.code) && <p className={blockStyles.muted}>{r.reason}</p>
        )}
      </div>
    </div>
  )
}
