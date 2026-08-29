// ─── THE PICTURE DOOR — CANDIDATES, NEVER A DIAGNOSIS ───────────────────────
//
// ⭐⭐ WHAT THIS SURFACE IS FOR. A member has an indicator on another platform
// they cannot export — a closed-source script, a broker's own study, something
// paid. They can still screenshot it. This box sends the picture and shows what
// the engine could RECONSTRUCT from it, in this engine's own grammar.
//
// ⛔⛔ AND IT SAYS SO, IN WORDS, BEFORE IT SHOWS ANYTHING. A picture of a curve
// does not determine the formula that drew it. Every candidate carries a
// confidence and WHAT THE MODEL SAW, the copy at the top says these are guesses,
// and nothing is saved until the member picks one. A surface that presented one
// answer as "your indicator" would be lying with a straight face — and would be
// believed, because it renders.
//
// ⭐⭐ THE READ-BACK IS `sentenceFor(candidate.ast)` — COMPUTED HERE, IN THE
// BROWSER, FROM THE TREE. The server's answer carries a `sentence` too and THIS
// COMPONENT DELIBERATELY IGNORES IT, for exactly the reason `ConciergeBox` does:
// a model-written summary of a model-written formula is two guesses agreeing, and
// a server-written one is two hops from the tree. `ImageBox.test.jsx` plants a
// DIFFERENT, plausible server sentence on every candidate and asserts the tree's
// is what renders — the only way to test the claim, since a box echoing a correct
// server sentence would look identical.
//
// ⛔ `readBackFor` IS `ConciergeBox`'s, IMPORTED. Two AI doors, one read-back
// helper: a second copy would be a second place for `SentenceRefusal` handling to
// drift, and the whole discipline here is that the English comes from the tree by
// one route.
//
// ⛔ A REFUSED CANDIDATE SHOWS NO FORMULA. The server already strips them — it
// sends a gate and a reason and no tree — and this box renders exactly that. A
// formula printed beside "this was refused" is a formula somebody copies.
//
// ⛔ AND THE BOX NEVER SAVES. Accepting calls `onAccept` and the BUILDER does the
// writing, through the same store door a typed formula goes through.
//
// ⚠️ NO CLIENT-SIDE COPY OF THE FILE RULES. The accepted media types and the size
// ceiling live in `api/services/indicator_from_image.py`, and this box does not
// restate either: an oversized or unreadable upload comes back as a named refusal
// with the fix in the sentence, and nothing was spent to learn that. The `accept`
// attribute below is a hint to the file picker, not a gate — a second gate here
// would be a second authority over the same two numbers.

import { useCallback, useId, useState } from 'react'
import { readBackFor } from './ConciergeBox.jsx'
import styles from './ImageBox.module.css'

const ENDPOINT = '/api/indicator-vision/candidates'

/** A hint for the OS file picker. NOT a gate — see the header. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

/** ⭐ THE SENTENCE THAT KEEPS THIS HONEST, AND IT IS ALWAYS ON SCREEN — not
 *  revealed after an answer, when a member has already read the first formula as
 *  the answer. */
const DISCLAIMER = (
  'A picture does not tell us the formula. These are the engine’s best '
  + 'guesses at what would draw something like it — read what it saw, check '
  + 'the plain-English read-back, and pick one only if it matches.'
)

/** ⛔ ONE EXPRESSION DRIVES BOTH THE `disabled` PROP AND THE LOOK. An inline
 *  style has no `:disabled` selector; a class does, but the rule that decides is
 *  still passed once so the two can never disagree. */
const dim = (isDisabled) => (isDisabled ? styles.dimmed : undefined)

/** One candidate, read back FROM ITS TREE. Returns the row to render, or a
 *  refusal row — never a formula the read-back could not describe. */
function withReadBack(candidate) {
  const read = readBackFor(candidate.ast, candidate.inputs)
  if (read.error) {
    return { refused: { label: candidate.label, saw: candidate.saw,
                        gate: 'sentence', reason: read.error } }
  }
  return { row: { ...candidate, sentence: read.text } }
}

/**
 * @param {object}   props
 * @param {Array}    [props.bars]      the bars the chart is holding; the server's
 *                                     compute stage runs on the window in view
 * @param {Function} [props.onAccept]  called with `{ast, source, repaint, sentence}`
 *                                     — `sentence` is THIS box's, from the tree
 * @param {Function} [props.fetchImpl] injection point for tests ONLY
 */
