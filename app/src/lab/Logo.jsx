// THE LOGO (decided 2026-11-03): the live three.js mark, step 12 of the ladder with the glow turned down, the same
// component the product renders (components/study/StudyMark3D). Falls back to the canvas renderer where the browser
// cannot run WebGL or asks for reduced motion. Every workbench piece imports this and gets the decision.
import StudyMark3D from '../components/study/StudyMark3D'
import { canRender3D } from '../components/study/studyMarkSupport'
import LogoCanvas from './LogoCanvas'

export default function Logo(props) {
  return canRender3D() ? <StudyMark3D variant={12} {...props} /> : <LogoCanvas {...props} />
}
