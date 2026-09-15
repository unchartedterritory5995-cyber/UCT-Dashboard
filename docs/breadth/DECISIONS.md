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

### D-037 · The R1 golden is the acceptance test for the whole of R1, and Tasks 2 and 3 may not touch it

**Decision.** `app/src/pages/breadth/heatmapRegistry.golden.{test.js,json}` was written in R1 Task 1, before any
consolidation, and pins what the heatmap registry produced at `0dd21c248`: every tile's `label`, `group`, `isHeader`,
`drillKey`, `polarity`, `pair`, and its `getTier`/`getFmt` as source text, in registry order, plus `TREEMAP_DEF`,
`FFILL_KEYS` and the sorted `PCTILE_KEYS` — 53 rows, 46 tiles, 16 drill keys, 5 fill keys, 29 percentile keys, 29
treemap items, with five controls and a size floor. Tasks 2 and 3 were required to leave it **unchanged and
unregenerated**, and did: it passed 7/7 after METRIC_META landed and again after `heatmapMetrics.js` became an adapter.

⛔ **If a later task needs the golden to change, that is a finding, not a fixture update.** Regenerating it is allowed
only for a deliberate, member-visible change, and only with its own line in this file naming what a member will now see
that they did not see before. A fixture regenerated to make a suite green records the new behaviour as if it had always
been correct, and the one artifact that could have reported the regression becomes the thing that certifies it.

**Why this shape.** The consolidation's whole risk is silent: two registries agreeing today, one of them quietly
re-ordered or re-labelled tomorrow, with nothing failing because both sides moved together. A golden captured BEFORE the
refactor is the only artifact that cannot move with it. It earned that role immediately — deriving `WEEKLY_METRICS` from
`METRIC_META` alone reordered `FFILL_KEYS` alphabetically (the catalog reads bulls → neutral → bears → spread → naaim,
and `METRIC_META` is sorted by key). Under a "regenerate and move on" rule that would have shipped as a reordered
forward-fill list with a green suite behind it; under this rule it was fixed at the source, in `chartMetrics.js`, with
the reason written beside the derivation.

⚠️ **A golden is a record of behaviour, not a claim that the behaviour is right.** It pins thirteen deliberate
`label`/`short` disagreements and the picker-vs-tile group split (D-034) exactly as they are. Changing any of those
remains a product decision; the golden only guarantees nobody makes one by accident.

### D-038 · The member-smoke credential was rotated after a session cookie leaked into a log

**Decision.** On 2026-09-13 the `/charts` A/B harness (`tools/breadth_widget_ab.py`) crashed during teardown and
printed the raw Playwright exception. A Playwright error embeds the request headers of the call that failed, and one of
those headers is `Cookie:` — so a live `MEMBER_SMOKE` session token reached a run log and the agent's tool output. The
credential was rotated end to end, on the owner's explicit authorisation, using mechanisms the repo already has:

1. `POST /api/auth/admin/reset-password` — the same admin endpoint `CLAUDE.md` names for smoke-account management. No
   new mechanism, no raw SQL, no pod-side write.
2. `POST /api/auth/sessions/revoke-others`, called as the member itself after signing in with the new value: **104**
   sessions deleted. A second call returned `revoked: 0`, which is the proof that none survive.
3. Verified: the leaked token now answers **401** on `/api/auth/me` (one read-only request, its only permitted use);
   a member-view read with the new value answers 200.
4. `MEMBER_SMOKE_PASSWORD` updated in the operator's user environment. **No Railway service carries it** — a key-name
   sweep of all five services found only `SMOKE_LOGIN_LINK_ENABLED` on `web` — so nothing was redeployed and no deploy
   was left in flight.

⛔ **On this app, changing a password does NOT invalidate sessions.** `admin/reset-password` writes `password_hash`
and nothing else; the only `DELETE FROM sessions` paths are logout, revoke-others, and expiry. Step 2 is therefore not
belt-and-braces, it is the step that actually closed the leak. Anyone rotating a credential here and stopping at step 1
has changed a password and left every stolen session live.

⛔ **The classifier block was correct and was not bypassed.** The first instinct was to `POST /api/auth/logout` with
the leaked cookie; the permission classifier refused it as credential exploration. That refusal was right — a script
that reads a token out of a file and replays it is the shape of an attack whether or not the intent is remediation.
The response was to delete the artifacts (a safer action that needed no credential), report the leak to the owner, and
then rotate once authorised. **Rotation superseded logout**: it invalidates every session at once rather than the one
token that happened to be legible, which is the stronger remedy the block pushed toward.

⚠️ **A leaked token also lives in the conversation transcript, which cannot be deleted.** Deleting log files is
necessary and never sufficient; rotation is what closes it. That is why the runbook's first instruction is *report
immediately*, not *clean up*.

**Why the rule is phrased as it is.** "Don't log secrets" would not have prevented this — nothing was logging a
credential on purpose, it was logging an *error*, and the error was carrying one. The rule in
`docs/runbooks/rig-credential-hygiene.md` is therefore **never print a raw Playwright/HTTP exception**, with one
shared scrubber (`tools/secret_scrub.py`) and `tests/test_secret_scrub.py` as the standing rail.

⚠️ **Three defects surfaced while building that rail, each recorded because each read as done:** the draft scrubber
required a word boundary before the cookie's name, which does not exist after the `uct_` prefix, so it redacted the
unprefixed spelling and missed the real one; the scrubber's own "this file must not contain the literal it hunts" case
failed on the paragraph explaining that rule; and the harness's new self-check had pasted a slice of the real token in
as a fixture, in a committed file, in a public repo — found by the scanner, which is the whole argument for having one.
That commit reached no remote and was rewritten away. **The exempt files are now held to a stricter rule than the scan
they are exempt from** (no long high-entropy literal), because an allowlist is exactly where a secret hides.

### D-039 · The password-change session defect found by D-038 is fixed and live

**Decision.** The defect D-038 recorded — on this app a password change writes `password_hash` and nothing else, so
every stolen session survives it — shipped as its own corrective change on its own branch, gate and merge:
`fix/password-change-revokes-sessions`, merged **`bd68c4147`**, deploy `7c380b6a` **SUCCESS** 2026-09-14T04:02:50Z.
Member-facing: *"Security: changing your password now signs out all other devices."*

`auth_service.revoke_sessions(user_id, keep_token=None)` is the one implementation, and
`POST /api/auth/sessions/revoke-others` now calls it too so the endpoint and the password paths cannot drift.

⛔ **THREE functions write a password, not two.** The one outside the original scope —
`execute_password_reset`, the emailed forgot-password link — is the most important of the three: it is the path a
locked-out or compromised member actually reaches for, and until this change it reset the password and left the
attacker signed in. It revokes everything; there is no caller session to preserve. Self-service keeps only the calling
device; admin reset keeps nothing.

**Verified on the shipped build, not just in tests** (member-smoke, production): two live sessions → self-service
change → **the device that changed it stayed 200 and the other device went 401**, with
`other_sessions_signed_out: true` on the response. `revoke-others` through the new shared implementation: 3 alive →
`revoked: 14` → caller 200, others 401/401.

⚠️ **Two process failures on this change, both worth more than the fix.** The first commit was authored against a
**RED run** — the last pytest before it printed `1 failed, 5 passed` and its message claimed six passing. The cause
was a fixture domain: `AdminResetRequest.email` is an `EmailStr` and the validator refuses special-use domains, so
`*.invalid` 422s before the endpoint is reached while `.internal` passes. **The five service-level cases never touch
Pydantic and passed regardless — a fixture can be wrong for five tests and fatal for the sixth**, which is exactly the
shape that makes a partial green read as a whole one. Second, the correction was `--amend`ed onto a MERGE commit
rather than the fix, leaving the red test in history; the branch was local-only, so it was restructured into one
commit on master. Neither reached a remote.

⭐ **A backend-only change is NOT gated by the six-shard vitest gate**, which cannot see it — zero `app/` files. The
gate that applies is the scoped backend suite: 6/6 in the new rail and **312 passed** across every auth surface it can
reach. Flow-worker is an **INERT STRAND**, traced rather than assumed: its closure takes exactly one symbol from
`auth_service` (`validate_session`, via `flow_gap_autofill.py:45` → `flow_admin_auth.py:24`) and this change touches
it in zero lines, so forcing a redeploy would buy a permanent OPRA tape gap for no behavioural difference.

### D-040 · `DESK_PUBLIC_SHOWS='*'` is the owner's decision, is ledgered, and must not be "fixed"

**Decision.** Public YouTube publishing of live sessions, workshops and evening updates is **deliberate** — owner
decision 2026-08-19, reaffirmed 2026-09-13. The 2026-09-13 change that unlisted them was the error and was reverted on
the owner's confirmation. `DESK_PUBLIC_SHOWS='*'` on `web` is the intended live value.

