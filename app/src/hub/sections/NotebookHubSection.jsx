// Mounts the Notebook's hub controller, and renders the ONE thing it needs a host for.
//
// ⛔ WHY A COMPONENT AND NOT A HOOK CALL IN HubRoot. HubRoot branches internally on visibility and
// on the capability floor; a hook called from inside it would register or not depending on where in
// that tree the call landed, which is a coupling nobody would remember. A null-rendering sibling
// under `HubProvider` mounts on exactly one condition — the provider is there — and the controller
// itself decides the rest from the route.
//
// ⚠️ It sits in Layout.jsx beside <HubRoot/> because rule 12 forbids editing NotebookTab.jsx, which
// is where every other section controller's equivalent lives. See notebookSection.js's header for
// why that departure is allowed here and nowhere else.
//
// ⭐ IT NO LONGER RENDERS NULL, AND THAT IS R-17's DOING. `notebook.linkTicker` writes, and a
// write that refuses — an empty ticker, an unreachable note — must SAY SO somewhere a member can
// read. The controller is a `.js` module and cannot render; this is its host, the same shape
// `catalystsSection`'s `hubMount` already uses. The host is permanent while the section is on
// route, so a message is never unmounted by the same commit that set it.
import useNotebookSection from './notebookSection'

export default function NotebookHubSection() {
  const { hubMount } = useNotebookSection()
  return hubMount
}
