/**
 * What a legal compare quad IS — pure, registry-derived, and the one author of
 * that answer for every consumer (the preference blob, the URL parser, and the
 * pane picker all import from here).
 *
 * ⛔ THE QUAD IS A SET: four DISTINCT styles, never the same style twice.
 *
 * That is a ruling, not an oversight, and it is load-bearing twice over:
 *
 *  1. **It is the only honest configuration.** Compare shares ONE cursor, ONE
 *     window and ONE scrubber, and the spec's §3 fixes options per STYLE ("a
 *     pane showing Radar uses Radar's options, wherever it sits"). Every input a
 *     pane reads is therefore a function of its style alone, so two panes on one
 *     style render the same pixels twice — a quarter of the grid spent on no
 *     information.
 *  2. **It makes the duplicate-test-id failure impossible rather than papered
 *     over.** Views own ids in the `{styleKey}-{role}` namespace
 *     (`viewRegistry.test.jsx` → "no two views claim the same test id"), so the
 *     ONLY way a grid of four can collide is by mounting one style twice. The
 *     alternative — threading an id prefix through all sixteen views — would
 *     change the view contract, and rewrite every existing `getByTestId`, to buy
 *     a configuration that shows nothing new.
 *
 * A pick that names a style already on screen therefore SWAPS the two panes; it
 * is never refused, and it never duplicates.
 */
import { STYLES, VIEW_CONFIG } from './views/viewMetricConfig'

export const COMPARE_PANES = 4

// The two layouts the tab offers, and the one it starts in. They live beside
// the quad rules — not in the preference hook — so a component can read them
// without importing the hook (a container that did could not be tested against
// a mocked hook, which is how half this tab's suite renders it).
export const LAYOUTS = ['single', 'compare']
export const DEFAULT_LAYOUT = 'single'

export const isStyleKey = (k) => typeof k === 'string' && STYLES.includes(k)

/**
 * The out-of-the-box quad, DERIVED: the first four lenses in registry order,
 * topped up from the rest of the registry if there are ever fewer than four.
 * A hand-typed `['clock', 'divergence', …]` would be a second roster of style
 * keys that goes stale the day a lens is renamed or retired.
 */
export function defaultQuad() {
  const out = STYLES.filter(s => VIEW_CONFIG[s]?.kind === 'lens').slice(0, COMPARE_PANES)
  for (const s of STYLES) {
    if (out.length >= COMPARE_PANES) break
    if (!out.includes(s)) out.push(s)
  }
  return out.slice(0, COMPARE_PANES)
}

/**
 * Coerce any candidate list into a legal quad.
 *
 * Unknown keys are DROPPED, not fatal (spec §5); duplicates collapse; a short
 * list is topped up from the default quad and then the registry. Returns `null`
 * only when nothing at all survived, so a caller can tell "no compare state
 * here" from "a compare state with one bad name in it".
 */
export function normalizeQuad(list) {
  const kept = []
  for (const raw of Array.isArray(list) ? list : []) {
    const k = typeof raw === 'string' ? raw.trim() : ''
    if (!isStyleKey(k) || kept.includes(k)) continue
    kept.push(k)
    if (kept.length === COMPARE_PANES) break
  }
  if (!kept.length) return null
  for (const s of [...defaultQuad(), ...STYLES]) {
    if (kept.length >= COMPARE_PANES) break
    if (!kept.includes(s)) kept.push(s)
  }
  return kept.slice(0, COMPARE_PANES)
}

/**
 * Put `style` in pane `i`. If it is already showing somewhere else the two
 * panes SWAP, so the result is still four distinct styles and the style the
 * user displaced is still on screen rather than silently dropped.
 */
export function pickIntoQuad(quad, i, style) {
  if (!Array.isArray(quad) || !isStyleKey(style)) return quad
  if (!Number.isInteger(i) || i < 0 || i >= quad.length) return quad
  if (quad[i] === style) return quad
  const next = [...quad]
  const j = next.indexOf(style)
  if (j >= 0) next[j] = next[i]
  next[i] = style
  return next
}
