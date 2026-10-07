// DPTH — Research › Depth, embedded. ⛔ An ADAPTER, not a fork: DepthTab takes the `flags`
// ResearchPage reads off the auth payload (`researchDepth`), so this hands it the same object.
//
// TERM-019: DPTH is a STACK of depth panels, each with its own source line in its own card. The
// header therefore says exactly that rather than naming one of them; the stacked panels stay
// quiet (they report only when each is the whole panel — `useDepthChrome().alone`).
import { useAuth } from '../../../context/AuthContext'
import { usePanelFreshness } from '../../../components/terminal'
import DepthTab from '../../research/depth/DepthTab'

const STACK_SOURCE = { source: 'several sources; each section names its own' }

export default function DepthPanel({ sym }) {
  const { researchDepth } = useAuth()
  usePanelFreshness(sym ? STACK_SOURCE : null)
  return <DepthTab sym={sym} flags={researchDepth} />
}
