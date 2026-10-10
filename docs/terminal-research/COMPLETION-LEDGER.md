---
id: COMPLETION-LEDGER
title: Is the UCT Terminal vision complete? One row per item, one state per row
role: The single "is the vision complete" checklist for TERMINAL-NEXT. Every TERM, FT, BRK and COV
  row, every D- promise, and every untracked promise from the 2026-10-02 full-scope audit.
as_of: master @ d95f331bb (2026-10-09), reconciled 2026-10-10 (was integrate/terminal-fixes @ 00ed982ea8, 2026-10-03)
status: living — update a row's state in the same commit that changes it
---

# Completion ledger — UCT Terminal (TERMINAL-NEXT)

**The answer today (branch f-l1 from master `11fa16167`, 2026-10-10): not complete.** 217 of 279 rows are `live` or `moot`; 62 are not (13 `dark`, 41 `building`, 8 `owner-blocked`). It is complete when every row below is `live` or `moot`.
The counts are in §0, and they are derived from this file by the command shown there, never typed.

## How to read this

- **One row per item, and exactly one state per row.** The vocabulary is fixed:

| state | meaning |
|---|---|
| `live` | Built, reachable, the gate armed (or ungated), **and on master**. Members can use it today. |
| `dark` | Built and reachable once switched on, but the flag is `pending`/`dark` **or** the code is only on `integrate/terminal-fixes` (branch-only). The note names the flag and what arming needs. Under D-009 (ship when green) the step left is arming, not building. |
| `building (lane)` | An agent-buildable remainder exists, and the named lane owns it. Lanes T1–T4, O, S, R and P are the audit's (§2 of the scope audit). D is this records lane. "Integrator" is the merging session. "Notebook" is that workstream. |
| `owner-blocked (what)` | Nothing an agent can do moves it. The note names the **exact** owner or vendor action. |
| `moot (why)` | Superseded, duplicated elsewhere, or excluded by a recorded ruling. The note cites it. |

- **`partial` is not a state here.** A partly built row is classified by its remainder: `building` if the remainder is agent-buildable, `owner-blocked` if it is not. Whatever is built shows in the note.
- **Sources of truth.** For code: master at `d95f331bb`, re-read 2026-10-10 by the reconciliation pass (every changed row cites a file:line or a commit). For flags: `docs/feature_flags.json` on master, plus the live reads recorded in `12-decisions/2026-10-07-owner-delegated-decisions.md` §8 (A4/A5) where that ledger lags them, plus the terminal codes and options gates verified on the live site 2026-10-09/10. For rulings: `00-program-control/OWNER_DECISIONS.md` D-005..D-014 and the 2026-10-07 delegated decisions with the owner's 2026-10-08 answers (§8b there). (Before 2026-10-10 the code source was the branch at `00ed982ea8`.)
- **Branch-only means not in production**, whatever its flag says. Since the X-01 landing (`2e304db42`, 2026-10-04) no lane named in this file is ahead of master, so no row is branch-only today.

## 0. Counts (derived)

```
python -X utf8 -c "import re,collections;t=open('docs/terminal-research/COMPLETION-LEDGER.md',encoding='utf-8').read();rows=re.findall(r'^\| `([A-Z][A-Za-z0-9./-]*)` \| [^|]* \| `(live|dark|building|owner-blocked|moot)',t,re.M);print(len(rows),collections.Counter(s for _,s in rows));print(len(rows)-len({i for i,_ in rows}),'duplicate ids')"
```

Printed 2026-10-10 on branch f-l1 (from master `11fa16167`), after lane f-l1's edits to X-03, X-04, X-05, X-14, RM-X02 and FB-A3:

```
279 Counter({'live': 177, 'building': 41, 'moot': 40, 'dark': 13, 'owner-blocked': 8})
0 duplicate ids
```

Before this reconciliation (same command, the file as committed at `d95f331bb`): `279 Counter({'building': 85, 'live': 77, 'dark': 69, 'moot': 36, 'owner-blocked': 12})`, 0 duplicate ids. (The table that stood here then still carried the pre-sweep 2026-10-03 numbers; the command, not the table, was right.)

The per-section split is the same regex applied to each `## ` section:

| section | rows | live | dark | building | owner-blocked | moot |
|---|---|---|---|---|---|---|
| 1 Programme records + ship | 17 | 9 | 0 | 5 | 0 | 3 |
| 2 Open owner decisions | 9 | 0 | 0 | 0 | 0 | 9 |
| 3 TERM-001..093 | 93 | 65 | 6 | 13 | 3 | 6 |
| 4 BRK-01..10 | 10 | 4 | 2 | 3 | 0 | 1 |
| 5 COV-01..12 | 12 | 5 | 0 | 3 | 1 | 3 |
| 6 FT-001..080 | 80 | 56 | 2 | 9 | 4 | 9 |
| 7 Untracked promises | 58 | 38 | 4 | 7 | 0 | 9 |
| **total** | **279** | **177** | **13** | **41** | **8** | **40** |

`building` by lane: P 11 · O 8 · R 5 · integrator 4 · D 1 · T1 3 · S 2 · Notebook 2 · T4 2 · T2 1 · decided follow-up builds (TERM-043, TERM-045) 2.

⛔ **These counts go stale the moment a row changes.** Re-run the command and replace the table in the same commit; never edit a number by hand (ADR-0002).
⚠️ **`live` rows are not all member features.** X-01 is the merge itself; X-06..X-08 and X-16 are records; X-09 is an env arming. Every TERM/FT/BRK/COV/D/V `live` row is on master with its gate armed or ungated.

## 1. Programme records and the ship campaign

| id | item | state | note |
|---|---|---|---|
| `X-01` | Merge `integrate/terminal-fixes` to master (77 ahead / 28 behind) | `live` | Landed 2026-10-04: `2e304db42` merge(terminal) X-01. `origin/integrate/terminal-fixes`, `lane/p-platform`, `lane/r-research-depth` and `lane/d-records` are each 0 commits ahead of master (`git rev-list --count HEAD..origin/<lane>` at `d95f331bb`), so no row below is branch-only any more. Was `building (integrator)`. |
| `X-02` | `TERMINAL_NEXT_ENABLED`: the `/terminal` shell + the `/calendar` redirect | `live` | `TERMINAL_NEXT_ENABLED` armed on web (`docs/feature_flags.json:2415`, recorded `4084cd903`). The nav entry graduated to `/terminal` (`c941080f0`, I-11 `12-decisions/2026-10-07-owner-delegated-decisions.md:39`; `app/src/components/NavBar.jsx:27`) and `/terminal` is measured viewport-locked (`18676e3ec`). V1 is fixed (row V1). Was `dark`. |
| `X-03` | Charter §49 #18: first vertical slice (`10-roadmap/first-slice.md`) | `live` | Done 2026-10-10 by lane f-l1: `10-roadmap/first-slice.md`, written retrospectively since the terminal had shipped. Its slice is `e5f189c56` (the `/terminal` shell, 2026-10-02), on master via `2e304db42`; every Part CCXLIII field cites a commit or a `file:line`. Roadmap RM-N16. Was `building (Lane D)`. |
| `X-04` | Charter §49 #24: master plan (`13-executive-synthesis/MASTER_PLAN.md`) | `live` | Done 2026-10-10 by lane f-l1: `13-executive-synthesis/MASTER_PLAN.md`, the 42 Part CC sections each with a five-line summary, plus D-005..D-014 and the later rulings (Part A) and this ledger's state (Part B). Roadmap RM-N17. Was `building (Lane D)`. |
| `X-05` | Charter §49 #26: readiness test | `building (Lane D)` | Input X-04 now exists; the run is recorded in `00-program-control/readiness-test.md`. |
| `X-06` | Record the 2026-10-02 owner rulings | `live` | Done here: D-005..D-014, DL-026..DL-037. |
| `X-07` | Retract or annotate NG-10, NG-04/05, NG-15 | `live` | Done here: `05-product-strategy/non-goals.md`. |
| `X-08` | COV-09 naming conflict | `live` | Resolved by DL-036: COV-09 is the SEC filings feed, congressional trackers are COV-12. |
| `X-09` | `OPTIONS_UNIVERSE_LOG_ENABLED` armed on terminal-next-monitor | `live` | Measured 2026-10-03 02:39Z (key names only): flag=1, `MASSIVE_API_KEY` + `DATA_SYNC_*` present. ⚠️ The first run's receipt and its `complete:true` manifest: not measured. Massive sells no chain history, so every session before arming is lost. The front-straddle summary columns BRK-10 reads (`f92239a2d9`) are on master since X-01 (`2e304db42`); whether terminal-next-monitor has redeployed with them: not measured. The full contracts file is stored, so `resummarize()` can backfill earlier nights. |
| `X-10` | Reconcile `CLAUDE.md`'s 3-agent cap with D-013 (cap 6) | `building (integrator)` | `CLAUDE.md:1927`, `:2263`. A records lane does not edit `CLAUDE.md`. Re-checked at `d95f331bb`: `CLAUDE.md:1937` still reads "MAXIMUM 3 AGENTS PLUS THE INTEGRATOR". |
| `X-11` | Five terminal-grade properties re-walked **on `/terminal`** | `building (Lane T1)` | The 2026-09-24 "5/5 PASS" ran on `/charts` and `/screener`, not the shell. The V22 throwing-panel rail now exists (`app/src/pages/terminal/TerminalShell.test.jsx:291`); the five-property walk on `/terminal` itself: not measured. This is V22 below. |
| `X-12` | `/calendar` retirement (RM-L16, CX-8) | `moot (decided 2026-10-07: /calendar coexists permanently as a URL)` | D-006 places the calendar inside the Terminal but does not choose. If retire: MG-7 at 0 GAP, nav graduation, MG-8 re-census, then the countdown. ➜ 2026-10-07: P-9 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `X-13` | MG-8 consumer re-census at countdown | `moot (no countdown; X-12 decided)` | The live instance is fixed (`api/services/journal_two/db.py:2302-2309`). The gate is unrun because no countdown has started. ➜ 2026-10-07: P-10 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `X-14` | RM-N05 MVP trial (subject Ravi, adjudicator Patrick) | `moot (owner waived the Ravi trial 2026-10-10)` | Owner ruling 2026-10-10, verbatim: "no need to wait for ravi on anything we can proceed fully with all of those" (`12-decisions/2026-10-07-owner-delegated-decisions.md:213-221`). It supersedes P-11 and C2. Pre-registered 2026-09-30, never started. Was `owner-blocked (Ravi records Phase A: 5 trading days or 10 occasions)`. |
| `X-15` | RM-N10 bars p95, clause 2 | `building (Lane P)` | Instrument fixed (`tools/bars_warmth_gate.py:115` `MIN_NOWAIT_N`). Needs one valid RTH run with n ≥ `MIN_NOWAIT_N`. No valid run recorded since 2026-10-03: not measured. |
| `X-16` | Ledger hygiene: `IMPLIED_ENRICHMENT_CUTOVER`, `D5_CP4_DUAL_COMPUTE_SAMPLE_RATE`, `WIRE_SURFACE_LINE_ENABLED` | `live` | Done: the `knobs` section of `docs/feature_flags.json` holds all three on master (`docs/feature_flags.json:2974` `IMPLIED_ENRICHMENT_CUTOVER` pending, `docs/feature_flags.json:2982` `D5_CP4_DUAL_COMPUTE_SAMPLE_RATE` armed, `docs/feature_flags.json:2990` `WIRE_SURFACE_LINE_ENABLED` dark), landed by `e82e6a661` on master via the X-01 landing `2e304db42`; rail `tests/test_flag_ledger_knobs.py`. Flipping `IMPLIED_ENRICHMENT_CUTOVER` is a separate owner call, not this hygiene row. Was `dark` (branch-only). |
| `X-17` | Settings "Free Plan" copy contradicts D-010 (U-COPY-01) | `building (Lane P)` | `app/src/pages/Settings.jsx:2042-2046` still renders "Free Plan" and lists free-tier pages at `d95f331bb`. Product copy, not this lane. |

