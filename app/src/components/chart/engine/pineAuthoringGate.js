// ─── ⛔⛔ THE GATE ON THE MEMBER PINE EDITOR (A1, 2026-10-04) ────────────────
//
// The "Pine Editor" tab in the builder — a member WRITING and editing Pine in
// UCT, compiled on every settle through the member door and applied to their
// chart through the same save path the attach button already uses. It ships
// DARK: until this flag is on, the tab does not exist and nothing in the editor
// module runs.
//
// ⛔ NOT `VITE_PINE_MEMBER_PANE_ENABLED`. That flag gates whether a member's
// translated script may reach a pane AT ALL (it is armed in production); this
// one gates only the authoring SURFACE on top of it. The editor's preview and
// its Apply both go through `MemberPane` / `memberPaneDefinition`, so with the
// pane flag off the editor still compiles and lists problems but draws and
// applies nothing — the pane gate stays the one authority over "may it reach a
// chart".
//
// ⭐ THE CONVENTION IS THE REPO'S: default OFF means `=== '1'` (absent, '',
// '0', 'true' are all off), read INSIDE a function so a test can flip it, and a
// build with no `import.meta.env` fails CLOSED.

//
// ⭐⭐ A2 (owner ruling O3) — AND A PER-MEMBER STAGE. The build flag is one
// bundle for every member; `PINE_AUTHORING_STAGE` (off / admins / all, server,
// read per request, default off) decides WHICH members, and arrives on the auth
// payload as `pine_authoring_enabled`, latched per tab in
// `src/lib/pineAuthoringPermission.js`. The tab needs BOTH. The client never
// re-derives the stage from a role; it is told yes or no.
export {
  latchPineAuthoringPermission, pineAuthoringPermitted, pineAuthoringPermissionDebug,
  __resetPineAuthoringPermission, __permitPineAuthoringForTests,
} from '../../../lib/pineAuthoringPermission'
import { pineAuthoringPermitted } from '../../../lib/pineAuthoringPermission'

/** Is the build flag on? (`VITE_PINE_AUTHORING_ENABLED === '1'`). */
export function pineAuthoringBuilt() {
  try {
    return import.meta.env.VITE_PINE_AUTHORING_ENABLED === '1'
  } catch {
    return false
  }
}

/** May the member see and use the Pine Editor tab? One reader, on purpose.
 *  ⭐ A2: BOTH the build flag AND the latched per-member stage. */
export function pineAuthoringEnabled() {
  return pineAuthoringBuilt() && pineAuthoringPermitted()
}
