// app/src/components/chart/builder/editorStatusGate.js
//
// Is the Pine editor's status panel (`PineEditorStatus.jsx`,
// `docs/pine/EDITOR-STATUS-PANEL-SPEC.md`) switched on in this build?
//
// ⛔ ONE READER, ON PURPOSE, like `engine/memberPaneGate.js`: only the literal
// '1' opens it, and a build with no `import.meta.env` fails CLOSED. Declared in
// Dockerfile.web (ARG + ENV) and docs/feature_flags.json (build_flags).
export function editorStatusEnabled() {
  try {
    return import.meta.env.VITE_PINE_EDITOR_STATUS === '1'
  } catch {
    return false
  }
}
