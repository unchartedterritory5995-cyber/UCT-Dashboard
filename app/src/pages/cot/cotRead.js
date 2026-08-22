// app/src/pages/cot/cotRead.js
//
// Pure positioning analytics for the COT tab — no React, no DOM.
//
// Input rows are the `/api/cot/{symbol}` records, ascending by date:
//   { date, commercial_net, large_spec_net, small_spec_net, open_interest }
//
// Two layers:
//   computeSnapshot(rows, idx) → the numbers for ONE report week (net, WoW,
//                                % of OI, 3-year COT Index, zone, streak, plus
//                                the v2 signal fields: 26-week index, 6-week
//                                Movement Index, weeks in zone, 4-week change
//                                and its percentile rank)
//   buildRead(snapshot, sym)   → the plain-words read of those numbers
//                                (bias, crowding, headline, points, watch,
//                                signals, classNote)
//
// The COT Index is Larry Williams' normalisation: where today's net sits
// inside its own min..max over the trailing window, 0..100. 156 weeks (three
// years) is the classic long-term window; it is what "3Y index" means in the
// UI. The index is computed per group against ITS OWN history, because the
// raw nets are not comparable across groups (commercials are structurally
// short most markets — "short" only means something relative to themselves).
//
// Every derived number here is computed from the rows it is handed — nothing
// is restated from a second source, so the snapshot and the read can never
// disagree about what "extreme" or "fast" means.

export const INDEX_WINDOW = 156
export const SHORT_WINDOW = 26   // the classic short-term index window (weeks)

const MOVE_WEEKS       = 6       // Movement Index: index now vs. six weeks ago
const CHG_WEEKS        = 4       // chg4: net now vs. four weeks ago
const MIN_CHG_SAMPLES  = 8       // chg4Rank needs at least this many changes to mean anything
const MOVEMENT_TRIGGER = 40      // |move6| at or past this is the classic trigger
const FASTEST_HI       = 95      // chg4Rank at or above → fastest buying in the window
const FASTEST_LO       = 5       // chg4Rank at or below → fastest selling
const MAX_SIGNALS      = 4

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

// ── Asset classes ─────────────────────────────────────────────────────────────
//
// Who the "commercials" are differs by market, and that decides how much to
// lean on the contrarian read. The map mirrors the COT tab's symbol roster.

const ASSET_CLASS = (() => {
  const m = {}
  const add = (cls, syms) => { for (const s of syms.split(' ')) m[s] = cls }
  add('index',     'ES NQ YM QR EW NK')
  add('vol',       'VI')
  add('metals',    'GC SI HG PL PA AL')
  add('energy',    'CL HO RB NG FL BZ')
  add('grains',    'ZW ZC ZS ZM ZL ZR KE MW OA')
  add('softs',     'CT OJ KC SB CC LB')
  add('livestock', 'LE GF HE DF BJ')
  add('rates',     'ZB UD ZN ZF ZT ZQ SR3')
  add('fx',        'DX B6 D6 J6 S6 E6 A6 M6 N6 L6')
  add('crypto',    'BTC ETH')
  return m
})()

export function assetClassOf(symbol) {
  if (!symbol) return 'other'
  return ASSET_CLASS[String(symbol).toUpperCase()] || 'other'
}

