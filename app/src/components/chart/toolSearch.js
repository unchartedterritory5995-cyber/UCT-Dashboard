/* Finding a drawing tool by what you MEAN, not by what it is called.
 *
 * ⛔ THE MEASURED GAP. MOB-04 gave the phone a searchable all-tools sheet, and
 * the search matched the tool's LABEL and its id — which only helps a user who
 * already knows the product's vocabulary. Typed into the shipped picker, every
 * one of these returned "No tool matches":
 *     support · resistance · retracement · box · zone · ruler · risk · target ·
 *     note · parallel · andrews · vwap anchor · r multiple
 * Those are the words a trader actually thinks in. "Parallel" is the sharpest
 * example: the DESKTOP label is "Parallel Channel", the phone label is
 * "Channel", so the one word most people would reach for matched nothing on the
 * only surface that has a search box.
 *
 * ⭐ SO THE FIX IS VOCABULARY, NOT UI. Aliases cost no screen space, no extra
 * tap and no new concept — the sheet looks identical and simply stops saying no.
 * That matters more than it sounds: a search that fails once teaches you not to
 * search, and then the roster's size becomes a real problem instead of a
 * navigable one.
 *
 * ⛔ AND RANKING IS PART OF THE ANSWER AT SCALE. Aliases overlap on purpose
 * ("target" is honestly both a Fib extension and the Position tool; "percent" is
 * both Advance % and Measure), so matches are ORDERED by how well they match
 * rather than filtered down to one. An exact name always outranks somebody
 * else's alias — typing "Text" must not put the Position tool first because
 * "text" appears in one of its synonyms.
 *
 * ⛔ WHAT THIS DELIBERATELY DOES NOT DO: categories. TradingView groups tools
 * because it has well over a hundred; UCT has eighteen, and the picker's grid is
 * 4 columns (3 on a narrow phone) — the ENTIRE roster is about five rows and
 * fits without scrolling. Three section headers would cost ~100px and push the
 * last row off screen, so grouping would make discovery measurably worse here.
 * Revisit above roughly thirty tools, when the flat grid stops fitting; the
 * grouping to add then is by INTENT (levels · projection · annotation), not by
 * TradingView's shape taxonomy.
 */

/** The words a trader reaches for, per tool.
 *  ⛔ Every tool needs at least one, and `toolSearch.test.js` fails by name if a
 *  new tool arrives without any — an un-aliased tool is invisible to exactly the
 *  user who does not know its name, which is the user search exists for. */
export const TOOL_ALIASES = {
  trendline:  ['trend', 'trendline', 'diagonal', 'uptrend', 'downtrend', 'tl'],
  horizontal: ['support', 'resistance', 'level', 'price level', 'hline', 'flat', 'sr'],
  hray:       ['support', 'resistance', 'ray', 'level forward', 'from here'],
  extended:   ['extended', 'infinite line', 'both directions'],
  vertical:   ['vline', 'date', 'session', 'event', 'time marker', 'earnings'],
  rect:       ['box', 'zone', 'range', 'area', 'supply', 'demand', 'consolidation', 'base'],
  circle:     ['ellipse', 'oval', 'highlight', 'ring'],
  arrow:      ['pointer', 'mark', 'point at'],
  fib:        ['retracement', 'fibonacci', 'golden', 'pullback levels', '618', '382'],
  fibext:     ['extension', 'projection', 'target levels', 'fibonacci extension', '1618'],
  channel:    ['parallel', 'parallel channel', 'trend channel', 'rails'],
  pitchfork:  ['andrews', 'median line', 'fork'],
  cup:        ['cup and handle', 'rounded', 'saucer', 'curve', 'arc'],
  avwap:      ['vwap', 'anchored vwap', 'volume weighted', 'average price'],
  advance:    ['percent', 'gain', 'move', 'run', 'advance label', 'how much'],
  text:       ['note', 'label', 'comment', 'annotation', 'write'],
  measure:    ['ruler', 'distance', 'how far', 'range', 'percent move'],
  position:   ['risk', 'reward', 'r multiple', 'stop', 'target', 'size', 'long', 'short', 'trade'],
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '')

/** Lower is better. `null` = no match at all. */
export function matchScore(tool, q) {
  if (!q) return 0
  const label = norm(tool.label)
  const id = norm(tool.id)
  const aliases = (TOOL_ALIASES[tool.id] || []).map(norm)

  if (label === q || id === q) return 0
  if (label.startsWith(q)) return 1
  if (id.startsWith(q)) return 2
  if (aliases.some((a) => a === q)) return 3
  if (aliases.some((a) => a.startsWith(q))) return 4
  if (label.includes(q)) return 5
  if (id.includes(q)) return 6
  if (aliases.some((a) => a.includes(q))) return 7
  return null
}

/**
 * The tools matching `query`, best first. An empty query returns the roster
 * untouched, in its authored reach-for order.
 *
 * ⛔ STABLE WITHIN A TIER — the roster order is deliberate (related tools
 * adjacent), and a search must not reshuffle equally-good matches from one
 * keystroke to the next.
 */
export function rankTools(tools, query) {
  const q = norm(query)
  if (!q) return tools || []
  return (tools || [])
    .map((t, i) => ({ t, i, s: matchScore(t, q) }))
    .filter((x) => x.s != null)
    .sort((a, b) => (a.s - b.s) || (a.i - b.i))
    .map((x) => x.t)
}
