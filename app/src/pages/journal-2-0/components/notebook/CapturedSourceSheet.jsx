import { Sheet } from '../../../../components/mobile'
import UIcon from '../../../../components/ui/UIcon'
import { sourceDomain } from '../../lib/searchResultLabel'
import styles from './CapturedSourceSheet.module.css'

/**
 * Wave N §9 — REVISITING A CAPTURED WEB PASSAGE.
 *
 * ⚰️ WHAT THIS REPLACES, and it was live. Clicking a captured passage in a
 * thesis ran `handleOpenExcerptSource`, whose only gate was
 * `if (!excerpt?.attachmentUrl) return`. A web capture HAS an
 * `attachment_url` — `web:<sha256>`, an identity string, not a file — so the
 * gate passed and the member got a FULLSCREEN PDF VIEWER pointed at a non-URL,
 * complete with working-looking "Open in new tab" and "Download" controls, over
 * an article we hold one paragraph of. Wave M had already ruled on this
 * (`searchNavigation.navigationDepth`: a web hit is 'note', "there is no viewer
 * to scroll"); the thesis click path never learned it. §18 again.
 *
 * ⛔ AND THIS IS NOT A WEB-DOCUMENT READER. It shows ONLY what we actually
 * hold: the passage the member selected, their own note about it, and where it
 * came from. No page anchors, no ordinals rendered as pages, no fetched
 * article body, no download. The one way to see the rest of the article is the
 * canonical URL, opened by the member, in their browser, from the publisher.
 *
 * ⛔ SOURCE, MEMBER NOTE AND STANCE STAY THREE THINGS (§7). The passage is
 * visually quoted and labelled with its origin; the annotation is labelled
 * "Your note" and never merged into the quotation.
 */
export default function CapturedSourceSheet({ open, excerpt, onClose, onOpenOwningNote }) {
  if (!excerpt) return null
  const url = excerpt.sourceUrl || ''
  const domain = sourceDomain(url)
  const name = excerpt.documentName || 'Captured source'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="auto"
      ariaLabel={`Captured passage from ${name}`}
      className={styles.sheet}
    >
      <div className={styles.head}>
        <div className={styles.identity}>
          {/* The link glyph, not the document glyph: a captured web source is
              not a filed document (FolderSidebar made the same call). */}
          <UIcon name="link" size={13} gold={false} />
          <div>
            <div className={styles.name}>{name}</div>
            {domain && <div className={styles.domain}>{domain}</div>}
          </div>
        </div>
        <button type="button" className={styles.close} onClick={onClose}
                aria-label="Close captured source">
          <UIcon name="x" size={13} gold={false} />
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.label} id="captured-passage-label">Captured passage</div>
        <blockquote className={styles.quote} aria-labelledby="captured-passage-label">
          {excerpt.capturedText}
        </blockquote>
        {/* ⛔ Says what we hold, so nobody reads the quotation as the article.
            This is the same coverage boundary Ask carries on every item. */}
        <p className={styles.coverage}>
          This is the passage you kept — not the whole article.
        </p>
      </div>

      {excerpt.annotation && (
        <div className={styles.section}>
          <div className={styles.label} id="your-note-label">Your note</div>
          <p className={styles.annotation} aria-labelledby="your-note-label">
            {excerpt.annotation}
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {url && (
          <a className={styles.action} href={url} target="_blank" rel="noreferrer noopener">
            <UIcon name="link" size={12} gold={false} /> Open the source
          </a>
        )}
        {onOpenOwningNote && (
          <button type="button" className={styles.action} onClick={onOpenOwningNote}>
            <UIcon name="document" size={12} gold={false} /> Open the note it lives in
          </button>
        )}
      </div>
    </Sheet>
  )
}
