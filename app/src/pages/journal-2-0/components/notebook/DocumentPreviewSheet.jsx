import { useRef } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import AskPanel from './AskPanel'
import PdfDocumentViewer from './PdfDocumentViewer'
import styles from './DocumentPreviewSheet.module.css'

/**
 * Wave I shipped a plain native `<iframe>` here. Wave J replaces the
 * PREVIEW AREA with `PdfDocumentViewer` (canvas + a real pdfjs text layer)
 * -- the ONE change needed for excerpt/highlight capture to work at all
 * (see lib/pdfjs.js's docstring for the measured, not-assumed reason).
 * Everything else is preserved byte-for-byte (checkpoint decision 10 --
 * "do not regress Wave I just to gain annotations"): the same fullscreen
 * Sheet wrapper, the same "Open in new tab"/"Download" actions at the same
 * authenticated `href`, the same page-target contract (now driven by
 * PdfDocumentViewer's own scroll-to-page instead of the browser's native
 * `#page=N` fragment convention -- functionally equivalent, live-verified).
 */
export default function DocumentPreviewSheet({
  open, href, name, page, onClose,
  excerpts = [], onSaveExcerpt, emphasizeExcerptId,
  documentId = null,
}) {
  const viewerRef = useRef(null)
  if (!href) return null
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
          {/* Ask stays IN document context -- a member should not have to
              leave the PDF to ask a question about it, and a citation lands
              back in this same viewer. */}
          {documentId && (
            <AskPanel
              scope="document"
              target={documentId}
              onNavigate={(source) => {
                const p = source?.navigation?.page_number
                if (p) viewerRef.current?.scrollToPage?.(p)
              }}
            />
          )}
        </div>
      </div>
      <PdfDocumentViewer
        ref={viewerRef}
        href={href}
        initialPage={page}
        excerpts={excerpts}
        onSaveExcerpt={onSaveExcerpt}
        emphasizeExcerptId={emphasizeExcerptId}
      />
    </Sheet>
  )
}
