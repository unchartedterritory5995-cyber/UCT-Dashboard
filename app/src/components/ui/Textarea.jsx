// Textarea — the one multi-line input. TERM-067 (FB-S10-03).
//
// The same contract as `Input`: pass `error` (the message, or `true`) and the
// control carries `aria-invalid` and, when it has an `id`, an `aria-describedby`
// pointing at the `FieldError` for that id. `aria-invalid` cannot be set by hand.
//
// It does NOT own the look, the label, the value or the size — the caller passes
// its class, `rows` and its own `<label htmlFor>` or `aria-label`. With no
// `error` it renders exactly the `<textarea>` the caller would have written.
import { fieldAria } from './FieldError'

export default function Textarea({
  error,
  'aria-describedby': describedBy,
  // consumed, never forwarded — derived from `error`
  'aria-invalid': _ariaInvalid,
  ...rest
}) {
  return <textarea {...rest} {...fieldAria({ id: rest.id, error, describedBy })} />
}
