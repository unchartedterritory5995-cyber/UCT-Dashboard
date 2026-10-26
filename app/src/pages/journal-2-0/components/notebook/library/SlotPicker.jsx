// Notebook widgets phase 2, wave 11 (Task 11.17): one "pick yours" choice of the adoption sheet.
//
// A shared widget, routine, tracker or template arrives with every member value stripped to a typed choice (ruling
// W11-R5: setup, tag, symbol, account, property, folder, kind of note, routine, tracker, number). This picker offers
// the member's OWN values for one choice:
//   * setup, tag, symbol, account, property, folder and kind of note: lib/builtWidgets' `loadVocabulary(field)` (the
//     member's own values, cached per tab; the builder's one reader, never a second fetch);
//   * routine and tracker: lib/toolsCrud's `listTools(kind)` (the member's active routines and trackers);
//   * number: a number field.
// "Any <label lowercase>" (drop that filter) is offered ONLY where the choice allows it (`slot.any`).
//
// ⛔ Picking writes nothing: Done hands the value back to the sheet, which re-asks the preview. Nothing here POSTs.
// ⛔ LAZY. Reached only through the adoption sheet (its own root, openAdoptSheet).
import { useEffect, useId, useState } from 'react'
import { loadVocabulary } from '../../../lib/builtWidgets'
import { listTools } from '../../../lib/toolsCrud'
import styles from './library.module.css'

export const DONE_LABEL = 'Done'
export const CANCEL_LABEL = 'Cancel'
export const LOADING_VALUES = 'Loading your choices…'
export const NO_VALUES = "You don't have any to pick yet."
export const VALUES_FAILED = "Your choices didn't load. Try again."
export const NUMBER_HINT = 'Type a number.'

/** The `?field=` of `GET /widget-definitions/vocabulary` each list type reads (the server's VOCAB_FIELDS and
 *  VOCAB_W10_FIELDS keys; a kind of note is the notes source's own `kind` field). */
export const VOCAB_FIELD = Object.freeze({
  setup: 'setup', tag: 'tag', symbol: 'symbol', account: 'account', property: 'property', folder: 'folder', note_kind: 'kind',
})
const TOOL_TYPES = new Set(['routine', 'tracker'])

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** "Any setup": the words for the Any answer of a choice. */
export const anyWords = (label) => `Any ${String(label || 'value').toLowerCase()}`

