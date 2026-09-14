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

### D-019 · Colour identity is scoped to a panel; palettes per Views key, validated on three surfaces

**Decision.** Each panel has its own legend row and assigns its own slots. Neutral order blue · orange · aqua · violet ·
magenta (Classic swaps aqua for pink, because aqua is Classic's bull tone). Opposed pairs take tone colours only when both
sides share a panel, with the per-palette pairs in `02-design.md` §4; a panel holding a pair takes at most one colour
neutral. Mono is the emphasis form (first series gold, the rest gray steps, end labels always).

**Why.** Measured (`dataviz` validator, OLED/dark/light, all pairs): no four-colour neutral set passes, three do; the
Classic green/red pair cannot pass CVD at any step (warn band at best), so its secondary encoding is mandatory; Colorblind and
Ocean pairs pass once re-stepped into the lightness band. Scoping identity to a panel keeps every panel inside the validated
count without inventing hues. The Mono palette's grays fail the chroma floor on purpose — as emphasis, not identity.

### D-020 · Chart chrome colours are derived from theme tokens at render

**Decision.** Axis text = the most recessive `mix(--text-muted, --bg-surface)` clearing 4.5:1; gridlines = the first mix
reaching 1.25:1; tooltip = `--bg-elevated` + `--text`; re-computed on theme change.

**Why.** Canvas cannot resolve `var()`; hard-coding was A-14. Measured results: axis text 4.57–4.60:1 on OLED/dark/light,
gridlines 1.26–1.27:1 — the `--border` token alone is 1.19:1 on OLED, too faint to be a gridline.

### D-021 · The record strip is the tab's one bold element

**Why.** The frontend-design principle "spend boldness in one place" applied to this subject: a breadth history is half
collected and half reconstructed, and nothing in the product says so. A thin collected/reconstructed band under the plot
is specific to this data, useful every time, and keeps every other surface quiet. Rejected defaults recorded in
`02-design.md` §1 (middle-dot meta strings, per-panel cards, gold series, uppercase eyebrows, decorative texture).

### D-022 · Phase 4 measures before and after in the same window, alternating, with the SPA served locally and the API forwarded to production

**Why.** Sunday's measurements were contaminated twice by other sessions' deploys and once by local CPU contention (5 s client
stalls at 768 against sub-second server answers). Production cannot serve a flag-off and a flag-on build at once, so both
columns load a local build of their branch while `/api/*` is forwarded to production as the member-smoke session; only the
front end differs, and alternating runs share whatever the network and the pod are doing.

### D-023 · The design mock draws synthetic series

**Why.** D-018. A mock of exported rows would put paid data in a public repository; seeded random walks shaped like each
metric show the design as faithfully without it.

### D-024 · Phase 3 runs inline, one written plan per merge

**Decision.** Each merge gets its own plan in `docs/superpowers/plans/`, executed in this session task by task (failing test
first, mutation proofs), not dispatched to subagents.

**Why.** This machine has recorded agent-isolation incidents (a dispatched agent's writes and commits landing outside the
dispatching session's branch), it runs one test gate at a time, and the repository is public, where one stray staged file
is an exposure (D-018). Each of those outweighs the parallelism a dispatch would buy.

### D-025 · C1 asks `utils/marketSession` which session should exist; the new date module only formats

**Decision.** "Is the newest stored session overdue?" uses `expectedLatestDailySessionET()` — holiday- and early-close-aware,
threshold the close. `breadth/sessionDates.js` holds Eastern date labels only (`todayET`, `shiftISO`, `shortSessionDate`).

**Why.** A second, weekday-only session rule would disagree with the existing one on every NYSE holiday. The authority's
threshold is 4:00 PM, not the collector's 4:15–4:30 write, so returning to the tab in that half hour can cost one throttled
request that finds nothing new; the superseded transition (A-09) is what picks the recorded row up.

### D-026 · C1 ships the design's copy, not the audit's first wording

**Decision.** Percentile chip "8th of 62 shown" (accessible name "…8th percentile of 62 readings shown"); stale badge
"last Aug 7" with a clock glyph (accessible name "not reported since Aug 7"); load-state sentences from `02-design.md` §6.
"No data in selected range." stays until V2 replaces the empty state.

**Why.** `02-design.md` superseded the audit's draft sentences; shipping the audit wording now would change the copy twice.
"Readings", not "sessions", in the accessible name: the count is of numeric observations, and a series with gaps has fewer
than the sessions on screen.

### D-027 · Refreshing on the close and on return to the tab is revalidation, not polling

**Decision.** No polling-registry row for C1.

**Why.** The polling rail defines a polling site as `useSWR(…, {refreshInterval})`; C1 adds none. Both refreshes fire on
events — the live hook's superseded transition (that hook already polls) and `visibilitychange` — one request each, the
second throttled to one per ten minutes.

### D-028 · C2 keeps `notMerge`; state the member set is written into every option, and motion stops after first paint

**Decision.** The legacy chart still rebuilds with `notMerge`. Zoom (as dates), hidden series (`legend.selected`) and the
reference lines are carried in the option, so a rebuild re-applies them. `animationDuration` is 400 ms until ECharts'
`finished` event, then 0; `animationDurationUpdate` is 0; reduced motion starts at 0.

**Why.** A merge-mode update (`replaceMerge`) keeps properties the new option omits — the `EXTREMES_BAND` axis bounds would
survive a deselect and pin the wrong axis. Rebuilding from state is predictable and testable on the option ECharts is
handed; switching the draw off after first paint is what 02-design §7 asks for.

### D-029 · The magnitude rule runs on the rows on screen, at 6×, and the legacy chart names the gap instead of splitting

**Decision.** `chartMagnitude.MAGNITUDE_LIMIT = 6`, computed over the zoomed rows per axis; the notice reads
"52W Lows (Close) is 300× smaller than Universe Count on this axis." V2 splits the series into its own panel (A-05).

**Why.** 6× is the threshold the retired `MAX_ABS` test used (froth's closest pair is 4.8×; both round-one defects exceed
it). Running it on the visible rows covers members' own selections, which the preset-only test never did, and removes a
hand-typed range table that had already drifted.

### D-030 · `adv_decline_cum` keeps its flat line as a metric-attached constant

**Decision.** `METRIC_REF_LINES` includes `adv_decline_cum: flat 0` beside the audit's list.

**Why.** The A/D Line preset already drew it (suppressed when zero is outside the framed extent). The audit's list
omitted it; dropping it would remove a canonical line members see today. The constant is unchanged.

### D-031 · Axis ticks follow the visible span; ECharts may still hide the year-bearing label in a short window

**Decision.** ≤ 6 months: ECharts spaces the labels and the first session of a year reads "Jan 2, 2026"; ≤ 2 years: month
starts "Jun '26"; longer: year starts "2026". The tooltip header always reads "Fri, Sep 11, 2026".

**Why.** 02-design §4. In a short window crossing New Year, ECharts' automatic spacing can skip the one label that carries
the year; the window is under six months there, so the months themselves disambiguate, and the tooltip always names the
year. Forcing that label on would fight `hideOverlap`.

### D-032 · More is a disclosure of buttons until V2 builds the keys a listbox or menu promises

**Decision.** The More trigger carries `aria-expanded` and `aria-controls` and no `aria-haspopup`; the list is headed groups
of plain buttons, the active one `aria-pressed`. Escape closes it and returns focus to More. No `listbox`, `option` or
`menu` role in C3.

**Why.** A-24: `listbox`/`option` (and `menu`/`menuitem` just as much) tell assistive technology to expect arrow-key
movement and selection the component does not have, so a screen-reader user presses keys that do nothing. A disclosure
promises exactly what exists — open, close, press a button. 02-design §3 puts arrow keys inside popover lists in V2; the
role can change when the behaviour arrives.

### D-033 · Finger targets move to the TOUCH tier with `var(--tap-min)`; phone layout stays at ≤ 640

**Decision.** Every Data Charts finger target — group toggles, Notable Extremes, metric rows, date fields, the FTD toggle,
readout chips, preset pills and More-list items, the load-problem action — declares the floor under
`@media (max-width: 1024px)` with `var(--tap-min)`. Padding, font size and gaps stay in the phone block.
`breadth/tapTier.test.js` reads the stylesheets and refuses a typed 40/44 px.

**Why.** A-19 measured 14 of 22 controls under 44 px at 768 px because the rules sat at ≤ 640 while the app's touch tier is
≤ 1024 (CLAUDE.md *Breakpoints*). The app-wide `tapFloor` rail only sees rules already written with `var(--tap-min)`, so
this tab's typed 44 px rules were invisible to it; the tab-level rail closes that gap without widening the shared rail.

### D-034 · The registry gains `METRIC_META`; joining the catalog is not joining the picker

**Decision.** `chartMetrics.js` holds `METRIC_META` — `short`, `drillKey`, `cadence`, `chartable` — for every chart metric
and every heatmap metric. The nine heatmap-only keys (`is_ftd`, `advancing`, `declining`, `up/down_from_open`,
`up/down_on_volume`, `spy_ma_stack`, `qqq_ma_stack`) enter `METRIC_META` but not `CHART_GROUPS`; `WEEKLY_METRICS` and
`FFILL_KEYS` derive from `cadence`; `METRIC_REF_LINES` stays a sibling map in the same module.

**Why.** R1 must be member-invisible (audit: `HM_METRICS` byte-identical). Adding the nine keys to `CHART_GROUPS` would put
six new checkboxes in the legacy picker in a registry merge; D-012 offers them in V2 with coverage badges. Deriving the
weekly set from `cadence` removes the last second copy of that list (`chartMetrics.WEEKLY_METRICS` and
`heatmapMetrics.FFILL_KEYS` were two typed copies of the same five keys).

### D-035 · The series endpoint is columnar, oldest-first, at most eight keys, cached as bytes under `breadth_history_`, and dark as a 404

**Decision.** `GET /api/breadth-monitor/series?keys=&from=&to=` returns `{from, to, sessions, dates[], series{key: []},
reconstructed[], missing[]}`; non-finite values are `null`; the span is counted in stored sessions and served through
`get_history_deep` so reconstructed rows and rolling warm-up are unchanged; the encoded bytes are cached five minutes under
`breadth_history_series_…`; `Cache-Control: private, max-age=60`; `BREADTH_SERIES_ENDPOINT_ENABLED` unset → 404.

**Why.** D-008 chose a projected, pre-encoded route over a bigger `days=`. Columns carry each date once instead of once per
metric; the `breadth_history_` prefix means every existing `delete_prefix` on snapshot writes already invalidates it, so no
new invalidation path can be forgotten; `private` because the data is paid; and a dark route that answers 404 cannot be
probed as a paid feature before it ships.

### D-036 · A flaky assertion in another area's test is fixed on this branch, in its own commit, when it reddens our gate

**Decision.** `app/src/context/AuthContext.test.jsx`'s "503 on a REFETCH" case read `authTransient` synchronously after
`act` while its sibling reads sat inside a `waitFor`; the read is moved into the same wait. Committed alone
(`3512348c5`), never folded into a Data Charts merge, and named in the merge's summary as not part of the tab.

**Why.** It failed once in the C3 six-shard gate and was green 3/3 alone and again in a re-run of its own shard with the
same file list and worker count, so it is a sampling race, not a product defect — the exact class the file's own
⚰️ comment describes for `user` and `plan`, left unfixed on the third value. Classifying it as "master's" and moving on
would leave every session on this box with an intermittently red gate, and a gate that reddens at random is one people
learn to wave through. The fix is one assertion's sampling moment, all three values still demanded, with a control
proving the moved assertion still fails when the expectation is inverted: flipping the expected `authTransient` to
`'true'` on the rewritten `waitFor` gives `Tests 1 failed | 7 passed (8)`, and the harness restores the exact bytes
(sha verified) afterwards. Without that control a `waitFor` can pass by asserting nothing, which would make this a
silence rather than a fix. Scope: the brief's off-limits list is Notebook product files and `OptionsFlow.jsx`; this is
neither, and it is test-only.

⛔ **This is not a licence to rewrite another area's failing test.** The same gate later reddened on
`src/pages/desk/ArticlesSection.native.test.jsx`, and that one was NOT fixed: its `waitFor` is correctly placed and
Testing Library's budget is already 4,000 ms against a 250 ms debounce, so the red was starvation under the full suite,
not a misplaced read. "Fixing" it would have meant raising a global timeout in another session's area to hide load. It is
recorded in `gates.md` as pre-existing and load-sensitive instead. The test that gets rewritten is the one whose
ASSERTION is in the wrong place; the test that gets recorded is the one the machine was too busy to answer.
