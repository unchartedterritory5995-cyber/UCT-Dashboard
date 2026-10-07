// Radio — the one native radio button. TERM-067 (FB-S10-03).
//
// ── WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────
//
// It owns the two things every hand-rolled `<input type="radio">` has to repeat:
//
//   • `type` is always "radio". A caller cannot turn it into something else —
//     `Input` refuses radio for the same reason, so the two cannot overlap.
//   • The same error semantics as `Input` / `Checkbox`: pass `error` and the
//     control carries `aria-invalid` and, with an `id`, an `aria-describedby`
//     pointing at the `FieldError` for that id. `aria-invalid` cannot be set by
//     hand, so the attribute and the visible message cannot disagree.
//
// It does NOT own the look, the label, the `name` that groups it, or the value.
// The caller passes its class, its group `name`, and wraps or associates its own
// `<label>` (or passes `aria-label`). With no `error`, the rendered element is
// the `<input type="radio">` the caller would have written by hand, attribute
// for attribute — `formPrimitives.test.jsx` proves it on the DOM.
//
// `ref` is an ordinary prop (React 19), forwarded with the rest.
import { fieldAria } from './FieldError'

export default function Radio({
  error,
  'aria-describedby': describedBy,
  // consumed, never forwarded — the semantics are the primitive's, not the caller's
  type: _type,
  'aria-invalid': _ariaInvalid,
  ...rest
}) {
  return <input type="radio" {...rest} {...fieldAria({ id: rest.id, error, describedBy })} />
}
