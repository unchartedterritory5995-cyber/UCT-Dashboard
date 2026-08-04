// app/src/components/research-kit/EyebrowLabel.jsx
import InfoTip from './InfoTip'
import styles from './EyebrowLabel.module.css'

/**
 * The single eyebrow idiom: 10px / 600 / --ls-label / uppercase (spec §3.2).
 * Uses --text-xs, so it lifts to 11px on phones via the token comfort scale —
 * that bump is intentional and helps the <18px contrast floor.
 *
 * Ink is --text-muted, which §3.2 declares the DIMMEST permitted on glass.
 * Never darken it further.
 *
 * `info` adds the optional ⓘ (§3.4): pass a string for a bare explanation, or
 * `{ text, href, hrefLabel }` to also link the methodology page (§12).
 */
export default function EyebrowLabel({
  children,
  info,
  as: Tag = 'div',
  id,
  className = '',
}) {
  const tip = typeof info === 'string' ? { text: info } : info || null
  const plain = typeof children === 'string' ? children : ''

  return (
    <Tag className={`${styles.eyebrow} ${className}`} id={id}>
      <span className={styles.text}>{children}</span>
      {tip?.text && (
        <InfoTip
          label={plain ? `About ${plain}` : 'What is this?'}
          text={tip.text}
          href={tip.href}
          hrefLabel={tip.hrefLabel}
        />
      )}
    </Tag>
  )
}
