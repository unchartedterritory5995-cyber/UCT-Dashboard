// Small UCT compass badge for the corner of a video thumbnail, so the Desk
// library reads as a cohesive UCT-branded collection. Drop inside any
// position:relative thumbnail wrapper; it anchors bottom-right.
import brandMark from '../intro/assets/compass-mark.png'
import styles from './BrandThumb.module.css'

export default function BrandBadge() {
  return (
    <span className={styles.badge} aria-hidden="true">
      <img src={brandMark} alt="" />
    </span>
  )
}
