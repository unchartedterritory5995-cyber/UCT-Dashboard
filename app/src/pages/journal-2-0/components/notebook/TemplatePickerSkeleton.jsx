// Wave 7 Task 7.4: the box the template picker fills, held while the picker's chunk (and the catalog it
// lists, lib/templatesLoader.js) are on their way.
//
// It is the picker's own outer box (the same `wrap` class) held at a height, so the empty notebook does not
// jump when the picker lands, and it carries the gallery door's tour anchor (`data-tour="template-gallery-door"`,
// TemplatePicker.jsx): the template-gallery and style-library tours wait for that anchor, and a tour shown
// while the chunk loads must still find it (b4Styles.emptyNotebook.test.jsx). Both tours `require` the gallery
// switch, so with the switch off nothing waits on this placeholder.
//
// Nothing here is a control: a placeholder that looks pressable and does nothing is the dead control the
// Notebook refuses. The anchor is an EMPTY shaped placeholder, so there is nothing for assistive technology to
// read, and it is deliberately NOT under `aria-hidden`: the tour engine refuses an anchor inside an aria-hidden
// subtree (tourAnchorVisibility.js `anchorFor`). The box itself is the one status a screen reader hears.
import styles from './TemplatePicker.module.css'

export default function TemplatePickerSkeleton() {
  return (
    <div
      className={`${styles.wrap} ${styles.skeleton}`}
      role="status"
      aria-label="Loading templates"
      data-template-picker-skeleton=""
    >
      <div className={styles.toolbar}>
        <div className={styles.skeletonBar} aria-hidden="true" />
        <div className={styles.skeletonDoor} data-tour="template-gallery-door" />
      </div>
      <div className={styles.skeletonCard} aria-hidden="true" />
      <div className={styles.skeletonCard} aria-hidden="true" />
      <div className={styles.skeletonCard} aria-hidden="true" />
    </div>
  )
}
