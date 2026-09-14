// The ONE render-token check for every /r/* page.
//
// Fourteen render pages each carried their own copy of
//   const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''
//   if (TOKEN && token !== TOKEN) …unauthorized
// Fourteen copies of a guard cannot be mutation-proved and cannot be rotated in one step, so the
// guard lives here and the pages call it (memory: lesson_a_guard_repeated_is_a_guard_unproved).
//
// DUAL ACCEPTANCE (rotation, 2026-09-13). The token is baked into the bundle at BUILD time, so a
// rotation is a rebuild; accepting the previous token as well means there is no moment where a
// sender holding the old value is refused. chart-renderer is NOT in this path — it navigates to
// whatever URL it is handed and never validates anything (OI-19). The check is here and in
// api/routers/render_panels.py, both on `web`, and nowhere else.
//
// ⛔ Clear VITE_CHART_RENDER_TOKEN_PREVIOUS as soon as every sender holds the new value. A
// "previous" that is never cleared is not a rotation, it is two live tokens.

const CURRENT = import.meta.env.VITE_CHART_RENDER_TOKEN || ''
const PREVIOUS = import.meta.env.VITE_CHART_RENDER_TOKEN_PREVIOUS || ''

// Unset = the gate is off. That is the behaviour every page already had (`TOKEN && …`), kept
// deliberately: a local `npm run dev` build sets no token, and these pages must still open.
export const RENDER_TOKEN_REQUIRED = Boolean(CURRENT)

export function renderTokenOk(token) {
  if (!CURRENT) return true
  const given = String(token ?? '')
  if (given === CURRENT) return true
  return PREVIOUS !== '' && given === PREVIOUS
}

// Test seam only — the module reads import.meta.env at load, which a test cannot re-trigger.
export function __makeRenderTokenOk(current, previous) {
  return (token) => {
    if (!current) return true
    const given = String(token ?? '')
    if (given === current) return true
    return Boolean(previous) && given === previous
  }
}