// One or two sentences per class, written for someone who has never read a
// COT report: who the hedgers and the crowd are HERE, and how hard to lean on
// the contrarian read.
const CLASS_NOTES = {
  index:
    'In stock-index futures the commercials are mostly dealers and asset managers hedging equity books, not producers who know a physical market, so the usual "hedgers know best" logic is weaker here. Lean more on how crowded the large speculators are — in index futures that is where the contrarian edge usually lives.',
  vol:
    'In VIX futures the commercials are dealers hedging volatility products, and the speculators are structurally short volatility to collect the roll. Read this market in reverse: a crowded speculator short is complacency, and the contrarian call is about a spike, not calm.',
  metals:
    'In metals the commercials are miners, refiners and fabricators hedging metal they actually hold or need. That physical anchor makes this the classic, strongest contrarian read in the COT report — when the hedgers lean hard against the trend, they are early far more often than they are wrong.',
  energy:
    'In energy the commercials are producers, refiners and big fuel buyers such as airlines, hedging barrels they own or will need. That physical anchor makes this the classic, strongest contrarian read — when the hedgers lean hard against the trend, they are early far more often than they are wrong.',
  grains:
    'In grains the commercials are farmers, grain elevators, millers and exporters hedging crops they grow, store or ship. They see the physical market first, which makes this the classic, strongest contrarian read — their extremes mark value far more reliably than the speculators\' do.',
  softs:
    'In softs the commercials are growers, merchants and processors — roasters, sugar refiners, cotton mills — hedging physical supply. Same classic read as any physical commodity: the hedgers at an extreme are the group to trust, and a crowded speculator position is the one to fade.',
  livestock:
    'In livestock the commercials are feedlots, packers and processors hedging animals they will actually feed, deliver or slaughter. That physical anchor gives the classic, strongest contrarian read — the hedgers\' extremes are worth far more than the crowd\'s.',
  rates:
    'In rate futures the commercials are dealers and banks hedging bond inventory, and the speculators are macro funds and trend followers. The hedgers\' read still works, but it is about inventory rather than value, so weight a crowded speculator position at least as heavily as the commercial side.',
  fx:
    'In currency futures the commercials are multinationals and banks hedging real trade and investment flows, and the crowd is macro and trend money. Currency trends are set by central banks and can run for months, so an extreme here persists longer than in commodities — treat it as a headwind or tailwind, not a reversal call.',
  crypto:
    'In crypto futures the "commercials" are mostly dealers and market-makers hedging ETF and over-the-counter books, not producers, and the history behind this index is short. Treat the extremes with extra caution — there are few past cycles to compare against.',
  other:
    'Commercials are the participants hedging a real business exposure in this market; large speculators are funds trading the trend. The contrarian read works best when the hedgers lean hard against the crowd — and it is a weeks-to-months signal, so confirm with price before acting.',
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

/**
 * Percentile rank of x among `values`, 0..100, SIGNED: 100 = x is the largest
 * value in the set, 0 = the smallest. x is ranked against the OTHER values
 * (one copy of x is left out if it is a member) with ties split at their
 * midpoint — so a flat set ranks 50, an odd set's median ranks 50, and a
 * value outside the set ranks where it would be inserted. null with fewer
 * than 2 values.
 */
export function percentileRank(values, x) {
  if (!values || values.length < 2 || x == null) return null
  let less = 0, equal = 0
  for (const v of values) { if (v < x) less++; else if (v === x) equal++ }
  const others = values.length - (equal > 0 ? 1 : 0)
  if (others <= 0) return null
  const equalOthers = equal > 0 ? equal - 1 : 0
  return ((less + 0.5 * equalOthers) / others) * 100
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

/** The COT index at row i over ITS OWN trailing window (the same way idx gets its index). */
function indexAt(rows, i, field, windowWeeks) {
  if (i < 0) return null
  const start = Math.max(0, i - windowWeeks + 1)
  const vals = new Array(i - start + 1)
  for (let k = start; k <= i; k++) vals[k - start] = rows[k][field]
  return cotIndex(vals)
}

/** Consecutive weeks ending at idx (inclusive) whose zone equals `zone`. 1 when just entered. */
function weeksInZone(rows, idx, field, windowWeeks, zone) {
  let n = 1
  for (let i = idx - 1; i >= 0; i--) {
    if (zoneOf(indexAt(rows, i, field, windowWeeks)) !== zone) break
    n++
  }
  return n
}

/** Every 4-week change that fits inside the window (the last one is this week's chg4). */
function fourWeekChanges(window, field) {
  const out = []
  for (let j = CHG_WEEKS; j < window.length; j++) out.push(window[j][field] - window[j - CHG_WEEKS][field])
  return out
}

export function computeSnapshot(rows, idx, windowWeeks = INDEX_WINDOW) {
  const row   = rows[idx]
  const prev  = idx > 0 ? rows[idx - 1] : null
  const back4 = idx >= CHG_WEEKS ? rows[idx - CHG_WEEKS] : null
  const start  = Math.max(0, idx - windowWeeks + 1)
  const window = rows.slice(start, idx + 1)
  const short  = rows.slice(Math.max(0, idx - SHORT_WINDOW + 1), idx + 1)
  const oi = row.open_interest

  const groups = {}
  for (const g of GROUPS) {
    const net   = row[g.field]
    const index = cotIndex(window.map(r => r[g.field]))
    const zone  = zoneOf(index)
    const indexBack6 = idx >= MOVE_WEEKS ? indexAt(rows, idx - MOVE_WEEKS, g.field, windowWeeks) : null
    const chg4    = back4 ? net - back4[g.field] : null
    const changes = fourWeekChanges(window, g.field)
    groups[g.key] = {
      net,
      wow:    prev ? net - prev[g.field] : null,
      pctOi:  oi ? (net / oi) * 100 : null,
      index,
      zone,
      streak: streak(rows, idx, g.field),
      // v2 signal fields
      index26:     cotIndex(short.map(r => r[g.field])),
      move6:       index != null && indexBack6 != null ? index - indexBack6 : null,
      weeksInZone: weeksInZone(rows, idx, g.field, windowWeeks, zone),
      chg4,
      chg4Rank:    chg4 != null && changes.length >= MIN_CHG_SAMPLES ? percentileRank(changes, chg4) : null,
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
      chg4:   back4 ? oi - back4.open_interest : null,
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

// ── Signals ───────────────────────────────────────────────────────────────────
//
// Each signal is one fact about ONE group, with a tone that already has the
// contrarian flip baked in: commercials buying is bullish; the speculator
// groups getting longer is the crowd piling in, which is bearish.

const CONTRARIAN_SIGN = { commercials: 1, largeSpecs: -1, smallSpecs: -1 }
const GROUP_NOUN      = { commercials: 'commercial', largeSpecs: 'large-spec', smallSpecs: 'small-trader' }
const GROUP_WHO       = { commercials: 'the hedgers', largeSpecs: 'the trend crowd', smallSpecs: 'small traders' }
const GROUP_LOWER     = { commercials: 'commercials', largeSpecs: 'large speculators', smallSpecs: 'small traders' }

// Ordering: the classic trigger first, then speed, then the two-window
// disagreement, then the weeks-at-extreme count; hedgers ahead of the crowd.
const SIGNAL_RANK = { movement: 4, fastest: 3, 'short-vs-long': 2, 'extreme-weeks': 1 }
const GROUP_RANK  = { commercials: 3, largeSpecs: 2, smallSpecs: 1 }

function toneForSign(groupKey, sign) {
  const s = Math.sign(sign) * CONTRARIAN_SIGN[groupKey]
  return s > 0 ? 'bull' : s < 0 ? 'bear' : 'neutral'
}

function signed(n) {
  const r = Math.round(n)
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : '0'
}

function movementText(groupKey, move6) {
  const abs = Math.abs(Math.round(move6))
  const up  = move6 > 0
  const dir = up ? 'climbed' : 'dropped'
  if (groupKey === 'commercials') {
    return `The three-year index for commercials has ${dir} ${abs} points in six weeks. A ${MOVEMENT_TRIGGER}-point swing inside six weeks is Larry Williams' classic Movement Index trigger: it says the hedgers are ${up ? 'buying' : 'selling'} with urgency rather than drifting, and that urgency has historically shown up near ${up ? 'lows' : 'highs'} far more often than in the middle of a move.`
  }
  return `The three-year index for ${GROUP_LOWER[groupKey]} has ${dir} ${abs} points in six weeks. A ${MOVEMENT_TRIGGER}-point swing inside six weeks is the classic Movement Index trigger, and for ${GROUP_WHO[groupKey]} it reads in reverse: ${up
    ? 'money rushing in this fast leaves fewer buyers behind it — a late-stage tell that leans contrarian-bearish'
    : 'money bailing out this fast is capitulation, which leans contrarian-bullish'}.`
}

function movementClause(groupKey, move6, tone) {
  const s = signed(move6)
  if (groupKey === 'commercials') {
    return ` — and a 6-week swing of ${s} points on the index is the classic Movement Index ${tone === 'bull' ? 'buy' : 'sell'} trigger`
  }
  return ` — and a 6-week swing of ${s} points on the index is a Movement Index trigger read in reverse: the crowd ${move6 > 0 ? 'rushing in' : 'bailing out'} this fast is a ${tone === 'bull' ? 'buy' : 'sell'} signal, not a ${tone === 'bull' ? 'sell' : 'buy'}`
}

function extremeWeeksText(groupKey, n, zone) {
  const where = zone === 'extreme-long' ? 'at a three-year max long' : 'at a three-year max short'
  return `${GROUP_LOWER[groupKey][0].toUpperCase()}${GROUP_LOWER[groupKey].slice(1)} have now spent ${n} straight weeks ${where}. Extremes can persist — this is context, not a timing signal — but the longer a group stays pinned here, the later in the move we are likely to be.`
}

function fastestText(groupKey, buying) {
  const band = buying ? 'top' : 'bottom'
  const head = `This week's four-week change in the ${GROUP_NOUN[groupKey]} net position ranks in the ${band} 5% of every four-week change in the trailing three years — the fastest ${buying ? 'buying' : 'selling'} by ${GROUP_WHO[groupKey]} in this window.`
  if (groupKey === 'commercials') {
    return `${head} Speed matters: hedgers rarely move this quickly unless ${buying ? 'they see value' : 'they think price has run ahead of the physical market'}.`
  }
  return `${head} ${buying
    ? 'A crowd piling in this fast is momentum now and fuel for a reversal later, which leans contrarian-bearish.'
    : 'A crowd bailing out this fast is capitulation, which leans contrarian-bullish.'}`
}

function shortVsLongText(groupKey, index, index26, fading) {
  const who = GROUP_LOWER[groupKey]
  return `The three-year index for ${who} sits at ${Math.round(index)}, but the 26-week index is at ${Math.round(index26)} — the two windows disagree. Use the three-year for magnitude (how stretched positioning is against its own history) and the 26-week for timing (which way it is moving now): ${fading
    ? `${who} are still historically long, but they have been lightening up over the last six months, so this extreme is fading rather than building`
    : `${who} are still historically short, but they have been buying back hard over the last six months, so the short extreme is unwinding and a new lean is building`}.`
}

function signalsOf(groups) {
  const out = []
  for (const g of GROUPS) {
    const gr = groups[g.key]
    if (!gr) continue
    const move6   = gr.move6 ?? null
    const weeks   = gr.weeksInZone ?? null
    const rank    = gr.chg4Rank ?? null
    const index   = gr.index ?? null
    const index26 = gr.index26 ?? null

    if (move6 != null && Math.abs(move6) >= MOVEMENT_TRIGGER) {
      out.push({
        kind: 'movement', group: g.key,
        key:   `movement-${g.key}`,
        tone:  toneForSign(g.key, move6),
        label: `Movement Index ${signed(move6)} · ${g.short}`,
        text:  movementText(g.key, move6),
      })
    }
    if ((gr.zone === 'extreme-long' || gr.zone === 'extreme-short') && weeks != null && weeks >= 2) {
      out.push({
        kind: 'extreme-weeks', group: g.key,
        key:   `extreme-weeks-${g.key}`,
        tone:  'neutral',
        label: `${weeks} wks at a 3-year extreme · ${g.short}`,
        text:  extremeWeeksText(g.key, weeks, gr.zone),
      })
    }
    if (rank != null && (rank >= FASTEST_HI || rank <= FASTEST_LO)) {
      const buying = rank >= FASTEST_HI
      out.push({
        kind: 'fastest', group: g.key,
        key:   `fastest-${g.key}`,
        tone:  toneForSign(g.key, buying ? 1 : -1),
        label: `Fastest ${GROUP_NOUN[g.key]} ${buying ? 'buying' : 'selling'} in 3 years`,
        text:  fastestText(g.key, buying),
      })
    }
    if (index != null && index26 != null) {
      const fading   = index >= HI && index26 <= LO
      const building = index <= LO && index26 >= HI
      if (fading || building) {
        out.push({
          kind: 'short-vs-long', group: g.key,
          key:   `short-vs-long-${g.key}`,
          tone:  'neutral',
          label: `Long-term extreme, short-term ${fading ? 'fading' : 'building'} · ${g.short}`,
          text:  shortVsLongText(g.key, index, index26, fading),
        })
      }
    }
  }
  out.sort((a, b) =>
    (SIGNAL_RANK[b.kind] - SIGNAL_RANK[a.kind]) || (GROUP_RANK[b.group] - GROUP_RANK[a.group]))
  return out.slice(0, MAX_SIGNALS).map(({ key, tone, label, text }) => ({ key, tone, label, text }))
}

/** The group's narrative sentence, with the streak and (when it fires) the Movement Index folded in. */
function groupPoint(groupKey, gr) {
  let text = GROUP_TEXT[groupKey][gr.zone].replace('{streak}', streakClause(gr.streak))
  const move6 = gr.move6 ?? null
  if (move6 != null && Math.abs(move6) >= MOVEMENT_TRIGGER) {
    text = text.replace(/\.\s*$/, '') + movementClause(groupKey, move6, toneForSign(groupKey, move6)) + '.'
  }
  return text
}

export function buildRead(snapshot, sym = {}) {
  const { groups, oi, windowWeeks } = snapshot
  const c = groups.commercials, l = groups.largeSpecs, s = groups.smallSpecs

  const bias     = biasOf(c, l)
  const crowding = crowdingOf(l)

  const headline = `Hedgers ${ZONE_SHORT[c.zone]} · trend money ${ZONE_SHORT[l.zone]}`

  const points = [
    { key: 'commercials', text: groupPoint('commercials', c) },
    { key: 'largeSpecs',  text: groupPoint('largeSpecs',  l) },
    { key: 'smallSpecs',  text: groupPoint('smallSpecs',  s) },
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
    note:      SYMBOL_NOTES[sym.symbol] || null,
    classNote: CLASS_NOTES[assetClassOf(sym.symbol)],
    signals:   signalsOf(groups),
  }
}
