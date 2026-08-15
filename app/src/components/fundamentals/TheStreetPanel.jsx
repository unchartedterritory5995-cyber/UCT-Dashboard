// app/src/components/fundamentals/TheStreetPanel.jsx
// "The Street" tab = Analyst + Ownership combined (both answer "what are the pros
// doing"): price target + upside + rating + recent rating changes, then
// institutional ownership + top holders + biggest buyers/sellers + short interest.
import AnalystPanel from './AnalystPanel'
import OwnershipPanel from './OwnershipPanel'

export default function TheStreetPanel({ sym }) {
  return (
    <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
      <AnalystPanel sym={sym} />
      <div style={{ height: 1, background: '#22251d', margin: '2px 16px' }} />
      <OwnershipPanel sym={sym} />
    </div>
  )
}
