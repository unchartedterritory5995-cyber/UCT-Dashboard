// Mounts the Notebook's hub controller, and hosts its one toast.
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
// ── IT NO LONGER RENDERS NULL (D-17) ───────────────────────────────────────────────────────────
// ⛔ THE FEEDBACK HOST OUTLIVES THE CONTROL THAT FIRES IT. The voice note's message has to survive
// the fan closing, the bubble unmounting and a navigation into the created note — a toast owned by
// any of those renders for zero frames, which is a defect this hub has already shipped once. This
// component is mounted from `Layout.jsx` for the whole session, so it outlives all three.
//
// ⛔ `msg`, NEVER `message`. `JournalToast`'s prop is `msg` (`useJournalToast.jsx:25`); the other
// toast defect this hub shipped passed `message` to it, and every structural assertion stayed
// green while the chip rendered blank. `notebookVoiceNote.test.jsx` asserts the RENDERED TEXT.
//
// ⭐ AND IT RENDERS UNCONDITIONALLY, empty or not. `JournalToast` is a permanent `role="status"`
// whose TEXT toggles (`data-empty` hides it visually) — a chip mounted only when there is something
// to say is silent to screen readers, which is the exact failure that hook's own header records.
import useNotebookSection from './notebookSection'
import { JournalToast } from '../../pages/journal-2-0/lib/useJournalToast'

/** Above the hub's resting corner, clear of the knob. Mirrors `chartSection.js`'s TOAST_STYLE —
 *  the recipe is `JournalToast`'s, the anchor is the host's (that module's own escape hatch). */
const TOAST_STYLE = Object.freeze({
  position: 'fixed',
  top: 'auto',
  bottom: 'calc(env(safe-area-inset-bottom) + 68px + 84px + 8px)',
  right: '16px',
  zIndex: 'var(--z-hub-open)',
})

export default function NotebookHubSection() {
  const { voiceMsg } = useNotebookSection()
  return <JournalToast msg={voiceMsg} style={TOAST_STYLE} />
}
