import { useRef } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import AskPanel from './AskPanel'
import { SOURCE_NOWHERE } from '../../lib/openCitation'
// ⛔ THE VIEWER IS BEHIND A BOUNDARY, NOT IMPORTED DIRECTLY. A static import here is what
// let a pdfjs incompatibility take the whole /journal/notebook route down on iOS 17
// (2026-09-12). See PdfViewerBoundary.jsx for the incident and both mechanisms.
import PdfViewerBoundary from './PdfViewerBoundary'
// Wave 7 lane G (G4): an image or a .docx can be a document too. Neither viewer
// touches pdfjs, so both are plain imports; the PDF path stays behind its boundary.
import ImageDocumentViewer from './ImageDocumentViewer'
import TextPagesViewer from './TextPagesViewer'
import { DOCUMENT_KIND_DOCX, DOCUMENT_KIND_IMAGE, documentKindFromHref } from './documentKind'
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
 *
 * Wave 7 (G4): the preview area BRANCHES on what the document is. The mounts
 * pass no kind (and are unchanged by ruling), so the kind is read from the
 * attachment URL, which the server makes say what the row is — see
 * `documentKind.js`. An image opens beside the text read from it; a .docx
 * opens as page-numbered text on the page a search hit named; everything else
 * — every PDF — opens exactly as before.
 */
export default function DocumentPreviewSheet({
  open, href, name, page, onClose,
  excerpts = [], onSaveExcerpt, emphasizeExcerptId,
  documentId = null,
  // G-064: inside a note, `onInsert` puts an answer into that note; in the
  // research workspace, `onOpenNote` enables the picker (spec §3.2-3.3).
  onInsert = null,
  onOpenNote = null,
}) {
  // Wave P5 — `bodyClassName` makes the sheet's body a flex column that does
  // not scroll, so the viewer below can size to the space that is LEFT and
  // its sticky Scanned text control lands on a visible edge. The measured
  // reason is in `.body` in this module's CSS.
  const viewerRef = useRef(null)
  if (!href) return null
  const kind = documentKindFromHref(href)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="fullscreen"
      ariaLabel={name ? `Preview of ${name}` : 'Document preview'}
      className={styles.sheet}
      bodyClassName={styles.body}
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
                // A source with no page has nowhere to go in this viewer, and
                // AskPanel says so inside itself rather than doing nothing.
                if (!p) return SOURCE_NOWHERE
                viewerRef.current?.scrollToPage?.(p)
                return null
              }}
              onInsert={onInsert}
              onOpenNote={onOpenNote}
            />
          )}
        </div>
      </div>
      {kind === DOCUMENT_KIND_IMAGE ? (
        <ImageDocumentViewer ref={viewerRef} href={href} documentId={documentId} name={name} />
      ) : kind === DOCUMENT_KIND_DOCX ? (
        <TextPagesViewer ref={viewerRef} href={href} documentId={documentId} initialPage={page} />
      ) : (
        <PdfViewerBoundary
          ref={viewerRef}
          href={href}
          /* Wave P4: the viewer needs the document id to fetch ONE page's
             scanned-text transcript. */
          documentId={documentId}
          initialPage={page}
          excerpts={excerpts}
          onSaveExcerpt={onSaveExcerpt}
          emphasizeExcerptId={emphasizeExcerptId}
        />
      )}
    </Sheet>
  )
}
