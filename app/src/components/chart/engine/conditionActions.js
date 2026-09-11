import { COND_TRUE } from './conditions'

// ─── ONE VISUAL-ACTION VOCABULARY ───────────────────────────────────────────
//
// ⭐⭐ A CONDITION IS DATA; AN ACTION IS WHAT CONSUMES IT. The two are separate
// objects and separate pipelines, and that is the whole architecture of this
// phase. Slingshot evaluates ONCE and feeds an orange candle AND a blue dot,
// because both actions read the same `Uint8Array`.
//
// ⛔ AND THE SCHEMA IS NOT CANDLE-SPECIFIC. `{ type, enabled, … }` with a
// per-type payload is what lets `indicatorColor`, `alert` and `label` land later
// without changing what is already persisted.

/** The action types that draw today. A row naming anything else is inert and
 *  kept — a chart saved by a newer build must not lose its rules here. */
export const ACTION_TYPES = Object.freeze(['candleColor', 'marker', 'background'])

/**
 * Which CHANNEL an action competes in.
 *
 * ⭐⭐ PRIORITY IS RESOLVED PER CHANNEL, NOT GLOBALLY (Part 16). If condition A
 * wins the candle and condition B also matches, B's MARKER still draws — "A won"
 * must not silently suppress an unrelated action. Two exclusive channels and one
 * additive one is the whole rule.
 */
export const ACTION_CHANNEL = Object.freeze({
  candleColor: 'candle',
  background: 'background',
  marker: 'marker',
})

/** The channels where exactly ONE rule may win a bar. */
export const EXCLUSIVE_CHANNELS = Object.freeze(['candle', 'background'])

/**
 * The marker vocabulary — six shapes, and the persisted MEANING is stable even
 * where the renderer has fewer.
 *
 * ⛔ LIGHTWEIGHT-CHARTS 5.2.0 DRAWS FOUR: `circle`, `square`, `arrowUp`,
 * `arrowDown`. Declaring only those would make "add a diamond" a change to what
 * members' saved charts MEAN, so the vocabulary is the product's and the map to
 * the renderer is this table. A `diamond` stored today draws as a square and
 * starts drawing as a diamond the day a primitive can; nothing re-saves.
 *
 * ⚠️ `dot` AND `circle` ARE THE SAME SHAPE AT DIFFERENT SIZES, which is what a
 * trader means by the two words. Size rides `MARKER_SIZE`, not the shape name.
 */
export const MARKER_SHAPES = Object.freeze(['dot', 'circle', 'triangleUp', 'triangleDown', 'square', 'diamond'])
const SHAPE_TO_LWC = Object.freeze({
  dot: 'circle',
  circle: 'circle',
  triangleUp: 'arrowUp',
  triangleDown: 'arrowDown',
  square: 'square',
  diamond: 'square',
})
const SHAPE_SIZE = Object.freeze({ dot: 0.6, circle: 1, triangleUp: 1, triangleDown: 1, square: 1, diamond: 1 })

/** ⭐ SEMANTIC POSITIONS, NEVER A SCREEN Y (Part 25). The renderer places the
 *  glyph relative to the BAR, so the gap survives every zoom (Part 26). */
export const MARKER_POSITIONS = Object.freeze(['aboveBar', 'belowBar'])

/** The pane an action targets. One value today and a field from the first day,
 *  because `'price'` as an assumption is exactly what this codebase has just
 *  spent a phase removing (`paneIndex: 0` was not the candles). */
export const ACTION_TARGETS = Object.freeze(['price'])

/** Every enabled action of one channel, in PRIORITY ORDER.
 *
 *  ⭐ PRIORITY IS THE ORDER THE CONDITIONS ARE SHOWN IN (Part 15) — top to
 *  bottom, first matching enabled rule wins. Predictable, and a member reorders
 *  it by reordering the list they are looking at. */
export function channelActions(conditions, channel) {
  const out = []
  for (const cond of (Array.isArray(conditions) ? conditions : [])) {
    if (!cond || cond.enabled === false) continue
    for (const action of (cond.actions || [])) {
      if (!action || action.enabled === false) continue
      if (ACTION_CHANNEL[action.type] !== channel) continue
      out.push({ cond, action })
    }
  }
  return out
}

/**
 * The winning colour per bar for an exclusive channel, or `null` where no
 * enabled rule matched.
 *
 * ⛔ FIRST MATCH WINS AND THE LOOP STOPS. Blending five candle colours produces
 * a colour nobody chose; the owner locked "first matching enabled rule wins" and
 * this is the only place that rule is spelled.
 */
