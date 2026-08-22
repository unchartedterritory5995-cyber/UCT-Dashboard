// app/src/pages/cot/cotRead.js
//
// Pure positioning analytics for the COT tab — no React, no DOM.
//
// Input rows are the `/api/cot/{symbol}` records, ascending by date:
//   { date, commercial_net, large_spec_net, small_spec_net, open_interest }
//
// Two layers:
//   computeSnapshot(rows, idx) → the numbers for ONE report week (net, WoW,
//                                % of OI, 3-year COT Index, zone, streak)
//   buildRead(snapshot, sym)   → the plain-words read of those numbers
//                                (bias, crowding, headline, points, watch)
//
// The COT Index is Larry Williams' normalisation: where today's net sits
// inside its own min..max over the trailing window, 0..100. 156 weeks (three
// years) is the classic long-term window; it is what "3Y index" means in the
// UI. The index is computed per group against ITS OWN history, because the
// raw nets are not comparable across groups (commercials are structurally
// short most markets — "short" only means something relative to themselves).

export const INDEX_WINDOW = 156

export const GROUPS = [
  { key: 'commercials', field: 'commercial_net', label: 'Commercials',       short: 'Commercials' },
  { key: 'largeSpecs',  field: 'large_spec_net', label: 'Large Speculators', short: 'Large Specs' },
  { key: 'smallSpecs',  field: 'small_spec_net', label: 'Small Speculators', short: 'Small Specs' },
]

// Zone thresholds on the 0..100 index. Shared by the snapshot (zoning) and the
// read (bias / crowding) so the two can never disagree about "extreme".
const EXTREME_HI = 90
const HI         = 75
const LO         = 25
const EXTREME_LO = 10

// Symbols whose positioning reads against the usual grain.
const SYMBOL_NOTES = {
  VI: 'VIX is the exception to the usual read: speculators are structurally short volatility, '
    + 'so a crowded short here means complacency — the setup that precedes volatility spikes, not calm.',
}

// ── Primitives ────────────────────────────────────────────────────────────────

/** Position of the LAST value inside the window's min..max, 0..100. */
export function cotIndex(values) {
  if (!values || values.length < 2) return null
  let min = Infinity, max = -Infinity
  for (const v of values) { if (v < min) min = v; if (v > max) max = v }
  if (max === min) return 50
  return ((values[values.length - 1] - min) / (max - min)) * 100
}

/** Consecutive same-direction weekly moves ending at idx: +n rising, −n falling, 0 flat. */
export function streak(rows, idx, field) {
  if (idx <= 0) return 0
  const dir = Math.sign(rows[idx][field] - rows[idx - 1][field])
  if (dir === 0) return 0
  let n = 0
  for (let i = idx; i > 0; i--) {
    if (Math.sign(rows[i][field] - rows[i - 1][field]) !== dir) break
    n++
  }
  return dir * n
}

