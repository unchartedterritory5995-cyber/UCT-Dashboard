import FilingSearchPanel from './FilingSearchPanel'
import styles from './Depth.module.css'

// Research > Depth (lane gaps-research). A container only: each panel is its own
// surface behind its own server flag (researchDepthFlags.js), and a panel whose
// flag is off is not rendered at all.
export default function DepthTab({ sym, flags }) {
  const f = flags || {}
  return (
    <div className={styles.depth} data-testid="research-depth">
      {f.filing_search_enabled === true && <FilingSearchPanel sym={sym} />}
    </div>
  )
}
