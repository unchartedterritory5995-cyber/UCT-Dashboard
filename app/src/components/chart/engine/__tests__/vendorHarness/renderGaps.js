// app/src/components/chart/engine/__tests__/vendorHarness/renderGaps.js
//
// ─── RENDER GAPS — what a capture's drawings hold that the member's chart does not draw ─────────────
//
// The census says a script is SERVED (the member door attaches it, nothing refused). It does not say every
// drawing the script makes lands on the chart. The render state does (`objectRenderState.js::toRenderState`,
// `unplaced`): an object TradingView draws that this chart does not, because
//   coordinate     a FINITE x that no bar of this chart places (an `xloc.bar_time` past the last bar, or a time
//                  off the session grid) — a line, label or box, and a line fill whose line is one of those;
//   textWithheld   a label, box or table cell whose text the run withheld (`null`: no capture settles it).
// The member's drawing note discloses both (`objectRenderNotice.js`). A whole family (or every drawing) the
// run withholds BY NAME is a third disclosed gap, `withheld`, keyed by the guard that withheld it.
//
// ⛔ ONE AUTHORITY. Nothing here decides what places: the render state is asked TWICE over the same live set,
// the second time with every withheld text given a placeholder. What still does not place does not place by
// its coordinate; the difference is the withheld-text class. No placement rule is restated.
//
// ⛔ KEYS AND COUNTS ONLY: a row names families, guards and the run's own `format:*` names, never a text,
// a source line or a message. Read by `renderGaps.measure.test.js`; joined to the sample by
// `tools/pine_coverage/render_gaps.py`.

import { toRenderState } from '../../objectRenderState'

/** The object families the render state counts as unplaced (its `unplaced` keys), in its own order. */
export const UNPLACED_FAMILIES = Object.freeze(Object.keys(toRenderState([], {}).unplaced))

const nonZero = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, n]) => n > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1)))

const placeText = (props) => (props && props.text === null ? { ...props, text: '' } : props)

/** The live set with every withheld text (`null`) given a placeholder; every other field untouched. */
export function withTextsPlaced(live) {
  return (live || []).map((o) => (o ? {
    ...o,
    props: placeText(o.props),
    ...(Array.isArray(o.cells) ? { cells: o.cells.map((c) => (c ? { ...c, props: placeText(c.props) } : c)) } : {}),
  } : o))
}

/**
 * The render state's `unplaced`, split by reason class.
 * @param {Array} live   a LIVE set (`evaluateObjects(...).live`, or the runtime lane's)
 * @param {{bars: Array, tf?: string, pineVersion?: number}} frame  what the object lane ran on
 * @returns {{state, coordinate: object, textWithheld: object}}  non-zero families only
 */
export function unplacedByClass(live, frame) {
  const opts = { bars: frame.bars, tf: frame.tf, pineVersion: frame.pineVersion }
  const state = toRenderState(live, opts)
  const coordinate = toRenderState(withTextsPlaced(live), opts).unplaced
  const textWithheld = {}
  for (const f of Object.keys(state.unplaced)) {
    const n = state.unplaced[f] - (coordinate[f] || 0)
    // ⛔ a placeholder text can only REMOVE a text drop; if it ever adds one, the split is not derivable this way
    if (n < 0) throw new Error(`render gaps: placing the withheld texts made ${f} drop MORE (${-n}): the render state is no longer monotone in its texts`)
    textWithheld[f] = n
  }
  return { state, coordinate: nonZero(coordinate), textWithheld: nonZero(textWithheld) }
}

/**
 * One capture's row from what `runOurSide` returned for it: `{status, ...}` with keys and counts only.
 *   measured        the drawings were measured (or the script draws none): `held`, and any `coordinate`,
 *                   `textWithheld` (+ `textKinds`), `withheld` gaps
 *   refused         our side did not run the capture (the door, its settings, its supply): nothing measured
 *   objects-failed  the object lane ran and reported no live set (it threw, or the run drew nothing unnamed)
 * `recomputed` is the render state built here, for the caller's self-check against the report's own `dropped`.
 */
export function renderGapRow(ours) {
  if (!ours || !ours.ok) return { row: { status: 'refused' }, recomputed: null }
  const o = ours.objects
  if (!o || (o.drawsObjects === false && !o.withheld)) return { row: { status: 'measured', held: 0 }, recomputed: null }
  const lane = o.lane === 'runtime' ? 'runtime' : 'host'
  // a drawing program withheld WHOLE, by name (the runtime run computed nothing here, the object gate, off-listing)
  if (o.withheld && !o.ok) {
    return { row: { status: 'measured', lane, held: Array.isArray(o.held) ? o.held.length : 0, withheld: { [String(o.withheld)]: 1 } },
      recomputed: null }
  }
  if (!o.ok || !Array.isArray(o.held) || !o.xFrame) return { row: { status: 'objects-failed', lane }, recomputed: null }
  const { state, coordinate, textWithheld } = unplacedByClass(o.held, { bars: o.xFrame.bars, tf: o.xFrame.tf, pineVersion: o.pineVersion })
  const row = { status: 'measured', lane, held: o.held.length }
  if (Object.keys(coordinate).length) row.coordinate = coordinate
  if (Object.keys(textWithheld).length) {
    row.textWithheld = textWithheld
    // the names the run gave the texts it withheld (host lane, `formatNumberWhy`); none named: `unnamed`
    const kinds = Object.keys(o.textsWithheldWhy || {}).filter((k) => /^[a-z][a-z0-9-]*:[a-z0-9:._-]+$/.test(k)).sort()
    row.textKinds = kinds.length ? kinds : ['unnamed']
  }
  // families the run withheld whole by name beside the ones it drew (`withheldFamilies` / `withheldGuards`)
  if (Array.isArray(o.withheldFamilies) && o.withheldFamilies.length) {
    const guards = (Array.isArray(o.withheldGuards) && o.withheldGuards.length ? o.withheldGuards : ['unnamed']).map(String)
    row.withheld = Object.fromEntries([...new Set(guards)].sort().map((g) => [g, o.withheldFamilies.length]))
  }
  return { row, recomputed: state }
}
