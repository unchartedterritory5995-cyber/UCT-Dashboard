import styles from '../ChartsWorkspace.module.css'

/**
 * Wrapper for anything rendered inside a popped-out window.
 *
 * Re-establishes the two things the workspace chrome normally supplies and that
 * a bare popup document has no way to inherit: the `data-charts-theme` attribute
 * every widget's CSS keys off, and a full-height flex column so the content
 * fills the window instead of collapsing to its intrinsic height.
 */
export default function PopoutShell({ theme, bodyRef, children }) {
  return (
    <div
      className={styles.workspace}
      data-charts-theme={theme}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <div className={styles.popoutBody} ref={bodyRef}>{children}</div>
    </div>
  )
}
