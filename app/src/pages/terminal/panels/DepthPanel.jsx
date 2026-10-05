// DPTH — Research › Depth, embedded. ⛔ An ADAPTER, not a fork: DepthTab takes the `flags`
// ResearchPage reads off the auth payload (`researchDepth`), so this hands it the same object.
import { useAuth } from '../../../context/AuthContext'
import DepthTab from '../../research/depth/DepthTab'

export default function DepthPanel({ sym }) {
  const { researchDepth } = useAuth()
  return <DepthTab sym={sym} flags={researchDepth} />
}
