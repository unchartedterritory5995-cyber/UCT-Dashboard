// SurfaceHeader — a page's PageHeader that steps aside inside a UCT Terminal panel.
//
// Whole pages (Breadth, UCT 20, …) are embedded in terminal panels unforked. The panel
// header already names the function, so the page's own title is a second header there.
// Outside a panel this IS `PageHeader`, prop for prop. Inside one the title row is dropped
// and only the page's own controls (tabs, buttons — `children` / `right`) are kept, in a
// plain bar, because a tab strip is navigation, not a title.
import PageHeader from '../components/PageHeader'
import { useInTerminalPanel } from '../components/terminal'
import styles from './SurfaceHeader.module.css'

export default function SurfaceHeader({ children, right, className = '', ...rest }) {
  const inPanel = useInTerminalPanel()
  if (!inPanel) return <PageHeader className={className} {...rest} right={right}>{children}</PageHeader>
  if (children == null && right == null) return null
  return (
    <div className={`${styles.bar} ${className}`} data-testid="surface-header-in-panel">
      {children != null && <div className={styles.controls}>{children}</div>}
      {right != null && <div className={styles.right}>{right}</div>}
    </div>
  )
}
