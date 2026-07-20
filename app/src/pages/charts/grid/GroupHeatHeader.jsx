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

export default function GroupHeatHeader({ groupName, total, shown, holdings, alsoIn, onSwitch }) {
  const { green, count, avg, leader } = summarizeHeat(holdings)
  const switches = (Array.isArray(alsoIn) ? alsoIn : []).filter(g => g && g.id && g.name).slice(0, 5)
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
      {/* Multi-membership switcher: the seed's other groups — click to re-fill. */}
      {switches.length > 0 && onSwitch && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted, #6b7280)' }}>also in:</span>
          {switches.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSwitch(g.id, g.name)}
              style={switchChipStyle}
              title={`Switch to ${g.name}`}
            >{g.name}</button>
          ))}
        </span>
      )}
      {Number.isFinite(total) && Number.isFinite(shown) && total > shown && (
        <span style={{ color: 'var(--text-muted, #6b7280)', marginLeft: 'auto' }}>{shown} of {total}</span>
      )}
    </div>
  )
}

const switchChipStyle = {
  background: 'transparent',
  border: '1px solid var(--border, #2a3340)',
  borderRadius: 4,
  color: 'var(--text-muted, #9aa4b2)',
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '1px 7px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const heaterStyle = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px',
  fontSize: 12, borderBottom: '1px solid var(--border, #2a3340)',
  flexWrap: 'wrap', rowGap: 4,   // also-in chips wrap on narrow widths instead of overflowing
}
