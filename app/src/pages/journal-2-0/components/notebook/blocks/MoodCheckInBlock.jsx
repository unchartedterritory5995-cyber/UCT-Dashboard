// The mood and focus check-in block (P2 Tier 3, Task 3; spec §P2 Tier 3 item 13, R-T3-2).
// params { mood: ''|'1'..'5', focus: ''|'1'..'5', day: ''|'YYYY-MM-DD' }. Two rows of five toggle buttons;
// pressing the picked one clears it. `day` is the ET date of the first pick (lib/blocks/checkinWords.js
// holds the ONE rule), so a check-in made just after midnight ET counts for the new ET day.
// ⛔ Block integrity rule: the ONE write is `setParams` (useBlockParams's setter, handed down by
// BlockNodeView): one editor transaction per press, riding the note's own save. It reads nothing and
// fetches nothing.
// ⛔ Read-only (a shared or published view, or a locked note) shows the picked words as text, no buttons.
import { useId, useState } from 'react'
import { todayET } from '../../../lib/calendar'
import { CHECKIN_LEVELS, FOCUS_WORDS, MOOD_WORDS, checkinDayText, checkinText, nextCheckinParams } from '../../../lib/blocks/checkinWords'
import styles from './Blocks.module.css'
import own from './MoodCheckInBlock.module.css'

const ROWS = [
  { key: 'mood', name: 'Mood', words: MOOD_WORDS },
  { key: 'focus', name: 'Focus', words: FOCUS_WORDS },
]
const PROMPT = 'Pick how you feel and how focused you are.'

function Row({ row, picked, onPick }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className={own.row}>
      <span id={labelId} className={own.rowLabel}>{row.name}</span>
      <div className={own.choices}>
        {CHECKIN_LEVELS.map((v) => {
          const on = picked === v
          return (
            <button key={v} type="button" aria-pressed={on} aria-label={`${row.name}: ${row.words[v]}`}
              className={`btn btn-ghost ${styles.tap} ${own.choice} ${on ? own.on : ''}`}
              onClick={() => onPick(row.key, on ? '' : v)}>
              {row.words[v]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function MoodCheckInBlock({ params, setParams, editable }) {
  const [notSaved, setNotSaved] = useState(false)
  const p = params || {}
  if (!editable) {
    const words = checkinText(p)
    return <p className={own.words}>{words || 'No check-in yet.'}</p>
  }
  const pick = (key, value) => {
    const ok = typeof setParams === 'function' && setParams(nextCheckinParams(p, key, value, todayET()))
    setNotSaved(ok === false)
  }
  const day = checkinDayText(p.day)
  const anyPick = Boolean(checkinText(p))
  return (
    <div className={own.rows}>
      {ROWS.map((row) => <Row key={row.key} row={row} picked={p[row.key]} onPick={pick} />)}
      <p className={styles.muted}>{anyPick && day ? `Checked in for ${day}` : PROMPT}</p>
      {notSaved && <p role="status" className={styles.muted}>That choice couldn't be saved. Nothing was changed.</p>}
    </div>
  )
}
