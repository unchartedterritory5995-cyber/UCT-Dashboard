// P4b Task 7: THE ONE card dispatcher of the community library. TemplateGallery.jsx (its `card`) and AuthorView.jsx
// both render this, and neither keeps a switch of its own, so an item type is decided in exactly one place:
//   * `page_layout` -> LayoutLibraryCard, and ONLY while the list answer says `capabilities.layoutSharing`. With
//     sharing off a layout row (a stale cache, an author's page) renders nothing: it is never an outline card,
//     whose "Use template" would copy an empty template and count a use (P4b X8).
//   * `style` -> StyleLibraryCard while the library switch is on; otherwise the outline card, as before P3a.
//   * anything else -> the gallery's own outline card (GalleryCard).
// Lazy-only: imported by TemplateGallery.jsx and AuthorView.jsx, both inside the lazy gallery chunk.
import { GalleryCard } from './TemplateGallery'
import StyleLibraryCard from './StyleLibraryCard'
import LayoutLibraryCard from './LayoutLibraryCard'

export default function LibraryCard({
  item, libraryOn = false, layoutSharing = false, isAdmin = false, busy = false,
  onPreview, onStylePreview, onUse, onChanged, onMessage, onOpenAuthor,
}) {
  if (item.itemType === 'page_layout') {
    return libraryOn && layoutSharing
      ? <LayoutLibraryCard item={item} busy={busy} onMessage={onMessage} onOpenAuthor={onOpenAuthor} />
      : null
  }
  if (libraryOn && item.itemType === 'style') {
    return <StyleLibraryCard item={item} busy={busy} onPreview={onStylePreview} onOpenAuthor={onOpenAuthor} onMessage={onMessage} />
  }
  return (
    <GalleryCard item={item} isAdmin={isAdmin} busy={busy} onPreview={onPreview} onUse={onUse} onChanged={onChanged}
      onMessage={onMessage} />
  )
}