## 2. Owner decisions still open

| id | item | state | note |
|---|---|---|---|
| `OD-D-001` | D-001 desk-first vs member-first | `moot (decided 2026-10-07: members first)` | Stale "Pending". OI-07 calls it ruled, and D-007/D-010 imply a member product. ➜ 2026-10-07: P-1 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `OD-D-002` | D-002 licensing exposure | `moot (closed by D-011, 2026-10-02)` | ADR-0015 holds; a new source still gets its own read. |
| `OD-D-003` | D-003 decisiveness posture (one shape vs desk/stranger) | `moot (decided 2026-10-07: one decisive shape for everyone, with its receipt)` | Renderer accepts a `posture` value either way. ➜ 2026-10-07: P-2 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `OD-SEAT` | Seat model (CARD 23 vs CARD 25 disagree) | `moot (decided 2026-10-07: one person per subscription)` | ➜ 2026-10-07: P-3; owner action C3 (one Terms sentence) (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `OD-OI04` | OI-04: are Bullflow, UW, Polygon-direct and TheFly still paid? | `moot (answered 2026-10-08: Bullflow, Unusual Whales and TheFly are not paid; Massive stays)` | C1 answer, `12-decisions/2026-10-07-owner-delegated-decisions.md:188`, recorded `99ee519b7`. Nothing to cancel. Was `owner-blocked`. |
| `OD-NEWS` | News feed (P-δ) and market-intelligence feed (U15): curated vs browsable | `moot (decided 2026-10-07: curated first, browsable one click away)` | ➜ 2026-10-07: P-5 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `OD-U16` | Desktop wrapper, plugins, scripting, marketplace (U16) | `moot (decided 2026-10-07: out of scope this programme)` | Explore-only; there is no ruling. ➜ 2026-10-07: P-6 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `OD-CORP` | Corp-actions D5 producer job vs the CARD 5 exclusion (`10-roadmap/backlog.md:2032`) | `moot (decided 2026-10-07: CARD 5 exclusion kept)` | Buildable once the exclusion is lifted. ➜ 2026-10-07: P-7 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `OD-FIGI` | Entity OpenFIGI fallback | `moot (decided 2026-10-07: declined)` | ➜ 2026-10-07: P-8 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |

## 3. Backlog — TERM-001..TERM-093

| id | item | state | note |
|---|---|---|---|
| `TERM-001` | Board-size bound (16) | `live` | `app/src/pages/charts/boardBound.js:21` (`MAX_BOARD_WIDGETS`), on master via the X-01 landing `2e304db42`; re-affirmed T-1 (`12-decisions/2026-10-07-owner-delegated-decisions.md:46`). Ungated. Was `dark` (branch-only). |
| `TERM-002` | Second OPRA connection | `live (purchased 2026-10-04)` | Licensing settled by D-011. ➜ 2026-10-07: I-9 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `TERM-003` | Confluence Radar extend/delete | `moot (ships as Options Flow tab 8; ledger G9 corrected 2026-09-27)` | `app/src/pages/OptionsFlow.jsx:114`. |
| `TERM-004` | One earnings-date authority | `dark` | OQ-14 decided 2026-10-02 (`555457ae33`, on master): `GET /api/calendar` is the authority. TERM-004b is built in the engine repo (uct-intelligence): adapter `uct_intelligence/dashboard_calendar.py` + `api.py::get_catalyst_calendar_context` behind `ENGINE_EARNINGS_SOURCE` = `fmp` (default, byte-identical) / `shadow` / `dashboard` (`8145f55`, `33b9148`, merged to its master `043faec`). Parity measurement `uct_intelligence/earnings_parity.py` + `scripts/earnings_parity_measure.py` (read-only: `mode=ro` DB, temp copy) and `tests/test_earnings_parity_term004b.py` on branch `term-004b` `7b9a95c` (not pushed): fixture at the measured 31% (4/13 disagree before, 3/13 de-staled, **0/13 in dashboard mode**). No dashboard change: `/api/calendar` stays anonymous (`tests/test_open_reads_gate.py:297`). Arming = set `ENGINE_EARNINGS_SOURCE=shadow`, then `dashboard`, on the engine host (the brain's 5 daily runs); live agreement is measured there with the script, because this PC has no engine DB. Not conformed, by scope (they change candidate selection, so owner sign-off first): `scripts/scanner_candidates.py::_fetch_earnings_risk`, `scripts/premarket_scanner.py:118`, `uct_intelligence/screener.py:403` still read FMP forward rows. Live note 2026-10-10: cold range weeks of `/api/calendar` exceeded the adapter's 4 s timeout on first read (warm on retry), which sends a dashboard-mode run to its FMP fallback. |
| `TERM-005` | Second screener universe | `moot (decided 2026-10-07: no purchase)` | ➜ 2026-10-07: I-10 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `TERM-006` | Freshness authority in time units | `live` | `app/src/components/provenance/freshnessAge.js:285`, on master via the X-01 landing `2e304db42`; the terminal's panel freshness badges read it (V8, `f26bbee7d`). Was `dark` (branch-only). |
| `TERM-007` | Quiet measurement window | `building (Lane P)` | Window fixed under delegation: Wed 2026-10-14 09:00–11:00 ET, then every Wednesday (B1, `12-decisions/2026-10-07-owner-delegated-decisions.md:200`, recorded `99ee519b7`); the owner is not asked to post it. Remainder: take the reading inside that window (not yet held on 2026-10-10). Was `owner-blocked`. |
| `TERM-008` | Cloudflare rule / cache key | `owner-blocked (a read with Cloudflare credentials)` | The authenticated `/api/flow/data` read is agent-doable with the smoke account; the rule read is not. ➜ 2026-10-07: decided: read it, then Browser Cache TTL → Respect Existing Headers. T-5; owner action B2 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) Re-checked: no answer to B2 in the 2026-10-08 owner answers (`12-decisions/2026-10-07-owner-delegated-decisions.md:186`). |
| `TERM-009` | Community call record | `live` | `api/services/community_call_record.py:33`. |
| `TERM-010` | First run = UCT Default | `live` | `app/src/pages/charts/ChartsWorkspace.jsx:2216`. |
| `TERM-011` | Ops channel split | `moot (decided 2026-10-08: no #uct-ops channel; ops alerts use the DISCORD_WEBHOOK_URL fallback)` | B3 answer, `12-decisions/2026-10-07-owner-delegated-decisions.md:202`, recorded `99ee519b7`. Steps 1–7 stay on master, inert (`api/services/alert_routing.py:114`); the fallback is now the decided steady state, so step 8 (fallback = 0) no longer applies. Was `dark`. |
| `TERM-012` | p95 gate measurable | `live` | `tools/bars_warmth_audit.py:73`. |
| `TERM-013` | Drop-counter reader | `dark` | On master (`api/services/bars_rail_monitor.py:88`); `BARS_RAIL_PAGE_ENABLED` still `dark` (`docs/feature_flags.json:640`). Decided: arm on web (I-3, `12-decisions/2026-10-07-owner-delegated-decisions.md:31`), the integrator's step, not yet recorded as armed. |
| `TERM-014` | RSS slope + memory attribution | `dark` | On master (`api/services/rss_series.py`, `tools/rss_slope_report.py`; `e82e6a661` on master via the X-01 landing `2e304db42`). `RSS_SERIES_ENABLED` still `pending` (`docs/feature_flags.json:72`). Decided: arm on web + terminal-next-monitor (I-2, `12-decisions/2026-10-07-owner-delegated-decisions.md:30`), the integrator's step. The slope READING needs the 2026-10-14 window (TERM-007). |
| `TERM-015` | Cadence heartbeat roll-up | `live` | `api/terminal_next_monitor_main.py:208`. |
| `TERM-016` | Durable alert cooldowns | `live` | `api/services/chart_health_alerts.py:130`. |
| `TERM-017` | Loop-lag distribution | `building (Lane P)` | Histogram built (`api/event_loop_watchdog.py:221`). Read `lag_histogram` inside the 2026-10-14 09:00–11:00 ET window fixed by B1 (`12-decisions/2026-10-07-owner-delegated-decisions.md:200`); an agent step after the window (`12-decisions/2026-10-07-owner-delegated-decisions.md:160`). Was `owner-blocked`. |
| `TERM-018` | Every guard can fire | `building (Lane P)` | CI live (`.github/workflows/term018-guards.yml`). `12-decisions/gates/term-018-guard-observations.json`: 12 `observed`, 20 `declared_unobserved` (was 22). Observing the 20 is the remainder. |
| `TERM-019` | Provenance set + adoption rail | `live` | `app/src/components/provenance/panelAdoption.ratchet.test.js`; adoption is a shrink-only ratchet. |
| `TERM-020` | Canonical resolver (CP3) | `live` | `api/services/canonical/resolver.py:453`; caller `api/routers/breadth_monitor.py:1061`. |
| `TERM-021` | Versioned workspace document | `live` | `api/services/workspace_doc_store.py:231`. |
| `TERM-022` | Massive adapter + retirement queue | `live` | `api/services/massive_adapter.py:63`. Partner-file ack is moot (fully open since 9/29). |
| `TERM-023` | Entity master member path | `live` | `api/services/entity_master/member_resolve.py:50`; armed 10-02 (this branch's ledger). |
| `TERM-024` | Panel declares a need | `live` | `app/src/lib/panelContract.js:126`. |
| `TERM-025` | Seven more trigger types | `owner-blocked (set each type's flip when its shadow log meets ADR-0036 over ≥10 sessions)` | 8/8 registered (`api/services/alert_taxonomy/registry.py:16`). ➜ 2026-10-07: T-11; owner action A8 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `TERM-026` | Auditor denominator | `live` | `api/auth_surface_check.py:393`. |
| `TERM-027` | Header inside error boundary | `live` | `app/src/pages/charts/WidgetHost.jsx:315`. |
| `TERM-028` | Honest blank for futures | `moot (futures removed 2026-07-27; BTC/VIX on yfinance is D-004)` | |
| `TERM-029` | GEX assumption label | `live` | `app/src/pages/OptionsFlow.jsx:4510`. |
| `TERM-030` | Calendar reader schema assertion | `live` | `api/services/calendar_week_contract.py:107`. |
| `TERM-031` | Derived Fed-speaker list | `live` | `api/routers/calendar.py:2370`. |
| `TERM-032` | "coverage n=0" for transcripts | `moot (RG-15 refuted, RG-15a)` | |
| `TERM-033` | `.catch(()=>null)` migration | `building (Lane P)` | Census rail live; `app/src/lib/swallowedFetch.baseline.json:18` reads `total: 37` (was 77 on 2026-10-03; drained by `383825c00`, `d30317b78` and others). Draining the 37 is the remainder. |
| `TERM-034` | I1 spec as rails | `live` | `app/src/pages/research/i1S8Boundary.test.js:562`. |
| `TERM-035` | Market clock as code | `live` | `app/src/lib/marketClock/marketClock.js:194`. The L0 strip is V7, not this. |
| `TERM-036` | Dividends onto Massive | `live` | `api/services/reference_corp_actions.py:62`. |
| `TERM-037` | Panel set from surfaces | `live` | The shell consumes it: `app/src/pages/terminal/surfacePanels.js:16` imports `SURFACE_PANELS`, so the 2026-10-03 "inert, parked" note was stale (`10-roadmap/backlog-status-2026-10-06.md:84`). V13 is the same work. Was `building (Lane T1)`. |
| `TERM-038` | Published address space | `live` | `ADDRESS_SPACE_ENABLED` armed; 8 kinds (`api/services/address_space.py:141-170`). |
| `TERM-039` | Feature status at point of use | `live` | `api/services/feature_status.py:118`. |
| `TERM-040` | Warm cold-pack shards | `moot (no server cache; shared-stall diagnosis instead)` | |
| `TERM-041` | Published regime vocabulary | `live` | `api/routers/regime.py:73`. |
| `TERM-042` | Re-source the EOD breadth row | `owner-blocked (set BREADTH_EOD_SOURCE=server when parity.switch.ready — the bar is 10 clean sessions)` | Armed in `shadow` (`api/services/breadth_eod_source.py:102`). ➜ 2026-10-07: T-12, built `6d2e692bd`; owner action A7 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `TERM-043` | Figure-to-source-page link | `building (decided 2026-10-07: link only, from the PIT store; follow-up build)` | `FUNDAMENTALS_PIT_ENABLED` is armed, so the "dark store" premise is stale. ➜ 2026-10-07: T-13 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) Not built at `d95f331bb` (no accession link in the fundamentals services, grep). |
| `TERM-044` | Span-anchored recap citation | `live` | `app/src/components/calendar/CallRecapSection.jsx:202`. |
| `TERM-045` | EDGAR Form 4 / 13F | `building (decided 2026-10-07: 13F join via the SEC Official List of Section 13(f) Securities; no purchase)` | Form 4 live (`api/routers/research.py:267`). ➜ 2026-10-07: T-14 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) Not built at `d95f331bb` (no reader of the SEC 13(f) list under `api/services`, grep). |
| `TERM-046` | Short-interest history | `live` | `SHORT_INTEREST_SOURCE=finviz` armed (`api/services/short_interest.py:99`). |
| `TERM-047` | CoverageLine on result surfaces | `building (Lane S)` | `lane/s2-finish` merged dark (`9e69eddd9`, 2026-10-07): receipts on scans, the six preset scans, volume-scan and `/api/screener/scan`, behind `COVERAGE_RECEIPTS_SCANS_ENABLED` (pending, `docs/feature_flags.json:1936`). Remainder: retire the `CoverageLine` shim (dropped from that merge: it needs an edit to `components/chart/builder/EvidenceTab.jsx`), then arm. |
| `TERM-048` | Watchlist alerts onto S7 | `live` | `api/services/alert_taxonomy/watchlist_price_alerts.py:80`. |
| `TERM-049` | Per-ticker history join | `live` | `api/services/ticker_history.py:43`; LANES2 armed 10-02. |
| `TERM-050` | One provenance renderer | `building (Notebook)` | Notebook Ask still imports `documentProvenance` (`app/src/pages/journal-2-0/components/notebook/AskPanel.jsx:17`). The terminal's Ask-AI doors are on the I1/S8 rail (`cb8fa7e0c`). |
| `TERM-051` | Workspace version history restore | `live` | `app/src/pages/charts/ChartsWorkspace.jsx:2461`. |
| `TERM-052` | Three personalization publications | `live` | `app/src/components/chart/chartCeilings.js`. |
| `TERM-053` | Close six dependency-less routes | `live` | `api/open_reads_gate.py:480`. |
| `TERM-054` | Emit `id:` on streams | `live` | `api/routers/stream.py:91`. |
| `TERM-055` | Adjustment as labelled policy | `dark` | Intraday split label shipped (`1464023a7`, merged 2026-10-06). The raw "As traded" view is built (`api/services/raw_price_view.py`) behind `RAW_PRICE_VIEW_ENABLED`, still `dark` (`docs/feature_flags.json:2270`). Decided: arm (I-1, `12-decisions/2026-10-07-owner-delegated-decisions.md:29`), the integrator's step. Was `building (Lane P)`. |
| `TERM-056` | Command-string interchange | `building (Notebook)` | Note-address half in the Notebook editor (`api/services/address_space.py:387`). |
| `TERM-057` | "Why isn't X here" receipt | `live` | `app/src/components/provenance/AbsenceReceipt.jsx:7`. |
| `TERM-058` | Authoring-time live match count | `live` | `api/routers/screener.py:258`. |
| `TERM-059` | Label stale / proxied values | `live` | On master (`6854c3350`, via X-01): AAII as-of labels (`app/src/pages/breadth/sentimentAge.js`), NAAIM (`naaimAge.js`), carried-print labels from `breadth_self_heal`; ungated (`10-roadmap/backlog-status-2026-10-06.md:106`). Was `dark` (branch-only). |
| `TERM-060` | Machine-checkable citation pointer | `live` | `api/services/canonical/claims.py:149`. |
| `TERM-061` | Skill file, whitelist, MCP | `building (integrator)` | Decided T-16 (`12-decisions/2026-10-07-owner-delegated-decisions.md:61`): publish `docs/api/skill.md` + the whitelist once `RATE_LIMIT_POLICY=enforce`, no MCP. That precondition holds (read live on web 2026-10-07, A4 `12-decisions/2026-10-07-owner-delegated-decisions.md:141`). Remainder: publish it; no route under `api/` serves `docs/api/skill.md` at `d95f331bb` (grep). Was `dark`. |
| `TERM-062` | Publish cooldowns | `live` | `api/services/alert_taxonomy/cooldowns.py`. |
| `TERM-063` | Keyboard registry | `live` | `app/src/pages/command/shortcutRegistry.js:50`. |
| `TERM-064` | One ticker resolver | `live` | On master (`6854c3350`, via X-01): `app/src/lib/tickerResolver.js`, consumed by `app/src/floor2/Composer.jsx`; tweet ingest delegates. Ungated. Was `dark` (branch-only). |
| `TERM-065` | DataGrid seed extraction | `building (Lane P)` | Seed live; `app/src/lib/presentation/dataGrid/dataGridSeed.rail.test.js:185` BASELINE holds 9 hand-rolled grids (was 14). Draining the 9 is the remainder. |
| `TERM-066` | One format module | `building (Lane P)` | Module live; `app/src/lib/presentation/handRolledFormatters.baseline.json:12` lists 150 sites in 28 files (read 2026-10-10; not reconciled with the 60 / 46 counts quoted earlier, which may have used a narrower census). `lane/p2-ratchets-a` is superseded. Draining is the remainder. |
| `TERM-067` | Form-control layer | `building (Lane P)` | `Radio` primitive shipped (`1b391f926`); `app/src/components/ui/formControls.census.test.js:918` `UNNAMED_BASELINE = 23` (was 33). Naming the 23 is the remainder. |
| `TERM-068` | Cohort store + kill switch | `live` | `api/services/rollout_gate.py:21`. |
| `TERM-069` | Retire the yfinance/BS chain leg | `live` | `tests/test_term069_chain_leg_retired.py:74`. |
| `TERM-070` | market-narrative 20.8 s | `live` | `api/services/market_narrative_swr.py`. |
| `TERM-071` | One regime authority | `live` | `tests/test_regime_authority.py`. |
| `TERM-072` | `_fmp_get` onto the D1 adapter | `live` | `api/services/earnings_estimates.py:352`. A per-service `FMP_RATE_LIMIT_PER_MIN` read is agent-doable. |
| `TERM-073` | Analyst pass into a timeline | `live` | `api/services/research/analyst_revisions.py:39`. |
| `TERM-074` | Wire view reachable by migration | `live` | `app/src/pages/calendar/viewLadder.js:8`. |
| `TERM-075` | Unify taxonomies, primary vs mentioned | `live` | `api/services/a8_taxonomy.py:150`. |
| `TERM-076` | Device-local vs cross-device | `live` | `app/src/pages/settings/DeviceSyncCard.jsx`. |
| `TERM-077` | Copy-or-link at import | `live` | `api/services/watchlist_origin.py:29`. |
| `TERM-078` | AI meters + population cap | `live` | Meters live; `AI_POPULATION_CAP_MODE=enforce` read live on web 2026-10-07 (A5, `12-decisions/2026-10-07-owner-delegated-decisions.md:144`). ⚠️ `docs/feature_flags.json:416` still says `dark`, `where: []`: the flag ledger lags that read. Was `dark`. |
| `TERM-079` | Typed context channels | `live` | `app/src/lib/context/contextChannels.jsx:71`. |
| `TERM-080` | Per-route rate limits | `live` | `RATE_LIMIT_POLICY=enforce` read live on web 2026-10-07 (A4, `12-decisions/2026-10-07-owner-delegated-decisions.md:141`). ⚠️ `docs/feature_flags.json:2259` still says `dark`: the flag ledger lags that read. Was `dark`. |
| `TERM-081` | Entitlements toolkit + paywall-all | `live` | Paywall-all on master: `FREE_PAGES = []` at `app/src/constants/freePages.js:21`. Second toolkit MOOT (T-19, `12-decisions/2026-10-07-owner-delegated-decisions.md:64`); the column stays (`api/services/entitlements.py:254`). Was `dark`. |
| `TERM-082` | Widen serve_stale | `live` | `/api/breadth-monitor` serve-stale slot on master (`e82e6a661`, via X-01; `tests/test_breadth_monitor_serve_stale.py`). Ungated. The post-deploy p95 read: not measured. Was `dark` (branch-only). |
| `TERM-083` | Backup rail + restore rehearsal | `live` | `api/services/store_backup.py`. |
| `TERM-084` | ICS token TTL / rotation | `live` | `api/services/ics_export_token.py:73`. |
| `TERM-085` | Wire sentence naming the surface | `dark` | morning-wire PC-side `WIRE_SURFACE_LINE_ENABLED`, still `dark` (ledgered as a knob, `docs/feature_flags.json:2990`). Arming is `setx WIRE_SURFACE_LINE_ENABLED 1` on the PC. |
| `TERM-086` | Inbound TradingView alert receiver | `live` | `api/services/inbound_alerts.py:155`. |
| `TERM-087` | Answer returns an editable object | `live` | `api/services/ai_search_scan_object.py:89`; not yet exercised by a live call. |
| `TERM-088` | Decision record member surface | `live` | `api/routers/decision_record.py:32`; armed 10-02. |
| `TERM-089` | Wire archive replay | `live` | `app/src/pages/MorningWire.jsx:404`. |
| `TERM-090` | EP base rate beside the flag | `live` | `app/src/components/tiles/EpBaseRate.jsx:68`. |
| `TERM-091` | Curriculum into the education store | `live` | `api/services/education_curriculum.py:434`. |
| `TERM-092` | Re-time the wire watchdog to 09:35 | `live` | `api/main.py:2567`. |
| `TERM-093` | "What else was open" capture | `dark` | On master (`api/services/what_else_open.py:72`, `lane/term-004-093` merged); `WHAT_ELSE_OPEN_CAPTURE_ENABLED` still `pending` (`docs/feature_flags.json:1196`). |

