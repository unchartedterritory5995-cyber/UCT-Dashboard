// Notebook widgets phase 2, wave 11 (Task 11.18, rulings W11-R8 / W11-R9): the 3rd-day question.
//
// One line above a note's body: "Was <title> helpful?" with Yes, Not really and a Dismiss icon. The SERVER decides
// whether it shows (`GET /notes/{id}/helpful-prompt`): once per member and item, only on a note made on the member's
// 3rd-or-later use day, never on the author's own item. This file asks once on mount and draws what it is told.
//
// Any answer hides the line at once (optimistic) and posts it (`POST /{item id}/helpful-prompt`); "Yes" also marks
// Helpful on the server. A failed post shows nothing: the line stays hidden. It is a courtesy, never a task.
// Fix round 1: the answer is said in a polite live region that exists from mount (before any text is set), and focus
// goes where the host says (`onDone`: the note body), never to <body> with the button that had it.
//
// ⛔ Live state never enters a note: no editor transaction, no note PUT, no outbox entry. This component is handed a
//    note id and nothing else; it cannot reach the editor or the note's save path.
// ⛔ LAZY. NoteEditorPage loads it through ONE guarded dynamic import (a styled note while wave 11 is on).
import { useEffect, useId, useState } from 'react'
import { answerHelpfulPrompt, helpfulPrompt } from '../../../lib/templateLibrary'
import UIcon from '../../../../../components/ui/UIcon'
import styles from './HelpfulPromptLine.module.css'

const text = (v) => (typeof v === 'string' ? v.trim() : '')
const isId = (v) => (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && Number.isFinite(v))

/** The server's answer, reduced to what the line draws; anything short of a full "show" is no line. */
export function promptOf(out) {
  const d = out?.ok ? out.data : null
  if (!d || d.show !== true || !isId(d.itemId)) return null
  const title = text(d.title)
  const line = text(d.line) || (title ? `Was ${title} helpful?` : '')
  return line ? { itemId: d.itemId, line } : null
}

/** What the live region says once the member answers (the post is optimistic, so it promises nothing more). */
export const ANSWERED_WORDS = 'Thanks for your answer.'

export default function HelpfulPromptLine({ noteId, onDone }) {
  const uid = useId()
  const [prompt, setPrompt] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [said, setSaid] = useState('')

  useEffect(() => {
    let live = true
    setPrompt(null)
    setAnswered(false)
    setSaid('')
    if (!isId(noteId)) return undefined
    helpfulPrompt(noteId).then((out) => { if (live) setPrompt(promptOf(out)) }, () => {})
    return () => { live = false }
  }, [noteId])

  const answer = (choice) => {
    // Focus first, while the pressed button still exists, so it never falls to <body> when the line goes.
    onDone?.()
    setAnswered(true)
    setSaid(ANSWERED_WORDS)
    // Fire and forget: the line is already gone, and a refusal or an outage changes nothing the member can see.
    answerHelpfulPrompt(prompt.itemId, choice).catch(() => {})
  }

  // ⛔ ONE live region, present from mount and always FIRST in the same fragment, so React keeps the same element
  // across every state and its text arrives as a change the reader hears (never a region born with its words).
  return (
    <>
    <p className={styles.srOnly} role="status" data-helpful-prompt-status="">{said}</p>
    {prompt && !answered && (
    <div className={styles.line} role="group" aria-labelledby={`${uid}-q`} data-helpful-prompt="" data-export-exclude>
      <p className={styles.question} id={`${uid}-q`}>{prompt.line}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={() => answer('yes')}>Yes</button>
        <button type="button" className={styles.btn} onClick={() => answer('not_really')}>Not really</button>
        <button type="button" className={styles.iconBtn} onClick={() => answer('dismissed')} aria-label="Dismiss">
          <UIcon name="x" size={14} gold={false} />
        </button>
      </div>
    </div>
    )}
    </>
  )
}
