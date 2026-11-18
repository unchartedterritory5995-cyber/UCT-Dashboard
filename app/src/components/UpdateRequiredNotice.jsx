// Shown where a lazy chunk could not load and a reload would close the member's pop-out windows.
import { reloadNow } from '../lib/reloadGuard'
import styles from './UpdateReadyToast.module.css'

export default function UpdateRequiredNotice() {
  return (
    <span className={styles.inline} data-testid="update-required-notice">
      <span>Update required to open this</span>
      <button type="button" className={styles.inlineBtn} onClick={() => reloadNow()}>Reload</button>
    </span>
  )
}
