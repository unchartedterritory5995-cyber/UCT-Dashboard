# Breadth → Data Charts overhaul — DECISIONS

Every judgment call made during the program, with its rationale. The owner asked for the
program to run without questions, so each call that would otherwise have been a question
is recorded here instead. Numbered, append-only; a reversed decision is struck and
re-recorded, never edited away.

---

### D-001 · The build flag is declared in `docs/feature_flags.json` → `build_flags`, not a new `docs/frontend_feature_flags.json`

**Context.** The program brief says to declare `VITE_BREADTH_CHARTS_V2_ENABLED` in
`docs/frontend_feature_flags.json`. That file does not exist on master (`f4fc5d1c1`).
Build-time `VITE_*` flags are already recorded in the `build_flags` section of
`docs/feature_flags.json` (17 entries), held to the frontend's actual reads by
`tests/test_vite_flag_ledger.py` and to `Dockerfile.web`'s `ARG` list by
`tests/test_dockerfile_vite_build_args.py` + `.github/workflows/vite-build-args.yml`, all
three derived from one reader (`tools/vite_flag_index.py`).

**Decision.** Register the flag in `docs/feature_flags.json` → `build_flags` and declare the
`ARG` in `Dockerfile.web`.

**Why.** Creating `docs/frontend_feature_flags.json` would be a second authority over which
build flags exist — a file no rail reads, beside one three rails already enforce. The brief's
intent (declared, ledgered, CI-checked) is met exactly by the existing registry.

### D-002 · The worktree gets its own `node_modules` via `npm ci`, not a junction

**Context.** Several sibling worktrees carry a lockfile identical to master's and could donate
`node_modules` by junction.

**Decision.** `npm ci` inside this worktree's `app/`.

**Why.** Every candidate donor belongs to another live session; `git worktree remove` on the
donor deletes the target of a junction, and a program this long outlives most of them. The box
had 12.9 GB free at install time, so the CLAUDE.md rule against `npm ci` under memory pressure
did not apply. Install completed with exit 0; `vite`, `vitest` and `echarts` verified present.

### D-003 · Member-view measurements sign in as `MEMBER_SMOKE_EMAIL`; the admin smoke account is not used

