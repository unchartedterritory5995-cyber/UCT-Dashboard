// Checkbox — the one native checkbox. TERM-067 (FB-S10-03).
//
// ── WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────
//
// It owns two things a hand-rolled `<input type="checkbox">` gets wrong or skips:
//
//   • `type` is always "checkbox". A caller cannot turn it into something else.
//   • `indeterminate`. The mixed state is a DOM PROPERTY with no HTML attribute,
//     so JSX cannot express it; every "select all" row that wants it has to reach
//     for a ref. Pass `indeterminate` and the property is kept in step.
//
// And the same error semantics as `Input` (`error` -> `aria-invalid` +
// `aria-describedby` at the field's `FieldError`).
//
// It does NOT own the look, the label or the value. The caller passes its class
// and wraps or associates its own `<label>`.
import { useCallback, useEffect, useRef } from 'react'
import { fieldAria } from './FieldError'

export default function Checkbox({
  indeterminate = false,
  error,
  ref,
  'aria-describedby': describedBy,
  // consumed, never forwarded — the semantics are the primitive's, not the caller's
  type: _type,
  'aria-invalid': _ariaInvalid,
  ...rest
}) {
  const own = useRef(null)
  useEffect(() => {
    if (own.current) own.current.indeterminate = !!indeterminate
  }, [indeterminate])

  // stable while the caller's ref is, so React does not detach and re-attach it per render
  const setRef = useCallback((el) => {
    own.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }, [ref])

  return <input type="checkbox" ref={setRef} {...rest} {...fieldAria({ id: rest.id, error, describedBy })} />
}
