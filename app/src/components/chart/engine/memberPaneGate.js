// ─── ⛔⛔ THE GATE ON A MEMBER'S OWN SCRIPT REACHING A PANE ──────────────────
//
// Nothing renders a member's translated Pine on a chart pane yet. This gate
// exists so that when something does, it arrives OFF, and so that the flag-off
// path has a rail from the first commit rather than from the commit after the
// incident.
//
// ⚰️ WHY A NEW FLAG AND NOT THE ONE THAT ALREADY HAS "VOLUME" IN ITS NAME.
// `VITE_VOLUME_NUMERIC_PANE_ENABLED` sounds like it gates exactly this and does
// not: it is read by `placement.js::volumeNumericPaneEnabled` and decides whether
// a definition ALREADY overlaid on the volume pane gets its own pane and right
// axis instead of the shared left one. It is a PLACEMENT flag. Turning it on does
// nothing whatsoever for `uncharted-volume.pine`. The collision is a coincidence
// of the word "volume" and it cost a full re-read of `resolvePlacement` to rule
// out, which is why both flags now say in writing what the other one is not.
//
// ⭐ THE CONVENTION IS READ OFF THE CODE, NOT INVENTED: default OFF means
// `=== '1'`, so absent, empty, `'0'` and `'true'` are all off; and the read
// happens INSIDE a function, never at module scope, so a test can flip it.
// `GlobalVideoLayer.jsx` writes that second reason down.

/** Is a member's own translated script allowed to reach a chart pane?
 *
 *  ⛔ ONE READER, ON PURPOSE. A rename is then one line, and the rail in
 *  `__tests__/memberPaneGate.test.js` derives the name from this file rather than
 *  typing it — a name typed in a test is the artifact that goes stale first.
 */
export function memberPaneEnabled() {
  try {
    return import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED === '1'
  } catch {
    // A build with no `import.meta.env` is not a build that may show a member an
    // unfinished pane. Fail CLOSED.
    return false
  }
}