/** A number the member typed, or null (empty, NaN and Infinity are not numbers). */
export function numberOf(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** The member's values as `[{value, label}]`: a text value is its own label; `{id, name}` is the id, worded by its name. */
export function valuesOf(list) {
  const out = []
  const seen = new Set()
  for (const v of Array.isArray(list) ? list : []) {
    let value = null
    let label = ''
    if (typeof v === 'string' && v.trim()) { value = v; label = v }
    else if (isRecord(v) && (typeof v.id === 'string' || typeof v.id === 'number') && String(v.id) !== '') {
      value = String(v.id)
      label = typeof v.name === 'string' && v.name.trim() ? v.name : value
    }
    if (value === null || seen.has(value)) continue
    seen.add(value)
    out.push({ value, label })
  }
  return out
}

/** Read the member's own values for one choice: `{ok, values}` or `{ok: false}`. Never throws. */
async function readValues(type) {
  try {
    if (TOOL_TYPES.has(type)) {
      const got = await listTools(type)
      return got.ok ? { ok: true, values: valuesOf(got.data) } : { ok: false }
    }
    if (!Object.hasOwn(VOCAB_FIELD, type)) return { ok: true, values: [] }
    return { ok: true, values: valuesOf(await loadVocabulary(VOCAB_FIELD[type])) }
  } catch {
    return { ok: false }
  }
}

const ANY = '\u0000any'

/**
 * @param slot     `{id, type, label, any}` (the server's slot)
 * @param answer   the choice's current answer: a value, a number, `{any: true}`, or undefined
 * @param onPick   `(answer, label) => void`: the picked value (or `{any: true}`) and its words
 * @param onCancel close without a change
 */
export default function SlotPicker({ slot, answer, onPick, onCancel }) {
  const uid = useId()
  const label = typeof slot?.label === 'string' && slot.label ? slot.label : 'Choice'
  const isNumber = slot?.type === 'number'
  const anyOk = slot?.any === true
  const isAny = isRecord(answer) && answer.any === true
  const [state, setState] = useState(isNumber ? { status: 'ok', values: [] } : { status: 'loading', values: [] })
  const [picked, setPicked] = useState(() => (isAny ? ANY : (answer === undefined || answer === null ? '' : String(answer))))
  const [typed, setTyped] = useState(() => (isNumber && typeof answer === 'number' ? String(answer) : ''))
  const [numberAny, setNumberAny] = useState(isNumber && isAny)

  useEffect(() => {
    if (isNumber) return undefined
    let alive = true
    readValues(slot?.type).then((got) => {
      if (!alive) return
      setState(got.ok ? { status: 'ok', values: got.values } : { status: 'error', values: [] })
    })
    return () => { alive = false }
  }, [isNumber, slot?.type])

  const typedNumber = numberOf(typed)
  const canDone = isNumber ? (numberAny ? anyOk : typedNumber !== null) : (picked === ANY ? anyOk : picked !== '')

  const done = () => {
    if (!canDone) return
    if (isNumber) {
      if (numberAny) onPick({ any: true }, anyWords(label))
      else onPick(typedNumber, String(typedNumber))
      return
    }
    if (picked === ANY) { onPick({ any: true }, anyWords(label)); return }
    const hit = state.values.find((v) => v.value === picked)
    onPick(picked, hit ? hit.label : picked)
  }

  return (
    <div className={styles.picker} role="group" aria-labelledby={`${uid}-legend`} data-slot-picker={slot?.id}>
      <p className={styles.label} id={`${uid}-legend`}>{`Pick your ${label.toLowerCase()}`}</p>
      {isNumber ? (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${uid}-n`}>{label}</label>
            <input id={`${uid}-n`} type="text" inputMode="decimal" className={styles.input} value={typed}
              disabled={numberAny} aria-describedby={`${uid}-nh`}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done() } }} />
            <p className={styles.hint} id={`${uid}-nh`}>{NUMBER_HINT}</p>
          </div>
          {anyOk && (
            <label className={styles.choice}>
              <input type="checkbox" checked={numberAny} onChange={() => setNumberAny(!numberAny)} />
              <span>{anyWords(label)}</span>
            </label>
          )}
        </>
      ) : (
        <fieldset className={styles.section}>
          <legend className={styles.srOnly}>{label}</legend>
          {state.status === 'loading' && <p className={styles.hint} role="status">{LOADING_VALUES}</p>}
          {state.status === 'error' && <p className={styles.hint} role="alert">{VALUES_FAILED}</p>}
          {state.status === 'ok' && state.values.length === 0 && <p className={styles.hint}>{NO_VALUES}</p>}
          {state.values.map((v) => (
            <label key={v.value} className={styles.choice}>
              <input type="radio" name={`${uid}-pick`} value={v.value} checked={picked === v.value}
                onChange={() => setPicked(v.value)} />
              <span>{v.label}</span>
            </label>
          ))}
          {anyOk && (
            <label className={styles.choice}>
              <input type="radio" name={`${uid}-pick`} value={ANY} checked={picked === ANY} onChange={() => setPicked(ANY)} />
              <span>{anyWords(label)}</span>
            </label>
          )}
        </fieldset>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onCancel}>{CANCEL_LABEL}</button>
        <button type="button" className={styles.btnPrimary} disabled={!canDone} onClick={done}>{DONE_LABEL}</button>
      </div>
    </div>
  )
}
