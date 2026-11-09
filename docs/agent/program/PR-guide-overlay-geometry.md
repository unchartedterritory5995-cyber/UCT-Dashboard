# PR: guide overlay geometry: a precise, attached ring for every walkthrough

> SIMULATED (jsdom rails, source reading). The real-browser before/after screenshots and pixel measurements are pl-auto's.
> Branch `agent/pl/guide-overlay-geometry`, cut from master `fdd4d73bd1`.

The owner's report:
1. The ring around a chart does not sit cleanly from top to bottom.
2. The ring on a resize corner lags while the member drags it.

The root cause and design are in `GUIDE-OVERLAY-GEOMETRY.md`.

## Commits
- `e0e5abca5c` fix: the shared overlay infrastructure.
  - New `guide/ringGeometry.js`: `RING` constants, two-axis clipping across every clipping ancestor, handle circles,
    and `trackRing` (event-driven, with a frame loop only while something moves).
  - `targets.rectOf` now uses the same measurement.
  - `GuideOverlay` places the ring by transform, with no positional transition.
  - `pointer-events: none` is kept.
- `cd2a4ff681` test:
  - `agentGuideRingGeometry.test.jsx`: 11 rails covering static alignment per target type, a moving target, unmount,
    no frame after cancel, and pointer-through.
  - `agentGuideWatchlistCreate`'s `ringIsOn` now reads the ring's transform: same check, same numbers.
- `871f899c0b` docs: the root-cause note.

No walkthrough's steps or targets changed.

## Results (SIMULATED)
- Targeted: the new rails 11/11. All guide rails pass (`src/agent/agentGuide*`, `src/agent/guide`, AgentPanel):
  `agentGuideWatchlistCreate` 45/45 after its ring read was adapted, and everything else green.
- **Locked full suite** at `871f899c0b`, quiet machine, `src/agent` + `src/pages/command`, BelowNormal:
  - `Test Files 2 failed | 296 passed | 5 skipped (303)`;
  - `Tests 3 failed | 9679 passed | 6 skipped (9688)`.
  - The 3 failures are `src/pages/command/keyListenerCensus` ×2 and `shortcutRegistry` DrillPlayer ×1.
  - They are the same 3 the teach lineage's suites fail, and this branch touches neither file.
  - `src/agent` is all green.
- **Notebook bytes:** master `fdd4d73bd1` 2,252,608 B → `871f899c0b` 2,252,608 B. **Delta 0**, verdict PASS
  (budget 2,264,889 B).

## Open
- pl-auto's real-browser measurements, before (master) and after (this head), as listed at the end of
  `GUIDE-OVERLAY-GEOMETRY.md`.
- Whether a "chart" step should ring the whole chart cell (header included) rather than `chart.plot`. That is a
  target choice, for the owner to decide after seeing the measurements; this branch does not make it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM
