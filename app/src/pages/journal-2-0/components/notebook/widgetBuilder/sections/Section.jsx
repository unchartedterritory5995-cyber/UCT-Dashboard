import { useId } from 'react'
import UIcon from '../../../../../../components/ui/UIcon'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * One builder section: a region named by its own heading (spec 5.11: every section has a heading, and a screen
 * reader can move section to section by region or by heading). The heading takes focus when a picker closes back
 * onto its section without a control to return to (`data-builder-heading`).
 */
export default function Section({ id, title, hint, children }) {
  const hid = useId()
  return (
    <section className={styles.section} aria-labelledby={hid} data-builder-section={id}>
      <h3 className={styles.sectionHeading} id={hid} tabIndex={-1} data-builder-heading="">{title}</h3>
      {hint && <p className={styles.sectionHint}>{hint}</p>}
      {children}
    </section>
  )
}

/** The head of a pushed-in picker: Back (Escape does the same) and the picker's heading, which takes focus. */
export function PickerHead({ title, onBack, backLabel = 'Back' }) {
  return (
    <div className={styles.pickerHead}>
      <button type="button" className={styles.backBtn} onClick={onBack} aria-label={`${backLabel} to the widget`}>
        <UIcon name="chevronLeft" size={16} gold={false} aria-hidden="true" />
        <span>{backLabel}</span>
      </button>
      <h3 className={styles.pickerTitle} tabIndex={-1} data-picker-heading="">{title}</h3>
    </div>
  )
}
