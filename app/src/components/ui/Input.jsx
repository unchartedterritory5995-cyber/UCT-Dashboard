// Input — the one single-line input. TERM-067 (FB-S10-03).
//
// ── WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────
//
// It owns the ERROR SEMANTICS every hand-rolled input leaves out: pass `error`
// (the message, or `true`) and the control carries `aria-invalid` and, when it
// has an `id`, an `aria-describedby` pointing at the `FieldError` for that id.
// A caller cannot set `aria-invalid` by hand — it is derived from `error`, so the
// attribute and the visible message cannot disagree.
//
// `type` defaults to "text". It is forwarded (date, number, search, ... are all
// this primitive), EXCEPT checkbox and radio, which have their own semantics and
// their own primitive: asking for one here renders a text input rather than a
// control this component does not understand.
//
// It does NOT own the look, the label or the value. The caller passes its class
// and wires its own `<label htmlFor>`, exactly as `Switch` leaves the look alone.
// With no `error`, the rendered element is the `<input>` the caller would have
// written by hand, attribute for attribute.
import { fieldAria } from './FieldError'

const NOT_THIS_PRIMITIVE = new Set(['checkbox', 'radio'])

export default function Input({
  type,
  error,
  'aria-describedby': describedBy,
  // consumed, never forwarded — derived from `error`
  'aria-invalid': _ariaInvalid,
  ...rest
}) {
  const t = type && !NOT_THIS_PRIMITIVE.has(String(type).toLowerCase()) ? type : 'text'
  return <input type={t} {...rest} {...fieldAria({ id: rest.id, error, describedBy })} />
}
