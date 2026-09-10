// Mounts the Notebook's hub controller. Renders nothing.
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
import useNotebookSection from './notebookSection'

export default function NotebookHubSection() {
  useNotebookSection()
  return null
}
