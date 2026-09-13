# Breadth → Data Charts overhaul — STATUS

Program: UX / visual / chart-mechanics overhaul of the Breadth → Data Charts tab.
Branch `feat/breadth-charts` · worktree `C:/Users/Patrick/uct-worktrees/breadth-charts`
· started from master `f4fc5d1c1` on 2026-09-13.

One short entry per phase, appended at the end of that phase. Decisions live in
[`DECISIONS.md`](DECISIONS.md), never here.

---

## Phase 0 — Discovery — DONE (2026-09-13)

- [`00-discovery.md`](00-discovery.md): every ground-truth line checked (4 corrections: the tab's
  fetcher is `BreadthCharts.jsx:19`, the magnitude "guard" is a test not a runtime check, Views has
  four palettes, FTD cannot exist before 2026 by construction); clickable map; option builder; 20 new
  findings with evidence tiers (one suspected finding measured and REFUTED).
- Instrument: `tools/breadth_charts_rig.py` (member-smoke, no account writes, per-segment deploy-swap
  verdicts, `--self-check`). 98 screenshots at 4 widths in `screenshots/before/`; measurements in
  `measurements/`.
- ⚠️ The first full run straddled another session's deploy; the affected segment was re-run on its own
  and spliced, with provenance in `before.json`. Tab-switch samples (5 per width) appended to §4.
- Not capturable: the live row (Sunday) — D-005.

## Phase 1 — Audit — DONE (2026-09-13)

- [`01-audit.md`](01-audit.md): 1 × P0 (a failed load reads as "No data in selected range"), 22 × P1,
  18 × P2, each with evidence and a lane; evaluations for Y axes (stacked panels), long history
  (projected pre-encoded endpoint + LTTB), registry unification (an adapter, byte-identical
  `HM_METRICS`), unoffered fields, URL state; prioritised backlog of 10 merges; north star.
- [`collector-asks.md`](collector-asks.md): 11 asks for the engine repo.
- Decisions D-007 … D-017.
