import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import UIcon from '../../../../../components/ui/UIcon'
import SnapshotFrame, {
  useSnapshotFrame, numCell, toneOf, fmtMoneySigned, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'

const NO_MISTAKES = 'No tagged mistakes yet.'

/** The Journal keeps no label map for mistake tags (its taxonomy is a bare list of raw tags), so the
 *  tag is title-cased with underscores as spaces. A tag already in capitals (FOMO) is left as it is. */
export function humanizeMistake(tag) {
  const words = String(tag ?? '').trim().replace(/_+/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Unnamed mistake'
  const text = words.join(' ')
  if (text === text.toUpperCase()) return text
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

// Text first, an arrow second: the words carry the meaning, so colour is never the only signal.
const TREND = {
  more: { text: 'More often', icon: 'chevronUp' },
  less: { text: 'Less often', icon: 'chevronDown' },
  same: { text: 'Same', icon: 'chevronRight' },
}

/**
 * Notebook widgets: My recurring mistakes. Rendered from `attrs.params` only.
 * ⛔ `cost30d` is money, so it reads like the P&L widget's figures; an unknown cost is n/a, never $0.
 */
export default function MyMistakesEmbed({ attrs, height = 260, editable = false, onUpdateParams }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame('myMistakes', attrs, { editable, onUpdateParams })
  const rows = Array.isArray(p.rows) ? p.rows : []
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const sourceLine = [accountSourceLine(p.source), extra].filter(Boolean).join(' · ') || null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="my-mistakes-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine}>
        {rows.length === 0 ? (
          <p className={s.empty}>{(typeof p.empty === 'string' && p.empty) || NO_MISTAKES}</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table} aria-label="Recurring mistakes, as captured">
              <thead>
                <tr>
                  <th scope="col">Mistake</th>
                  <th scope="col">Cost, last 30 days</th>
                  <th scope="col">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const trend = TREND[r?.trend]
                  return (
                    <tr key={`${r?.mistake || 'row'}-${i}`}>
                      <td>{humanizeMistake(r?.mistake)}</td>
                      <td className={toneOf(r?.cost30d)}>
                        {numCell(r?.cost30d, fmtMoneySigned, 'No cost figure for this mistake in the last 30 days')}
                      </td>
                      <td>
                        {trend ? (
                          <span>
                            <UIcon name={trend.icon} size={12} gold={false} />
                            {' '}{trend.text}
                          </span>
                        ) : (
                          <span className={s.na} title="Trend not available">n/a</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SnapshotFrame>
    </div>
  )
}
