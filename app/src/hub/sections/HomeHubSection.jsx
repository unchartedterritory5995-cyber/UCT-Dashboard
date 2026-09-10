// Mounts Home's hub controller. Renders nothing.
//
// ⛔ WHY A COMPONENT AND NOT A HOOK CALL IN HubRoot — the same reason NotebookHubSection gives:
// HubRoot branches internally on visibility and on the capability floor, so a hook called from
// inside it would register or not depending on where in that tree the call landed. A null-rendering
// sibling under `HubProvider` mounts on exactly one condition — the provider is there — and the
// controller itself decides the rest from the route.
//
// ⚠️ It sits in Layout.jsx beside <NotebookHubSection/> because Home's list is the REGISTRY, not
// anything `Dashboard.jsx` renders — see homeSection.js's header for why a page-side mount would
// buy nothing here.
import useHomeSection from './homeSection'

export default function HomeHubSection() {
  useHomeSection()
  return null
}
