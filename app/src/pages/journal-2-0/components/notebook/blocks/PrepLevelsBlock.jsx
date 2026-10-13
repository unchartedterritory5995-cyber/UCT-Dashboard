// The daily prep pack's key levels block (Notebook P2b, Task 10; spec §P2 item 6): one line per card on
// the member's setups board, frozen at capture. The card is the board's own (setups_board.py), and the
// state and distance are said in the board's own words (lib/blocks/setupsBoardText), so the two never
// describe one card two ways, and the setup the plan was tagged with leads the line when it has one. A level the plan never drew is left out, never invented. The snapshot
// holds one page of the board with the member's own total; a shorter page says so.
import PrepCapture from './PrepCapture'
import { money, stateAndDistance } from '../../../lib/blocks/setupsBoardText'
import styles from './Blocks.module.css'

const LEVELS = [['entry', 'Entry'], ['stop', 'Stop'], ['target', 'Target']]

function cardLine(c) {
  const parts = [c.symbol]
  if (c.setupTag) parts.push(c.setupTag)
  parts.push(stateAndDistance(c))
  for (const [key, label] of LEVELS) if (typeof c[key] === 'number') parts.push(`${label} ${money(c[key])}`)
  return parts.join(' · ')
}

export default function PrepLevelsBlock(props) {
  return (
    <PrepCapture part="levels" {...props}>
      {(s) => {
        const cards = Array.isArray(s.cards) ? s.cards : []
        return (
          <>
            <ul className={styles.list} aria-label="Setups on your board">
              {cards.map((c) => <li key={`${c.noteId}:${c.symbol}`}>{cardLine(c)}</li>)}
            </ul>
            {typeof s.total === 'number' && s.total > cards.length && (
              <p className={styles.muted}>{`Showing ${cards.length} of your ${s.total} setups.`}</p>
            )}
          </>
        )
      }}
    </PrepCapture>
  )
}
