import { useEffect, useRef } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import styles from './myTools.module.css'

/** A push-in panel's head inside My tools: Back (Escape does the same), and the panel's heading, which takes focus
 *  when the panel opens unless the panel puts focus on its own field (rename, delete). */
export default function PanelHead({ title, onBack, focusHeading = true, backLabel = 'Back to your widgets' }) {
  const ref = useRef(null)
  useEffect(() => { if (focusHeading) ref.current?.focus() }, [focusHeading])
  return (
    <div className={styles.panelHead}>
      <button type="button" className={styles.backBtn} onClick={onBack} aria-label={backLabel}>
        <UIcon name="chevronLeft" size={16} gold={false} />
        <span>Back</span>
      </button>
      <h3 ref={ref} className={styles.panelTitle} tabIndex={-1} data-panel-heading="">{title}</h3>
    </div>
  )
}
