// app/src/components/research/sections/FundamentalsSection.jsx
//
// The valuation / growth / margin context you need to judge a print —
// previously only on /research's Overview tab, which the modal had to navigate
// away to reach.
//
// This is the snapshot ONLY. Overview also mounts a full ChartPane, and that
// does not belong here twice over: the modal's footer already has "View Chart",
// and an ECharts instance that mounts inside a hidden/zero-width panel never
// recovers its size — the same trap the modal's own GATE c comment calls out
// for its unmounted panels.
import FundamentalSnapshot from '../../FundamentalSnapshot'

export default function FundamentalsSection({ sym }) {
  if (!sym) return null
  // showResearchLink={false}: the whole point of this section is that there is
  // nowhere else to go.
  return <FundamentalSnapshot sym={sym} showResearchLink={false} />
}