## 4. Break-out ledger — BRK-01..BRK-10

| id | item | state | note |
|---|---|---|---|
| `BRK-01` | Pre-trade options analysis | `building (Lane O)` | Chain, surface and payoff live; backtest armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2178`). The FT-001/011/012/014/018 remainders are now live (rows below). Left: FT-015's streamed chain. |
| `BRK-02` | Screen universe + expressiveness | `moot (decided 2026-10-07: no second universe)` | Logic built and armed on web 2026-10-04 (`a046f7d9f`) (`SCREENER_LOGIC_ENABLED`, `docs/feature_flags.json:1876`). The second universe is declined: I-10 (`12-decisions/2026-10-07-owner-delegated-decisions.md:38`). |
| `BRK-03` | Alert authoring grammar | `live` | The typed where-grammar (FT-029 v2: typed subjects, `$AAPL` / `#list` scopes, arithmetic; one parser, `api/services/screener/grammar.py`) is armed on web 2026-10-04 (`a046f7d9f`) (`SCREENER_ALERT_GRAMMAR_ENABLED`, `docs/feature_flags.json:1898`); standing alerts on a filter-list screen ride it (`SCREENER_SPEC_ALERTS_ENABLED`, `docs/feature_flags.json:1948`). Was `building (Lane S)`. |
| `BRK-04` | Mobile push alert channel | `dark` | D-012. On master (`api/services/web_push.py:101`); `WEB_PUSH_ENABLED` still `pending` (`docs/feature_flags.json:1996`). Arming needs `tools/gen_vapid_keys.py` + 3 VAPID vars on web. |
| `BRK-05` | Config-as-citation | `live` | `SCREENER_NL_COMPILE_ENABLED` (`docs/feature_flags.json:1988`) and `SCREENER_LOGIC_ENABLED` (`docs/feature_flags.json:1876`) armed on web 2026-10-04 (`a046f7d9f`); route `api/routers/screener_nl.py:44`. Was `dark`. |
| `BRK-06` | Programmatic egress | `building (integrator)` | Personal API armed; `DATA_EXPORTS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1868`). Remainder as TERM-061: publish `skill.md` now that `RATE_LIMIT_POLICY=enforce` (A4, `12-decisions/2026-10-07-owner-delegated-decisions.md:141`). No MCP (T-16). Was `dark`. |
| `BRK-07` | Per-surface status disclosure | `live` | `app/src/pages/Support.jsx:1316` (TERM-039). FT-046 is separate. |
| `BRK-08` | Dealer vocabulary with a base rate | `building (Lane O)` | Vocabulary armed on web 2026-10-04 (`a046f7d9f`) (`OPTIONS_POSITIONING_VOCAB_ENABLED`, `docs/feature_flags.json:201`). The base rate (how often levels held) is still not computed (no base-rate field in `api/routers/options_analytics.py`, grep at `d95f331bb`). |
| `BRK-09` | Transcript / filing retrieval depth | `dark` | Boolean / NEAR / synonym operators over transcripts built dark (`lane/s2-finish`, merged `9e69eddd9`): `TRANSCRIPT_OPERATOR_SEARCH_ENABLED` pending (`docs/feature_flags.json:1942`). A transcript backfill would also need the FMP storage / AI-processing rights read: not measured. Was `building (Lane S)`. |
| `BRK-10` | Implied-move calibration | `live` | `IV_HISTORY_ENABLED` armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09 (`docs/feature_flags.json:146`). The calibration score is meaningful at ≥4 logged prints per name (log armed 2026-10-02). Was `dark`. |

