// @vitest-environment jsdom
/* MOB-11 + MOB-18 — the half-finished placement.
 *
 * A channel wants three taps. Make one, change your mind, and before this the
 * phone offered nothing: the chip that would have told you where you were was a
 * one-time coach mark gated on `tapHintSeen`, and the only aborts were a
 * keyboard Escape that does not exist on a phone or finishing a drawing you did
 * not want so you could undo it.
 *
 * ⛔ SOURCE-READ, AND THE REASON IS STATED. The live HUD only exists while
 * `pendingPoints.length > 0` inside `ChartDrawingOverlay`, which is reached by
 * real canvas taps against a live lightweight-charts instance with a working
 * price scale — the same coordinate machinery MEASURE-01 needed a real device
 * to exercise, and the reason those four checks were `ACCESS_BLOCKED` for the
 * whole research phase. A jsdom render of the overlay produces a canvas that
 * maps no coordinates, so `pendingPoints` can never become non-empty and every
 * behavioural assertion here would pass vacuously against a HUD that never
 * rendered.
 *
 * So this file gates the DECISIONS in the source — which condition shows which
 * half, that Cancel reuses Escape's own abort, and that the dismiss button
 * cannot take Cancel with it — and says plainly that the pixels are the device
 * pass's job. A vacuous behavioural test would be worse than this: it would read
 * as coverage.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ChartDrawingOverlay.jsx'), 'utf8')

/** The chip's JSX block, located by its own test id so the read cannot silently
 *  drift onto another element. Throws by name if the marker moves. */
function chipBlock() {
  const i = SRC.indexOf('data-testid="tap-tap-hint"')
  if (i < 0) throw new Error('the placement chip has moved — this gate is reading nothing')
  // `lastIndexOf(needle, fromIndex)` — two args. A third is ignored and the
  // search runs from 0, which finds nothing and threw by name. Exactly what a
  // marker-based read should do when it is wrong.
  const start = SRC.lastIndexOf('{coarsePointer', i)
  const end = SRC.indexOf('{textInput && (', i)
  if (start < 0 || end < 0) throw new Error('could not bound the chip block')
  return SRC.slice(start, end)
}

/** The chip block with COMMENTS STRIPPED.
 *
 * ⚠️ ABSENCE ASSERTIONS MUST NOT READ THE PROSE. "the old wording is gone"
 * failed on its first run against a correct file, because the comment explaining
 * WHY the wording changed quotes the old wording. This programme has now hit
 * that exact shape twice; a probe a correct file fails is worse than no probe. */
function chipCode() {
  return chipBlock()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')
}

describe('MOB-18 · a placement in progress can be abandoned', () => {
  const chip = chipBlock()

  it('the chip renders while a placement is pending, EVEN once the hint is seen', () => {
    // The whole defect: `!tapHintSeen` alone meant the surface vanished for
    // exactly the users who had already drawn something once.
    expect(chip).toContain('pendingPoints.length > 0 || !tapHintSeen')
  })

  it('a Cancel control exists, and only while there is something to cancel', () => {
    expect(chip).toContain('data-testid="cancel-placement"')
    expect(chip).toContain('aria-label="Cancel placement"')
    const guardIdx = chip.indexOf('{pendingPoints.length > 0 && (')
    const cancelIdx = chip.indexOf('data-testid="cancel-placement"')
    expect(guardIdx, 'Cancel is not guarded by a pending placement').toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(cancelIdx)
  })

  it('⛔ Cancel reuses ESCAPE\'s abort, it does not invent a second one', () => {
    // Two abort routines drift the first time one of them learns about a new
    // tool. Escape already meant "clear the pending points".
    expect(chip).toContain('onClick={() => setPendingPoints([])}')
    const esc = SRC.slice(SRC.indexOf("if (e.key === 'Escape')"), SRC.indexOf("if (e.key === 'Escape')") + 500)
    expect(esc, 'Escape no longer clears pending points — the two paths have diverged')
      .toContain('setPendingPoints([])')
  })

  it('cancelling does NOT disarm the tool — the user aborted a placement, not a decision', () => {
    const cancelLine = chip.split('\n').find((l) => l.includes('setPendingPoints([])'))
    expect(cancelLine).toBeTruthy()
    expect(cancelLine, 'Cancel also disarms the tool').not.toContain('setActiveTool')
  })

  it('the dismiss button cannot take Cancel down with it', () => {
    // Dismissing the coach mark while a placement is live would hide the very
    // affordance the user is reaching for.
    expect(chip).toContain('hidden={pendingPoints.length > 0}')
  })
})

describe('MOB-11 · the chip says WHERE you are, not just "next"', () => {
  const chip = chipBlock()

  it('narrates the point number and the total', () => {
    expect(chip).toContain('`Point ${pendingPoints.length + 1} of ${POINT_COUNT[activeTool] || 2}`')
  })

  it('the old count-free wording is gone', () => {
    expect(chipCode(), 'a three-point tool still says only "next", which answers nothing')
      .not.toContain('Now tap the next point')
  })

  it('the total comes from POINT_COUNT, so a 3-point tool says 3', () => {
    // Derived, never typed: `channel`, `pitchfork`, `position` and `cup` are all 3.
    const table = SRC.slice(SRC.indexOf('const POINT_COUNT = {'), SRC.indexOf('const POINT_COUNT = {') + 400)
    for (const t of ['channel', 'pitchfork', 'position', 'cup']) {
      expect(table, `${t} is no longer a 3-point tool — the narration total would be wrong`)
        .toMatch(new RegExp(`${t}:\\s*3`))
    }
  })

  it('the un-started wording still names the total too', () => {
    expect(chip).toContain("=== 3 ? '3 points' : '2 points'")
  })
})
