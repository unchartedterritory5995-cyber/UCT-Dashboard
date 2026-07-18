//
// One-line group heat summary above the grid in Groups mode. Live, not frozen:
// it reads the same live today's-% the cells already stream.

export function summarizeHeat(holdings) {
  const list = (holdings || []).filter(h => Number.isFinite(h?.changePct))
  const count = list.length
  if (!count) return { green: 0, count: 0, avg: 0, leader: null }
  let green = 0, sum = 0, leader = list[0]
  for (const h of list) {
    if (h.changePct > 0) green++
    sum += h.changePct
    if (h.changePct > leader.changePct) leader = h
  }
  return { green, count, avg: Math.round((sum / count) * 100) / 100, leader }
}

function pct(n) { return `${n > 0 ? '+' : ''}${n.toFixed(1)}%` }

export default function GroupHeatHeader({ groupName, total, shown, holdings }) {
  const { green, count, avg, leader } = summarizeHeat(holdings)
  return (
    <div className="groupHeatHeader" style={heaterStyle}>
      <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}>{groupName}</strong>
      {count > 0 && (
        <>
          <span>{green}/{count} green</span>
          <span style={{ color: avg >= 0 ? '#22c55e' : '#f87171' }}>{pct(avg)}</span>
          {leader && <span>{leader.sym} {pct(leader.changePct)}</span>}
        </>
      )}
      {Number.isFinite(total) && Number.isFinite(shown) && total > shown && (
        <span style={{ color: 'var(--text-muted, #6b7280)', marginLeft: 'auto' }}>{shown} of {total}</span>
      )}
    </div>
  )
}

const heaterStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px',
  fontSize: 12, borderBottom: '1px solid var(--border, #2a3340)',
}
