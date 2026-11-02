// UCT Agent's mark and name, for surfaces outside the panel (UCT News). The same compass as the panel's
// avatar, on a gold rim, at 14–16px. Branding only: it grants nothing (see canUseAgent).
import compassMark from '../components/intro/assets/compass-mark.png'
import styles from './AgentPanel.module.css'

export function AgentIdentity({ size = 16, label = true }) {
  const px = Math.min(16, Math.max(14, Number(size) || 16))
  return (
    <span className={styles.identity} data-agent-identity="">
      <span className={styles.identityMark} style={{ width: px, height: px }} aria-hidden="true"><img src={compassMark} alt="" /></span>
      {label && <span>UCT Agent</span>}
    </span>
  )
}

export default AgentIdentity
