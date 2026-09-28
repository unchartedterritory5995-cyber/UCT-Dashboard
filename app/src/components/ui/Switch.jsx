// Switch — the one on/off control. TERM-067 (FB-S10-03), the first member of the
// form-control layer, chosen by the census in `formControls.census.test.js`:
// the hand-rolled switch is the only control family copied in ONE structural
// shape (`<button type="button" role="switch" aria-checked> > <span knob>`), and
// the only form-control wrapper defined twice under one name (`Toggle`).
//
// ── WHAT IT OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────
//
// It owns the SEMANTICS every copy had to get right by hand: a real <button>,
// `type="button"` (so it never submits a form it sits in), `role="switch"`, the
// `aria-checked` state, and the knob element. A caller cannot override those —
// `type`, `role`, `aria-checked` and `children` are consumed here, never spread.
//
// It does NOT own the look. Every copy in the tree is styled by its own CSS
// module with its own geometry (the knob travels 14, 16, 17 or 18px depending on
// the surface), so the caller passes its classes and the primitive composes them.
// Unifying the look is a design decision, not a de-duplication, and doing it here
// would have changed pixels on every migrated surface.
//
// ⛔ The class join is `[className, checked && checkedClassName].join(' ')` with
// empties dropped — it never emits a trailing space. The two panels migrated with
// it produced exactly that string before, which `Switch.parity.test.jsx` proves.
// The chart copies write `${toggle} ${on ? toggleOn : ''}`, whose OFF state has a
// trailing space; migrating those changes `class` by that one character (same
// classList, same pixels) and must be done as its own reviewed step.
//
// ⚠️ `aria-checked` is passed through as given, as every copy did. Pass a boolean:
// an undefined `checked` renders no `aria-checked`, which is not a valid switch.

export default function Switch({
  checked,
  className,
  checkedClassName,
  knobClassName,
  // consumed, never forwarded — the semantics are the primitive's, not the caller's
  type: _type,
  role: _role,
  'aria-checked': _ariaChecked,
  children: _children,
  ...rest
}) {
  const cls = [className, checked ? checkedClassName : null].filter(Boolean).join(' ')
  return (
    <button type="button" role="switch" aria-checked={checked} className={cls || undefined} {...rest}>
      <span className={knobClassName} />
    </button>
  )
}
