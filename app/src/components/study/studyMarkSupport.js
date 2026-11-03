// Shared by StudyMark (the product) and the workbench's Logo: where the still lives, and whether this browser
// should run the live three.js mark.
export const STILL_SRC = '/brand/study-mark-256.png'

/** True when this browser should run the live mark: WebGL available and no reduced-motion preference. */
export function canRender3D() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false
    const c = document.createElement('canvas')
    return Boolean(c.getContext?.('webgl2') || c.getContext?.('webgl'))
  } catch { return false }
}
