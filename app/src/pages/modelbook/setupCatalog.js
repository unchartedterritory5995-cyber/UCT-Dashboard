// Model Book → Setup Library catalog.
//
// The firm's curated setup list (v1 — 24 swing setups, provided 2026-06-10; more
// may be added later). Most names line up with the labeling taxonomy in
// constants/setupGroups.js (which feeds the Throughout the Years setup dropdown);
// a few use the library's fuller display name (e.g. 'U&R (Undercut & Rally)' vs
// the taxonomy's 'Classic U&R') — normalize when wiring examples to the DB.
//
// Each entry:
//   family    — field-guide grouping (one of SETUP_FAMILIES, drives pills/dividers)
//   direction — 'long' | 'short' | 'both'
//   essence   — one-line hook shown on the card (the detailed write-up the firm
//               authors lives in the detail view, added separately)
//   candles   — hand-drawn idealized mini-chart of the pattern. Each candle is
//               either a number (close-to-close % body move, auto wicks) or
//               [body%, upperWick%, lowerWick%] when the wick IS the story
//               (e.g. U&R, Slingshot). Rendered by <SetupGlyph/>.
//   pivot     — optional { idx, side: 'h'|'l' }: dashed trigger line drawn at
//               that candle's high/low, extended to the right edge.
//   ema       — optional EMA period: draws a smoothed moving-average curve under
//               the candles (for the setups defined by their relationship to it).

export const SETUP_FAMILIES = [
  'Bases & Breakouts',
  'Momentum & Trend',
  'Gaps & Catalysts',
  'Reversals & Reclaims',
]

// Short chip shown on cards (the full family name lives in the section divider).
export const FAMILY_CHIP = {
  'Bases & Breakouts': 'BASE',
  'Momentum & Trend': 'TREND',
  'Gaps & Catalysts': 'GAP',
  'Reversals & Reclaims': 'REVERSAL',
}

