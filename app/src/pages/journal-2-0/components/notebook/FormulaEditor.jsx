import { useId, useMemo, useRef } from 'react'
import {
  STARTER_FORMULAS, checkFormula, evaluateFormula, formatComputedNumber,
} from '../../lib/formula/computed'
import styles from './FormulaEditor.module.css'

/**
 * Wave 11 (lane 11B): writing a formula.
 *
 * The member types property NAMES in braces — `({Exit} - {Entry}) / ({Entry} - {Stop})`
 * — or inserts them with the buttons; the server stores property IDS, so a rename
 * never breaks the formula. Every outcome is said in WORDS in one live region:
 * a parse error, an unknown property, a circular reference, or the value this
 * formula has on the open note (the live preview), so the member never has to
 * guess what Create will do.
 *
 * Controlled: `value` is the member's text, `onChange` gets the next text.
 * `defs` is the member's property definitions (with `config` on formulas),
 * `previewProps` the open note's values by property id (null outside a note),
 * `selfId` the formula being edited (null while creating).
 */
export default function FormulaEditor({
  value, onChange, defs, previewProps = null, selfId = null, onStarter = null, onCreateMissing = null,
}) {
  const id = useId()
  const textRef = useRef(null)
  const usable = useMemo(
    () => (defs || []).filter((d) => (d.type === 'number' || d.type === 'formula') && d.id !== selfId
      && d.source !== 'financial_derived'),
    [defs, selfId],
  )
  const names = useMemo(() => new Set(usable.map((d) => d.name.trim().toLowerCase())), [usable])

  const check = useMemo(() => (value.trim() ? checkFormula(value, defs, selfId) : null), [value, defs, selfId])
  const preview = useMemo(() => {
    if (!check?.ok || !previewProps) return null
    return evaluateFormula(check.stored, defs, previewProps)
  }, [check, defs, previewProps])

  const missing = useMemo(() => {
    const m = [...value.matchAll(/\{([^@{}][^{}]*)\}/g)].map((x) => x[1].trim())
    return [...new Set(m)].filter((n) => !names.has(n.toLowerCase()))
  }, [value, names])

  const insert = (name) => {
    const el = textRef.current
    const token = `{${name}}`
    const start = el ? el.selectionStart : value.length
    const end = el ? el.selectionEnd : value.length
    const next = value.slice(0, start) + token + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      if (!textRef.current) return
      textRef.current.focus()
      const caret = start + token.length
      textRef.current.setSelectionRange(caret, caret)
    })
  }

  const pickStarter = (starterId) => {
    const s = STARTER_FORMULAS.find((x) => x.id === starterId)
    if (!s) return
    onChange(s.expression)
    onStarter?.(s)
  }

  let status
  if (!value.trim()) {
    status = <span>Type a formula, or start from a trader formula above.</span>
  } else if (!check.ok) {
    status = <span className={styles.error} data-formula-error={check.code}>{check.message}</span>
  } else if (preview) {
    const text = formatComputedNumber(preview.value)
    status = text !== null
      ? <span>On this note: <strong className={styles.previewValue}>{text}</strong></span>
      : <span>On this note: no value yet ({preview.reason})</span>
  } else {
    status = <span>The formula reads correctly.</span>
  }

  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor={`${id}-starter`}>Start from a trader formula</label>
      <select id={`${id}-starter`} className={styles.select} value="" onChange={(e) => pickStarter(e.target.value)}>
        <option value="">Choose…</option>
        {STARTER_FORMULAS.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <label className={styles.label} htmlFor={`${id}-text`}>Formula</label>
      <textarea
        id={`${id}-text`}
        ref={textRef}
        className={styles.text}
        value={value}
        rows={3}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-help ${id}-status`}
        placeholder="({Exit} - {Entry}) / ({Entry} - {Stop})"
      />
      <p id={`${id}-help`} className={styles.help}>
        Put a number property in braces, like {'{Entry}'}. Use + - * / and ( ), and round(x, 2), abs, min, max,
        and if(test, then, else) with &lt; &lt;= &gt; &gt;= = !=.
      </p>

      {usable.length > 0 && (
        <div className={styles.insertRow} role="group" aria-label="Insert a property">
          {usable.map((d) => (
            <button key={d.id} type="button" className={styles.insertBtn} onClick={() => insert(d.name)}
              aria-label={`Insert ${d.name}`}>
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div id={`${id}-status`} className={styles.status} role="status" aria-live="polite">
        {status}
      </div>
      {missing.length > 0 && onCreateMissing && (
        <button type="button" className={styles.createMissing} onClick={() => onCreateMissing(missing)}>
          {`Create ${missing.join(', ')} as number ${missing.length === 1 ? 'property' : 'properties'}`}
        </button>
      )}
    </div>
  )
}
