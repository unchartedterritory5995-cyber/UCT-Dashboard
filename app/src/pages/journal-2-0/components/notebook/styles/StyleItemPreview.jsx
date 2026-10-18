// P3b Task 6: a library STYLE's Preview -- the surface P3a uses to show one style in full (ruling P3b-R7) -- with the
// style's examples ("In use") under its composed body. The same sheet, title, subtitle, states and Close that
// TemplatePreview gave a style's Preview, and the same read-only renderer (DocBody).
// ⛔ Why not TemplatePreview itself: it is in the Notebook's first open (TemplatePicker), and P3b adds +0 B there
//    (ruling P3b-R9). This file is only ever imported by TemplateGallery.jsx, a lazy chunk, so it ships inside it.
import Sheet from '../../../../../components/mobile/Sheet'
import { DocBody } from '../TemplatePreview'
import ExamplesInUse from './ExamplesInUse'
import styles from '../TemplateGallery.module.css'

export default function StyleItemPreview({ open, onClose, title, subtitle, body, examples, loading = false, loadError = null }) {
  return (
    <Sheet open={open} onClose={onClose} title={title || 'Preview'} labelledByTitle variant="auto" maxWidth={640}>
      <div className={styles.spWrap}>
        {subtitle && <p className={styles.spSubtitle}>{subtitle}</p>}
        {loading ? (
          <p className={styles.spStatus}>Loading preview…</p>
        ) : loadError ? (
          <p className={styles.spStatus} role="alert">{loadError}</p>
        ) : (
          <>
            <DocBody body={body} />
            <ExamplesInUse examples={examples} />
          </>
        )}
        <div className={styles.spActions}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </Sheet>
  )
}
