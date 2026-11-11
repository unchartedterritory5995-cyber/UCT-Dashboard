import { useEffect, useMemo, useRef } from 'react'
import StudyMark3D from '../../components/study/StudyMark3D'

/** The EXPORT stage for the brand assets (scratchpad local_study/pw_export.py). Not for scoring.
 *  ?size=512 &bg=transparent|#0b0b0b &mood=idle &phase=0.55 — renders one bare frame of the decided mark on a
 *  transparent page, so the rig can screenshot the element with the background omitted. */
export default function Piece59LogoExport() {
  const q = useMemo(() => new URLSearchParams(window.location.search), [])
  const size = Number(q.get('size')) || 512
  const bg = q.get('bg') || 'transparent'
  const mood = q.get('mood') || 'idle'
  const ref = useRef(null)
  useEffect(() => {
    const phase = q.get('phase'); if (phase != null) window.__uctLogoPhase = Number(phase)
    // every ancestor transparent, so an element screenshot with the page background omitted is truly transparent
    for (let el = ref.current; el; el = el.parentElement) el.style.setProperty('background', 'transparent', 'important')
    document.documentElement.style.setProperty('background', 'transparent', 'important')
    document.body.style.setProperty('background', 'transparent', 'important')
    return () => { delete window.__uctLogoPhase }
  }, [q])
  return (
    <div ref={ref} data-export style={{ width: size, height: size, background: bg, display: 'grid', placeItems: 'center' }}>
      <StudyMark3D still mood={mood} size={size} variant={12} />
    </div>
  )
}
