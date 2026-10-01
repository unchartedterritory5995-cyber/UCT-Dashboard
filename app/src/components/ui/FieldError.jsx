// FieldError — the one place a field's error message is rendered. TERM-067
// (FB-S10-03), beside `Switch`, `Input`, `Select` and `Checkbox`.
//
// ── WHAT IT OWNS ────────────────────────────────────────────────────────────────
//
// The LINK between a control and its message. `errorIdFor(fieldId)` is the single
// derivation of the message's id: `Input`/`Select`/`Checkbox` point their
// `aria-describedby` at it (through `fieldAria`), and this component renders the
// element that carries it. Neither side types the id, so they cannot drift.
//
// It renders NOTHING when there is no message. An empty element with a live
// `role="alert"` is announced by some screen readers as an empty alert, and an
// `aria-describedby` pointing at an empty node is a description of nothing.
//
// It does NOT own the look: the caller passes its class, as with `Switch`.

/** The id of the error element that describes the control with this id. */
export const errorIdFor = (fieldId) => `${fieldId}-error`

const present = (v) => v != null && v !== false && v !== ''

/**
 * The ARIA a control carries for its error state. `error` is the message (or
 * `true`); a caller's own `aria-describedby` is kept and the error id appended.
 * With no `id` there is no element to point at, so only `aria-invalid` is set.
 */
export function fieldAria({ id, error, describedBy }) {
  const invalid = present(error)
  const ids = [describedBy, invalid && id ? errorIdFor(id) : null].filter(Boolean).join(' ')
  return {
    'aria-invalid': invalid ? true : undefined,
    'aria-describedby': ids || undefined,
  }
}

export default function FieldError({
  forId,
  children,
  className,
  // consumed, never forwarded — the id and the role are the primitive's
  id: _id,
  role: _role,
  ...rest
}) {
  if (!present(children)) return null
  return (
    <span id={errorIdFor(forId)} role="alert" className={className} {...rest}>
      {children}
    </span>
  )
}
