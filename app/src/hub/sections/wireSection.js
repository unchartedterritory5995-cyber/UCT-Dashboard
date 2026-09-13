// app/src/hub/sections/wireSection.js — Morning Wire's hub section (Phase 3 §3.1).
//
// Spec: `docs/plans/joystick/60-phase3-plan.md` §3.1. Contract: `hub/contracts.js`,
// section "PHASE 3 CONTRACTS" (`HubSectionConfig` + `HubListAdapter`).
//
// Primary (tap) = next segment · Reverse (double-tap) = previous segment ·
// Scrub = segment index, vertical · Chip = the segment's own label text.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE SEGMENTS ARE DOM NODES, NOT REACT STATE.
// The rundown is `dangerouslySetInnerHTML` (`MorningWire.jsx`), so there is no array of
// segments in React to hand the cursor and no JSX element to spread `itemProps` onto. The
// cursor holds an INDEX into `root.querySelectorAll('section.rd-seg[data-seg]')`, the
// selection is painted imperatively with `useHubCursor`'s `paintCursor(nodes)` — the path that
// hook grew for exactly this page — and movement scrolls with
// `scrollIntoView({block:'start'})`. `itemProps` cannot work here.
//
// ⛔ THE CONFIG SPREADS THE REGISTRY MODE, AND THAT IS LOAD-BEARING — NOT TIDINESS.
// `HubContext.registerHubMode` REPLACES the route-derived default with whatever a page
// registers (`activeModeConfig = pageModeConfig ?? modesById[mode]`). `HubRoot` then reads
// `label` / `color` / `tapHint` off it AND calls `fanFor(activeModeConfig)`, whose last line is
// `mode.fan.filter(...)`. So registering a BARE `HubSectionConfig` — precisely the shape
// `contracts.js` documents — blanks the chip and throws
// `Cannot read properties of undefined (reading 'filter')` the moment /morning-wire mounts.
// `validateSectionConfig` cannot catch it: a bare section config is a VALID section config,
// and this failure lives on the other side of the seam. Layering the Phase 3 handlers ON TOP
// of `modesById.wire` fixes it and, as a bonus, keeps `wire` in `PREVIEW_MODES` untouched —
// `fanFor` keys off `mode.id`, which the spread carries through — so this wave wires
// tap/double-tap/scrub/readout/cursor with no registry edit at all.
//
// ⛔ THE SEGMENT LABEL IS NOT `label.textContent`.
// `MorningWire.jsx`'s feedback effect INJECTS the per-segment controls (👍 👎 ✎) into
// `.rd-seg-label` itself — grep `data-fb-vote`, and note that §3.1 of the plan cites this as
// `MorningWire.jsx:183`, which mounting the hub has already pushed down the file. The naive
// `textContent` read narrates "The Board👍👎✎" — wrong in a way no
// structural assertion notices, because the string is non-empty and the element is the right
// one. `segmentLabelText` skips the injected `.rd-fb` span.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useHubCursor from '../useHubCursor'
import { modesById } from '../registry'

/** The mode this section controls. Its registry entry supplies label/color/tapHint/fan. */
const WIRE_MODE_ID = 'wire'

/**
 * ⭐ ONE SELECTOR, matching the two `section.rd-seg[data-seg]` reads in `MorningWire.jsx` (its
 * feedback-control injection and its note-panel anchor). A segment is a `section.rd-seg` that
 * carries a `data-seg` key; a `.rd-seg` without one is not addressable and must not enter the
 * cursor's list, or "tap N times" and "segment N" stop meaning the same thing.
 */
export const SEGMENT_SELECTOR = 'section.rd-seg[data-seg]'

/**
 * The label element inside a segment — a DIRECT child, the way MorningWire selects it
 * (`section.rd-seg[data-seg] > .rd-seg-label`). A descendant search would find a nested
 * `.rd-seg-label` in a future nested segment and narrate the wrong heading.
 */
const SEG_LABEL_CLASS = 'rd-seg-label'

/** The class MorningWire wraps its injected 👍/👎/✎ controls in. See the header note. */
const INJECTED_CONTROLS_CLASS = 'rd-fb'

/**
 * The cursor's list id. DERIVED from the registry (`modes` → `wire.cursor.listId`) rather than
 * typed here, so the section and the registry cannot disagree about which store this page
 * walks — a second authority over one value is how this repo's enumeration defects start.
 */
const LIST_ID = modesById[WIRE_MODE_ID]?.cursor?.listId ?? WIRE_MODE_ID

/** Stable empty list, so a rundown that has not arrived does not churn the cursor's identity. */
const NO_SEGMENTS = Object.freeze([])

/** The rendered segment nodes, in document order — the same order as `listAdapter.items`. */
export function segmentNodes(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return Array.from(root.querySelectorAll(SEGMENT_SELECTOR))
}

