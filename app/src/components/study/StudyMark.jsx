// THE STUDY MARK for the product. Renders the live three.js mark (StudyMark3D, lazy-loaded so the 3D library is its
// own chunk and never rides the entry bundle) when the browser can run it, and the exported still
// (public/brand/study-mark-256.png, made from the same renderer) when it cannot: no WebGL, prefers-reduced-motion, or
// while the chunk is still loading. The still is decorative (alt "", aria-hidden): the mark never carries meaning the
// text beside it does not.
import { lazy, Suspense, useMemo } from 'react'
import m from './StudyMark.module.css'
import { canRender3D, STILL_SRC } from './studyMarkSupport'

const StudyMark3D = lazy(() => import('./StudyMark3D'))

/** @param {{ mood?: 'idle'|'live'|'think'|'happy'|'oops'|'fire', size?: number, className?: string }} props */
export default function StudyMark({ mood = 'idle', size = 72, className = '' }) {
  const live = useMemo(() => canRender3D(), [])
  const still = <img src={STILL_SRC} width={size} height={size} alt="" aria-hidden="true" draggable={false} className={`${m.still} ${className}`} data-study-mark="still" />
  if (!live) return still
  return <Suspense fallback={still}><StudyMark3D mood={mood} size={size} className={className} /></Suspense>
}
