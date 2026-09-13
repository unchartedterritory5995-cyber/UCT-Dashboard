// Mounts the Notebook's hub controller, and hosts the ONE chip it needs a host for.
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
// ── IT NO LONGER RENDERS NULL, AND TWO SEPARATE ITEMS NEEDED THAT ─────────────────────────────
// D-17's voice note and R-17's Set ticker both WRITE, and a write that refuses must SAY SO
// somewhere a member can read. They arrived on different branches and each converted this
// component; the merge keeps ONE host and one chip, because two `role="status"` regions on one
// screen is a screen reader reading the same corner twice.
//
// ⛔ THE FEEDBACK HOST OUTLIVES THE CONTROL THAT FIRES IT. A voice note's message has to survive
// the fan closing, the bubble unmounting and a navigation into the created note — a toast owned by
// any of those renders for zero frames, which is a defect this hub has already shipped once. This
// component is mounted from `Layout.jsx` for the whole session, so it outlives all three.
//
// ⛔ `msg`, NEVER `message`. `JournalToast`'s prop is `msg` (`useJournalToast.jsx:25`); the other
// toast defect this hub shipped passed `message` to it, and every structural assertion stayed
// green while the chip rendered blank. Both `notebookVoiceNote.test.jsx` and
// `linkTickerWritesTheNote.test.jsx` assert the RENDERED TEXT.
import useNotebookSection from './notebookSection'


export default function NotebookHubSection() {
  const { hubMount } = useNotebookSection()
  return hubMount
}
