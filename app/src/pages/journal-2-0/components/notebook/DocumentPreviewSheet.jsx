import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import styles from './DocumentPreviewSheet.module.css'

/**
 * Wave I — PDF preview. Native browser PDF rendering inside a Sheet (no
 * pdf.js/react-pdf dependency — every modern browser's built-in viewer
 * already gives page navigation, zoom, and Ctrl+F find-in-document; this
 * page never rebuilds any of that). Opened from a click on a PDF
 * AttachmentChip (see NoteEditorPage.jsx's editorProps.handleClickOn) and
 * from the standalone /journal/notebook/documents/:noteId/:filename route
 * (DocumentPage.jsx) — same component, same content, matching this whole
 * program's "one implementation" convention.
 *
 * Accessibility, stated precisely rather than claimed: an <iframe> PDF
 * viewer's internal page-nav/zoom controls are the BROWSER's own — this
 * component cannot add keyboard/ARIA semantics inside a cross-origin-like
 * native viewer. What IS provided: a labeled dialog, a working Escape/close
 * (via Sheet), and an explicit "Open in new tab" / "Download" fallback for
 * anyone whose browser or assistive tech doesn't render inline PDFs well.
 */
export default function DocumentPreviewSheet({ open, href, name, page, onClose }) {
  if (!href) return null
  const srcWithPage = page ? `${href}#page=${page}` : href
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="fullscreen"
      ariaLabel={name ? `Preview of ${name}` : 'Document preview'}
      className={styles.sheet}
    >
      <div className={styles.bar}>
        <span className={styles.name}>{name || 'Document'}</span>
        <div className={styles.actions}>
          <a
            className={styles.actionLink}
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            <UIcon name="link" size={13} gold={false} /> Open in new tab
          </a>
          <a className={styles.actionLink} href={href} download={name || undefined}>
            <UIcon name="download" size={13} gold={false} /> Download
          </a>
        </div>
      </div>
      <iframe
        title={name ? `Preview of ${name}` : 'Document preview'}
        src={srcWithPage}
        className={styles.frame}
      />
    </Sheet>
  )
}
