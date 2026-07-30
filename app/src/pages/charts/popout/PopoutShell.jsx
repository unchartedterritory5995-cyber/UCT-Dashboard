import styles from '../ChartsWorkspace.module.css'

/**
 * Wrapper for anything rendered inside a popped-out window.
 *
 * Re-establishes the two things the workspace chrome normally supplies and that
 * a bare popup document has no way to inherit: the `data-charts-theme` attribute
 * every widget's CSS keys off, and a full-height flex column so the content
 * fills the window instead of collapsing to its intrinsic height.
 */
export default function PopoutShell({ theme, bodyRef, merged = false, children }) {
  return (
    <div
      className={styles.workspace}
      data-charts-theme={theme}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* `merged` must mirror the main board's body: the shared row-height math
          drops the body padding in merged mode, so a popped body that KEPT its
          6px would overflow by 12px and clip the bottom widget's date axis. */}
      <div
        className={`${styles.popoutBody} ${merged ? styles.popoutBodyMerged : ''}`}
        ref={bodyRef}
      >{children}</div>
    </div>
  )
}