export function zoneOf(index) {
  if (index == null) return 'neutral'
  if (index >= EXTREME_HI) return 'extreme-long'
  if (index >= HI)         return 'long'
  if (index <= EXTREME_LO) return 'extreme-short'
  if (index <= LO)         return 'short'
  return 'neutral'
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export function computeSnapshot(rows, idx, windowWeeks = INDEX_WINDOW) {
  const row  = rows[idx]
  const prev = idx > 0 ? rows[idx - 1] : null
  const start  = Math.max(0, idx - windowWeeks + 1)
  const window = rows.slice(start, idx + 1)
  const oi = row.open_interest

  const groups = {}
  for (const g of GROUPS) {
    const net   = row[g.field]
    const index = cotIndex(window.map(r => r[g.field]))
    groups[g.key] = {
      net,
      wow:    prev ? net - prev[g.field] : null,
      pctOi:  oi ? (net / oi) * 100 : null,
      index,
      zone:   zoneOf(index),
      streak: streak(rows, idx, g.field),
    }
  }

  return {
    date: row.date,
    idx,
    windowWeeks: window.length,
    oi: {
      value:  oi,
      wow:    prev ? oi - prev.open_interest : null,
      index:  cotIndex(window.map(r => r.open_interest)),
      streak: streak(rows, idx, 'open_interest'),
    },
    groups,
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

function biasOf(c, l) {
  const ci = c.index ?? 50
  const li = l.index ?? 50
  if (ci >= HI) {
    return { label: 'Contrarian Bullish', tone: 'bull',
             strength: ci >= EXTREME_HI || li <= EXTREME_LO ? 'strong' : 'moderate' }
  }
  if (ci <= LO) {
    return { label: 'Contrarian Bearish', tone: 'bear',
             strength: ci <= EXTREME_LO || li >= EXTREME_HI ? 'strong' : 'moderate' }
  }
  // Hedgers mid-range: the crowd alone can still be stretched enough to fade.
  if (li >= EXTREME_HI) return { label: 'Contrarian Bearish', tone: 'bear', strength: 'moderate' }
  if (li <= EXTREME_LO) return { label: 'Contrarian Bullish', tone: 'bull', strength: 'moderate' }
  return { label: 'Neutral', tone: 'neutral', strength: null }
}

function crowdingOf(l) {
  const li = l.index ?? 50
  const index = Math.round(li)
  if (li >= EXTREME_HI) return { label: 'Crowded Long',  index, tone: 'bear' }
  if (li >= HI)         return { label: 'Leaning Long',  index, tone: 'bear' }
  if (li <= EXTREME_LO) return { label: 'Crowded Short', index, tone: 'bull' }
  if (li <= LO)         return { label: 'Leaning Short', index, tone: 'bull' }
  return { label: 'Balanced', index, tone: 'neutral' }
}

const ZONE_SHORT = {
  'extreme-long':  'at a 3-year max long',
  'long':          'leaning long',
  'neutral':       'mid-range',
  'short':         'leaning short',
  'extreme-short': 'at a 3-year max short',
}

function streakClause(st) {
  const n = Math.abs(st)
  if (n < 3) return ''
  return ` — and ${st > 0 ? 'adding' : 'cutting'} for ${n} straight weeks`
}

// One sentence per group per zone. Written for someone who has never read a
// COT report: who the group is, what their position means, and why it matters.
const GROUP_TEXT = {
  commercials: {
    'extreme-long':
      'Commercials are as long as they have been in three years{streak}. These are the hedgers who live in this market, and they only lean this hard when they see value — historically that is where bottoms get built, not where they start.',
    'long':
      'Commercials are near the long end of their three-year range{streak}. The hedgers are buying into weakness, which tends to put a floor under price over the coming weeks.',
    'neutral':
      'Commercials sit mid-range{streak}. The hedgers are not taking a stand here, so there is no contrarian signal from the group that matters most.',
    'short':
      'Commercials are near the short end of their three-year range{streak}. The hedgers are selling into strength — not a top call by itself, but a reason to stop chasing.',
    'extreme-short':
      'Commercials are as short as they have been in three years{streak}. The hedgers are leaning hard against this rally, and that shows up late in a move far more often than early.',
  },
  largeSpecs: {
    'extreme-long':
      'Large speculators are crowded long at a three-year extreme{streak}. The trend money is all in — trends can stay crowded for a while, but there is little fuel left from new buyers, and any shakeout forces this group to sell.',
    'long':
      'Large speculators are leaning long{streak}. The trend followers are on board, which means the trend is still being fed rather than fading.',
    'neutral':
      'Large speculators are mid-range{streak}. No crowd to fade and no trend conviction to ride — they are waiting like everyone else.',
    'short':
      'Large speculators are leaning short{streak}. The trend followers are pressing the downside, so the path of least resistance is still lower until they are forced to cover.',
    'extreme-short':
      'Large speculators are crowded short at a three-year extreme{streak}. The trend money is all in on the downside — and a crowded short is the fuel for sharp, short-covering rallies.',
  },
  smallSpecs: {
    'extreme-long':
      'Small traders are as long as they have been in three years{streak}. When the crowd is this one-sided, the easy money has usually been made — they are the group most often wrong at extremes.',
    'long':
      'Small traders are leaning long{streak}. Retail is chasing; fine while the trend holds, but they are the first to get shaken out.',
    'neutral':
      'Small traders are mid-range{streak}. The crowd has no strong opinion, which removes one of the classic tops-and-bottoms tells.',
    'short':
      'Small traders are leaning short{streak}. Retail is bearish — a mild contrarian positive, since this group rarely catches the low.',
    'extreme-short':
      'Small traders are as short as they have been in three years{streak}. The crowd has given up, and that kind of capitulation is usually a contrarian buy signal, not a sell.',
  },
}

function oiText(oi) {
  const rising  = oi.wow != null && oi.wow > 0
  const falling = oi.wow != null && oi.wow < 0
  const high = (oi.index ?? 50) >= HI
  const low  = (oi.index ?? 50) <= LO
  const st = Math.abs(oi.streak)
  if (rising && high)
    return 'Open interest is near a three-year high and still expanding — fresh money keeps arriving, so the current move has real participation behind it.'
  if (rising)
    return `Open interest is expanding${st >= 3 ? ` for ${st} straight weeks` : ''} — new positions are being opened, which gives the current move conviction.`
  if (falling && low)
    return 'Open interest is near a three-year low and still contracting — traders are closing out rather than committing, so moves here are thin and easier to reverse.'
  if (falling)
    return `Open interest is contracting${st >= 3 ? ` for ${st} straight weeks` : ''} — positions are being closed, not opened, so the move carries less conviction.`
  return 'Open interest is flat — no new commitment either way this week.'
}

const WATCH = {
  'bull-strong':
    'Do not press shorts into this. Hedgers at a three-year extreme are early more often than they are wrong. Let price confirm — a higher low or a reclaim of a key level — then lean long on pullbacks.',
  'bull-moderate':
    'Positioning favors the long side over the coming weeks. Wait for price to confirm rather than buying positioning alone — COT is a weeks-to-months signal, not a timing tool.',
  'bear-strong':
    'Do not chase strength here. Hedgers are as short as they have been in three years while the crowd is long. Tighten stops on longs and wait for a lower high before leaning short.',
  'bear-moderate':
    'Positioning is a headwind for new longs. Keep risk tight and let price print a lower high before pressing the short side.',
  'neutral':
    'No edge from positioning this week — trade the chart. Check back when any group pushes past 75 or under 25 on the three-year index.',
}

export function buildRead(snapshot, sym = {}) {
  const { groups, oi, windowWeeks } = snapshot
  const c = groups.commercials, l = groups.largeSpecs, s = groups.smallSpecs

  const bias     = biasOf(c, l)
  const crowding = crowdingOf(l)

  const headline = `Hedgers ${ZONE_SHORT[c.zone]} · trend money ${ZONE_SHORT[l.zone]}`

  const points = [
    { key: 'commercials', text: GROUP_TEXT.commercials[c.zone].replace('{streak}', streakClause(c.streak)) },
    { key: 'largeSpecs',  text: GROUP_TEXT.largeSpecs[l.zone].replace('{streak}', streakClause(l.streak)) },
    { key: 'smallSpecs',  text: GROUP_TEXT.smallSpecs[s.zone].replace('{streak}', streakClause(s.streak)) },
    { key: 'oi',          text: oiText(oi) },
  ]

  const watch = WATCH[bias.strength ? `${bias.tone}-${bias.strength}` : 'neutral']

  const caveat = windowWeeks < INDEX_WINDOW
    ? `Only ${windowWeeks} weeks of history behind this index — read the extremes with less confidence than a full three-year window.`
    : null

  return {
    bias,
    crowding,
    headline,
    points,
    watch,
    caveat,
    note: SYMBOL_NOTES[sym.symbol] || null,
  }
}