**Context.** CLAUDE.md records a 2026-09-12 ruling that `smoke@uctintelligence.internal` is the
only account automated production tools sign in as. The program brief (2026-09-13, newer)
instructs member-view checks to use `member-smoke@uctintelligence.internal` and never the admin
smoke account. `docs/runbooks/flow-cold-paint-rig.md` already uses the member-smoke account for
exactly this purpose (an admin session can render more than a member's).

**Decision.** Member-smoke for every member-view capture and measurement; the admin account is not
used by this program at all.

**Why.** The brief is the owner's most recent instruction and is specific to this program; the
member-smoke account is an existing synthetic account with an established precedent for member
measurements. Credentials are read from the environment by name and never printed or stored.

### D-004 · The rig never writes to the member-smoke account; saved chart state is stripped for "default"

**Context.** Data Charts POSTs `breadth_charts_state` on every selection change. A measurement
run exercises dozens of controls.

**Decision.** `tools/breadth_charts_rig.py` routes `/api/auth/preferences`: GETs pass through with
`breadth_charts_state` removed (so "default" is a first visit), POSTs are answered locally and
counted. Failure states (500/401/402/network/held response) and the light theme are induced in
the browser only.

**Why.** CLAUDE.md: a smoke account that accumulates state stops being a control. Counting the
blocked writes keeps the write behaviour measurable (F-16) without it landing anywhere.

### D-005 · Phase 0 proceeds without a live-row capture; it is taken in the first RTH window the program is still running in

**Context.** The brief asks for the live-row state "if the window allows". Phase 0 ran on Sunday
2026-09-13; `/api/breadth-monitor/live` answered `superseded: true, market_open: false`.

**Decision.** Do not block Phase 0. Record the state as not capturable, keep F-2 (the per-minute
rebuild) at CODE tier, and capture the live row during the first regular session the program is
still running in. The instrument for it is the same rig (`default` state during RTH).

**Why.** "Do not stop" is the standing instruction; the finding it would confirm is already
established by mechanism (F-4 demonstrates the same rebuild path), and waiting ~20 hours for a
screenshot would idle every later phase.

### D-006 · Smoothing is not changed on overshoot grounds

**Context.** Suspected in Phase 0 that `smooth: 0.35` draws values beyond the data.

**Decision.** Measured with the real ECharts 6 renderer (server-side SVG, drawn Béziers evaluated):
0.0 overshoot. Any later change to smoothing must be argued on other grounds (e.g. that a curve
between discrete sessions implies intraday continuity), never on overshoot.

**Why.** A plausible defect that measurement refutes must not survive into the audit as a
finding.

### D-007 · Y axes: stacked panels per unit family are the primary path; normalisation is a follow-up; a hard two-family cap is rejected

**Decision.** One panel per family (max 4), shared X, linked crosshair and zoom; a >6× spread inside a family splits
the smaller series into its own panel; a fifth family is refused with a sentence. Rebased/%-change/z-score ship later
as an explicit "Scale" control.

**Why.** Dual axes invent relationships (10 presets do it today, F-8). A cap removes presets members use. Normalising
discards the levels members trade on and makes the canonical reference lines meaningless. Panels keep real units and
real lines. (Audit §Y axes.)

### D-008 · Long history ships through a new projected, pre-encoded series endpoint with client LTTB — not a bigger `days=`, not server resampling

**Decision.** `GET /api/breadth-monitor/series` (≤ 8 keys, bounded span, bytes encoded inside the sync handler, cached
5 min under the existing invalidation prefix), dark behind `BREADTH_SERIES_ENDPOINT_ENABLED`; V2 decimates with ECharts
`sampling: 'lttb'`.

**Why.** Measured: the existing route encodes on the event loop (438 ms at 3,650 rows) and ships ~96 keys per row when
a chart needs ≤ 8. Server resampling needs a per-metric aggregation rule and hides spikes (a thrust day in a weekly
mean); LTTB keeps the visual extremes without that choice. Resampling stays available if payloads prove too large.

### D-009 · Reference lines attach to metrics; preset `lines:` arrays are removed

**Decision.** A registry field `refLines` on the metrics that own each canonical constant; a line draws whenever such a
metric is plotted, on that metric's axis/panel. The constants themselves do not change.

**Why.** Fixes brief defect (b) and A-02 at the root, and leaves one authority over which lines exist. The standing
decision "canonical constants only" is preserved verbatim.

### D-010 · Colour: a validated categorical order per surface, bull/bear tones from the Views palette the member picks, sticky per metric

**Decision.** Categorical slots validated with the `dataviz` validator against OLED `#0a0a0a`, dark `#17181b` and light
`#f4f5f6`; opposed pairs keep bull/bear tone (the standing decision) using the chosen Views palette's `bull`/`bear`, each
pair validated; a removed series frees its slot and survivors keep theirs; gold is never a series colour; legend always,
direct end-labels for ≤ 4 series as the secondary encoding the red/green pair needs.

**Why.** Measured collisions under normal vision (ΔE 4.2, 5.2, 6.7) and recolour-on-removal (F-10, A-13). Taking
bull/bear from the Views palettes gives the parity with Views the brief asks for without inventing a fifth palette system.

### D-011 · Registry unification is an adapter: `chartMetrics.js` canonical, `HM_METRICS` byte-identical

**Decision.** Canonical schema gains `short`, `drillKey`, `refLines`, `mark`, `cadence`, `chartable`; `heatmapMetrics.js`
builds `HM_METRICS` from it plus its own tiers/formatters/headers. Acceptance: `HM_METRICS` serialises byte-identically
before and after. Own merge. The Monitor's `COLS` stays out of scope.

**Why.** The two schemas share keys but not fields (F-19); a relabel would move 15 Views labels. Carrying the heatmap's
label as `short` keeps every consumer identical while leaving one source of truth. Passes the brief's thin-adapter test.

### D-012 · Unoffered fields: offer advancing, declining, vix_term_structure, spy/qqq distribution days, market_phase shading; defer the rest

**Why.** See the audit's table: the offered ones have real history and a clear reading; `up/down_on_volume` have 2
sessions, the raw ETF closes duplicate offered ratios, `up/down_from_open` are empty.

### D-013 · The percentile defaults to the shown window, with an all-history toggle

**Why.** It should describe the plot the member is looking at; the basis is now always stated, so the default cannot be
misread as all-time.

### D-014 · Custom user presets stay out of this program (the August call, now argued)

**Why.** Share links cover sending a chart, the persisted last selection covers returning to it, and named presets add a
management surface and a second preset authority with no member request behind them. Follow-up, not rejected forever.

### D-015 · Range pills 90D · 6M · 1Y · 2Y · 5Y · Max + Custom; default stays 90D

**Why.** The brief's set. The default is not changed: an existing view must not change shape unasked (the rule the FTD
toggle's own comment cites), and a longer default costs payload for every visit.

### D-016 · Preset order stays editorial; "ordering by member frequency" is not implemented

**Why.** No usage telemetry for presets exists; ranking by an invented frequency would be a guess presented as data.
The preset sheet gains search and partial-match display instead.

### D-017 · Merge plan: three corrective merges, one registry merge, one dark backend merge, five V2 merges

**Decision.** C1 honest states · C2 chart mechanics · C3 touch & ARIA · R1 registry · B1 series endpoint · V2-1…V2-5
(audit backlog). Corrective merges change the legacy tab only where it is wrong today, each with rails.

**Why.** Small, reviewable, independently revertable merges under the one-merge-at-a-time queue; the legacy tab stays the
fallback until the flip, so members get the defect fixes without waiting for V2.

### D-018 · The repository is public: paid-data evidence stays local; an exposure was contained

**What happened.** On 2026-09-13 the Phase 0/1 commit (`b98ce804b`) was pushed to `origin/feat/breadth-charts` carrying
98 screenshots of the Data Charts tab (member-only breadth data drawn over 90–365 sessions), the rig's measurement
JSON, and discovery text quoting several metrics' latest and maximum values. The repository is **public** (GitHub API,
anonymous: `visibility: public`). It was noticed a few minutes after the push, before any other step used the branch.

**Containment.** The remote branch was deleted immediately (`git ls-remote` then showed no head); the local commit was
undone; `docs/breadth/.gitignore` now excludes `screenshots/`, `measurements/` and `mock/data/`; the quoted values were
replaced with ratios or descriptions (public market levels such as the S&P print were left). The sanitized branch is
re-pushed without any of those files. ⚠️ **Deleting a branch does not purge its commit from GitHub**: the object stays
reachable by SHA until GitHub garbage-collects it, and may already have been fetched. Purging it needs a GitHub support
request by the owner — listed in the Phase 6 items.

**Policy for the rest of the program.**
- Nothing that reproduces member-only data is committed: no screenshots of member surfaces, no captured payloads, no
  per-metric values. The rig writes to the ignored paths; the docs describe what the evidence shows.
- The design mock (Phase 2) draws **synthetic** series shaped like the real ones, never exported rows.
- Every push of this branch is preceded by `git diff --cached --name-only` checked for image/JSON/data files.

**Why it matters.** The breadth history became `require_paid` on 2026-08-09 precisely because it is the product; a
public repository is an unauthenticated door to anything committed to it.
