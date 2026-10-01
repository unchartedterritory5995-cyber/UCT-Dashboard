// Select — the one native dropdown. TERM-067 (FB-S10-03).
//
// ── WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────
//
// The same error semantics as `Input` (`error` -> `aria-invalid` + an
// `aria-describedby` at the field's `FieldError`), and ONE way to state the
// choices: `options`, an array of strings or `{ value, label, disabled }`. A
// string is its own value and label. `children` still works for a caller that
// needs `<optgroup>`; when both are given, `options` render first.
//
// It stays a NATIVE `<select>`: the platform's own keyboard, type-ahead and
// touch picker are the behaviour, and none of that is re-implemented here.
//
// It does NOT own the look, the label or the value — the caller passes its class
// and wires its own `<label htmlFor>`.
import { fieldAria } from './FieldError'

const asOption = (o) => (typeof o === 'object' && o !== null ? o : { value: o, label: String(o) })

export default function Select({
  options,
  error,
  children,
  'aria-describedby': describedBy,
  // consumed, never forwarded — derived from `error`
  'aria-invalid': _ariaInvalid,
  ...rest
}) {
  return (
    <select {...rest} {...fieldAria({ id: rest.id, error, describedBy })}>
      {(options || []).map((o) => {
        const { value, label, disabled } = asOption(o)
        return <option key={String(value)} value={value} disabled={disabled || undefined}>{label ?? String(value)}</option>
      })}
      {children}
    </select>
  )
}
