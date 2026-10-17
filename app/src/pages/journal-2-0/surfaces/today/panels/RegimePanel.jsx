/**
 * Today panel: market regime (P4a Task 4).
 *
 * Reads `GET /api/j2/regime` (useJ2CurrentRegime). The payload is
 * `{ regime: 'green'|'amber'|'orange'|'red'|null, score, source, asOf }` (regime_from_exposure in
 * api/services/journal_two/regime.py), so the regime id is `regime.regime`; there is no `label` field.
 * The word shown is `regimeWord(id)` (lib/blocks/regimeWords.js), the one map the Notebook's blocks and its
 * board column read, so Today says "Yellow" where the notes say "Yellow".
 *
 * ⛔ Never a guessed regime. While the read is in flight, when it failed, when the payload names no regime
 * (the wire has not landed) and when it names an id the map has no word for, the panel says it is not
 * available, and shows no word at all.
 *
 * The payload carries no reason sentence today. A `reason` string, if the server ever sends one, is shown as
 * one line under the word; nothing is invented in its place. `asOf` is the date of the wire the regime was
 * read from, shown so a regime from a stale wire does not read as today's.
 */
import TileCard from '../../../../../components/TileCard'
import useJ2CurrentRegime from '../../../hooks/useJ2CurrentRegime'
import { regimeWord } from '../../../lib/blocks/regimeWords'
import styles from './panels.module.css'

const UNAVAILABLE = 'Market regime is not available right now.'
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/

export default function RegimePanel() {
  const { regime, isLoading, error } = useJ2CurrentRegime()
  const word = isLoading || error ? null : regimeWord(regime?.regime)
  const reason = typeof regime?.reason === 'string' ? regime.reason.trim() : ''
  const asOf = typeof regime?.asOf === 'string' && DATE_PREFIX.test(regime.asOf) ? regime.asOf.slice(0, 10) : ''

  return (
    <TileCard title="Market regime" icon="breadth">
      {word ? (
        <div>
          <p className={styles.regimeWord} data-regime={regime.regime}>
            <span className={styles.regimeDot} aria-hidden="true" />
            {word}
          </p>
          {reason && <p className={styles.regimeLine}>{reason}</p>}
          {asOf && <p className={styles.regimeLine}>As of {asOf}</p>}
        </div>
      ) : (
        <p className={styles.muted}>{UNAVAILABLE}</p>
      )}
    </TileCard>
  )
}
