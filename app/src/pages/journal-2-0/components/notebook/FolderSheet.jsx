// S12 (audit 2026-11-05, B13), fix round 1 (review Important 6): inside a note on a phone, Folders opens the folders
// panel as the repo's bottom Sheet -- a dialog named "Folders", focus moved in and trapped, Escape and the backdrop
// close it, and focus returns to the Folders button that opened it. Fetched on its first open (NotebookTab's
// `lazyDialog`). The panel itself (FolderSidebar) is passed in as children: one panel component, never a copy.
import Sheet from '../../../../components/mobile/Sheet'

export default function FolderSheet({ open, onClose, returnFocusTo, children }) {
  return (
    <Sheet open={open} onClose={onClose} title="Folders" labelledByTitle variant="bottom-sheet" returnFocusTo={returnFocusTo}>
      {children}
    </Sheet>
  )
}
