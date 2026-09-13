/* MOB-08 — presentation[deviceClass], the smallest device-scoped model.
 *
 * ⛔ THE DEFECT THIS EXISTS FOR, and it is in the codebase with a comment
 * admitting it. `multichart_state.mode` ('workspace' | 'grid') is ONE shared
 * preference, so:
 *   · a desktop user who enters Multi Chart makes the PHONE open in grid mode —
 *     `ChartsWorkspace.jsx` says so out loud: "grid mode persists from desktop,
 *     and without an exit control a phone user is TRAPPED in it";
 *   · and the phone's escape hatch writes `mode: 'workspace'` back to that same
 *     shared key, DESTROYING the desktop's grid mode.
 * Bleed in both directions, with a UI workaround standing in for a scope fix.
 *
 * ⛔ THIS IS NOT A SECOND WORKSPACE. No new record, no parallel mobile blob:
 * one additive key inside the record that already exists, carrying only values
 * that are legitimately a property of the DEVICE rather than of the board.
 *
 * ⭐ THE LINE IS "WHAT AM I LOOKING AT" vs "HOW DOES THIS DEVICE FRAME IT".
 * Which charts, which symbols, which timeframes, the grid's shape and its cells
 * are all the BOARD — shared, unchanged, still one source of truth. Whether
 * this particular device renders that board as a desktop grid is a property of
 * the device. Only the second kind is scoped, and the registry below is the
 * whole list.
 */

/** ⛔ THE SMALLEST VOCABULARY THAT MAPS TO A REAL DIFFERENCE — two shells.
 *
 * The product has exactly two chart shells: the desktop workspace and the
 * mobile shell (which phones and tablets share). `mode` differs between those
 * two and not between phone and tablet, so inventing a third class today would
 * be a taxonomy with nothing behind it. A future field that genuinely differs
 * phone-vs-tablet extends this list — and `normalisePresentation` PRESERVES
 * unknown classes precisely so that day costs no data. */
export const DEVICE_CLASSES = ['desktop', 'mobile']

/**
 * ⛔ DERIVED FROM THE SHELL, NOT FROM THE USER AGENT AND NOT FROM THE POINTER.
 * `ChartsWorkspace` has already decided which shell is rendering; this reads
 * that one decision so there is no second opinion about what a device is. It is
 * deliberately NOT `pointer: coarse` — that is a hit-target and hover question,
 * a different concept the program has kept separate on purpose (viewport/shell ·
 * pointer semantics · touch hardware · presentation policy are four things).
 */
export function deviceClassOf(shellIsMobile) {
  return shellIsMobile ? 'mobile' : 'desktop'
}

/**
 * The scoped field registry. Adding a row here is a product decision, so each
 * one states its own answer to "why does this differ by device?".
 *
 * `legacyFallbackFor` is the load-bearing column. A field is scoped precisely
 * because the shared value is WRONG for some class, so that class must NOT fall
 * back to it — falling back would faithfully reproduce the bug.
 */
export const SCOPED_FIELDS = {
  mode: {
    // WHY: the Multi-Chart grid is desktop-only by design (CLAUDE.md: "desktop-
    // only by design, and the phone is explicitly protected from inheriting
    // it"). It was not actually protected; this is that protection.
    legacyKey: 'mode',
    productDefault: 'workspace',
    isValid: (v) => v === 'grid' || v === 'workspace',
    // DESKTOP keeps reading the pre-MOB-08 shared value, so an existing blob
    // behaves exactly as it did. MOBILE does not — inheriting it is the defect.
    legacyFallbackFor: ['desktop'],
    // ⭐ ONE WRITER for the legacy key, and it is a MIRROR of a derived value,
    // never a second opinion. Desktop keeps the old field truthful so a rollback
    // to pre-MOB-08 code still finds a correct grid mode; the phone never writes
    // it, which is what stops the phone clobbering the desktop.
    legacyMirrorFrom: 'desktop',
  },
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Normalise the `presentation` sub-object.
 *
 * ⛔ IT PRESERVES CLASSES IT DOES NOT KNOW. A newer client writing
 * `presentation.watch` must not have that erased the next time an older client
 * saves — silent cross-version data loss is the same family as the cross-device
 * bleed this feature removes. Unknown FIELDS inside a known class are kept for
 * the same reason. Malformed input degrades to `{}` rather than throwing: a bad
 * presentation value must never be able to stop a board from loading.
 */
export function normalisePresentation(raw) {
  if (!isPlainObject(raw)) return {}
  const out = {}
  for (const [cls, val] of Object.entries(raw)) {
    if (!isPlainObject(val)) continue          // drop a malformed branch, keep the rest
    out[cls] = { ...val }
  }
  return out
}

/**
 * Resolve one scoped field. PRECEDENCE, in order:
 *   1. presentation[deviceClass][field]        — this device's own answer
 *   2. the legacy shared value                 — only for classes allowed it
 *   3. the product default
 */
export function readScopedField(state, deviceClass, field) {
  const spec = SCOPED_FIELDS[field]
  if (!spec) throw new Error(`readScopedField: '${field}' is not a scoped field`)
  const pres = normalisePresentation(state && state.presentation)
  const own = pres[deviceClass] ? pres[deviceClass][field] : undefined
  if (spec.isValid(own)) return own
  if (spec.legacyFallbackFor.includes(deviceClass)) {
    const legacy = state ? state[spec.legacyKey] : undefined
    if (spec.isValid(legacy)) return legacy
  }
  return spec.productDefault
}

/**
 * Write one scoped field, returning the next state.
 *
 * ⛔ ADDITIVE AND SURGICAL. Every other class's branch, every unknown class,
 * every unrelated top-level key (cells, layout, group, sync flags) is carried
 * through untouched. This function is the reason a mobile write cannot blank a
 * desktop board — and `devicePresentation.test.js` mutation-checks exactly that.
 */
export function writeScopedField(state, deviceClass, field, value) {
  const spec = SCOPED_FIELDS[field]
  if (!spec) throw new Error(`writeScopedField: '${field}' is not a scoped field`)
  const next = spec.isValid(value) ? value : spec.productDefault
  const base = isPlainObject(state) ? state : {}
  const pres = normalisePresentation(base.presentation)
  const out = {
    ...base,
    presentation: { ...pres, [deviceClass]: { ...(pres[deviceClass] || {}), [field]: next } },
  }
  // The compatibility mirror — one writer, and only for the class that owns it.
  if (spec.legacyMirrorFrom === deviceClass) out[spec.legacyKey] = next
  return out
}