export const SETUP_CATALOG = [
  // ── Bases & Breakouts ──────────────────────────────────────────────────────
  {
    name: 'High Tight Flag (Powerplay)',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'A near-vertical pole that barely pulls back — a tight sideways flag, then a breakout to new highs.',
    candles: [3.5, 9, 12, 8, -1.5, 1, -1.2, 0.8, -0.6, 10],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Flat Base Breakout',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'Weeks of quiet, range-bound trade under a flat ceiling; the break through it starts the next leg.',
    candles: [1.2, -0.8, 0.9, -0.7, 0.6, -0.9, 1.0, -0.5, 0.7, 7],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'VCP (Volatility Contraction Pattern)',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'Each pullback shallower than the last, coiling under resistance until supply dries up.',
    candles: [9, -6, 7.5, -4, 5, -2.5, 3, -1.2, 0.6, 6.5],
    pivot: { idx: 2, side: 'h' },
  },
  {
    name: 'IPO Base',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'A new issue’s first consolidation — short, often shallow, and explosive when it resolves higher.',
    candles: [12, -3, -2, 1.5, -1.5, 1, -0.8, 0.6, 8],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Launchpad',
    family: 'Bases & Breakouts',
    direction: 'long',
    essence: 'Price compressed flat on top of rising moving averages — everything aligned, waiting for ignition.',
    candles: [2, -0.8, 1.2, -0.5, 0.8, -0.4, 0.6, -0.3, 8],
    ema: 3,
  },

  // ── Momentum & Trend ───────────────────────────────────────────────────────
  {
    name: 'Parabolic Long',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'Riding the steepening curve of a runaway move — managed bar by bar as the angle goes vertical.',
    candles: [1, 1.5, 2, 3, 4, 5.5, 7.5, 10, 13],
  },
  {
    name: '20 EMA Pullback',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'A trending leader’s orderly pullback into the rising 20 EMA — buy the bounce as the trend resumes.',
    candles: [3.5, 2.5, 3, -1.5, -1.8, -1.2, [1.2, 0.4, 1.8], 4.5, 3],
    ema: 4,
  },
  {
    name: 'EMA Crossback',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'A dip below the rising EMA that quickly reclaims it — the crossback confirms buyers defended the trend.',
    candles: [3, 2.5, -2.2, -2.8, -1, 0.8, [4.5, 0.6, 0.5], 3],
    ema: 4,
  },
  {
    name: 'Go Signal',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'The first powerful thrust off a controlled pullback — the trend announcing it’s back in gear.',
    candles: [5, 4, -2, -1.5, -1, [6, 1, 0.3], 4],
    ema: 4,
  },
  {
    name: 'HVC (High Volume Close)',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'A massive-volume accumulation candle — its close becomes the level the stock must defend.',
    candles: [1, -0.8, 0.6, [9, 0.8, 0.5], -1, 0.8, -0.6, 5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Wedge Pop',
    family: 'Momentum & Trend',
    direction: 'long',
    essence: 'A tightening downward drift on fading volume that suddenly pops out the top of the wedge.',
    candles: [-1.8, -1.5, -1.2, -1, -0.7, -0.5, -0.3, 6.5, 3],
  },
  {
    name: 'Wedge Drop',
    family: 'Momentum & Trend',
    direction: 'short',
    essence: 'A weak, narrowing upward drift into resistance that rolls over and breaks down.',
    candles: [1.8, 1.5, 1.2, 1, 0.7, 0.5, 0.3, -6.5, -3],
  },

  // ── Gaps & Catalysts ───────────────────────────────────────────────────────
  {
    name: 'Episodic Pivot',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A game-changing catalyst gaps the stock out of obscurity — day one of a brand-new trend.',
    candles: [0.5, -0.6, 0.4, -0.4, 0.3, [14, 2, 0.5], 3.5, 2.5],
  },
  {
    name: 'Delayed Episodic Pivot',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'The catalyst gap that digests sideways for days first — the delayed breakout is the entry the crowd misses.',
    candles: [0.5, -0.5, 0.4, [10, 1.5, 0.5], -1.2, 0.8, -0.6, 0.5, 7.5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'News/Catalyst Gapper',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A headline-driven gap that holds its range — traded off the first pullback and reclaim.',
    candles: [0.4, -0.5, 0.5, [9, 2, 0.6], -1.5, -1, 1.2, 5],
    pivot: { idx: 3, side: 'h' },
  },
  {
    name: 'Power Earnings Gap',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'Blowout numbers gap the stock above its base on huge volume — institutions repricing in real time.',
    candles: [0.8, -0.6, 0.7, -0.5, 0.6, [11, 1, 0.4], 2.5, 3],
    pivot: { idx: 0, side: 'h' },
  },
  {
    name: 'Gap Support',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A powerful gap that pulls back to its upper edge and holds — the gap zone becomes the springboard.',
    candles: [0.6, -0.5, 0.5, [8, 1, 0.4], -2, -1.4, [1, 0.4, 1.8], 5],
    pivot: { idx: 3, side: 'l' },
  },
  {
    name: 'Kicker Candle',
    family: 'Gaps & Catalysts',
    direction: 'long',
    essence: 'A violent open against the prior trend — sentiment flips in a single bar.',
    candles: [-2.5, -3, -2, -2.8, [9, 1.5, 0.3], 4],
  },

  // ── Reversals & Reclaims ───────────────────────────────────────────────────
  {
    name: '2B Reversal',
    family: 'Reversals & Reclaims',
    direction: 'both',
    essence: 'Price breaks a prior extreme, fails to follow through, and snaps back — trapping the late entries.',
    candles: [-4, -3, -2.5, [-1.2, 0.5, 3.2], 4.5, 5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'U&R (Undercut & Rally)',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'An undercut of a key prior low that immediately rallies back through it — a spring off trapped supply.',
    candles: [-2, -1.5, -2.5, [-1, 0.4, 3], 5, 3.5],
    pivot: { idx: 2, side: 'l' },
  },
  {
    name: 'Slingshot',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'A sharp flush through obvious support that instantly reverses — the failed breakdown becomes fuel.',
    candles: [1, -0.8, 0.7, -0.6, -3.5, [4.5, 0.6, 1.8], 5],
    pivot: { idx: 3, side: 'l' },
  },
  {
    name: 'Remount',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'A leader slips below its moving average, shakes out weak hands, then remounts it with authority.',
    candles: [3, 2.5, -2, -3, -1.5, 1, [5, 0.8, 0.4], 3.5],
    ema: 4,
  },
  {
    name: 'Failed H&S / Rounded Top',
    family: 'Reversals & Reclaims',
    direction: 'long',
    essence: 'Everyone sees the topping pattern — when the breakdown never comes, the squeeze fuels the next leg up.',
    candles: [3, -2.5, 4.5, -4, 2.5, -2, 1.5, 7],
  },
  {
    name: 'Parabolic Short',
    family: 'Reversals & Reclaims',
    direction: 'short',
    essence: 'A vertical blow-off stretched far above any support — shorted as the curve cracks and gravity takes over.',
    candles: [2, 3, 4.5, 7, 10, 13, [-3, 4, 1], -11, -7],
    pivot: { idx: 6, side: 'l' },
  },
]

export const SETUP_CATEGORIES = ['All', ...SETUP_FAMILIES]

// Direction → display chip.
export const DIRECTION_META = {
  long: { label: 'LONG', cls: 'long' },
  short: { label: 'SHORT', cls: 'short' },
  both: { label: 'LONG / SHORT', cls: 'both' },
}