function resolveExclusive(conditions, columnOf, barCount, channel, colorOf) {
  const rules = channelActions(conditions, channel)
  if (!rules.length) return null
  const cols = []
  for (const r of rules) {
    const col = columnOf(r.cond.id)
    if (col) cols.push([col, colorOf(r.action)])
  }
  if (!cols.length) return null
  const out = new Array(barCount).fill(null)
  for (let i = 0; i < barCount; i++) {
    for (let k = 0; k < cols.length; k++) {
      if (cols[k][0][i] === COND_TRUE) { out[i] = cols[k][1]; break }
    }
  }
  return out
}

/** Per-bar candle colour overrides, or `null` when no candle rule is live. */
export function resolveCandleColors(conditions, columnOf, barCount) {
  return resolveExclusive(conditions, columnOf, barCount, 'candle',
    (a) => (typeof a.color === 'string' && a.color ? a.color : '#e8a33d'))
}

/** Per-bar background colour, or `null` when no background rule is live. */
export function resolveBackgroundColors(conditions, columnOf, barCount) {
  return resolveExclusive(conditions, columnOf, barCount, 'background',
    (a) => (typeof a.color === 'string' && a.color ? a.color : 'rgba(34,168,94,0.14)'))
}

/**
 * Contiguous runs of one resolved colour → one band each.
 *
 * ⭐⭐ SEGMENTATION HAPPENS **AFTER** PRIORITY IS RESOLVED (Part 33), and the
 * order matters: segmenting each condition separately and painting them all
 * would stack translucent layers into colours nobody picked. One colour per bar
 * first; runs second; one `fillRect` per run last.
 *
 * ⚠️ A COLOUR CHANGE BREAKS A RUN, so two adjacent regimes stay two bands.
 *
 * @param {Array<string|null>} colors  per-bar resolved colour
 * @param {object[]} bars
 * @param {Function} timeOf  bar → the chart's own time value (`adjustTime`)
 */
export function colorRuns(colors, bars, timeOf) {
  const out = []
  if (!Array.isArray(colors) || !Array.isArray(bars)) return out
  const n = Math.min(colors.length, bars.length)
  let cur = null
  for (let i = 0; i < n; i++) {
    const c = colors[i]
    const t = timeOf ? timeOf(bars[i] && bars[i].t) : (bars[i] && bars[i].t)
    if (c && cur && cur.color === c) { cur.to = t; continue }
    if (cur) out.push(cur)
    cur = c ? { from: t, to: t, color: c } : null
  }
  if (cur) out.push(cur)
  return out
}

/**
 * The markers every enabled marker action asks for.
 *
 * ⭐ THE MARKER CHANNEL IS ADDITIVE, AND THAT IS WHAT THE INFRASTRUCTURE MAKES
 * CLEAN (Part 17). `createSeriesMarkers` already takes many markers at one time
 * and lays them out itself — it is the same controller the earnings, news, desk
 * and flow categories feed. Stacking is therefore free and suppressing would be
 * the extra code, so two conditions that both match a bar both draw.
 *
 * ⛔ NO DOM PER MARKER. These are plain descriptors for the chart-native
 * renderer, merged into the one `mergedMarkers` array the chart already owns.
 */
export function resolveMarkers(conditions, columnOf, bars, timeOf) {
  const rules = channelActions(conditions, 'marker')
  const out = []
  if (!rules.length || !Array.isArray(bars)) return out
  for (const { cond, action } of rules) {
    const col = columnOf(cond.id)
    if (!col) continue
    const shape = MARKER_SHAPES.includes(action.shape) ? action.shape : 'dot'
    const position = MARKER_POSITIONS.includes(action.position) ? action.position : 'belowBar'
    const color = typeof action.color === 'string' && action.color ? action.color : '#3b82f6'
    const n = Math.min(col.length, bars.length)
    for (let i = 0; i < n; i++) {
      if (col[i] !== COND_TRUE) continue
      const t = timeOf ? timeOf(bars[i] && bars[i].t) : (bars[i] && bars[i].t)
      if (t == null) continue
      out.push({
        time: t,
        position,
        color,
        shape: SHAPE_TO_LWC[shape] || 'circle',
        size: SHAPE_SIZE[shape] || 1,
        // ⚠️ ONE ID PER (CONDITION, ACTION, BAR). The markers array is merged
        // with five other categories and sorted; a colliding id would let one
        // category's marker stand in for another's on the same bar.
        id: `cond-${cond.id}-${action.id || shape}-${i}`,
      })
    }
  }
  return out
}

/** Does any enabled action of this channel exist? Cheap enough to ask per
 *  render, and what lets every consumer stay completely inert with no rules. */
export function hasChannel(conditions, channel) {
  return channelActions(conditions, channel).length > 0
}
