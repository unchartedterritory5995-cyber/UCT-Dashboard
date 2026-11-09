// The editor's Share door: share links and publish-to-web for this note (wave 8, lane 8B). Audit 2026-11-05, S19: the
// sheet's content -- "Private link" and "Publish to the web" tabs, the preview, the publish confirm -- is
// NoteSharePanel.jsx, a lazy chunk; this file is only the button and the sheet.
//
// ⛔ ONE DOOR IN THE EDITOR (ruling D-B8): a share link, the note's published page, and the
// folder's published page all live in this one popover. There is no FolderSidebar door; the
// folder is published from here, from a note inside it, and managed in Settings → Sharing &
// publishing (SharingCard.jsx).
//
// ⛔ WHO SEES IT: a PAID member, and only while a gate is on. `j2_share_links_enabled` shows the
// share-link section, `notebook_publish_enabled` the publish section; both are latched from the
// auth payload for the life of the tab (lib/offline/notebookFlags.js). The admin special case
// that stood here is GONE (finding F-ADMIN-GATE): admins follow the flags like everyone else.
// A member whose plan lapsed still sees and revokes every link in Settings, which is not
// plan-gated (ruling D-B3).
//
// ⛔ THE PUBLISH CALL LIVES IN lib/notePublishLink.js (wave 9, lane 9D, ruling D-9D2): this door
// and the sidebar's folder door (PublishFolderSheet) publish through the ONE `publishTarget`, find
// an existing page with the ONE `findLivePublication`, and say what becomes public in the SAME
// sentences, which moved there with it. Nothing here restates them.
//
// It opens a `Sheet` (a centered dialog on desktop, a bottom sheet on touch), which owns focus
// trapping, Escape and focus return. Nothing is fetched until it opens: the editor already
// makes enough requests on mount.
//
// ⚠️ The trigger borrows NoteEditorPage.module.css's `.chromeBtn` so it sits in the editor's
// header row like its neighbours (lane 8A owns that stylesheet; do not rename the class).
import { Suspense, useState } from 'react'
import { useAuth } from '../../../../context/AuthContext'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import lazyChunk from '../../lib/lazyChunk'
import editorStyles from './NoteEditorPage.module.css'
import styles from './NoteShareControls.module.css'

// Audit 2026-11-05, S19: the sheet's content (the two tabs, the preview, the publish confirm) is its own chunk,
// fetched the first time the sheet opens, so the editor's first open carries only this button.
const SharePanel = lazyChunk(() => import('./NoteSharePanel'))

/** The Share sheet's title (M5): `Share "<title>"`, or "Share this note" for an untitled one. */
export function shareTitle(noteTitle) {
  const t = String(noteTitle || '').trim()
  return t ? `Share "${t}"` : 'Share this note'
}

export default function NoteShareControls({ noteId, noteTitle = '', onMessage }) {
  const { isPaid } = useAuth()
  const [open, setOpen] = useState(false)
  const shareOn = notebookFlag('j2_share_links_enabled') === true
  const publishOn = notebookFlag('notebook_publish_enabled') === true
  if (!noteId || isPaid !== true || (!shareOn && !publishOn)) return null
  // M5: the sheet names the note it shares.
  const title = shareTitle(noteTitle)
  return (
    <>
      <button
        type="button"
        className={editorStyles.chromeBtn}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Share"
        data-tour="note-share"
        title={publishOn ? 'Share a link to this note or publish it to the web' : 'Share a read-only link to this note'}
        onClick={() => setOpen(true)}
      >
        <UIcon name="link" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        {/* Finish batch (iPhone): on a phone the header shows Share's icon; the word is visually hidden there and the
            name stays "Share" (aria-label). Wider screens show the word, unchanged. */}
        <span className={editorStyles.phoneIconLabel}>Share</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} ariaLabel={title} maxWidth={460}>
        {open && (
          <Suspense fallback={<div className={styles.panel} role="status" aria-live="polite">Loading…</div>}>
            <SharePanel noteId={noteId} noteTitle={noteTitle} shareOn={shareOn} publishOn={publishOn}
              onMessage={onMessage} onClose={() => setOpen(false)} />
          </Suspense>
        )}
      </Sheet>
    </>
  )
}