## 5. Coverage gaps — COV-01..COV-12

| id | item | state | note |
|---|---|---|---|
| `COV-01` | Seasonality | `live` | `api/routers/seasonality.py:59`; armed 10-02. |
| `COV-02` | Options screening | `live` | `OPTIONS_SCREENER_ENABLED` (`docs/feature_flags.json:152`) and the strategy screens (`docs/feature_flags.json:291`) armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09. Ranks need ≥10 / 20 logged sessions. Was `dark`. |
| `COV-03` | IV percentile / unusual volume | `owner-blocked (set OPTIONS_SCREENER_TAPE_URL on terminal-next-monitor)` | Decided: set the tape URL (S-11 `12-decisions/2026-10-07-owner-delegated-decisions.md:97`; A6 `12-decisions/2026-10-07-owner-delegated-decisions.md:146`). No record that `OPTIONS_SCREENER_TAPE_URL` was set on terminal-next-monitor (`docs/feature_flags.json:159` still names it as needed). The screener itself is armed (COV-02). IV ranks also need ≥20 sessions. |
| `COV-04` | Filing blackline | `live` | `api/routers/filing_blackline.py:42`; armed 10-02. |
| `COV-05` | People / executive intelligence | `building (Lane R)` | People tab armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2002`): officers (FMP key-executives), compensation, Form 4 roles. Remainder: bios and board, which need a source (D-008); none is wired at `d95f331bb`. Was `dark`. |
| `COV-06` | Version history on user artefacts | `live` | `api/services/artifact_versions.py:81` (all four kinds). |
| `COV-07` | Broker estimates + consensus drift | `moot (decided 2026-10-07: no FMP upgrade now; drift accrues from our snapshots)` | Drift built and armed on web 2026-10-04 (`a046f7d9f`) (`ESTIMATE_HISTORY_ENABLED`, `docs/feature_flags.json:2010`), accumulating from 2026-10-02. NG-15 retracted (D-008). ➜ 2026-10-07: S-2 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `COV-08` | Depth of book / L2 / T&S | `moot (decided 2026-10-07: no L2 purchase)` | In scope by D-008. ➜ 2026-10-07: S-1 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `COV-09` | SEC filings feed (re-id DL-036) | `live` | `FILINGS_FEED_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2018`); `api/services/filings_feed.py`. Was `dark`. |
| `COV-10` | Monitor groups / list subscriptions | `building (Lane T2)` | List-subscribe (`docs/feature_flags.json:1832`) and groups E-H (`docs/feature_flags.json:1840`) armed on web. Remainder (handoff to Lane T2, V10): the rail still carries literal `COLORS` / `COLOR_HEX` (`app/src/pages/charts/WidgetHeader.jsx:19`, `app/src/pages/charts/PeriodSortPanel.jsx:23`); retarget them to `colorGroups.js`, then delete them. Community lists stay on /watchlists via TERM-077. Was `dark`. |
| `COV-11` | Indicator templates object | `building (Lane R)` | Same as FT-070; coordinate with the indicator programme. |
| `COV-12` | Congressional / political-disclosure trackers (was COV-09) | `moot (decided 2026-10-07: not pursued, no scraping fallback)` | ➜ 2026-10-07: S-6 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |

## 6. Feature register — FT-001..FT-080

| id | item | state | note |
|---|---|---|---|
| `FT-001` | Risk-profile graph | `live` | Expiry curve plus the "today at IV" curve and PoP: `OPTIONS_PAYOFF_TODAY_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:300`; `docs/terminal-research/reports/lane-o-options-remainders.md:9`). Was `building (Lane O)`. |
| `FT-002` | Simulated multi-leg trades | `live` | `OPTIONS_MULTI_LEG_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:275`). Was `dark`. |
| `FT-003` | Probability analysis | `live` | `OPTIONS_PROBABILITY_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:259`). Was `dark`. |
| `FT-004` | thinkBack past-date trade | `live` | `OPTIONS_BACKTEST_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2178`). The pre-arming live run against our Massive key: not measured. Was `dark`. |
| `FT-005` | Earnings-reaction panel | `live` | `EARNINGS_REACTION_PANEL_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2042`). The implied leg fills as the options log grows. Was `dark`. |
| `FT-006` | IV rank header label | `live` | `OPTIONS_IV_RANK_ENABLED` armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09 (`docs/feature_flags.json:217`). Rank needs ≥20 logged sessions. Was `dark`. |
| `FT-007` | Daily implied vs actual | `live` | `OPTIONS_DAILY_MOVE_ENABLED` armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09 (`docs/feature_flags.json:247`). Needs 20 pairs. Was `dark`. |
| `FT-008` | Implied-move calibration score | `live` | `IV_HISTORY_ENABLED` armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09 (`docs/feature_flags.json:146`). Was `dark`. |
| `FT-009` | ATM straddle history | `live` | `OPTIONS_STRADDLE_HISTORY_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:239`). Was `dark`. |
| `FT-010` | IV-crush table | `live` | `OPTIONS_IV_CRUSH_ENABLED` armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09 (`docs/feature_flags.json:253`). Needs 4 earnings windows. Was `dark`. |
| `FT-011` | Earnings strategy backtester | `live` | Earnings-anchored entry + 8 structures: `OPTIONS_BACKTEST_MORE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:308`; lane report `:10`). The live FMP run the lane report asked for before arming (`lane-o-options-remainders.md:41`): not measured. Was `building (Lane O)`. |
| `FT-012` | Theoretical-value edge ranking | `live` | Edge ranking: `OPTIONS_EDGE_RANKING_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:316`); states its n and does not rank by win rate under 60 sessions. Was `building (Lane O)`. |
| `FT-013` | Mid-price backtest caveat | `live` | `OPTIONS_BACKTEST_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2178`). Was `dark`. |
| `FT-014` | Chain + builder + finder | `live` | Chain live; finder `OPTIONS_STRATEGY_FINDER_ENABLED` (`docs/feature_flags.json:324`) and Spread Book (`docs/feature_flags.json:388`) armed on web 2026-10-04 (`a046f7d9f`). Was `building (Lane O)`. |
| `FT-015` | Full Greek set chain | `building (Lane O)` | Rho / lambda / epsilon and a Calls/Puts mode armed on web 2026-10-04 (`a046f7d9f`) (`OPTIONS_CHAIN_FULL_GREEKS_ENABLED`, `docs/feature_flags.json:332`). Remainder: a streamed chain, which needs a Massive option-quote socket (`lane-o-options-remainders.md:38`); the chain polls every 60 s. |
| `FT-016` | Chain → chart → pricer drill | `live` | `OPTIONS_PRICER_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:267`). Was `dark`. |
| `FT-017` | OSA what-if fields | `live` | `OPTIONS_PRICER_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:267`). Was `dark`. |
| `FT-018` | Implied-vol surface | `live` | Surface live; RR/BF tenor table (`docs/feature_flags.json:340`) and 3D view (`docs/feature_flags.json:348`) armed on web 2026-10-04 (`a046f7d9f`). Was `building (Lane O)`. |
| `FT-019` | Option monitor EVTS / HV | `live` | `OPTIONS_MONITOR_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:231`). Was `dark`. |
| `FT-020` | Volatility endpoints | `live` | `OPTIONS_VOL_ENDPOINTS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:223`). VRP / rank need the log. Was `dark`. |
| `FT-021` | Multi-category screener | `live` | `api/routers/screener.py:274`. |
| `FT-022` | Named preset scans | `live` | `SCREENER_PATTERN_PRESETS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1972`). Was `dark`. |
| `FT-023` | Pine-style screener | `live` | `api/services/screener/query.py:21` (nightly). |
| `FT-024` | AI screener + explanation | `live` | `SCREENER_NL_COMPILE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1988`). Was `dark`. |
| `FT-025` | Screener column presets | `live` | `api/services/screener/filters.py:718`. |
| `FT-026` | All / none / any groups | `live` | `SCREENER_LOGIC_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1876`). Was `dark`. |
| `FT-027` | Scan → watchlist / query / alert | `live` | Promote `SCREENER_PROMOTE_ENABLED` (`docs/feature_flags.json:1964`) and standing alerts on spec screens `SCREENER_SPEC_ALERTS_ENABLED` (`docs/feature_flags.json:1948`) armed on web 2026-10-04 (`a046f7d9f`); member controls `69420baf3`. Was `building (Lane S)`. |
| `FT-028` | Live count + as-of | `live` | Live count with its as-of on master: `app/src/pages/screener/hooks/useScreenerCount.js:43` reads `as_of`, `app/src/pages/screener/shell/ScannerShell.jsx:124` shows it. Was `dark` (branch-only). |
| `FT-029` | `where` grammar | `live` | Typed subjects, `$AAPL` / `#list` scopes and arithmetic in the one where-grammar: `SCREENER_ALERT_GRAMMAR_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1898`). Was `building (Lane S)`. |
| `FT-030` | English → grammar compiler | `live` | `SCREENER_NL_COMPILE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1988`). Was `dark`. |
| `FT-031` | Three alert kinds | `live` | `api/services/alert_conditions.py:44`. |
| `FT-032` | Alert on the position drawing | `building (Lane S)` | Line-drawing alerts live; `alertKindFor` still returns null for the position drawing (`app/src/components/chart/drawingAlertAnchors.js:35-40`). |
| `FT-033` | Outbound webhook alerts | `dark` | `ALERT_WEBHOOKS_ENABLED` still `pending` (`docs/feature_flags.json:1884`); on master. |
| `FT-034` | Six trigger source types | `owner-blocked (as TERM-025)` | A rating-change type is agent-buildable (Lane S) once ruled. ➜ 2026-10-07: T-11 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-035` | Per-alert lifecycle | `dark` | Expiry armed on web 2026-10-04 (`a046f7d9f`) (`ALERT_LIFECYCLE_ENABLED`, `docs/feature_flags.json:1980`). Remind built dark (`lane/s2-finish`, `9e69eddd9`): `ALERT_REMIND_ENABLED` pending (`docs/feature_flags.json:1930`). Reverse still waits on the price_level flip (TERM-025). Was `building (Lane S)`. |
| `FT-036` | Routing rule + suspend | `live` | `ALERT_ROUTING_RULE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1890`); the rule governs the TERM-048 bridge too (`937b3d9e5`). Was `building (Lane S)`. |
| `FT-037` | Four channels incl. SMS / push | `moot (decided 2026-10-07: no SMS; email, in-app and push cover it)` | Email/in-app live; push dark (BRK-04). ➜ 2026-10-07: S-3 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-038` | Push topics + Telegram bot | `moot (decided 2026-10-07: no Telegram)` | Chat-linking is agent-buildable afterwards. ➜ 2026-10-07: S-4 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-039` | Option-stance fit score | `live` | `OPTIONS_STANCE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:283`). iv_regime is blank under 20 sessions. Was `dark`. |
| `FT-040` | MCP + skill.md | `building (integrator)` | As TERM-061: publish `skill.md` now that `RATE_LIMIT_POLICY=enforce` (A4, `12-decisions/2026-10-07-owner-delegated-decisions.md:141`); no MCP (T-16, `12-decisions/2026-10-07-owner-delegated-decisions.md:61`). Was `dark`. |
| `FT-041` | Excel export + API | `live` | `DATA_EXPORTS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1868`). Was `dark`. |
| `FT-042` | Metered CSV / Excel | `live` | `DATA_EXPORTS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1868`). A protective cap, NG-06. Was `dark`. |
| `FT-043` | Chart data CSV | `live` | `DATA_EXPORTS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1868`). Was `dark`. |
| `FT-044` | Competitor's own "no API" | `moot (describes SpotGamma's absence; nothing to build)` | |
| `FT-045` | Beta pills + today / working-on | `live` | `app/src/components/featureStatus/FeatureStatusStrip.jsx`. |
| `FT-046` | Per-surface how-to checklist | `owner-blocked (approve the copy in the owner's voice)` | Mechanism built dark (lane/r-research-depth): `HOW_TO_CHECKLISTS_ENABLED` pending; registry `app/src/components/howTo/howToChecklists.js` + `HowToChecklist.jsx` on Research > Depth and /screener. All 8 entries ship `draft-awaiting-owner-voice` and render nothing even when armed; the owner rewrites or approves each (status `approved` + `approved_by` + `approved_on`), then arms. ➜ 2026-10-07: decided: arm the flag; copy approval stays the owner's. F-4; owner actions A9, C5 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) Re-checked: `HOW_TO_CHECKLISTS_ENABLED` still `pending` (`docs/feature_flags.json:1848`); C5 has no owner answer in §8b. |
| `FT-047` | Named dealer vocabulary | `live` | `OPTIONS_POSITIONING_VOCAB_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:201`). Was `dark`. |
| `FT-048` | HIRO | `live` | `api/gex_router.py:12` (different shape). |
| `FT-049` | TRACE heatmaps | `building (Lane O)` | Gamma heatmap (`docs/feature_flags.json:169`), delta-pressure (`docs/feature_flags.json:356`) and charm (`docs/feature_flags.json:364`) armed on web 2026-10-04 (`a046f7d9f`). Remainder: forward projection and a 1-minute refresh (the heatmaps read the 60 s chain cache, `lane-o-options-remainders.md:39`). |
| `FT-050` | Options Impact gauge | `live` | `OPTIONS_IMPACT_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:193`). 20-session average. Was `dark`. |
| `FT-051` | Two positioning models | `live` | `api/gex_router.py:35`. |
| `FT-052` | Negative OI explained | `live` | `OPTIONS_DEALER_SHORT_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:209`). Was `dark`. |
| `FT-053` | Level files into other platforms | `building (Lane O)` | Licensing cleared by D-011, so it is now agent-buildable. No lane listed it in the audit, so it is proposed here for Lane O. |
| `FT-054` | "N minutes ago" overlay | `building (Lane O)` | Needs a durable intraday per-strike exposure store on flow-worker. |
| `FT-055` | Positioning primitives | `live` | `OPTIONS_MAX_PAIN_ENABLED` (`docs/feature_flags.json:177`) and `OPTIONS_NOPE_ENABLED` (`docs/feature_flags.json:185`) armed on web 2026-10-04 (`a046f7d9f`); GEX live. Was `dark`. |
| `FT-056` | Market Tide | `live` | Market Tide (`docs/feature_flags.json:161`) and per-sector tide (`docs/feature_flags.json:372`) armed on web 2026-10-04 (`a046f7d9f`). Was `building (Lane O)`. |
| `FT-057` | Tide → flow-minute jump | `live` | Tide click-through to the flow minute: `OPTIONS_TIDE_CLICKTHROUGH_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:380`). Was `building (Lane O)`. |
| `FT-058` | Boolean proximity search | `live` | `FILING_SEARCH_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2074`). Was `dark`. |
| `FT-059` | Smart synonyms | `live` | `FILING_SEARCH_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2074`). Was `dark`. |
| `FT-060` | Section-scoped filing search | `live` | `FILING_SEARCH_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2074`). Was `dark`. |
| `FT-061` | Snippet Explorer | `live` | `api/routers/earnings_intel.py:493`. Depth is BRK-09. |
| `FT-062` | Filing blackline | `live` | Via COV-04. |
| `FT-063` | Documents tab (filings) | `live` | `api/routers/filings.py:20`. |
| `FT-064` | EVTS staged events | `live` | `EVENTS_TIMELINE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2050`). Was `dark`. |
| `FT-065` | Seasonals tab | `live` | Via COV-01. |
| `FT-066` | 15-year seasonality | `live` | ~31-year daily window. |
| `FT-067` | Congressional trackers | `moot (as COV-12)` | ➜ 2026-10-07: S-6 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-068` | Insider / 13F / FEC / SI / FTD datasets | `moot (decided 2026-10-07: no FEC key)` | Insider, 13F and SI live; FTD armed on web 2026-10-04 (`a046f7d9f`) (`FTD_DATASET_ENABLED`, `docs/feature_flags.json:2058`). ➜ 2026-10-07: S-5 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-069` | MNRS history + copy / link | `live` | `api/services/artifact_versions.py:97`. |
| `FT-070` | Indicator templates | `building (Lane R)` | Coordinate with the indicator programme. |
| `FT-071` | Broker estimates + drift | `moot (as COV-07)` | Built and armed on web 2026-10-04 (`a046f7d9f`) (`BROKER_ESTIMATES_ENABLED`, `docs/feature_flags.json:2034`); should read COV-07's snapshot instead of a second FMP call. ➜ 2026-10-07: S-2 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-072` | Option / Spread Hacker | `live` | Saved Spread Book: `OPTIONS_SPREAD_BOOK_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:388`). Was `building (Lane O)`. |
| `FT-073` | Per-strategy option screeners | `building (Lane O)` | Strategy screens (`docs/feature_flags.json:291`) and the remaining screens (call butterflies, by-expiration, block trades; `docs/feature_flags.json:396`) armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09. Remainder: multi-leg trades (the tape carries no multi-leg flag, `lane-o-options-remainders.md:40`). |
| `FT-074` | Unusual options volume report | `owner-blocked (as COV-03: OPTIONS_SCREENER_TAPE_URL)` | ➜ 2026-10-07: decided: as COV-03. Owner action A6 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-075` | Sizzle Index | `live` | Sizzle 5-day: `OPTIONS_SIZZLE_ENABLED` armed on web 2026-10-09 (`c10e0fef3`) and answering 200 live 2026-10-09 (`docs/feature_flags.json:402`). Ranks only with 5 prior sessions. Was `building (Lane O)`. |
| `FT-076` | MGMT surface | `building (Lane R)` | As COV-05: `RESEARCH_PEOPLE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2002`); bios / board need a source (D-008), none wired. Was `dark`. |
| `FT-077` | Level II / T&S | `moot (as COV-08)` | ➜ 2026-10-07: S-1 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-078` | Candlestick pattern detection | `moot (decided 2026-10-07: toggle stays off; Pattern-Lab pause stands)` | Overlay mounted (`app/src/components/StockChart.jsx:19753`), but the toolbar toggle is dead code (`app/src/components/chart/ChartToolbar.jsx:1431`, `{false && …}`). ➜ 2026-10-07: F-5 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-079` | Chart-pattern auto-labelling | `moot (as FT-078)` | Fibonacci patterns would be agent-buildable afterwards. ➜ 2026-10-07: F-5 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `FT-080` | Social-sentiment overlay | `owner-blocked (one ruling: may message text be kept, so posts can carry a polarity)` | Mention series armed on web 2026-10-04 (`a046f7d9f`) (`MENTION_SERIES_ENABLED`, `docs/feature_flags.json:2066`); TWT (X/Twitter chatter) answered live 2026-10-09. Polarity needs the owner to reverse the "no message text kept" rule (`buzz_store.py:3`); the 2026-10-07 sweep did not rule on it. Was `dark`. |

## 7. Untracked promises (scope audit §2; no TERM / RM / FT / COV / BRK row before this file)

| id | item | state | note |
|---|---|---|---|
| `V1` | Fix the false ABSENT answers for OSCR / OBT (`functions.js:121-124`) | `live` | `OBT` and `OSCR` are real codes (`app/src/pages/terminal/functions.js:177`, `:179`), shipped in `609b8e651` (T1 shell reach), on master via the X-01 landing `2e304db42`. Was `building (Lane T1)`. |
| `V1b` | Codes for the built-but-uncoded Research sections + Depth panels, IV history, Tide, strategy screens, Notebook, Exports | `live` | Codes on master: `DPTH` (`app/src/pages/terminal/functions.js:142`), `IVH` (`:169`), `TIDE` (`:193`), `STRS` (`:195`), `NB` (`:233`). `EXP` was later dropped from the list on purpose (`cb60717b2`, the function-list trim). Was `building (Lane T1)`. |
| `V13` | Doors → panels (26 of 46 codes leave the shell), with one panel vocabulary | `live` | One panel vocabulary: `app/src/pages/terminal/surfacePanels.js:16` imports `SURFACE_PANELS` (TERM-037). 18 of 85 codes still leave the shell, each declaring why in `app/src/pages/terminal/functions.js` (for example `:91`, `:187`, `:220`). Was `building (Lane T1)`. |
| `V6a` | Honour stored arguments (`ChartPanel.jsx:7` hard-codes `tf="D"`) | `live` | `app/src/pages/terminal/panels/ChartPanel.jsx:7` takes `tf` from the command (`NVDA GP W`); variants declare their args (`app/src/pages/terminal/args.js:6`). Was `building (Lane T1)`. |
| `V22` | Throwing-panel rail + re-run the five-property walkthrough on `/terminal` | `building (Lane T1)` | Throwing-panel rail built: `app/src/pages/terminal/TerminalShell.test.jsx:291`. Remainder: re-run the five-property walk on `/terminal` (X-11): not measured. |
| `RM-X02` | `/terminal` in `tools/hub_nav_smoke.py` + a pre-authored rollback branch | `building (Lane T1)` | `tools/hub_nav_smoke.py:188` follows the UCT Terminal entry onto `/terminal` (`alsoActive`). Rollback branch prepared, push pending: `rollback/terminal-next-off` at `f1c811f4c` (from `origin/master` `11fa16167`, lane f-l1, 2026-10-10). The off switch is the `TERMINAL_NEXT_ENABLED` variable read per request (`api/services/rollout_gate.py:141-155`), not code, so the branch carries only `docs/runbooks/terminal-rollback.md`: the `railway` commands and a three-step verification. Remainder: the integrator pushes the branch. |
| `V2` | `terminal_layout` onto the versioned TERM-021 store + version restore | `live` | The board is versioned on TERM-021's store (`app/src/pages/terminal/boardModel.js:3-6`, `TERMINAL_PREF_KEYS`) with version restore (`app/src/pages/terminal/TerminalVersions.jsx:4`). Was `building (Lane T2)`. |
| `V3` | Named, addressable, shareable terminal boards (FB A-2 for the shell) | `live` | Named boards addressed `B:<slug>` (`app/src/pages/terminal/boardModel.js:792`) and shared by link (`encodeShare` `:606`, `/terminal?board=` `:622`). Was `building (Lane T2)`. |
| `V9` | Panel close + undo, duplicate, pop-out | `live` | Close, undo, duplicate and pop-out (`app/src/pages/terminal/boardModel.js:415`, `undoClose` `:440`); Alt+X / Z / C keys (`af1048a95`). Was `building (Lane T2)`. |
| `V10` | Channel record instead of A-D+N; `linkable:false`; late panel inherits context | `live` | Channel record `{id, name, color, sym, history}` (`app/src/pages/terminal/boardModel.js:22`), `linkable:false` (`:164`), a late panel inherits its channel (`:454`). Linked panels (list rows publish to their link group) answered live 2026-10-09. Was `building (Lane T2)`. |
| `V11` | Recents split by kind + favourites | `live` | Function recents (`app/src/pages/terminal/recents.js:10`), board favourites (`app/src/pages/terminal/boardModel.js:47` `FAVORITES_MAX`), Alt+R Recents (`af1048a95`). Was `building (Lane T2)`. |
| `V12` | Board-level density token + control | `live` | Board density in the layout (`app/src/pages/terminal/boardModel.js:120`), the Comfortable / Compact / Dense control (`15d3bad28`), reaching panel content (`a8c6c4d71`). Was `building (Lane T2)`. |
| `V14` | Per-ticker workspace preset | `live` | Per-ticker presets in the board library (`app/src/pages/terminal/boardModel.js:8`, `:654`). Was `building (Lane T2)`. |
| `V19` | "Keep the old page" revert preference, or a record that the redirect is the revert | `moot (decided 2026-10-07 P-9: /calendar coexists permanently as a URL; graduation moves the nav, not the address)` | `12-decisions/2026-10-07-owner-delegated-decisions.md:79`. There is no old page to keep: `/calendar` renders the same CAL section. Was `building (Lane T2)`. |
| `V4` | Global focus key + keyboard panel switching; palette as a second front end of one grammar | `live` | Backtick is the global terminal key (`app/src/pages/command/shortcutRegistry.js:179`), Alt+1..4 focus panels; the Ctrl/Cmd-K palette is a second front end of the one grammar (`app/src/pages/terminal/paletteGrammar.js:1`). Was `building (Lane T3)`. |
| `V5` | Interpreted-parse echo before Enter | `live` | The echo says what Enter will do (`app/src/pages/terminal/CommandLine.jsx:10`; `1d60f60e2`). Was `building (Lane T3)`. |
| `V6b` | Symbol expressions, channel targeting, member aliases, argument shape as you type | `live` | Channels (`app/src/pages/terminal/grammar.js:64`), member aliases (`:74`), symbol expressions `A/B` (`app/src/pages/terminal/parseCommand.js:20`); `HELP <code>` states what a code takes (`6735440c7`). Was `building (Lane T3)`. |
| `V6c` | Published ranking with Reset | `live` | Published ranking (`app/src/pages/terminal/ranking.js:1`) with "Reset my ranking" (`app/src/pages/terminal/panels/HelpPanel.jsx:242`, `DELETE` at `api/routers/terminal_grammar.py:67`). Was `building (Lane T3)`. |
| `V6d` | Every command is a URL | `live` | `?cmd=` reflects every command (`app/src/pages/terminal/TerminalShell.jsx:26`). Was `building (Lane T3)`. |
| `V15` | MOVE / WIIM + per-member "since last visit" diff | `live` | MOVE diffs against the member's last visit (`app/src/pages/terminal/panels/MovePanel.jsx:5`); WIIM folded into MOVE (`cb60717b2`). Was `building (Lane T3)`. |
| `V16` | Natural-language fallback + `ASK <question>` | `live` | `ASK <question>` and the natural-language fallback (`app/src/pages/terminal/parseCommand.js:22`; `app/src/pages/terminal/functions.js:115`). Was `building (Lane T3)`. |
| `V17` | Server-side command telemetry + personalised ranking | `live` | Server-side command counts (`api/services/terminal_grammar.py:51`, telemetry `:94`) feed the personalised ranking (V6c). Was `building (Lane T3)`. |
| `V18` | Comparison modes beyond company-vs-company | `live` | Comparison modes (`app/src/pages/terminal/grammar.js:124`), e.g. `TICKER CMP SECTOR` (`app/src/pages/terminal/parseCommand.js:21`); REL, RRG, CORR and PEER answered live 2026-10-09. Was `building (Lane T3)`. |
| `HELP` | One-page address space + row-number `<GO>` | `live` | Numbered function list with row `<GO>` (`app/src/pages/terminal/panels/HelpPanel.jsx:3`); examples and plain-word search (`65013e0c2`). Was `building (Lane T3)`. |
| `V7` | L0 strip (clock, regime, alert inbox, channel), desktop and phone | `live` | `app/src/pages/terminal/L0Strip.jsx:4`: ET clock, regime chip, alert inbox, channel (`a5a76d001`); a phone layout in `app/src/pages/terminal/L0Strip.module.css:107`. Was `building (Lane T4)`. |
| `V8` | Panel freshness / as-of wired to TERM-006 | `live` | `FreshnessBadge` in the shell (`app/src/pages/terminal/TerminalShell.jsx:34`), wired to TERM-006 (`f26bbee7d`); panel headers state their time (`8877704d1`). Was `building (Lane T4)`. |
| `V20` | MG-7: the hub `calendar` mode resolves under `/terminal/calendar` (the only GAP of 31) | `building (Lane T4)` | Still the one GAP: `10-roadmap/coexistence-parity-matrix.md:67` (the hub `calendar` mode is route-bound to `/calendar`; it needs a `/terminal` mode or alias in `app/src/hub/**`). The hub is a separate workstream (stage-2 PATRICK-MERGE, H14), so coordinate rather than land blind. |
| `P14a` | Phone shell: stored-panel switcher + panel-count control | `live` | Phone panel switcher + touch panel-count control (`3456eb0f8`; rail `app/src/pages/terminal/phoneSwitcher.test.jsx`). Was `building (Lane T4)`. |
| `P14b` | `/charts` phone: Multi-Chart grid, compare, version-history door | `building (Lane T4)` | Phone door into Multi-Chart grid mode shipped (`2fd16ae9f`). The phone compare and version-history doors: not measured. |
| `NAV` | Nav graduation `to:'/terminal'` + the fresh viewport-lock measurement | `live` | Graduated: `app/src/components/NavBar.jsx:27` is `to: '/terminal'` (`c941080f0`, I-11 `12-decisions/2026-10-07-owner-delegated-decisions.md:39`); `/terminal` measured viewport-locked (`18676e3ec`). Was `building (Lane T4)`. |
| `EXPORT-FLOW` | Options-flow export from flow-worker | `building (Lane O)` | Still open: options-flow export is served from flow-worker (`docs/terminal-research/reports/lane-o-options-remainders.md:37`). |
| `SCR-URL` | Grouped logic carried in the screener URL | `live` | The grouped `logic` node rides the screener URL (`app/src/pages/screener/shell/useScreenSpec.js:31`, `:84`); `SCREENER_LOGIC_ENABLED` armed on web 2026-10-04 (`a046f7d9f`). Was `building (Lane S)`. |
| `AC-2` | One channel registry instead of per-alert webhook names | `dark` | Built dark (`lane/s2-finish`, `9e69eddd9`): `ALERT_CHANNEL_REGISTRY_ENABLED` pending (`docs/feature_flags.json:1912`). Was `building (Lane S)`. |
| `AC-4` | Per-trigger-type queue caps with a reserve | `dark` | Built dark (`9e69eddd9`): `ALERT_QUEUE_CAPS_ENABLED` pending (`docs/feature_flags.json:1906`). Was `building (Lane S)`. |
| `AC-7` | Per-trigger ops monitor + channel-health view | `dark` | Built dark (`9e69eddd9`): `ALERT_OPS_MONITOR_ENABLED` pending (`docs/feature_flags.json:1918`). Was `building (Lane S)`. |
| `AC-11` | Save-time fork: frozen list / re-runnable definition / standing alert (UC-4) | `live` | Save-time fork (`dea677762`): `SCREENER_SAVE_FORK_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:1956`). Was `building (Lane S)`. |
| `D-1` | Three-state earnings-date status with timestamps | `live` | `EARNINGS_DATE_STATUS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2146`); `api/services/earnings_date_status.py`, `GET /api/calendar/date-status`. "Company-signaled" stays unavailable (no provider carries it). Was `dark`. |
| `D-2` | "First confirmed" timestamp on `calendar_date_history` | `live` | Same flag, armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2146`); timestamps are first seen by UCT, accumulating from merge. Was `dark`. |
| `D-3` | Index-rebalance dates on the calendar | `moot (decided 2026-10-07: S&P rule-derived only; others "not tracked")` | Built and armed on web 2026-10-04 (`a046f7d9f`) (`INDEX_REBALANCE_EVENTS_ENABLED`, `docs/feature_flags.json:2154`): S&P 500 quarterly, rule-derived and labelled so. No paid provider returns rebalance dates. ➜ 2026-10-07: S-8 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `D-4` | Transcript chapters / jump to Q&A + an "AI-generated, not reviewed" recap label | `live` | `TRANSCRIPT_CHAPTERS_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2130`). Recaps carry "AI-generated · not reviewed". Was `dark`. |
| `D-5` | Tape + transcript replay | `live` | `CALL_REPLAY_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2138`): Research > Depth > Call replay. Coverage stays AAPL/MSFT: decided buy nothing (S-9, `12-decisions/2026-10-07-owner-delegated-decisions.md:95`) and the key is probably not held (C4, `12-decisions/2026-10-07-owner-delegated-decisions.md:199`, `99ee519b7`). Was `owner-blocked`. |
| `D-6` | Story versioning and retraction | `moot (decided 2026-10-07: no retraction feed)` | Versioning built and armed on web 2026-10-04 (`a046f7d9f`) (`NEWS_STORY_VERSIONS_ENABLED`, `docs/feature_flags.json:2082`); versions accrue from arming. No paid source sends a retraction field, and the payload says so. ➜ 2026-10-07: S-10 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `D-7` | Coarse news importance label | `live` | `NEWS_IMPORTANCE_LABEL_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2090`). Each label carries its rule; no model. Was `dark`. |
| `D-8` | Read / unread on news | `live` | `NEWS_READ_STATE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2098`). Was `dark`. |
| `D-9` | Personalization UC-1: consumers of `/api/member/interest` | `building (Lane R)` | First consumer armed on web 2026-10-04 (`a046f7d9f`) (`MEMBER_INTEREST_LINE_ENABLED`, `docs/feature_flags.json:2106`; `app/src/pages/research/notices/ResearchNotices.jsx:37`). Remainder: the other UC-1 consumers (Breadth drill, Screener rows, Wire Top-5); no other frontend caller of `/api/member/interest` at `d95f331bb` (grep). |
| `D-10` | Personalization UC-3: explain list order | `live` | `CALENDAR_ORDER_EXPLAIN_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2162`). Was `dark`. |
| `D-11` | Entity UC-1: "formerly / now trades as" notice | `live` | `ENTITY_RENAME_NOTICE_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2114`). Was `dark`. |
| `D-12` | Canonical UC-5: show when two computations of one metric disagree | `live` | `METRIC_DISAGREEMENT_ENABLED` armed on web 2026-10-04 (`a046f7d9f`) (`docs/feature_flags.json:2122`). Was `dark`. |
| `D-13` | FDA / PDUFA dates on the events calendar | `moot (decided 2026-10-07: no PDUFA source purchase)` | ➜ 2026-10-07: S-7 (`12-decisions/2026-10-07-owner-delegated-decisions.md`) |
| `ARCH-5B8` | Store retention registry visible to `disk_watchdog` | `live` | On master (`e82e6a661`, via X-01): `api/services/store_retention.py` registers the stores and `disk_watchdog` prints each one's retention or `UNDECLARED`; ungated; rail `tests/test_store_retention.py`. Was `dark` (branch-only). |
| `ENT-UC2` | Watchlist rows keyed by entity id | `dark` | On master (`5d376567e`, via X-01; `api/services/watchlist_entity_keys.py`); `WATCHLIST_ENTITY_KEYS_ENABLED` still `pending` (`docs/feature_flags.json:79`). Arming needs the Entity Master seeded on web; rendering `display_sym` on the Watchlists page is not built. |
| `CAP-A12` | Merge the two drag-and-drop libraries | `building (Lane P)` | |
| `FB-A3` | Doc `file:line` citation resolver | `live` | Done 2026-10-10 by lane f-l1: `tools/doc_citation_resolver.py` (backticked `file.ext:N`, `:N-M` and `:N,M` resolved at a git revision; missing files and out-of-range lines reported; `--self-check` with a fixture that must fail), rails `tests/test_doc_citation_resolver.py`. Run over this file and the 2026-10-10 delivery record: 290 citations, 0 broken. Was `building (Lane P)`. |
| `FB-A1` | Feature-backlog appendix A-1 | `moot (MOOT by the audit, §1b)` | |
| `PREARM` | Pre-arm "would have fired N" receipt | `moot (dropped by the TERM-062 ruling 2026-09-29)` | |
| `PP-ROLES` | Shared-instance roles (PP §1 #6) | `moot (deferred to need by its own doc)` | |
| `PP-PERSONA` | Persona re-ranking (PP §4) | `moot (deferred by its own doc)` | |
| `NG-12` | Multi-user collaboration | `moot (non-goal NG-12)` | |

## 8. What only the owner can do — the 9 `owner-blocked` rows, grouped

Reconciled 2026-10-10 against master `d95f331bb`. This replaces the 43-row before-state list that
stood here (most of it was decided under delegation on 2026-10-07, `12-decisions/2026-10-07-owner-delegated-decisions.md`, and
answered on 2026-10-08, §8b there, `99ee519b7`). Each line names the one act; the row ids are in
brackets. Arming steps the integrator owns (I-1 raw view, I-2 RSS series, I-3 rail page) are
`dark` rows, not owner-blocked, and are not listed here.

**Set one env var**
- `OPTIONS_SCREENER_TAPE_URL` on terminal-next-monitor, copied from web's `WORKER_INTERNAL_URL` (A6, `12-decisions/2026-10-07-owner-delegated-decisions.md:146`) (COV-03, FT-074).
- `BREADTH_EOD_SERVER_FROM` then `BREADTH_EOD_SOURCE=server` on web, once `/api/admin/breadth-eod-source` reads `parity.switch.ready: true` (A7, `12-decisions/2026-10-07-owner-delegated-decisions.md:148`) (TERM-042).
- Per shadow trigger type, its flip variable on web once its own shadow reading meets T-11, one type at a time (A8, `12-decisions/2026-10-07-owner-delegated-decisions.md:151`) (TERM-025, FT-034).

**Provide a reading or a person**
- A read with Cloudflare credentials: the `/api/flow/*` cache rule and key, then Browser Cache TTL → Respect Existing Headers (B2, `12-decisions/2026-10-07-owner-delegated-decisions.md:164`); no answer in §8b (TERM-008).
- Ravi records Phase A: at least 5 trading days and at least 10 logged occasions; not started (C2 answer, `12-decisions/2026-10-07-owner-delegated-decisions.md:190`) (X-14).

**Approve copy in the owner's voice**
- The 8 draft how-to checklists in `app/src/components/howTo/howToChecklists.js` (C5, `12-decisions/2026-10-07-owner-delegated-decisions.md:181`) (FT-046).

**Rule on one question**
- May message text be kept so the social-sentiment series can carry a polarity? Today `buzz_store.py:3` keeps none; the 2026-10-07 sweep did not rule on it (FT-080).

Moved out of this list by the reconciliation: OD-OI04 (answered, C1), TERM-011 (answered, B3: no new channel),
TERM-007 / TERM-017 (window fixed by B1 for 2026-10-14; the reading is agent work), D-5 (C4: key
probably not held, S-9: buy nothing, so coverage stays AAPL/MSFT and the row is `live`).