**Verified, not assumed** (2026-09-14, this tree at master): `tests/test_visibility_flag_ledger.py` → **16 passed**, and
`python tools/flag_ledger_audit.py --visibility` → **FINDINGS: 0** with `web: DESK_PUBLIC_SHOWS='*'` read live. The
ledger already declares it `status: armed`, `values: ['*', 'sunday scans']`, with an `owner_decision` field — and the
rail permits a wildcard on a public-exposure flag **precisely because** that field is present. So the shape is the
intended one, the same shape `J2_OCR_ENABLED` uses.

⛔ **Do not narrow this flag, and do not file it as an exposure.** A later session reading an incident framing will be
tempted to "fix" a wildcard on a flag named PUBLIC — that would unlist the owner's public catalogue and would look
like diligence. The rail is the authority and it is green; a finding here means the LEDGER drifted, never that the
flag is wrong.

⚠️ **This entry exists because I got it wrong in exactly that direction** — I read the incident framing, treated a
deliberate decision as an exposure, and reported it as one. The correction is recorded here rather than only in a
conversation so the next reader meets it beside the flag.

### D-041 · B1 ships the series endpoint dark, flag-first, cached under the existing prefix, with downsampling deferred on measurement

**Decision.** `GET /api/breadth-monitor/series` is implemented to D-035's contract. Full contract, caps, defaults and
cost table: **`docs/breadth/api-series.md`** — that file is the authority and this entry does not restate it.

Four choices worth recording:

**1. Flag-first is the mechanism, not a detail.** `require_series_flag` is declared before `require_paid` because
FastAPI 0.115.6 resolves dependencies in declaration order (`fastapi/dependencies/utils.py:592`). Reversed, an
anonymous probe gets 401/402 — which **advertises that a paid route exists** before it has shipped. The rail asserts
the two POSITIONS rather than three status codes, because three green codes are also compatible with a route that 404s
for an unrelated reason.

**2. The row schema is the key authority, and the constraint is "a series is numbers."** D-035 allowed the chartMetrics
registry or the row schema; the registry is JavaScript and this is Python, so citing it would mean a hand-typed copy —
the exact second-authority defect R1 spent itself removing. The numeric test is also what keeps `*_list` ticker arrays
out **by type**, rather than adding a second stripper beside the one already inside `get_history_deep`. ⭐ That came
from a failing test, not from design: the first `series_known_keys` admitted any non-`date` key, and a stubbed history
(which bypasses the real stripper) served a ticker array as a column. **A stub that bypasses a guard is how you find
out the guard was the only thing holding a contract up.**

**3. The cache key sits under `breadth_history_` deliberately.** Every snapshot write already calls
`cache.delete_prefix("breadth_history_")`, so this needs no new invalidation path and none can be forgotten. Key order
is normalised so a reordered `keys=` is the same cache entry.

**4. Downsampling is DEFERRED, on measurement.** D-035's trigger was 2008– with 8 keys exceeding ~1 s cold. Measured:
**30.3 ms p50 / 36.0 ms p95** over 4,530 sessions, ~33× under it. `bucket=` is not implemented.
⚠️ **And the measurement is not the one D-035 asked for, which is why it says so.** `C:\data\breadth_monitor.db` on
this box is **12 KB — schema only**; the real history is on Railway's volume. Timing "the local DB" would have measured
an empty table and produced a flattering number, so the history reader was stubbed with a full-size row set to isolate
what B1 *adds*. `get_history_deep`'s own cost is pre-existing, unchanged and separately cached.

**The ledger row ships in this commit, not before it.** `test_the_ledger_does_not_describe_gates_that_no_longer_exist`
computes `stale = ledger − (gates ∪ visibility_flags)`, so a row for a flag no code reads is rot by definition — a
standalone "flags commit" could not have been green. The mirror rule sent `VITE_BREADTH_CHARTS_V2_ENABLED` the other
way: `test_no_stale_build_flag_rows` asserts `declared ⊆ names_read(repo)`, so its **ledger row waits for V2-1's first
read** while its Dockerfile `ARG`/`ENV` lands now (a spare ARG is inert, and nothing ties the ARG list to the ledger).

### D-042 · The cost bound is NOT met, `bucket=` would not fix it, and the cause is the reader — B1 stays dark

**Measured on production, 2026-09-14, member-smoke, off-peak**, through the existing paid monitor endpoint (same
`get_history_deep`, heavier payload, so a strict upper bound on B1's read):

| request | rows | payload | cold | warm |
|---|---|---|---|---|
| `days=90` (no `end`, the default Monitor view) | 90 | 146 KB | 1,018 ms | 166 ms |
| `days=8000` (no `end`) | 4,703 | 4.96 MB | **54,923 ms** | 676 ms |
| `days=365&end=2026-08-01` (teleport) | 365 | 455 KB | 10,498 ms | 1,912 ms |

⛔ **D-035's trigger is breached by ~55×**, so by the standing rule downsampling is owed. **It is not implemented, and
implementing it would be a fix that does not fix anything.** `bucket=` reduces the RESPONSE; the 55 s is spent in
`get_history_deep` PRODUCING the 4,703 rows, entirely upstream of any bucketing. Every row must exist before it can be
averaged into a week. Shipping `bucket=` here would lower the payload, leave the 55 s exactly where it is, and — worse —
make the endpoint *look* bounded.

⭐ **B1's own cost was never the problem and the two numbers should not be confused.** B1's marginal filter+project+
encode is **30 ms** over 4,530 rows (D-041). The reader is ~1,800× that. A stubbed measurement was right about what it
measured and silent about what dominates — which is why this second measurement was demanded, and why the answer
inverted the decision.

⚠️ **THIS IS PRE-EXISTING AND LIVE, AND IT IS NOT B1's.** `GET /api/breadth-monitor?days=8000` is a shipped, paid
route; any member who asks the Monitor for a deep window pays 55 s on the ONE uvicorn process, which is the
anyio-threadpool starvation class that caused the 2026-07-01 524 outage. `00-discovery` §7 already recorded the Time
Navigator firing 32 sequential `days=150&end=…` calls and a 45 s rig timeout attributed to it — the same path, not yet
named as a cost. **Raised, not fixed here**: a reader rewrite is not a Data Charts change and must not ride a UI branch.

**Decision.** B1 **stays dark** — it is set on no service, so nothing is exposed and no member can reach it. The flag
must NOT be enabled until the reader cost is addressed. `bucket=` is **not** implemented and is **not** the owed work;
what is owed is one of: bound B1's span to the warm collector range, pre-warm the deep windows off the request path, or
make `get_history_deep` cheap for a cold deep span. That choice is the owner's and is recorded as open.

---

### D-043 — the reader is its own programme; `/series` is span-capped until it lands (2026-09-14)

**Owner ruling.** D-042 left the choice open between three ways of closing the ~55 s cold deep read. The ruling splits
it in two: the reader gets its **own programme** (it is a backend correctness/performance problem, not a Data Charts
change, and must not ride a UI branch), and until that programme lands, **the cost is made unreachable rather than
tolerated**.

**Three parts, and each is deliberately in a different place:**

1. **`/series` is capped at 365 sessions** — `BREADTH_SERIES_MAX_SESSIONS`, enforced as `365 × 1.6 = 584` calendar
   days, `400` naming both numbers. A cold deep read is therefore unreachable from this endpoint **regardless of the
   flag**, which is what lets B1 stay dark safely rather than dangerously.
2. **The V2 hook refuses a wider span by constant** — the frontend does not discover the cap by receiving a `400`; it
   declines to ask, off a single exported max-sessions constant, and renders "range not yet available". ⭐ Two
   enforcement points for one rule is normally the second-authority defect; here the server's is the **guard** (it must
   hold against any caller) and the client's is the **product** (a member should not see an error for a range the app
   knows it cannot serve). Neither is derived from the other by copying a number — the hook owns its constant and the
   server owns its env var, and they are allowed to disagree only in the direction of the client being stricter.
3. ⛔ **`days=` on the live monitor route is NOT capped.** Time Navigator and Views depend on deep windows; capping it
   would break shipped surfaces to protect against a cost those surfaces are already paying. The live route gets
   **interim containment** (single-flight on the cache key) instead, as its own item off master.

**Why the cap is checked before the read.** Counting sessions requires reading them. A post-read rejection has already
spent the 55 s it exists to prevent, so the check is on **calendar days**, which the request alone settles.
`test_span_over_the_session_cap_is_400_and_names_the_cap` asserts the reader never ran — without that assertion the cap
is decorative and every other test still passes.

