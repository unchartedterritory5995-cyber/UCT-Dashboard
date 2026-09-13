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

## ⚠️ Exposure contained (2026-09-13) — D-018

The repository is public. The first Phase 0/1 push carried paid-data screenshots, measurement JSON and quoted metric
values; the remote branch was deleted within minutes, the commit rebuilt without them, and `docs/breadth/.gitignore` now
keeps that evidence on local disk. The original commit (`b98ce804b`) remains reachable on GitHub by SHA until purged —
owner action, Phase 6.

## Phase 2 — Design — DONE (2026-09-13)

- [`02-design.md`](02-design.md): token plan reviewed against the brief (five template defaults rejected), layouts for
  desktop/tablet/phone, controls, stacked-panel rules, axes, metric-attached reference lines, marks, a colour model
  validated on OLED/dark/light, the coverage and staleness language, nine member-visible states with copy, motion, URL,
  accessibility, and the flag architecture.
- [`mock/index.html`](mock/index.html) + `mock/render_mock.py` → `mock/renders/` (five boards). Synthetic series, the
  app's real tokens, fonts and ECharts; one critique pass applied (irregular ticks, colliding end labels, a heavy
  not-recorded area, a gold slider band, a record key naming absent states).
- Decisions D-019 … D-023. Tab-switch samples added to discovery §4 as not quotable, with the Phase 4 A/B method.
