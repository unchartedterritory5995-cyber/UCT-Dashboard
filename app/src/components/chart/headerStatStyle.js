// PER-STAT STYLE for the chart header's info row (owner 11-17): "every header stat must be clickable … rename, value
// color, label color, a shaded box with its own color, text size". The value color stays where it always was
// (`header.colors[colorKey]`, signed stats `<colorKey>:pos|neg`); everything else lives here.
//
// STORAGE: `header.statStyle = { [statKey]: { labelColor?, box?: true, boxColor?, size?: 's'|'l'|'xl' } }` — under
// `header`, which `mergeChartSettings` spreads, and NOT declared in CHART_DEFAULTS: absent = today's exact row and
// blob, and the pinned merged-blob digests do not move. Defaults are never stored (`size: 'm'`, `box: false`, an empty
// color), so turning everything back off returns the blob to its legacy shape.
//
// SANITISED ON READ, field by field from an allow-list: a color reaches CSS only if it is a plain hex / rgb() /
// rgba() string (and ChartMetaRow runs it through safeCssColour again), a size only from STAT_SIZES. Which KEYS are
// stats is the caller's question (headerStatCatalog passes its own known-key test). Pure, no imports.

export const STAT_SIZES = Object.freeze(['s', 'm', 'l', 'xl'])
export const STAT_SIZE_LABELS = Object.freeze({ s: 'S', m: 'M', l: 'L', xl: 'XL' })
/** The scale each size applies to the stat (label, value and box together). `m` = today's size, no style at all. */
export const STAT_SIZE_SCALE = Object.freeze({ s: 0.88, m: 1, l: 1.15, xl: 1.3 })
export const DEFAULT_STAT_SIZE = 'm'
/** Text thickness (owner 11-17: "thicker/thinner should be an option too"). `regular` = today's 500, never stored. */
export const STAT_WEIGHTS = Object.freeze(['light', 'regular', 'bold', 'heavy'])
export const STAT_WEIGHT_LABELS = Object.freeze({ light: 'Light', regular: 'Regular', bold: 'Bold', heavy: 'Heavy' })
export const STAT_WEIGHT_VALUE = Object.freeze({ light: 400, regular: 500, bold: 600, heavy: 700 })
export const DEFAULT_STAT_WEIGHT = 'regular'
/** The shaded box when no box color is chosen: the Signature soft fill. */
export const DEFAULT_BOX_COLOR = '#f8f7f314'   // #f8f7f3 at 8%: a swatch picked from here keeps that opacity

const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\))$/i
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** A color value, cleaned: a plain hex / rgb() / rgba() string, else '' (none). */
export function cleanStatColor(v) {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  return s.length <= 40 && COLOR_RE.test(s) ? s : ''
}

/** ONE stat's style, rebuilt from the allow-list; null when it holds nothing but defaults. */
export function cleanStatStyle(raw) {
  if (!isObj(raw)) return null
  let labelColor, box, boxColor, size, weight
  try { ({ labelColor, box, boxColor, size, weight } = raw) } catch { return null }
  const out = {}
  const lc = cleanStatColor(labelColor)
  if (lc) out.labelColor = lc
  if (box === true) out.box = true
  const bc = cleanStatColor(boxColor)
  if (bc) out.boxColor = bc
  if (typeof size === 'string' && STAT_SIZES.includes(size) && size !== DEFAULT_STAT_SIZE) out.size = size
  if (typeof weight === 'string' && STAT_WEIGHTS.includes(weight) && weight !== DEFAULT_STAT_WEIGHT) out.weight = weight
  return Object.keys(out).length ? out : null
}

/** Every stored stat style whose key passes `isKnown` (all keys when omitted). Always a fresh object. */
export function statStylesOf(header, isKnown) {
  const raw = header && isObj(header.statStyle) ? header.statStyle : null
  const out = {}
  if (!raw) return out
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (typeof isKnown === 'function' && !isKnown(k)) continue
    const s = cleanStatStyle(v)
    if (s) out[k] = s
  }
  return out
}

/** The `header.statStyle` map after patching one stat. A patch field set to null / undefined / '' / the default
 *  removes it; a stat left with only defaults is dropped from the map. */
export function withStatStyle(header, key, patch, isKnown) {
  const next = statStylesOf(header, isKnown)
  if (typeof key !== 'string' || !key || (typeof isKnown === 'function' && !isKnown(key))) return next
  const merged = { ...(next[key] || {}) }
  for (const f of ['labelColor', 'box', 'boxColor', 'size', 'weight']) {
    if (!isObj(patch) || !Object.prototype.hasOwnProperty.call(patch, f)) continue
    const v = patch[f]
    if (v == null || v === '' || v === false) delete merged[f]
    else merged[f] = v
  }
  const clean = cleanStatStyle(merged)
  if (clean) next[key] = clean
  else delete next[key]
  return next
}

/** `statStyle` without `key` (the stat left the header: its style goes with it, like its rename). */
export function statStylesWithout(header, key, isKnown) {
  const next = statStylesOf(header, isKnown)
  delete next[key]
  return next
}
