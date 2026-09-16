// D-39 — the chip yields to page-level fixed furniture.
//
// ⛔⛔ HUB-SIDE, AND THAT IS THE RULING, NOT A CONVENIENCE. The tempting fix is to move the
// Journal's "Log a trade" FAB out of the way; that file belongs to another workstream and rule 12
// forbids it. The hub is the newcomer on these screens, so the hub yields. Owner ruling 2026-09-12.
//
// ── TWO DESIGNS WERE WRONG BEFORE THIS ONE, AND BOTH LOOKED RIGHT ────────────────────────────────
//
// ⛔ **Probing the chip's CEILING edge clamps on every page.** `elementFromPoint` returns the
// TOPMOST element at a point, so at a position the chip does not currently occupy it returns
// ordinary page content — a div, a cell, whatever is there. Treating that as furniture would shrink
// the chip on every screen in the app, which is a worse defect than the one being fixed.
//
// ⛔⛔ **Probing the chip's OWN box and releasing when it clears OSCILLATES.** That is the honest
// reading of the ruling — it is what `tools/hub_chip_clearance.py` does — but as a live loop it goes
// covered -> clamp -> clear -> release -> covered, forever. In THIS component that is not cosmetic:
// a passive-effect loop in hub code starved React Router's transition commit on 2026-09-10 and
// froze navigation app-wide for four and a half hours, found by a member.
//
// ⭐ **So: probe the chip's own box (agreeing with the instrument), and make RELEASE depend on the
// INPUTS, never on the output.** Once clamped for a given geometry the answer is kept; the clamp is
// dropped only when the geometry that produced it changes — viewport, inset or handedness. A stable
// page therefore measures once and then costs nothing, and the clamp can never chase its own tail.

/**
 * The cinematic intro overlay's root. It carries `aria-label="Welcome"`.
 *
 * ⚰️⚰️ IT IS NOT PAGE FURNITURE, AND MISTAKING IT FOR SOME COST THIS ROW A FALSE DEFECT ALREADY.
 * The intro runs ~9.3s on EVERY real page load and paints over the entire app; its capability pills
 * are anonymous `<span>`s. On 2026-09-12 the sweep sampled straight through it and reported
 * "breadth @360: 56/56 points -> span" — a full-screen animation written down as a product defect,
 * and that half of D-39 was withdrawn on 2026-09-13 once `hub_chip_clearance.py` learned to wait it
 * out. The same trap exists at RUNTIME, and worse: a clamp taken during the intro would be KEPT by
 * the input-driven release above, long after the animation had gone.
 */
const INTRO_ROOT_SELECTOR = '[aria-label="Welcome"]'

/** How many x positions across the chip's box to sample. The instrument samples every pixel of the
 *  rightmost band; at runtime a coarse sweep is enough to FIND a coverer, because the clamp is then
 *  computed from that coverer's own rect rather than from where the sample happened to land. */
export const PROBE_SAMPLES = 9

/**
 * Is `el` something the chip must clear?
 *
 * ⭐ The predicate MATCHES `tools/hub_chip_clearance.py`'s `isChip` exactly — that instrument is
 * what judges this row, and a fix whose idea of "covered" differs from the gate's is one that passes
 * locally and fails the sweep. Its rule is `el === chip || chip.contains(el)`.
 *
 * Two things are NOT coverers: `null` (nothing is there), and the intro overlay (transient).
 */
export function isOccluder(el, chipEl) {
  if (!el || !chipEl) return false
  if (el === chipEl) return false
  if (typeof chipEl.contains === 'function' && chipEl.contains(el)) return false
  if (typeof el.closest === 'function' && el.closest(INTRO_ROOT_SELECTOR)) return false
  return true
}

/**
 * The x positions to sample across the chip's own box, leading edge first.
 *
 * Leading edge = LEFT unmirrored (the chip is anchored right and grows leftward), RIGHT when
 * mirrored. Sampling the leading edge first matters because that is the end that runs into
 * furniture, so the common case answers on the first probe.
 */
export function probePoints({ chipRect, mirrored, samples = PROBE_SAMPLES }) {
  const out = []
  const span = chipRect.width - 2
  if (!(span > 0)) return out
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0 : i / (samples - 1)
    out.push(mirrored ? chipRect.right - 1 - span * t : chipRect.left + 1 + span * t)
  }
  return out
}

/**
 * The smallest width the chip may keep: left padding + the mode name + right padding.
 *
 * ⭐ MEASURED, NEVER TYPED. `.chipMode` is `flex: 0 0 auto` so it does not shrink and `.chipHint`
 * ellipsises — the mode name is the part that must survive, the tap hint is the part that may yield,
 * which is the rule the stylesheet already follows. Re-typing `padding: 0 12px` here would be a
 * second authority over one value, and this repo has paid for that repeatedly.
 */
export function floorWidth({ chipRect, modeRect, hintRect }) {
  if (!chipRect || !modeRect) return 0
  const leftPad = modeRect.left - chipRect.left
  const rightPad = hintRect ? Math.max(0, chipRect.right - hintRect.right) : leftPad
  return Math.ceil(leftPad + modeRect.width + rightPad)
}

/**
 * The ceiling that puts the chip's leading edge clear of `coverRect`, floored so the mode survives.
 *
 * Unmirrored the chip is anchored by its RIGHT edge and grows leftward, so clearing means
 * `width <= chipRight - coverRight`. Mirrored it is anchored left, so `width <= coverLeft - chipLeft`.
 * Returns `null` when the coverer does not actually constrain the chip.
 *
 * ⭐ COMPUTED, NOT SEARCHED. The ruling says "shrink the max-width until it clears"; one subtraction
 * lands in the same place as an iterative shrink, without a loop that can fail to terminate.
 */
export function clearedCeiling({ chipRect, coverRect, mirrored, floorPx }) {
  if (!chipRect || !coverRect) return null
  const want = mirrored
    ? coverRect.left - chipRect.left
    : chipRect.right - coverRect.right
  if (!Number.isFinite(want)) return null
  if (want >= chipRect.width) return null // the coverer is not in the way after all
  return Math.max(floorPx, Math.floor(want))
}

/**
 * The identity of the layout that produced a clamp. The clamp is dropped when, and only when, this
 * changes — which is what stops the release from chasing the clamp. See the header.
 */
export function geometryKey({ viewportWidth, inset, mirrored }) {
  return `${viewportWidth}|${inset}|${mirrored ? 'L' : 'R'}`
}