export default function ImageBox({ bars, onAccept, fetchImpl, disabled = false }) {
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const fileId = useId()
  const noteId = useId()

  const submit = useCallback(async () => {
    if (!file || busy) return
    setBusy(true)
    setAnswer(null)
    setRefusal(null)
    const doFetch = fetchImpl || ((...args) => fetch(...args))
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('note', note)
      form.append('bars', JSON.stringify(bars || []))
      const res = await doFetch(ENDPOINT, { method: 'POST', body: form })
      // ⚠️ `res.ok` IS CHECKED BEFORE `res.json()`. A 402 and a 429 both answer
      // JSON on this route, and treating every 2xx-or-not the same is how a
      // paywalled surface renders "no answer" instead of "you need a plan".
      if (!res || !res.ok) {
        const status = res ? res.status : 0
        setRefusal({
          gate: `http:${status}`,
          reason: status === 402
            ? 'Reading an indicator from a picture requires a paid plan.'
            : status === 429
              ? 'That is a lot of pictures in one hour. Try again shortly.'
              : 'The picture reader could not be reached just now.',
        })
        return
      }
      const body = await res.json()
      if (!body || body.ok !== true) {
        setRefusal({
          gate: (body && body.gate) || 'unknown',
          reason: (body && body.reason) || 'That picture could not be read.',
          saw: (body && body.saw) || '',
          refused: (body && body.refused) || [],
        })
        return
      }
      // ⛔ EVERY READ-BACK IS COMPUTED HERE, FROM `candidate.ast`. `sentence` on
      // the wire is never read — see the header.
      const rows = []
      const rejected = [...(body.refused || [])]
      for (const candidate of body.candidates || []) {
        const out = withReadBack(candidate)
        if (out.refused) rejected.push(out.refused)
        else rows.push(out.row)
      }
      if (!rows.length) {
        setRefusal({ gate: 'sentence', saw: body.saw || '', refused: rejected,
                     reason: 'Nothing in that picture came back as a formula this '
                             + 'engine can describe.' })
        return
      }
      setAnswer({ saw: body.saw || '', candidates: rows, refused: rejected })
    } catch (err) {
      setRefusal({ gate: 'network',
                   reason: 'The picture reader could not be reached just now.' })
    } finally {
      setBusy(false)
    }
  }, [file, note, bars, busy, fetchImpl])

  const blocked = disabled || busy || !file

  return (
    <div className={styles.wrap} data-testid="image-box">
      <p className={styles.head}>Recreate it from a screenshot</p>
      <p className={styles.disclaimer} data-testid="image-disclaimer">{DISCLAIMER}</p>

      <label className={styles.label} htmlFor={fileId}>The picture</label>
      <input
        id={fileId}
        type="file"
        accept={ACCEPT}
        className={styles.file}
        data-testid="image-file"
        disabled={disabled || busy}
        onChange={(e) => {
          setFile((e.target.files && e.target.files[0]) || null)
          setAnswer(null)
          setRefusal(null)
        }}
      />

      <label className={styles.label} htmlFor={noteId}>
        Anything you know about it (optional)
      </label>
      <input
        id={noteId}
        type="text"
        className={styles.note}
        data-testid="image-note"
        placeholder="e.g. it sits under the price and its scale runs 0 to 100"
        value={note}
        disabled={disabled || busy}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.button} ${dim(blocked) || ''}`}
          disabled={blocked}
          onClick={submit}
        >
          {busy ? 'Reading…' : 'Read the picture'}
        </button>
        {busy ? <span className={styles.meta} role="status">working</span> : null}
        {/* A dimmed button says it is off; it does not say WHY, and the control
            it wants used is directly above. */}
        {!busy && !disabled && !file ? (
          <span className={styles.meta}>Choose a picture first</span>
        ) : null}
      </div>

      {refusal ? (
        <div className={styles.refusal} role="alert" data-testid="image-refusal">
          <div>{refusal.reason}</div>
          {refusal.saw ? (
            <div className={styles.saw} data-testid="image-refusal-saw">
              What it saw: {refusal.saw}
            </div>
          ) : null}
          <div className={styles.meta} data-testid="image-gate">{refusal.gate}</div>
        </div>
      ) : null}

      {answer ? (
        <div className={styles.answer} data-testid="image-answer">
          {answer.saw ? (
            <p className={styles.saw} data-testid="image-saw">
              What it saw: {answer.saw}
            </p>
          ) : null}
          {answer.candidates.map((c, i) => (
            <div className={styles.candidate} key={`c-${i}`} data-testid="image-candidate">
              <div className={styles.candidateHead}>
                <span className={styles.rank}>{c.rank || i + 1}</span>
                <span className={styles.label} data-testid="image-label">
                  {c.label || 'unnamed'}
                </span>
                {/* ⭐ THE CONFIDENCE IS SHOWN AS THE MODEL'S OWN NUMBER, not
                    dressed up as a probability the firm stands behind. */}
                <span className={styles.confidence} data-testid="image-confidence">
                  {c.confidence}% sure
                </span>
              </div>
              {c.saw ? (
                <div className={styles.saw} data-testid="image-candidate-saw">
                  Because: {c.saw}
                </div>
              ) : null}
              <div className={styles.sentence} data-testid="image-readback">
                {c.sentence}
              </div>
              <div className={styles.source} data-testid="image-source">{c.source}</div>
              <div className={styles.meta}>{c.repaint}</div>
              <button
                type="button"
                className={styles.button}
                data-testid="image-accept"
                onClick={() => onAccept && onAccept({
                  ast: c.ast, source: c.source, repaint: c.repaint,
                  // ⛔ THE BOX'S OWN READ-BACK TRAVELS, never the server's.
                  sentence: c.sentence,
                })}
              >
                Use this one
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* ⛔ THE REFUSED ONES ARE NAMED, WITH THE DOOR THAT DECIDED AND NO
          FORMULA. A member who is shown two candidates and told nothing else
          cannot tell "it only found two" from "it found five and three were
          nonsense" — and the second is the one that says how much to trust the
          two. */}
      {(answer || refusal) && ((answer || refusal).refused || []).length ? (
        <div className={styles.rejected} data-testid="image-rejected">
          <div className={styles.meta}>
            Not offered, and why
          </div>
          {((answer || refusal).refused || []).map((r, i) => (
            <div key={`r-${i}`} data-testid="image-rejected-item">
              <span className={styles.label}>{r.label || 'unnamed'}</span>
              {' — '}{r.reason}
              <span className={styles.meta} data-testid="image-rejected-gate">
                {' '}{r.gate}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
