// P3a Task 10 (R-P3-7): a door into the community style library, opened at Styles. KindSection (the New note
// sheet) and the Styles manager each render one; neither has a tab of its own.
// ⛔ The gallery loads through the SAME lazy chunk TemplatePicker's door uses (`import('../TemplateGallery')`),
//    and that import lives HERE, inside the lazy styles chunks (StyleSurfaces via lazyStyles.js, and the Styles
//    manager's own chunk), never in an eager Notebook file: it adds no first-open bytes (R-P3-5). It is not a
//    styles/ module, so NoteEditorPage.styleChunks.test.js's count of two is untouched.
// ⛔ The callers render this only while styleLibraryEnabled() is true; this file restates no gate.
import { Suspense, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon from '../../../../../components/ui/UIcon'
import lazyChunk from '../../../lib/lazyChunk'

const TemplateGallery = lazyChunk(() => import('../TemplateGallery'))

export default function LibraryDoor({ label, className, disabled = false }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}
        aria-haspopup="dialog" data-community-library-door="">
        <UIcon name="community" size={14} gold={false} />
        <span>{label}</span>
      </button>
      {open && (
        <Sheet open onClose={() => setOpen(false)} title="Community styles" labelledByTitle variant="auto" maxWidth={960}>
          <Suspense fallback={<p role="status">Loading the community library…</p>}>
            <TemplateGallery initialType="style" onBack={() => setOpen(false)} backLabel="Close the library" />
          </Suspense>
        </Sheet>
      )}
    </>
  )
}
