import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, {
  useSnapshotFrame, NA, accountSourceLine, fmtDay, snapshotStyles as s,
} from './SnapshotFrame'

const NO_CHECKS = 'No rule checks in this range yet.'

const isCount = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Notebook widgets: My rules check. Rendered from `attrs.params` only.
 *
 * ⛔ The headline is the top-level `kept` / `total`, which are authoritative. The per-rule rows are a
 * breakdown and are never summed into the headline. Null counts mean "nothing to count": the empty
 * sentence, never "Kept 0 of 0".
 */
export default function MyRulesCheckEmbed({ attrs, height = 260, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myRulesCheck', attrs, { editable, onUpdateParams })
  const from = fmtDay(p.range?.from)
  const to = fmtDay(p.range?.to)
  const rules = Array.isArray(p.rules) ? p.rules : []
  const hasCounts = isCount(p.kept) && isCount(p.total)

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-rules-check-embed">
      <SnapshotFrame {...frame} sourceLine={accountSourceLine(p)}>
        {from && to && <p className={s.range}>{`${from} to ${to}`}</p>}
        {!hasCounts ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || NO_CHECKS}</p>
        ) : (
          <>
            <p className={s.statValue}>{`Kept ${p.kept} of ${p.total} rule checks`}</p>
            {rules.length > 0 && (
              <div className={s.tableWrap}>
                <table className={s.table} aria-label="Rule checks by rule, as captured">
                  <thead>
                    <tr>
                      <th scope="col">Rule</th>
                      <th scope="col">Kept</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, i) => (
                      <tr key={`${r?.rule || 'rule'}-${i}`}>
                        <td>{r?.rule || 'Unnamed rule'}</td>
                        <td>
                          {isCount(r?.kept) && isCount(r?.total)
                            ? `${r.kept} of ${r.total}`
                            : <NA reason="No checks for this rule in this range" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={s.note}>Rows count each rule only for trades made after it existed.</p>
          </>
        )}
      </SnapshotFrame>
    </div>
  )
}
