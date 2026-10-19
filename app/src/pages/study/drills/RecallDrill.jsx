/**
 * RecallDrill — type 1 (spec §4.3): multiple choice, true/false, or fill-in.
 *
 * prompt_json:
 *   { q | question, kind: 'mcq' | 'tf' | 'fill' | 'fill_numeric' | 'fill_text',
 *     quote?: '...',           // the thing to name, shown as a quote block above the choices
 *                              //   (the bank's "which term / principle / candle is this" items)
 *     format: 'fill',          // the bank's short free-text items (O'Neil's numbers):
 *                              //   no bank, no sentence -> a plain text input, sent as typed
 *     choices?: [..],          // mcq (2-4); tf defaults to True / False
 *     sentence?: '...___...',  // fill: the blank is ___ (shown as a gold slot)
 *     bank?: [4-6 words],      // fill: the chip word bank (D8: never a keyboard for terms)
 *     prefix?: '$', suffix?: '%' } // fill_numeric
 *
 * Answer: {choice}. A numeric fill-in sends the number itself as the choice
 * (study_scoring._norm compares 42 and 42.0 as one value).
 */
import { useEffect, useRef } from 'react'
import ChoiceList from './ChoiceList'
import { choiceAnswer, choiceAnswerable, choicesFromPrompt, questionOf } from './types'
import styles from './drills.module.css'

const TF = ['True', 'False']

export function kindOf(item) {
  const p = item?.prompt_json || {}
  if (p.kind) return p.kind
  if (p.bank) return 'fill'
  if (p.format === 'fill' && !p.sentence) return 'fill_text'
  if (p.sentence && !p.bank) return 'fill_numeric'
  if (!p.choices || p.choices.length === 0) return 'tf'
  return 'mcq'
}

function choicesFor(item) {
  const kind = kindOf(item)
  if (kind === 'tf') return choicesFromPrompt(item, TF).length ? choicesFromPrompt(item, TF) : TF
  if (kind === 'fill') return (item.prompt_json?.bank || []).map(String)
  if (kind === 'fill_numeric' || kind === 'fill_text') return []
  return choicesFromPrompt(item)
}

/** The quoted thing an item asks you to name (a definition, a principle, a
 *  candle description). Verbatim member copy from the bank; the drill shows
 *  it above the choices, before the question. */
function Quote({ text }) {
  if (!text) return null
  return <blockquote className={styles.quote} data-testid="prompt-quote">{text}</blockquote>
}

function FillSentence({ sentence, value }) {
  const parts = String(sentence || '').split('___')
  return (
    <p className={styles.fillSentence}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className={styles.fillSlot} aria-label={value ? `blank: ${value}` : 'blank'}>
              {value || ' '}
            </span>
          )}
        </span>
      ))}
    </p>
  )
}

/** D8: a numeric field keeps the Check button above the iOS keyboard by
 *  scrolling the field into view when the visual viewport shrinks. */
function useVisualViewportGuard(ref) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return undefined
    const onResize = () => {
      const el = ref.current
      if (!el || document.activeElement !== el) return
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* jsdom */ }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [ref])
}

function NumericFill({ item, state, setState, locked, text = false }) {
  const p = item.prompt_json || {}
  const ref = useRef(null)
  useVisualViewportGuard(ref)
  return (
    <div className={styles.fields}>
      <Quote text={p.quote} />
      {p.sentence && <FillSentence sentence={p.sentence} value={state?.choice ?? ''} />}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{p.label || 'Your answer'}</span>
        <span className={styles.inputWrap}>
          {p.prefix && <span className={styles.inputPrefix}>{p.prefix}</span>}
          <input
            ref={ref}
            className={styles.input}
            type="text"
            inputMode={text ? 'text' : 'decimal'}
            autoComplete="off"
            disabled={locked}
            value={state?.choice ?? ''}
            onChange={(e) => setState({ choice: text ? e.target.value : e.target.value.replace(/[^0-9.\-]/g, '') })}
            aria-label={p.label || 'Your answer'}
          />
          {p.suffix && <span className={styles.inputSuffix}>{p.suffix}</span>}
        </span>
      </label>
    </div>
  )
}

export function Body({ item, state, setState, locked }) {
  const kind = kindOf(item)
  if (kind === 'fill_numeric') return <NumericFill item={item} state={state} setState={setState} locked={locked} />
  if (kind === 'fill_text') return <NumericFill item={item} state={state} setState={setState} locked={locked} text />
  const choices = choicesFor(item)
  const p = item.prompt_json || {}
  return (
    <div>
      <Quote text={p.quote} />
      {kind === 'fill' && p.sentence && <FillSentence sentence={p.sentence} value={state?.choice} />}
      {kind === 'fill' ? (
        <ul role="radiogroup" aria-label="Word bank" className={styles.bank}>
          {choices.map((w, i) => (
            <li key={`${i}-${w}`}>
              <button
                type="button"
                role="radio"
                aria-checked={state?.choice === w}
                className={styles.bankChip}
                disabled={locked}
                onClick={() => setState({ choice: w })}
                data-choice-index={i + 1}
              >
                {w}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ChoiceList
          choices={choices}
          value={state?.choice ?? null}
          onChange={(choice) => setState({ choice })}
          disabled={locked}
          label={questionOf(item) || 'Choices'}
        />
      )}
    </div>
  )
}

export function answerFromState(state, item) {
  const kind = kindOf(item)
  if (kind === 'fill_numeric') {
    const n = Number(state?.choice)
    return { choice: Number.isFinite(n) ? n : state?.choice ?? null }
  }
  if (kind === 'fill_text') return { choice: String(state?.choice ?? '').trim() || null }
  return choiceAnswer(state)
}

export function isAnswerable(state, item) {
  const kind = kindOf(item)
  if (kind === 'fill_numeric') return Number.isFinite(Number(state?.choice)) && String(state?.choice ?? '').trim() !== ''
  if (kind === 'fill_text') return String(state?.choice ?? '').trim() !== ''
  return choiceAnswerable(state)
}

export function choicesOf(item) {
  const kind = kindOf(item)
  return kind === 'fill_numeric' || kind === 'fill_text' ? [] : choicesFor(item)
}

export default { Body, answerFromState, isAnswerable, choicesOf }