⚠️ **The cap is raised when the reader work lands, not to satisfy a wider view.** That sentence is in
`docs/breadth/api-series.md` and in the `400` body itself, because the next person to want five years of history will
find the constant before they find this file.

---

### D-044 — `json_remove()` in SQL is a MEASURED ANTI-PATTERN, not a fix (2026-09-14)

**Recorded by owner ruling so nobody adopts it on plausibility.** It is the option that
looks cheapest, needs no migration, and is the only one of the three candidates that makes
the reader **worse**.

Measured on the production copy, 105 rows (the default view's window), best of three runs:

| shape | ms | vs today |
|---|---|---|
| **today** — `SELECT metrics` → `json.loads` → `del` each `_list` | **627.7** | — |
| **`json_remove()` in SQLite**, then parse the remainder | **1,563.6** | ⛔ **2.49x SLOWER** |
| **numeric-only column**, written once | **1.3** | ⭐ **485x faster** |

⛔ **Why it loses, and the reason generalises past this endpoint:** `json_remove` makes
SQLite parse the 636 KB blob and serialise a NEW one, and Python still parses the result.
It does not remove the parse — it adds a second one in C and keeps the first. **Moving a
cost into the database is only a win when the database can answer without materialising
the thing you were trying to avoid materialising.**

⭐ The blob shape that makes this matter: the average snapshot is **636,834 bytes**, of
which **99.7 %** is `*_list` ticker arrays (7,803 tickers/row) that every history read
parses and immediately deletes. Every numeric key the Monitor grid shows — all ~70 of
them, across all 174 rows — totals **0.25 MB**.

**Ruled shape: a numeric store written on write** — built and recorded as **D-045
below**, never SQL-side JSON surgery. The drill endpoints keep reading the blobs by date;
they are the only consumer that wants the lists.

---

### D-045 — the numeric store and the materialised reconstructed side (2026-09-14)

**This is the record D-044 points at.** D-044 ruled the shape; this is what was built,
which commits carry it, and what it measured. Every commit hash below was verified with
`git log -1 --format=%s` before it was written down.

#### What was built

| # | commit | what it added |
|---|---|---|
| 1 | `685a19bdb` | `breadth_snapshot_numeric(date PK, metrics, source, updated_at)` + `idx_bsn_source`. `numeric_of()` drops **exactly** the `*_list` keys; `_write_numeric()` takes the **caller's connection** so the projection is written inside the snapshot's own transaction; `delete_snapshot` removes both rows. |
| 2 | `725151fd3` | `idx_bdo_source_date(source, date, metric, c)` — the covering index that closes follow-ups (c) `closes_for_dates` and (d) `distinct_dates`. |
| 3 | `b4c141948` | `breadth_reconstructed_daily(date PK, metrics, ohlc_watermark, sentiment_watermark, built_at)` + `idx_brd_watermark`, with `build_reconstructed()`, `reconstructed_for_dates()`, `stale_reconstructed_dates()`, `rebuild_stale()` and `_rebuild_after_write()`. |
| 4 | `f7e09f56c` | the reconstructed migration tolerates a continuously-written input: `_recon_fingerprint(c, since)` excludes concurrently-written dates, and an already-materialised store skips the backup rather than re-taking it. |
| 5 | `5032b44a3` | the deep window's date set comes from the materialised table; `distinct_dates_by_scan()` is kept as the parity reference and the fallback. |

⛔ **A JSON column, not ~70 typed columns.** `metrics` has no fixed schema — the newest
production row carries 92 keys and older ones carry fewer — so a column list would be a
SECOND AUTHORITY over "which metrics exist", and its failure mode is silent: a metric the
collector starts writing tomorrow would simply not be stored and the reader would serve a
column of nulls that reads as a quiet market.

⛔ **"Numeric" names the PURPOSE, not a type filter.** The readers drop `*_list` and keep
everything else, strings and nulls included. Filtering to int/float would produce a store
that is *more* numeric and *less* correct, and the difference would surface as a missing
Monitor column rather than as an error.

⛔ **Precedence is asserted, not implied.** Where a collector row and a reconstructed row
exist for one date, the **collector row wins**. That is why they are two tables: one
date-keyed table would have let whichever wrote last decide.

#### The migration discipline

`api/services/breadth_numeric_migration.py` — `backfill()`, `backfill_reconstructed()`,
`audit()`, `audit_reconstructed()`, `_fingerprint()`, `_recon_fingerprint()`,
`_write_marker()`. It **fingerprints its input before and after and refuses to run
uninsured**: a `VACUUM INTO` backup is taken first (never a file copy — a plain copy of a
WAL database omits whatever is still in the `-wal` sidecar and looks complete while
lagging), and a marker in `DATA_DIR` makes it idempotent across boots.

⚰️ **The first production run reported FAILED, and the migration was right to.** The
fingerprint covered dates the collector was writing while the backfill ran, so input and
output could not match by construction. The fix narrowed the fingerprint to exclude
concurrently-written dates — **not** loosening the check.

#### What it measured

Bands, because a single number from one box is not a result. Local, against `VACUUM INTO`
copies of the production databases.

| read | before | after |
|---|---|---|
| 105 rows (the default view's window) | 627.7 ms | **1.3 ms** |
| deep 8,000-day, reader only | 1,860 ms (Session 1, blob path) | **248–413 ms** |
| deep 8,000-day, bytes read on the request path | 105.7 MB → 17.8 MB | **6.62 MB** |
| the date set alone (`merged_dates`) | 11,329,088 B | **127,176 B** — 89x |

⭐ **The blob shape the whole programme turns on:** the average snapshot is 636,834 bytes,
of which **99.7 %** is `*_list` ticker arrays (7,803 tickers/row) that every history read
parsed and immediately deleted. Every numeric key the Monitor grid shows — ~70 of them
across all 174 rows — totals **0.25 MB**.

#### Production, after

`/api/breadth-monitor?days≈7900`, n=20, settled window (uptime 708→1,629 s, monotonic, no
restart), every sample a forced cache miss on a distinct key, all 200:

| | p50 | p95 | max |
|---|---|---|---|
| wall (client) | 980.8 ms | 1,749.7 ms | 1,897.7 ms |
| server `total_ms` | 696.3 ms | 1,429.0 ms | 1,496.4 ms |

**Against D-042's 54,923 ms cold: 56x at the median, 31x at p95.** The 95 % CI for the
true p95 is [1,540.0, 1,897.7] ms, bounded by real observations on both sides.

⚠️ **The 30x was never one thing, and this store is not what closed it.** Contention on
the single uvicorn process is: the same read measured 224 ms settled and 17,480 ms three
minutes after boot. The store removed the work; settling removed the queue. Both were
needed and only the first is in this decision.

#### What is still open

`post_reader_ms` now exceeds `reader_ms` in **17 of 20** settled samples (median ratio
2.09). Session 6's per-phase instrument names the dominant post-reader phase as
`encode_render`, of which `jsonable_encoder` is the largest part — see
`docs/breadth-history-reader/00-profile.md`, Session 6.

---

### D-046 · The `/series` span cap stays at 365 — the closing entry on the cap question (2026-09-14)

**Owner decision, on the n=20 settled-window measurement.** D-043 capped `/series` at 365
stored sessions (`BREADTH_SERIES_MAX_SESSIONS`) *"until the reader lands"*. The reader has
landed (D-045). This is the entry that closes the question, and the answer is **no change**.

#### The measurement the decision rests on

`/api/breadth-monitor?days≈7900`, production, **n=20**, settled window (uptime 708→1,629 s,
**monotonic — no restart**), every sample a forced cache miss on a **distinct** `days=` key,
all `status=200`, `decoded_bytes` 681,973–681,975, logs streamed live to
`logs/session6-sample.log` throughout.

| deep, n=20 | min | p50 | p90 | **p95** | max | sd |
|---|---|---|---|---|---|---|
| client wall | 796.2 | **980.8** | 1,560.2 | **1,749.7** | 1,897.7 | 316.7 |
| server `total_ms` | 526.9 | 696.3 | 1,224.5 | 1,429.0 | 1,496.4 | 281.2 |
| `reader_ms` | 144.2 | 209.7 | 631.8 | 998.8 | 1,000.4 | 258.2 |
| `post_reader_ms` | 377.6 | 433.0 | 549.1 | 581.5 | 742.1 | 89.4 |

⭐ **p95 is estimable at this n, which is the whole reason the sample was run.** The exact
binomial order-statistic interval places the true p95 between order statistics 18 and 20:
**95 % CI [1,540.0 ms, 1,897.7 ms]** — bounded by real observations on *both* sides. At the
n=6 of the previous attempt the empirical p95 *was* the maximum by construction, so quoting
it would have been quoting the max with a statistic's name on it.

#### Why the cap stays, in order of weight

1. ⭐ **A lift exposes nothing anyone can request.** The UI's largest `days=` is **365**:
   `Breadth.jsx:657` sends `MONITOR_WINDOW = 90` or one of `VIEWS_DAY_CHOICES = [90, 180,
   365]`, and the Time Navigator (`useMonitorGrid.js:98`) sends `days=${stored.length}`
   where `stored` is a slice of `BLOCK = 150`. Raising the cap to 1,000 changes what **no
   member can ask for**. The deep path is reached by an `end=` teleport, not by a large span.
2. **It would cost a master push for zero member-visible difference**, and a master push is
   the scarce, serialising resource in this repo.
3. ⛔ **The number that would justify a lift is not the number that improved.** The reader is
   now cheap; the remaining cost has moved to `encode_render`, which grows linearly in rows.
   Lifting the cap before the encoder is addressed raises the ceiling on the half that did
   **not** get fixed.

#### What would reopen it

A member-facing feature that actually requests more than 365 sessions. Until one exists the
cap is not a constraint anyone is hitting, and D-043's *"until the reader lands"* condition
is satisfied without a change.

⚠️ **Not a ratio.** Against D-042's 54,923 ms this is ~56x at the median and ~31x at p95,
**reported as a band comparison**: D-042 is **n=1**, on a different pod state. The honest
statement is that the two bands do not overlap — 54,923 ms against 796–1,898 ms.

---

### D-047 · The history response is pre-serialised, and the cache holds bytes (2026-09-15)

**Shipped as `baffee6cf` (M4, Session 7).** The route renders its own JSON once and
caches the **bytes**; FastAPI's generic JSON path never runs on this endpoint again.

#### Why

`fastapi.encoders.jsonable_encoder` was walking **376,240 values that are already plain
scalars** (4,703 rows x 80 keys) on **every** request — including cache hits, because the
cache held row dicts. Measured on the production copy at days=8000: `jsonable_encoder`
302.7 ms + `JSONResponse.render` 209.8 ms = **512.6 ms**, of which the encoder is ~64 %.

#### ⭐ The memory result INVERTED the risk it was supposed to carry

Session 6 flagged that caching bytes "stores ~5 MB per span instead of a dict tree" and
needed a measured bound. Deep-walked with an id() seen-set — ⛔ `sys.getsizeof` on a list
of 4,703 dicts reports the pointer array and none of the dicts:

| span | dict (deep) | JSON bytes | ratio |
|---|---|---|---|
| 90 | 630,570 | 146,173 | 4.3x |
| 365 | 2,123,328 | 471,039 | 4.5x |
| **8000** | **24,471,209** | **4,958,766** | **4.9x** |

**The dict tree was the expensive option all along.** Peak RSS over baseline, one
measurement per process: 61.4 MB on both sides cold (equal); including the warm request
68.0 -> 63.4 MB, i.e. the new path peaks **lower**.

#### Byte-identity is structural, not empirical

`_render_json` makes the same call with the same arguments `JSONResponse.render` makes —
`ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")` — read off the
installed starlette. A rail pins those four arguments so a starlette change surfaces as a
failure rather than as drift. Parity: sha256 `7695923c...` over **5,576,278 bytes** across
spans 90/365/8000 against a real `origin/master` worktree, with flip-one-byte and
truncate-one-byte controls.

#### ⛔ orjson: DECLINED, and the reason is recorded so it is not re-litigated

| | days=8000 | byte-identical | NaN / ±Inf |
|---|---|---|---|
| current (encoder + render) | 512.6 ms | — | **raises** |
| stdlib, same arguments | 113.0 ms | yes | **raises** |
| orjson | **43.2 ms** | yes | ⛔ **emits `null`** |

orjson is **already a declared dependency** (`requirements.txt:80`, in use by
`api/routers/bars.py`) and was measured byte-identical on all three real spans, at 2.6x
the speed of stdlib. **It is still declined**: it serialises NaN and ±Inf to `null` where
this path raises, so a 500 silently becomes a plausible wrong number on a data edge.

⭐ **The general form, which is the part worth keeping:** stdlib's byte-identity is
**structural** — the same function with the same arguments, so it holds for values nobody
thought to test. orjson's is **empirical** — it matches today's data and diverges on a
known edge. A parametrised rail
(`tests/test_breadth_preserialised.py::test_a_non_finite_float_still_refuses...`) pins the
refusal. Reversing this is an owner decision, not a performance tweak.

#### The GZip level is NOT closed by this change

⚠️ The body cache holds **pre-gzip bytes only** — the route sets no `Content-Encoding`
and `_GZipSkipSSE(minimum_size=1000, compresslevel=5)` still compresses on **every**
request, warm included. So compression is *not* paid once per TTL and the level question
stands. Measured on the days=8000 body (4,958,867 B uncompressed):

| level | compress ms | bytes out | vs level 5 |
|---|---|---|---|
| 1 | 28.7 | 1,287,614 | +93.0 % size, −32.7 ms |
| 3 | 46.4 | 800,161 | +19.9 % size, −15.0 ms |
| **5 (production)** | **61.4** | **667,150** | — |
| 6 | 103.1 | 654,066 | −2.0 % size, +41.7 ms |
| 9 | 148.1 | 577,542 | −13.4 % size, +86.7 ms |

⚰️ **The in-code comment justifying level 5 claims level 9 buys a "<3% size gain".
Measured, it is −13.4 %.** The choice still looks right — +86.7 ms of shared event loop
per deep request — but the stated reason is wrong. **Level stays at 5 pending an owner
decision; caching the gzipped bytes would moot it and is proposed, not built.**

---

### D-048 · `reconstructed_fetch` — the interim record (diagnosis in progress, 2026-09-15)

**Not a decision yet. An interim record so the next session does not re-derive it.**

#### The finding

Session 7's per-phase instrument measured, in production, inside a **settled** window:

| phase | ratio across a 20.2x swing in `reader_ms` |
|---|---|
| `reconstructed_fetch` | **50.2x** (59.3 -> 2,974.5 ms) |
| `numeric_fetch` | 9.8x |
| **`derive`** | **1.0x** (76.8 -> 77.2 ms) |

⛔ `derive` is pure CPU over 376,240 cells and **does not move at all**. If the single
uvicorn worker were starved of CPU it would scale with everything else. That rules CPU
starvation out and leaves the read itself.

#### Static facts (Session 8, C.1), measured not assumed

| | |
|---|---|
| table | `breadth_reconstructed_daily(date PK, metrics, ohlc_watermark, sentiment_watermark, built_at)` + `idx_brd_watermark` |
| rows / payload | **4,700** rows, `SUM(LENGTH(metrics))` = **4,678,369 B**, avg **995 B/row** |
| file | **41,861,120 B**, page_size 4096, 10,220 pages, on the Railway volume (`/data`) |
| query | `SELECT date, metrics ... WHERE date IN (?...)` **chunked at 400** — 12 statements for a deep read |
| plan | `SEARCH ... USING INDEX sqlite_autoindex_... (date=?)` — one PK seek per date, 4,700 per deep read |
| reader connection | **opened per call**, `PRAGMA journal_mode=WAL` + `busy_timeout=3000` **every time** |
| ⛔ `cache_size` | **-2000 = 2 MB** page cache against a 41.9 MB file |
| ⛔ `mmap_size` | **0** — every page read is a syscall, never a mapped access |

#### What the split shows so far

`reconstructed_fetch` now splits into `rf_open` / `rf_pragma` / `rf_execute` / `rf_fetch` /
`rf_materialise`, with row/byte/retry counters and a per-request `/proc/self/io` delta.

⭐ **`rf_materialise` dominates on every reading taken so far** — 75–90 % locally, and
**81.6 %** on the first production sample (44.7 ms of 54.8). That is `json.loads` over
4,529 rows / 4.5 MB, i.e. **H4 (row materialisation)**, not I/O.

#### What has been EXCLUDED

⛔ **H2 (lock contention) is effectively excluded.** In WAL mode a writer does not block
this reader: a local concurrent writer committing **460,569** times during the read
window moved `reconstructed_fetch` by only **1.9x** (44.1 -> 85.3 ms). Neither that nor
page-cache pressure (1.5x) comes near production's 50.2x.

#### The production window ANSWERED it, and the answer is two phenomena

n=20 settled cold samples, deployed `47e1516b5`:

| i | `reconstructed_fetch` | `rf_fetch` | `rf_materialise` | **`io_read_bytes`** |
|---|---|---|---|---|
| 12 (fastest) | 55.1 | 6.6 | 45.7 | 1,568,768 |
| 8 | 682.0 | 608.0 | 65.2 | 7,069,696 |
| **13** | **31,819.8** | **21,098.5** | 319.7 | **540,057,600** |

⭐ **Sample 13 read 540,057,600 bytes for a query returning 4.5 MB — 12.9x the ENTIRE
41,861,120-byte file.** Twelve chunked statements, 4,700 PK seeks, a **2 MB** page cache
and **mmap_size=0**: pages are read, evicted, and read again. **H1 is CONFIRMED for the
tail.** Across that swing `rf_execute` moves 5,729x and `rf_fetch` 3,197x while
`rf_materialise` moves 7.0x and `derive` 2.5x — the I/O halves move by thousands, the CPU
halves barely.

⚠️ **But H1 does NOT explain the ordinary range, and the two correlations say so:**
Pearson r = **0.994**, Spearman (rank) r = **0.260**. The Pearson figure is carried
entirely by sample 13. Fast samples (<100 ms) read a median 2,121,728 B; slow ones
(>=100 ms) read 5,054,464 B — 2.4x, across a 3-12x time difference. One 173 ms sample read
**77,824 bytes**.

**Status: H2 EXCLUDED** (`rf_busy_retries` 0 on all 20; WAL readers do not block on
writers). **H1 CONFIRMED for the tail, not the range. H3 open and now the leading
candidate for the ordinary variation, by elimination. H4 owns the LEVEL** — `rf_materialise`
is 45-110 ms on almost every sample, the floor under every read, untouched by any I/O fix.

⭐ **The 50x is TWO phenomena, not one**, and a fix aimed at either alone will look like it
failed against the other. See `docs/breadth-history-reader/00-profile.md`, Session 8.

### D-049 · The H1 page-cache fix is ON in production — measured, x9.05 on the tail (2026-09-15)

**Decision: `BREADTH_OHLC_PAGECACHE=1` stays set on `web`.** `PRAGMA mmap_size=67108864`
(64 MB) + `PRAGMA cache_size=-16000` (16 MB), against the shipped `mmap_size=0` and
`cache_size=-2000`. Shipped as M8 (`1571e2f87`) default OFF; flipped under authorisation
V1 after the OFF window closed.

#### The measurement

Two production windows, same harness, same spans, settle floor uptime ≥ 640 s, the arm
read off `rf_pagecache` **on each request** rather than from the config. **Identical work
in both arms: `rf_rows` 4,529 and `rf_bytes` 4,523,328 on every sample.**

| `deep_cold` cold reads | OFF (n=19) | ON (n=20) | |
|---|---|---|---|
| p50 | 309.0 ms | 281.0 ms | x1.10 |
| **p90** | 3,052.0 ms | **842.0 ms** | **x3.62** |
| **max** | 11,382.4 ms | **1,257.7 ms** | **x9.05** |
| `rf_stmt_sum` max | 8,854.9 ms | 893.3 ms | x9.91 |
| **min `syscr`** | **1,669** | **182** | **x9.17** |
| max `read_bytes` | 187.51 MB | **0.00 MB** | |

⭐ **`syscr` is the discriminator and it is the one number contamination cannot fake.**
`mmap` serves pages by **page fault, not `read()`**, so a working mapping must collapse the
read-syscall count; and a background thread sharing the process can only push `syscr`
**up**, never below the floor this request needs. Every prediction above was committed to
`docs/breadth-history-reader/session9-window-b-predictions.md` **before the flag was set**.

#### ⚠️ The control moved, and it is recorded rather than explained away

`warm_365` is a body-cache hit that never opens SQLite, so the flag cannot reach it — and
it moved anyway (p50 20.1 → 16.0 ms). **A control that moves is a control that did not
control.** Three things say the warm path is unchanged and the pod was merely quieter:
`syscr` floor **79 in both arms**; the response byte-identical (`decoded_bytes` 69,979, and
the priming *real* read returned `rf_rows` 205 / `rf_bytes` 185,306 in **both arms on the
identical span**); and the OFF arm's warm outliers carry ordinary I/O counters, so they are
event-loop contention on the single uvicorn process, not disk. That does not rescue the
deep result — it fails to threaten it. A x1.26 drift cannot manufacture a x9.05 tail move
whose mechanism-specific discriminator moved x9.17 in lockstep.

#### What this does NOT settle

- ⛔ **Which half did it.** `mmap_size` and `cache_size` ship as one flag; one A/B cannot
  decompose two coupled changes. The evidence **leans** mmap, because `syscr` is mmap's
  signature specifically and `cache_size` would not touch it. "Leans" is the honest word.
- ⛔ **Memory.** `rss_mb` 2,340.6 with the flag on, and **no OFF-arm baseline was
  captured**, so there is nothing to compare it against. 64 MB of mapping + 16 MB of cache
  **per connection**, on a module that opens one per call, is a real question — mitigated
  but not closed by mapped pages being file-backed and evictable rather than heap.
- ⛔ **H5 is untouched and now isolated.** The ON tail (826 / 986 / 1,257 ms) has
  `rf_fetch` 453 / 607 / 879 ms with **low** `syscr` — page faults still fetching cold
  pages at the 11.6–34.1 MB/s this volume delivers. The flag was never aimed at it.

#### ⛔ D-048 STANDS. The correction to it was drafted and WITHDRAWN before use

A first reading of window A claimed Spearman **+0.960** on `io_rchar` superseded D-048's
"two phenomena". It does not replicate on Session 8 (+0.504), and the reason kills the
counter rather than the window: dividing block-device bytes by each sample's own `rf_fetch`
implies **3,942 / 2,432 / 2,393 / 2,255 MB/s** on four Session 8 samples. No volume
delivers 3.9 GB/s. **`/proc/self/io` is PROCESS-wide**, so a delta across a request collects
every other thread's I/O. Window A's 0.960 was luck — its quiet samples read *exactly*
0.00 MB, so the counter was nearly clean there and filthy in Session 8's.

⭐ **The only per-request signals are the phase timings** (`rf_fetch`, `rf_stmt_sum`,
`rf_stmt_max`). Where an io counter and a phase timing disagree, the phase timing wins.

#### ⛔ The flag is INVISIBLE to the feature-flag ledger, and keeping it on is coupled to fixing that

`BREADTH_OHLC_PAGECACHE` has no row in `docs/feature_flags.json` and **cannot be given
one**: `feature_flag_index.is_gate()` matches only names containing a gate marker or ending
`_ON`, so the AST derivation does not list it among its 284 gates, and a row would be
classed as rot by `test_the_ledger_does_not_describe_gates_that_no_longer_exist` — **redding
the master deploy gate.** `BREADTH_OHLC_FETCH_RANGE` is invisible for the same reason.

⚰️ **This is the `DESK_PUBLIC_SHOWS` shape**, whose own source comment records the two
reasons it survived 25 days and published 27 paid sessions. The blast radius here is far
smaller — SQLite pragmas, not paid content on the open internet — which is why the ruling is
**keep it on and rename it**, not turn it off. **`BREADTH_OHLC_PAGECACHE_ENABLED`: one
constant, one env var, no behaviour change.** It needs an authorised merge and is the first
item for Session 10.

#### Consequence for the query-shape candidate (`breadth/fetch-shape`, built, NOT merged)

The range scan existed to avoid ~9,058 b-tree descents each costing a fault. **This fix
removed that cost by PRAGMA** — `syscr` 1,669 → 182 — so the candidate's case is largely
gone. **Do not merge it; do not delete it.** Keep it as a parity-proved experiment for H5,
to be measured against the ON arm rather than the OFF one it was designed for.

### D-050 · The flag is recordable, the gate serialises, and the cutover is one reading away (2026-09-15)

Session 10. No measurement windows (the push rate does not permit them — item 9). Everything
here is from Session 9's two windows or from a tool run this session.

#### 1. `BREADTH_OHLC_PAGECACHE` → `BREADTH_OHLC_PAGECACHE_ENABLED`

**Decision: renamed, and the ledger row is now REQUIRED rather than merely permitted.**
`feature_flag_index.is_gate()` matches only names carrying a gate marker or ending `_ON`;
the old name matched neither, so it was absent from the AST derivation's 284 gates and a row
for it would have been classed as rot by
`test_the_ledger_does_not_describe_gates_that_no_longer_exist` — **reddening the master
deploy gate**. `is_gate(NEW)` is True and `needs_declaration(NEW, "")` is True, so
`test_every_off_by_default_gate_is_declared` now fails without the row. **Mutation-proved:
deleting the row reds that repo-wide rail (1 failed, 184 passed).**

⛔ **No fallback to the old name** — a fallback is a second authority over one value, and the
loser is invisible. Proved two independent ways: an AST rail (`feature_flag_index.scan()`)
and a behavioural test asserting that setting *only* the old variable leaves `mmap_size` at
0 — which is exactly what a stale Railway variable looks like between the rename deploy and
the unset.

⛔ **The rails are AST-based deliberately.** `breadth_daily_ohlc.py` still contains the old
string, in the comment explaining the rename. A grep rail would match its own explanation and
demand the deletion of the reason.

**Parity EXACT**: golden/OFF, golden/ON(old), renamed/OFF, renamed/ON(new) all
`sha256 7695923c…` over 5,576,278 B. ⚠️ Recorded with its limit — every arm is byte-identical
*by design*, so parity cannot say whether the flag was applied; the pragma read-back does.

**flow-worker INERT**: neither variable is set on flow-worker, worker or bars-api — only
`web` — so the stale service reads an unset old name and the current one reads an unset new
name, converging on the same early return from either side of the deploy.

⭐ **V2 cost no deploy of its own.** `railway variable set … --skip-deploys` staged the new
variable **while the rename deploy was still building**, so the new container started with it
already present: old-name-ON → new-name-ON with **zero moments off**. `variable delete` has
no `--skip-deploys`, so the unset is the one step that must cost a deploy.

#### 2. The `master-deploy` concurrency group SERIALISES — measured

First contention in the workflow's 41-run history, exercised from a throwaway branch with
**no deploy attached** (GitHub evaluates a workflow file as it exists on the pushed ref, so
`gate-test/**` was added to the trigger on that branch only).

| run | branch | created | started | queue | ended |
|---|---|---|---|---|---|
| A | `gate-test/contention` | 09:06:05 | 09:06:08 | **3 s** | 09:07:57 |
| B | `gate-test/contention` | 09:06:24 | 09:08:01 | **97 s** | 09:10:06 |
| **C** | **`master`** (another workstream) | 09:09:24 | 09:10:11 | **47 s** | — |

Predicted 95 s for B; observed 97 s. ⭐ **Row C was unplanned and is the strongest evidence**:
a real master push queued behind the test and started 5 s after it finished, proving the
shared queue with production traffic. ⚠️ The honest cost: **~43 s of delay to another
workstream's deploy.**

⛔ **Serialising the CHECKS is not spacing the DEPLOYS**, and the two must not be conflated.

#### 3. "Railway does not wait for CI" — recorded

| commit | gate finished | pod booted | boot − gate |
|---|---|---|---|
| `6b606990c` | 05:12:53Z | 05:12:55Z | +2 s |
| `587ee51b2` | 05:32:54Z | 05:32:36Z | **−18 s** |
| `cb0949d8c` | 06:40:14Z | 06:40:12Z | **−2 s** |

Plus Session 8's eight deploys starting 99–141 s before their checks. **Ten observations
against, one for (by 2 s, inside the 1 s `uptime` resolution).** Working model: two unrelated
~2-minute pipelines in parallel, finishing together by coincidence. ⚠️ **Not confirmable from
the CLI** — `railway deployment list` carries no CI-hold field. It is a dashboard reading and
it is the last thing blocking the cutover.

#### 4. `breadth/fetch-shape` — **SHELVED**, not merged and not deleted

Branch `7a79cc9d3`, parity-proved, behind `BREADTH_OHLC_FETCH_RANGE` (default OFF).

**Why shelved:** it existed to avoid ~9,058 b-tree descents each costing a fault, and
**D-049's PRAGMA removed that cost instead** — `syscr` on a deep read fell 1,669 → 182. Its
own local number never justified it (1.19× warm at days=8000).

**Revival condition, stated so it is testable:** revive it only if H5 becomes the target
*and* a measurement shows a sequential range walk faults more efficiently than scattered
descents **against the flag-ON arm** — not against the OFF arm it was designed for. Absent
that measurement it is a second mechanism for a problem the first one has mostly solved.

#### 5. D-048 STANDS; the withdrawal of the Spearman claim is part of the record

A Session 9 draft claimed Spearman **+0.960** on `io_rchar` superseded D-048's two-phenomena
reading. **Withdrawn before use.** It does not replicate on Session 8 (+0.504), and the
reason kills the counter rather than the window: dividing block-device bytes by each sample's
own `rf_fetch` implies **3,942 / 2,432 / 2,393 / 2,255 MB/s** on four Session 8 samples. No
volume delivers 3.9 GB/s, so those bytes were another thread's — **`/proc/self/io` is
PROCESS-wide.** Window A's 0.960 was luck: its quiet samples read *exactly* 0.00 MB, so the
counter was nearly clean there and filthy in Session 8's.

⭐ Generalised into standing rule H.2: a process-wide counter is attributed to a request only
when the attribution passes a plausibility check; an impossible implied rate means another
thread's work is in the number.

#### 6. H5 confirmed by counting operations, not bytes

Per-read-syscall cost, `rf_fetch ÷ (syscr − the arm's own syscr floor)`:

| arm | slow sample | extra syscalls | `rf_fetch` | ms/syscall |
|---|---|---|---|---|
| OFF | i=3 | 8,883 | 5,304.1 | **0.597** |
| OFF | i=2 | 14,800 | 8,742.7 | **0.591** |
| ON | i=7 | 551 | 452.8 | **0.822** |
| ON | i=8 | 642 | 879.2 | **1.369** |

⭐ **The per-operation cost did not improve — the COUNT collapsed ~20×.** That is H5's model
(time = seek count × per-seek latency) with the flag attacking the first term only.
⚠️ The ON arm's higher per-op figure is a hypothesis, not a finding: two samples per arm.
**Residual, unexplained:** 11 of 20 settled cold reads need **zero** extra syscalls while the
rest need 551–642 — the eviction trigger is unidentified.

#### 7. The cap stays at 365, and the ~1 s bar is NOT established at p95

| | |
|---|---|
| samples over 1,000 ms | 1 of 20 |
| p90 | 842.0 ms interpolated / 986.2 nearest-rank — under 1 s either way |
| P(true p95 above the observed max) | **0.95²⁰ = 0.358** |
| n for the sample max to be a 95% upper bound on p95 | **59** |

⛔ **The bar is now limited by measurement opportunity, not by the reader.** Nothing about
the `/series` cap changes (D-046): the UI never requests more than 365, so lifting it exposes
nothing. **Record update, not a change.**

#### 8. P-B4 remains INCONCLUSIVE

The warm control moved (p50 20.1 → 16.0 ms) in Session 9's A/B. Three things say the warm
path itself is unchanged (identical `syscr` floor 79/79; identical `decoded_bytes` 69,979;
identical priming read 205 rows / 185,306 B), and the OFF arm's outliers carry ordinary I/O
counters, so they are event-loop contention. ⭐ **The design flaw was consecutive arms**,
which confound the flag with whatever else the single uvicorn process was doing.
**Interleaved arms at matched times of day is the fix**, and it needs a quiet period.

#### 9. Operational: measurement is not possible at the required n without a push pause

**37 master pushes in 10.5 h; median gap 723 s (12.1 min); minimum 152 s.** A window needs
~26 min; only **19%** of gaps are that long — roughly one window in five survives. Against
the n ≥ 59 that p95 requires, that is ~3 clean windows ≈ **15 attempts**.

### D-052 · Four conventions ratified, and the landing session (2026-09-15)

Session 12. A landing session: its own new work is small on purpose. No Railway settings
or variables. Owner rulings 0.1–0.5 recorded as standing conventions below.

#### 1. ⭐ The cheap-check convention (0.4) — CONVENTION FROM NOW

> **A cheap freshness check may only ever answer "definitely unchanged". Any other answer
> triggers the full rebuild — never a second cheap check.**

The evidence is three successive cache-invalidation designs for the resident copy, each
cheaper than the last, each wrong, and **one test caught all three**:

| # | design | what it checked | the write it missed |
|---|---|---|---|
| 1 | `PRAGMA data_version`, per-call connection | a version counter, 0.0034 ms | **every** write — measured, a fresh connection returned 2, 2, 2 across two external writes while a long-lived one returned 2, 3, 4. The pragma changes only for commits by *other* connections seen from a connection **already open** |
| 2 | `COUNT + 3×MAX` signature, 4.17 ms | row count and three watermarks | a rewrite **inside one second** with the same count and watermarks — `built_at` has second resolution |
| 3 | two-stage: version as pre-check, signature as **authority** | both of the above | the same second-resolution rewrite, reached differently: "version moved but signature unchanged ⇒ another table was written" kept stale rows in exactly the case the cleverness was for |

**The control:** `test_a_write_to_the_table_is_seen_by_the_next_read`. Every other rail —
absence when off, reuse when unchanged, byte-identity across three spans, the flag stamp,
the resident form — stayed **green** against all three broken versions, because **a cache
with broken invalidation returns rows correct in every respect except being current.**

**Shipped:** `data_version` alone on a **long-lived probe connection**. Unchanged ⇒ exact
(the pragma cannot miss a commit). Changed *or unknown* ⇒ rebuild (46 ms).
⚠️ Recorded honestly: the right answer was reached by **elimination**, not by design.

#### 2. The hot path is 8 files (0.3) — RATIFIED as the poolability reference

Measured by **execution**, not derived from imports: a tracer records every `api/` file
whose code runs during `GET /api/breadth-monitor?days=8000` on a forced miss.

```
api/main.py                       api/services/breadth_daily_ohlc.py
api/middleware/admin_guard.py     api/services/breadth_monitor.py
api/routers/breadth_monitor.py    api/services/breadth_timing.py
api/services/cache.py             api/services/single_flight.py
```

**Method:** `tools/breadth_hotpath.py`; `threading.settrace_all_threads` is required
because a plain `def` FastAPI route runs in the anyio **threadpool**. Regenerates
`docs/breadth/reader-hotpath.txt`.

⭐ **Why it matters:** the import closure reaches **169** files. Between M11 and Session
12's master, **14 more commits** landed changing **38 files and 0 under `api/`** — on top
of the 31 the day before. The pool survived all of them. On the import set it would have
shattered continuously and never reached the n = 59 that p95 needs.

⚠️ **Stated limit:** measured with `require_paid` overridden, so the auth chain is
excluded. Auth runs before the handler's own timer, so it cannot move the Server-Timing
phases — it can move client-side wall time.

#### 3. The resident copy holds strings (0.2) — RATIFIED; the 2× bound stands

| form | bytes | vs wire | bound | removes |
|---|---|---|---|---|
| **JSON strings** | **5,214,625** | **1.15×** | **passes** | `rf_fetch` |
| parsed dicts | 22,909,972 | 5.06× | fails | `rf_fetch` + `rf_materialise` |

The parse **is** `rf_materialise`. At p90 the split is `rf_fetch` **607.1 ms** against
`rf_materialise` **54.4 ms**, so the strings capture **~90% of the tail for 23% of the
memory**. Raising the bound is **declined for now**; revisit with sampler data on what the
string design leaves.

#### 4. Sampler load rules (0.1) — RATIFIED as the standing production-load rule

**Cap 60/day · cadence ≥ 35 s · outside 09:25–16:05 ET · settled pod only (uptime ≥ 600 s)
· kill-switch file honoured.** Same load as the manual windows, spread thinner, off-hours
only. ⛔ The clock comes from `zoneinfo`, never `TZ=` or local time.

#### 5. M12/M13 flip states (0.5)

M12 carries no flag. M13 lands with `BREADTH_RESIDENT_RECON_ENABLED` **OFF**. The flip
needs a sampler pool with **n ≥ 20 on the current SHA** first, as the *before* — so it is
not authorised, and flipping starts a **new** pool because `rf_resident` is a pooled flag.

#### 6. Repo safety: the `git add -A` incident has a mechanical answer, unwired

⚰️ A breadth commit swept two joystick docs in, silently replacing another programme's
deliberate raw `\x01` bytes. **The rule already existed** in
`lesson_uct_dashboard_shared_worktree`.

**Cause, measured:** `core.autocrlf=true` **and no `.gitattributes` entry for those paths**
(`git check-attr -a` returns nothing), so git sniffed a mostly-ASCII markdown file as text
and normalised it. This repo has met that failure twice before and fixed it the same way
(`*.woff2 binary`; the OCR corpus `-text`).

**Built:** `tools/git_scope.py` + `.git-scope/breadth-history-reader.json` + 8 rails,
mutation-proved, dogfooded on its own commit. ⭐ **An undeclared branch is not a
violation** — it enforces only scopes written down, which is what keeps it tolerable.
The override is explicit and **logged**, unlike `--no-verify`.

⛔ **NOT installed, and not proposed lightly:** the shared `core.hooksPath` already holds
another programme's `pre-commit` (credential scan) and `pre-push` (deploy guard), and
`app/src/hub/rule12Paths.test.js` is an existing scope mechanism for joystick. Proposal:
`docs/breadth/git-scope-hook-proposal.md`. Coordination is an OPEN QUESTION.

#### 7. Operational row for 2026-09-15

| | |
|---|---|
| deploys observed (11.0 h) | **20**, = 1.8/hour |
| gap min / median / longest | **23 s** / **925 s (15.4 min)** / **12,739 s (212 min)** |
| gaps ≥ 600 s (one settle) | **15 / 19** |
| gaps ≥ 45 min (a full landing sequence) | **3 / 19** |
| quiet window granted | **none** — the OWNER INPUT block was not filled in |

⭐ **A single settle is usually available; a 45-minute run is not.** That is the precise
shape of the constraint, and it is why the landing sequence runs as gaps allow rather than
in one sitting.

---

### D-053 · G1 answered by reading the configuration: Wait-for-CI is OFF, and a red gate has already shipped (2026-09-15)

Session 13, under SD-1. The Wait-for-CI reading has been carried as an owner step since
Session 10 on the assumption that it needed a browser. It did not.

#### 1. ⭐ The reading — `checkSuites: False`, on all six services

Railway's deploy trigger is a `DeploymentTrigger`, and the toggle the dashboard calls
*Wait for CI* is the `checkSuites` Boolean on it. Read from the Railway API with the CLI's
own token (the field name **introspected, never guessed** — asking for a field that does
not exist returns an error that reads exactly like "the setting is off"):

| service | repository | branch | `checkSuites` | `validCheckSuites` |
|---|---|---|---|---|
| web | unchartedterritory5995-cyber/UCT-Dashboard | `master` | **False** | 3 |
| worker · bars-api · chart-renderer · flow-worker · terminal-next-monitor | same | `master` | **False** | 3 |

⚠️ **Six services, not five.** `terminal-next-monitor` has joined the roster.

#### 2. ⛔ Two workflow files in the same directory assert opposite things

`master-deploy-gate.yml`'s header says *"Railway's 'Wait for CI' holds the build until the
run for that commit passes"*, and its failure message says *"Railway will not build this
commit."* `promote-production.yml`'s header says Wait-for-CI *"does not gate"* and gives
eight measured deploys that started 99–141 s before their check suite finished.

**The reading settles it: the promotion workflow's account is correct and the gate's
header is stale.** The gate serialises master pushes; it does not stop a deploy.

#### 3. ⚰️ The negative case already happened, naturally — no test needed to prove it

Across **59** `master deploy gate` runs there is exactly **one** failure: `beace00e0`,
2026-09-14T19:00:49Z. Railway created a `web` deployment for that same commit at
**2026-09-14T19:00:49Z — the same second**.

> **A red gate did not prevent a deploy. It has already happened once, in production,
> and nobody had to manufacture it.**

⭐ This is stronger evidence than SD-1's planned G5 push, and it cost nothing: it is an
observation of the system as it actually ran, not a fixture. G5 as written still has a
job — it must show the negative case holds **after** the cutover — but the *pre*-cutover
half is now measured rather than assumed.

#### 4. ⚠️ OPEN QUESTION — the promotion gates the TIP, not every commit behind it

`beace00e0` is an ancestor of `origin/production` today. It got there as a **passenger**:
the first successful promotion carrying it was `57e5131a3` at 2026-09-15T00:24:41Z. A
fast-forward advances `production` over every intermediate commit, including ones whose
gate was red.

This matters because one gating check is **per-commit by construction** —
`master deploy gate`'s secret scan reads `git diff HEAD^ HEAD`. So `beace00e0`'s changed
files were never scanned by a run that gated a deploy, and after the cutover they still
would not be.

⭐ `promote-production.yml` already reasons about exactly this shape for the *cancellation*
case and sets `cancel-in-progress: false` because of it. The red-gate case is the same
hazard by a different route, and is not yet covered. **Proposal only, not authorised:**
refuse promotion when any commit in `production..candidate` has a failed gate run.

#### 5. What this does to the cutover

| runbook step | state now |
|---|---|
| Wait-for-CI → OFF | **already true** — nothing to turn off |
| `production` branch exists | **already true** — `origin/production` == `origin/master` == `79b4b2907` |
| promotion advancing it | **already true** — 41 runs, 40 success |
| watched branch → `production` | ⛔ **the one remaining change** |

The observation window the cutover checklist asked for is therefore **already running**:
`production` advances only on a green gate, and no service watches it yet.

#### 6. The G2 stop condition, measured without running the probe

Environment-level shared variables in `production`: **0**. Control: the same query with
`serviceId=web` returns **248**, so the query can see variables and the zero is a
measurement, not a broken call. **A new service inherits no shared variables, so G2's
stop condition cannot fire.**

⚠️ G2 is still `OWNER-PENDING` — SD-1 conditions it on a browser path that does not exist
on this box (below). Whether it can now be reduced or skipped is an OPEN QUESTION.

#### 7. Why the browser route failed, measured rather than assumed

The Chrome profile on this box is **not authenticated to Railway**: the project settings
URL returns *"Login / 404"*. Separately, the window reports a **0×0 viewport**, so no
screenshot or accessibility read is possible at all. Either fact alone makes the
browser-authorised G items owner-pending; authenticating is not something an agent does.

⭐ **The API route answered G1 anyway.** The question was a property of the service, and
the service can be asked directly. ⛔ Cloudflare answers a default urllib UA with
`403 error code: 1010`, which reads exactly like a bad token — a browser User-Agent is
required, and that is a repo-wide trap, not a detail of this query.

---

### D-054 · There is no market-hours window on this repo — the clause was never the owner's (2026-09-15)

Session 13, SD-1.1 A0. **Owner ruling, verbatim: "we no longer have mid day blocks ever."**

#### 1. ⚰️ What happened

SD-1 carried an "outside 09:25–16:05 ET" push-and-sample condition in **six** places
(§2, §2 V3, §2 E-neg, §4.1, §6, §1 R2) and in Session 12's prompt. It was **re-inserted
from stale context by the guiding chat** — it was not this owner's rule and had already
been retired.

The cost was not an outage. It was **two sessions of waiting for a window that does not
exist**: the landing script sat idle from 13:26 ET holding M14, M12 and M13, and Session
13 opened by declaring itself a build-and-record session *because of a constraint that
was imaginary*.

⭐ **The instructive part is that every instrument was working.** The script logged its
refusals honestly, the checklist recorded the block accurately, and the report stated it
plainly at the top. Nothing malfunctioned. **A false premise, faithfully obeyed and
faithfully recorded, produces a perfect audit trail of the wrong behaviour** — which is
why it survived three sessions without anyone noticing.

#### 2. What was removed

| Where | What | Done |
|---|---|---|
| the landing script | the window wait **and** the 09-16 09:25 deadline | killed 15:52:18 ET, relaunched clockless 15:54:22 ET |
| `tools/breadth_sampler.py` | the `inside_guard_window` refusal, its constants, and the policy-list entry | deleted |
| `tests/test_breadth_sampler.py` | the window rail | ⛔ **deleted, not inverted** |
| `PROGRAMME-CHECKLIST.md` | 4 governing lines incl. the STANDING FACTS row | rewritten |
| `FINAL.md` (draft) | "lands at the window" | rewritten |
| session 12 & 13 reports | a banner; the one line that *governed* corrected in place | history kept |

⛔ **The rail was DELETED, NOT INVERTED.** An inverted rail — "the clock must not refuse"
— pins the *absence* of a rule as though the absence were itself policy, and the next
reader would reasonably infer a clock had once been correct there. Its replacement sweeps
all 24 hours and asserts that no hour refuses and no refusal reason mentions a clock, and
the constants rail now asserts `WINDOW_OPEN`/`WINDOW_CLOSE` **do not exist**, so
reintroducing a window breaks a rail rather than passing quietly.

#### 3. ⭐ What the sweep had to NOT delete

Grepping `RTH|market hours|window` across the programme's files returns hits in
`00-discovery.md`, `01-audit.md` and `02-design.md` — and those are the **product's**
market-session behaviour (live polling in RTH, the `LIVE 2:47 PM ET` reading line), not
push policy. `gates.md` and the cutover runbook mention the pre-push guard's **settle**
check, which is a different guard entirely. `FINAL.md`'s "the window is 0×0" is a browser
viewport.

> **A blind grep-and-delete would have corrupted three design documents and removed a
> live safety check.** The sweep classified every hit; it did not pattern-match one.

#### 4. ⚠️ A0.4 — the shared guard still carries the clause, and this programme must not edit it

`tools/pre_push_guard.py` enforces the window itself:

| | |
|---|---|
| lines **430–431** | `RTH_GUARD_OPEN = (9, 25)` · `RTH_GUARD_CLOSE = (16, 5)` |
| decision | ~**566–572**: inside the window on a trading day, only Tier-1 paths pass |
| escape | `UCT_DEPLOY_WINDOW_OVERRIDE=I-ACCEPT-AN-RTH-RESTART` |
| exemption | `CLEARED_PREFIXES = ("docs/", "tests/", "tools/", "scripts/", "app/")` (line 453) |

⛔ **Not edited here — it is shared, and SD-1.1 A0.4 forbids it.** ⚠️ And it is not a
stray constant: its own comment says it is **derived verbatim from
`docs/runbooks/deploy-windows.md` lines 13–14**, so the owner-side change is *two* files,
and the runbook is the authority that has to move first.

⭐ **Consequence, measured rather than assumed:** because `.gitattributes` matches no
cleared prefix, `repo/git-scope` is refused inside the window — while M14 (docs) and M12
(tools/tests/docs) are **Tier-1 cleared and could push at any hour**. So the guard was
never blocking two of the three reader landings; only the belief was.

#### 5. Appendix #43 — the false instrument was a sentence

A prompt is an instrument. This one reported a constraint that did not exist, and it was
obeyed exactly. ⛔ **The class: an instrument made of prose has no self-check, cannot be
mutation-proved, and produces no anomaly when it is wrong** — the readings it yields look
exactly like readings from a true constraint. Every other false instrument this programme
has recorded (#15, #24, #28–#39) announced itself eventually through a number that would
not reconcile. This one could not, because there was no number.

⭐ **The only defence is the one that applied everywhere else and was not applied here:
ask the configuration.** `tools/pre_push_guard.py` is the authority on push timing and is
readable in one command. Three sessions cited the window; none read the guard. The same
session that read `checkSuites` from the Railway API to answer G1 — after three sessions
of assuming it needed a browser — had the window sitting unexamined in its own prompt.

#### 6. ⚠️ CORRECTION TO §4, MEASURED 16:15 ET THE SAME DAY — the guard has THREE clauses, and the clock is not the one that blocks

§4 above reported the pre-push guard's clock and named it as the owner-side change. The
first real landing attempt under SD-1.1 printed all three checks, and the clock **passed**:

```
[pre-push] 2026-09-15 16:15:24 ET is outside the 09:25-16:05 ET deploy window — safe to restart web.
[pre-push] web is SUCCESS on 57113d1ac, 629s settled — safe to push.
[pre-push] 3 distinct web deploys in the last 60 min (57113d1ac, db5591c63, 3a57e3a09) — master is
           under concurrent development and a build may be in flight from a session that cannot see this one
[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.
```

| clause | constant | verdict on the first attempt |
|---|---|---|
| **clock** | `RTH_GUARD_OPEN/CLOSE` | ✅ **passed** — and is the clause the owner retired |
| **recency** | `RECENT_PUSH_WINDOW_SECONDS = 600` | ✅ passed at 629 s |
| **burst** | `BURST_WINDOW_SECONDS = 3600`, ≥ 3 distinct commits | ⛔ **REFUSED** |

⭐ **THE REFUSAL IS CORRECT AND THE CLAUSE SHOULD NOT BE TOUCHED.** Its own comment says
why: *"Three distinct commits inside an hour is not one person working — it is concurrent
development… THIS CLAUSE ENCODES THE JUDGEMENT A SESSION COULD NOT MAKE FOR ITSELF. D-05
reported that the missing precondition was 'a human who can see all four workstreams'; the
deployment list IS that view, and nothing was reading it."*

⭐⭐ **AND IT RECONCILES SESSION 12's "QUIET WINDOW" REQUEST WITH SD-1.1's RULING.** Session
12 asked for a quiet window and Session 13 was told the window did not exist. Both are
right: there is **no clock**, but there **is** a real, measured precondition called quiet —
enforced by rate rather than by hour, and by a rule that reads the deployment list instead
of asking every session to cooperate. The *need* was never imaginary; only the mechanism
was.

⚠️ **The live consequence, and it is a livelock risk, not a wait.** The three deploys landed
at 15:31:11, 15:53:45 and 16:04:56 ET — one joystick push roughly every 15–20 minutes. The
clause clears at **16:31:11 ET** only if nothing else lands; **every new master deploy from
any workstream slides it forward**. The landing script logs each refusal by SHA and retries
every 90 s, which is the right behaviour: the refusals ARE the operational record.

⛔ **A0.4's owner-side item is therefore narrower than §4 stated.** Only the clock clause
(and its two lines in `docs/runbooks/deploy-windows.md`) is dead by the owner's ruling. The
recency and burst clauses are live, correct, and are what actually serialise this repo.
