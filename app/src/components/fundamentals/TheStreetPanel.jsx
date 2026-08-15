// app/src/components/fundamentals/TheStreetPanel.jsx
// "The Street" tab = Analyst + Ownership SIDE BY SIDE (both answer "what are the
// pros doing"): left = price target + upside + rating + recent rating changes;
// right = institutional ownership + top holders + biggest buyers/sellers + short
// interest. Two independently-scrollable columns so you see both at once instead
// of scrolling a tall stack; collapses to one column on a narrow popup (phone).
import AnalystPanel from './AnalystPanel'
import OwnershipPanel from './OwnershipPanel'

const col = { minWidth: 0, maxHeight: '72vh', overflowY: 'auto' }

export default function TheStreetPanel({ sym }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 16,
      padding: '6px 10px',
      alignItems: 'start',
      // .chartArea flex-centers its child — fill it, top-aligned, or the two
      // columns collapse into a narrow centered strip.
      width: '100%',
      alignSelf: 'flex-start',
    }}>
      <div style={col}><AnalystPanel sym={sym} /></div>
      <div style={col}><OwnershipPanel sym={sym} /></div>
    </div>
  )
}
