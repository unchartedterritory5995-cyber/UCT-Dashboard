export const TAG_COLORS = [
  { key: 'green',  hex: '#4ade80', bg: 'rgba(74,222,128,0.18)',  label: 'Breaking Out' },
  { key: 'blue',   hex: '#60a5fa', bg: 'rgba(96,165,250,0.18)',  label: 'Setting Up' },
  { key: 'orange', hex: '#fb923c', bg: 'rgba(251,146,60,0.18)',  label: 'Earnings Watch' },
  { key: 'red',    hex: '#f87171', bg: 'rgba(248,113,113,0.18)', label: 'Caution' },
  { key: 'purple', hex: '#c084fc', bg: 'rgba(192,132,252,0.18)', label: 'Watching' },
  { key: 'gold',   hex: '#c9a84c', bg: 'rgba(201,168,76,0.18)',  label: 'Top Pick' },
  { key: 'teal',   hex: '#2dd4bf', bg: 'rgba(45,212,191,0.18)',  label: 'Pullback' },
]

export const TAG_BY_KEY = Object.fromEntries(TAG_COLORS.map(t => [t.key, t]))