/**
 * The segment KEYS (`data-seg`: 'tape', 'macro', …) in document order. These are the cursor's
 * items: `useHubCursor`'s own `defaultKey` documents Morning Wire's list as exactly these
 * strings, so a bare string is its own identity.
 */
export function segmentKeys(root) {
  return segmentNodes(root).map((node, i) => node.dataset?.seg || `__seg_${i}`)
}

/**
 * The visible label of one segment — what the chip narrates during a scrub.
 *
 * ⛔ Skips the injected feedback controls (see the header). Reads, never mutates: `readout()`
 * is called per scrub step and the contract says it must not mutate, so this walks child nodes
 * rather than cloning-and-stripping.
 */
export function segmentLabelText(segNode) {
  if (!segNode || !segNode.children) return ''
  let label = null
  for (const child of segNode.children) {
    if (child.classList && child.classList.contains(SEG_LABEL_CLASS)) { label = child; break }
  }
  if (!label) return ''
  let text = ''
  for (const node of label.childNodes) {
    // nodeType 1 = ELEMENT_NODE, written as the literal so this module needs no DOM global.
    const injected = node.nodeType === 1
      && node.classList
      && node.classList.contains(INJECTED_CONTROLS_CLASS)
    if (injected) continue
    text += node.textContent || ''
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** Are two key lists the same list, in the same order? */
function sameOrder(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Morning Wire's `HubSectionConfig`, ready for `useHubMode`.
 *
 * @param {Object} [args]
 * @param {{current: Element|null}} args.rootRef  The element the rundown HTML is written into
 *   (`MorningWire.jsx`'s `rundownRef`). This never queries `document`: a second rundown mounted
 *   anywhere else would otherwise drive this one's cursor.
 * @param {string|null|undefined} args.wireDate   The wire's own date (`rundown.date`).
 * @param {string|null|undefined} args.html       The rundown HTML. Not rendered here — it is the
 *   signal that the segment DOM has been replaced and must be re-read.
 * @returns {import('../contracts').HubSectionConfig}
 */
export default function useWireSection({ rootRef, wireDate, html } = {}) {
  // The segment keys, mirrored OUT of the DOM into React state. This is a genuine
  // external-system read (innerHTML written outside React), which is what an effect is for —
  // not a value derived from props, which `react-hooks/set-state-in-effect` would rightly flag.
  const [segments, setSegments] = useState(NO_SEGMENTS)

  useLayoutEffect(() => {
    const next = segmentKeys(rootRef?.current)
    // Returning the CURRENT array when nothing moved is what stops this re-rendering forever:
    // `segmentKeys` builds a fresh array on every call, so its identity always differs.
    //
    // The disable below is the "subscribe to an external system" half of the rule's own
    // description, not an exemption from it: the rundown's markup arrives through innerHTML, so
    // "which segments exist" has no render-time answer and no props to derive one from. The
    // cascade it warns about is bounded to one extra render per rundown, because the updater
    // returns `cur` unchanged on every re-render that did not replace the DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSegments((cur) => (sameOrder(cur, next) ? cur : next))
  }, [rootRef, html])

  /**
   * ⭐ THE IDENTITY KEY CARRIES THE WIRE'S DATE.
   * `useHubCursor` treats the ordered join of these as "is this the same list?", so embedding
   * the date makes a new wire a genuinely new list and the index resets to 0. Keying on the
   * segment alone — or on the route — leaves yesterday's index pointing into today's segments,
   * and today's rundown carries the SAME `data-seg` keys as yesterday's, so nothing else in the
   * system would notice.
   */
  const identityKey = useCallback(
    (seg, index) => `wire:${wireDate ?? 'none'}:${seg ?? index}`,
    [wireDate],
  )

  const cursor = useHubCursor(LIST_ID, segments, { key: identityKey })
  const { index, count, next, prev, scrubTo, paintCursor } = cursor

  /**
   * Bring segment `target` into view. This is the `HubListAdapter.scrollTo` the contract
   * requires, and the ONE place this section scrolls — the reveal effect and `onScrubCommit`
   * both call it rather than reaching for `scrollIntoView` themselves.
   *
   * The `typeof` guard is not defensive noise: jsdom ships no `scrollIntoView`, so without it
   * every unit test of a cursor move throws on the reveal instead of on the thing under test.
   */
  const scrollTo = useCallback((target) => {
    const node = segmentNodes(rootRef?.current)[target]
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'start' })
  }, [rootRef])

  /**
   * Paint the selection, and reveal it WHEN IT MOVES.
   *
   * ⛔ Not on arrival. Painting is unconditional — the cursor IS at segment 0 the moment the
   * rundown lands and the outline should say so — but scrolling is not: a member opening
   * /morning-wire never asked to be scrolled, and the first commit after the HTML arrives goes
   * `index: -1 → 0`, which reads as movement to any naive "did the index change?" test.
   */
  const revealRef = useRef({ html: null, index: null })
  useLayoutEffect(() => {
    const nodes = segmentNodes(rootRef?.current)
    paintCursor(nodes)

    const prevReveal = revealRef.current
    revealRef.current = { html, index }
    const sameRundown = prevReveal.html === html
    const wasEstablished = typeof prevReveal.index === 'number' && prevReveal.index >= 0
    const moved = prevReveal.index !== index
    if (sameRundown && wasEstablished && moved && index >= 0) scrollTo(index)
  }, [rootRef, html, index, paintCursor, scrollTo])

  // Clamping lives in `useHubCursor` (`Math.min(i+1, count-1)` / `Math.max(i-1, 0)`) and is NOT
  // re-implemented here — one authority over "where does the list end", so tap can never wrap
  // in one section and clamp in another.
  const onTap = useCallback(() => { next() }, [next])
  const onDoubleTap = useCallback(() => { prev() }, [prev])

  /**
   * ⛔ CONTEXT FIRST, AND NO NORMALISER. `HubRoot.jsx` calls `onScrub(ctx, scrub)`;
   * `contracts.js` says the same; `contractArity.test.js` DERIVES that from the call site rather
   * than restating it, so the three cannot drift apart again.
   *
   * ⚰️ This used to run every argument through a `readScrubPayload(...args)` shim that picked
   * whichever one carried a numeric `delta`, because the typedef and the mounted caller
   * disagreed (R-05). They no longer do. The shim is deleted rather than left standing: a
   * defensive read against a bug that no longer exists teaches the next reader that the seam is
   * still ambiguous, and it is the reason `wireSection.test.jsx` now RAILS the one-argument form
   * out of this file instead of asserting both call shapes land.
   */
  // ⛔ `scrub.delta` IS A PER-MOVE STEP, NOT A POSITION — and this called `scrubTo` as though it
  // were one. `useJoystick.js:301-306` emits `raw / travelPx` where `raw` is the distance between
  // THIS pointermove and the LAST one, while `useHubCursor.scrubTo` reads its argument as an
  // absolute 0..1 position along the list. So a small downward drag emitted ~-0.1 and slammed the
  // cursor to segment 0; a small upward drag jumped ~10% into the wire. The gesture "worked" —
  // something moved, an index changed, every structural test passed — it just went somewhere the
  // member did not ask for.
  //
  // ⭐ Found by the 3.3 Screener integrator, which hit the same mismatch and accumulated; this
  // file did not. The accumulator lives in a ref because a scrub is a stream of steps between one
  // press and one release, and state would lag a render behind the finger.
  // ⭐ SEEDED FROM WHERE THE CURSOR ALREADY IS, not from 0. An accumulator that starts at zero on
  // every gesture would send a member who tapped to segment 5 back to the top the moment they
  // began a drag — the steps are relative, so the starting point has to be too. `null` means "no
  // gesture in progress"; `onScrubCommit` clears it.
  const scrubPosRef = useRef(null)
  const onScrub = useCallback((ctx, scrub) => {
    if (!scrub || typeof scrub.delta !== 'number' || !Number.isFinite(scrub.delta)) return
    if (scrubPosRef.current === null) {
      scrubPosRef.current = count > 1 ? index / (count - 1) : 0
    }
    const next = Math.min(1, Math.max(0, scrubPosRef.current + scrub.delta))
    scrubPosRef.current = next
    scrubTo(next)
  }, [scrubTo, index, count])

  // A scrub that lands back on the segment it started from moves no index, so the reveal effect
  // never fires — and the member gets a released gesture that did nothing visible. Commit
  // reveals wherever the cursor actually landed.
  const onScrubCommit = useCallback(() => {
    scrubPosRef.current = null   // the gesture is over; the next one re-seeds from where we landed
    if (index >= 0) scrollTo(index)
  }, [index, scrollTo])

  /**
   * What the chip says during a scrub: the segment's own label, e.g. "The Board".
   *
   * The positional fallback is not decoration. `validateSectionConfig` refuses an `onScrub`
   * without a `readout` because a scrub the chip cannot narrate is invisible, and a rundown
   * that renders a segment with an empty label would recreate exactly that condition inside a
   * config that passed validation.
   */
  const readout = useCallback(() => {
    const text = segmentLabelText(segmentNodes(rootRef?.current)[index])
    if (text) return text
    if (count > 0) return `Segment ${Math.max(index, 0) + 1} of ${count}`
    return 'No segments'
  }, [rootRef, index, count])

  const listAdapter = useMemo(() => ({
    // The list AS RENDERED, read from the DOM the member is looking at — on this page there is
    // no other copy of it.
    items: segments,
    identityKey,
    scrollTo,
  }), [segments, identityKey, scrollTo])

  return useMemo(() => ({
    // ⛔ See the header: the spread is what keeps the chip labelled and `fanFor` alive.
    ...modesById[WIRE_MODE_ID],
    onTap,
    onDoubleTap,
    onScrub,
    onScrubCommit,
    readout,
    listAdapter,
  }), [onTap, onDoubleTap, onScrub, onScrubCommit, readout, listAdapter])
}
