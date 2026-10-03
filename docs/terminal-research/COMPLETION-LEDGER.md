---
id: COMPLETION-LEDGER
title: Is the UCT Terminal vision complete? One row per item, one state per row
role: The single "is the vision complete" checklist for TERMINAL-NEXT. Every TERM, FT, BRK and COV
  row, every D- promise, and every untracked promise from the 2026-10-02 full-scope audit.
as_of: integrate/terminal-fixes @ 00ed982ea8 (code) + lane/d-records (records), 2026-10-03
status: living — update a row's state in the same commit that changes it
---

# Completion ledger — UCT Terminal (TERMINAL-NEXT)

**The answer today: not complete.** It is complete when every row below is `live` or `moot`.
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
- **Sources of truth.** For code: the branch at `00ed982ea8`, read 2026-10-03 by three read-only sub-audits, with file:line spot-checked by this lane. For flags: `docs/feature_flags.json` on this branch. Eight gates are armed in this branch's ledger while master's ledger still says pending/dark (`d73edb8bc9`); their code is on master, so those rows count as `live`. For rulings: `00-program-control/OWNER_DECISIONS.md` D-005..D-014.
- **Branch-only means not in production**, whatever its flag says. `integrate/terminal-fixes` is 77 commits ahead of master and 28 behind (audit §0). Row X-01 covers the merge.

## 0. Counts (derived)

```
python -X utf8 -c "import re,collections;t=open('docs/terminal-research/COMPLETION-LEDGER.md',encoding='utf-8').read();rows=re.findall(r'^\| `([A-Z][A-Za-z0-9./-]*)` \| [^|]* \| `(live|dark|building|owner-blocked|moot)',t,re.M);print(len(rows),collections.Counter(s for _,s in rows));print(len(rows)-len({i for i,_ in rows}),'duplicate ids')"
```

Printed 2026-10-03: **279 rows, 0 duplicate ids.**

| section | rows | live | dark | building | owner-blocked | moot |
|---|---|---|---|---|---|---|
| 1 Programme records + ship | 17 | 4 | 2 | 8 | 3 | 0 |
| 2 Open owner decisions | 9 | 0 | 0 | 0 | 8 | 1 |
| 3 TERM-001..093 | 93 | 55 | 11 | 13 | 10 | 4 |
| 4 BRK-01..10 | 10 | 1 | 3 | 4 | 2 | 0 |
| 5 COV-01..12 | 12 | 3 | 3 | 2 | 4 | 0 |
| 6 FT-001..080 | 80 | 13 | 34 | 21 | 11 | 1 |
| 7 Untracked promises | 58 | 0 | 1 | 51 | 1 | 5 |
| **total** | **279** | **76** | **54** | **99** | **39** | **11** |

`building` by lane: O 17 · R 16 · P 14 · S 13 · T3 10 · T1 8 · T2 8 · T4 6 · D 3 · integrator 2 · Notebook 2.

⛔ **These counts go stale the moment a row changes.** Re-run the command and replace the table in the same commit; never edit a number by hand (ADR-0002).
⚠️ **`live` rows are not all in production.** X-06..X-09 are records and an env arming. Every TERM/FT/BRK/COV `live` row is on master.

## 1. Programme records and the ship campaign

| id | item | state | note |
|---|---|---|---|
| `X-01` | Merge `integrate/terminal-fixes` to master (77 ahead / 28 behind) | `building (integrator)` | Merge origin/master in, re-run the gates, then push under the D-009 standing go with a member-impact paragraph. Until then every branch-only row stays `dark`. |
| `X-02` | `TERMINAL_NEXT_ENABLED`: the `/terminal` shell + the `/calendar` redirect | `dark` | `pending`, `where: []`. Arm: set it on web and tag the cohort with `tools/rollout_cohort.py`. Fix T1's V1 first so the shell does not deny built surfaces. |
| `X-03` | Charter §49 #18: first vertical slice (`10-roadmap/first-slice.md`) | `building (Lane D)` | **NOT MET**: the file is absent, and the work is not started. Roadmap RM-N16. |
| `X-04` | Charter §49 #24: master plan (`13-executive-synthesis/MASTER_PLAN.md`) | `building (Lane D)` | **NOT MET**: the file is absent, and the work is not started. Roadmap RM-N17. Must carry D-005..D-014 and this ledger. |
| `X-05` | Charter §49 #26: readiness test | `building (Lane D)` | **NOT RUN.** It needs X-04 as its input. Roadmap RM-N18; the procedure is in `00-program-control/readiness-test.md`. |
| `X-06` | Record the 2026-10-02 owner rulings | `live` | Done here: D-005..D-014, DL-026..DL-037. |
| `X-07` | Retract or annotate NG-10, NG-04/05, NG-15 | `live` | Done here: `05-product-strategy/non-goals.md`. |
| `X-08` | COV-09 naming conflict | `live` | Resolved by DL-036: COV-09 is the SEC filings feed, congressional trackers are COV-12. |
| `X-09` | `OPTIONS_UNIVERSE_LOG_ENABLED` armed on terminal-next-monitor | `live` | Measured 2026-10-03 02:39Z (key names only): flag=1, `MASSIVE_API_KEY` + `DATA_SYNC_*` present. ⚠️ The first run's receipt and its `complete:true` manifest are still unread. Every session before arming is lost permanently (Massive sells no chain history). ⚠️ The service runs master's `api/services/options_universe_log.py`. This branch adds the front-straddle summary columns (`front_expiration`, `front_dte`, `front_strike`, `front_straddle`; commit `f92239a2d9`) that BRK-10 reads. They reach the monitor only after X-01, so until then each night's summary lacks them. The full contracts file is still stored, so `resummarize()` can backfill those nights after the merge. |
| `X-10` | Reconcile `CLAUDE.md`'s 3-agent cap with D-013 (cap 6) | `building (integrator)` | `CLAUDE.md:1927`, `:2263`. A records lane does not edit `CLAUDE.md`. |
| `X-11` | Five terminal-grade properties re-walked **on `/terminal`** | `building (Lane T1)` | The 2026-09-24 "5/5 PASS" ran on `/charts` and `/screener`, not the shell. This is V22 below. |
| `X-12` | `/calendar` retirement (RM-L16, CX-8) | `owner-blocked (retire vs permanent coexistence)` | D-006 places the calendar inside the Terminal but does not choose. If retire: MG-7 at 0 GAP, nav graduation, MG-8 re-census, then the countdown. |
| `X-13` | MG-8 consumer re-census at countdown | `owner-blocked (X-12 first)` | The live instance is fixed (`api/services/journal_two/db.py:2302-2309`). The gate is unrun because no countdown has started. |
| `X-14` | RM-N05 MVP trial (subject Ravi, adjudicator Patrick) | `owner-blocked (Ravi records Phase A: 5 trading days or 10 occasions)` | Pre-registered 2026-09-30, not started. It tests the breadth drill, not the shell. |
| `X-15` | RM-N10 bars p95, clause 2 | `building (Lane P)` | Instrument fixed (`tools/bars_warmth_gate.py:115` `MIN_NOWAIT_N`). Needs one valid RTH run with n ≥ `MIN_NOWAIT_N`. |
| `X-16` | Ledger hygiene: `IMPLIED_ENRICHMENT_CUTOVER`, `D5_CP4_DUAL_COMPUTE_SAMPLE_RATE`, `WIRE_SURFACE_LINE_ENABLED` | `dark` | BUILT on `lane/p-platform` (branch-only): a `knobs` section in `docs/feature_flags.json` holds all three (`IMPLIED_ENRICHMENT_CUTOVER` pending, `D5_CP4_DUAL_COMPUTE_SAMPLE_RATE` armed at its 0.05 default, `WIRE_SURFACE_LINE_ENABLED` dark, repo morning-wire), held to the AST scan by `tests/test_flag_ledger_knobs.py`. Flipping `IMPLIED_ENRICHMENT_CUTOVER` is the owner's call. |
| `X-17` | Settings "Free Plan" copy contradicts D-010 (U-COPY-01) | `building (Lane P)` | `app/src/pages/Settings.jsx:2035-2046` still lists free-tier pages. Product copy, not this lane. |

## 2. Owner decisions still open

| id | item | state | note |
|---|---|---|---|
| `OD-D-001` | D-001 desk-first vs member-first | `owner-blocked (one word: close it)` | Stale "Pending". OI-07 calls it ruled, and D-007/D-010 imply a member product. |
| `OD-D-002` | D-002 licensing exposure | `moot (closed by D-011, 2026-10-02)` | ADR-0015 holds; a new source still gets its own read. |
| `OD-D-003` | D-003 decisiveness posture (one shape vs desk/stranger) | `owner-blocked (choose a, b or c)` | Renderer accepts a `posture` value either way. |
| `OD-SEAT` | Seat model (CARD 23 vs CARD 25 disagree) | `owner-blocked (one word)` | |
| `OD-OI04` | OI-04: are Bullflow, UW, Polygon-direct and TheFly still paid? | `owner-blocked (one sentence)` | |
| `OD-NEWS` | News feed (P-δ) and market-intelligence feed (U15): curated vs browsable | `owner-blocked (choose)` | |
| `OD-U16` | Desktop wrapper, plugins, scripting, marketplace (U16) | `owner-blocked (in scope at all?)` | Explore-only; there is no ruling. |
| `OD-CORP` | Corp-actions D5 producer job vs the CARD 5 exclusion (`10-roadmap/backlog.md:2032`) | `owner-blocked (revisit the CARD 5 exclusion)` | Buildable once the exclusion is lifted. |
| `OD-FIGI` | Entity OpenFIGI fallback | `owner-blocked (approve a new external source)` | |

## 3. Backlog — TERM-001..TERM-093

| id | item | state | note |
|---|---|---|---|
| `TERM-001` | Board-size bound (16) | `dark` | Branch-only (`app/src/pages/charts/boardBound.js:21`, `e509700b25`). |
| `TERM-002` | Second OPRA connection | `owner-blocked (buy it: $75/mo per Massive 2026-09-30)` | Licensing settled by D-011. |
| `TERM-003` | Confluence Radar extend/delete | `moot (ships as Options Flow tab 8; ledger G9 corrected 2026-09-27)` | `app/src/pages/OptionsFlow.jsx:114`. |
| `TERM-004` | One earnings-date authority | `building (Lane P)` | OQ-14 decided 2026-10-02 (branch-only `555457ae33`). Remainder TERM-004b: engine adapter + parity test (31% disagree), needs a uct-intelligence session; delegated by D-014. |
| `TERM-005` | Second screener universe | `owner-blocked (purchase a second whole-market universe; LIC-06)` | |
| `TERM-006` | Freshness authority in time units | `dark` | Branch-only (`app/src/components/provenance/freshnessAge.js:285`, `5bf1d08fd2`). |
| `TERM-007` | Quiet measurement window | `owner-blocked (declare a ≥104-min single-pod no-deploy window over the 09:30 open + a heavy job)` | Both prior windows started after the open. |
| `TERM-008` | Cloudflare rule / cache key | `owner-blocked (a read with Cloudflare credentials)` | The authenticated `/api/flow/data` read is agent-doable with the smoke account; the rule read is not. |
| `TERM-009` | Community call record | `live` | `api/services/community_call_record.py:33`. |
| `TERM-010` | First run = UCT Default | `live` | `app/src/pages/charts/ChartsWorkspace.jsx:2216`. |
| `TERM-011` | Ops channel split | `dark` | Steps 1–7 on master, inert (`api/services/alert_routing.py:114`). Owner creates the ops channel and sets `DISCORD_OPS_WEBHOOK_URL` + `OPS_ALERT_EMAIL_TO`. Step 8 needs fallback = 0 over a weekly cycle. |
| `TERM-012` | p95 gate measurable | `live` | `tools/bars_warmth_audit.py:73`. |
| `TERM-013` | Drop-counter reader | `dark` | `BARS_RAIL_PAGE_ENABLED` dark (`api/services/bars_rail_monitor.py:88`). Owner reads the digest verdicts. |
| `TERM-014` | RSS slope + memory attribution | `dark` | BUILT on `lane/p-platform` (branch-only), dark behind `RSS_SERIES_ENABLED` (pending, web + terminal-next-monitor): `api/services/rss_series.py` retains each 60 s `[mem]` sample with a per-subsystem census (cache entries, threads per prefix); `tools/rss_slope_report.py` = OBS-3 slope (>= 40 samples in ONE deployment, `deployments_sampled`), OBS-4 PAGE (RSS > 3,500 MB / threads > 200, exit 3), attribution ranked by growth; monitor job `memory` weekdays 09:20 ET. OBS-5 retention 400 rows / 90 d, declared. The READING needs TERM-007's quiet window (owner). |
| `TERM-015` | Cadence heartbeat roll-up | `live` | `api/terminal_next_monitor_main.py:208`. |
| `TERM-016` | Durable alert cooldowns | `live` | `api/services/chart_health_alerts.py:130`. |
| `TERM-017` | Loop-lag distribution | `owner-blocked (TERM-007 window)` | Histogram built (`api/event_loop_watchdog.py:221`). |
| `TERM-018` | Every guard can fire | `building (Lane P)` | CI live (`.github/workflows/term018-guards.yml`). 22 `declared_unobserved` guards remain to observe. |
| `TERM-019` | Provenance set + adoption rail | `live` | `app/src/components/provenance/panelAdoption.ratchet.test.js`; adoption is a shrink-only ratchet. |
| `TERM-020` | Canonical resolver (CP3) | `live` | `api/services/canonical/resolver.py:453`; caller `api/routers/breadth_monitor.py:1061`. |
| `TERM-021` | Versioned workspace document | `live` | `api/services/workspace_doc_store.py:231`. |
| `TERM-022` | Massive adapter + retirement queue | `live` | `api/services/massive_adapter.py:63`. Partner-file ack is moot (fully open since 9/29). |
| `TERM-023` | Entity master member path | `live` | `api/services/entity_master/member_resolve.py:50`; armed 10-02 (this branch's ledger). |
| `TERM-024` | Panel declares a need | `live` | `app/src/lib/panelContract.js:126`. |
| `TERM-025` | Seven more trigger types | `owner-blocked (per-type CP4/FLIP ruling for the 7 shadow types)` | 8/8 registered (`api/services/alert_taxonomy/registry.py:16`). |
| `TERM-026` | Auditor denominator | `live` | `api/auth_surface_check.py:393`. |
| `TERM-027` | Header inside error boundary | `live` | `app/src/pages/charts/WidgetHost.jsx:315`. |
| `TERM-028` | Honest blank for futures | `moot (futures removed 2026-07-27; BTC/VIX on yfinance is D-004)` | |
| `TERM-029` | GEX assumption label | `live` | `app/src/pages/OptionsFlow.jsx:4510`. |
| `TERM-030` | Calendar reader schema assertion | `live` | `api/services/calendar_week_contract.py:107`. |
| `TERM-031` | Derived Fed-speaker list | `live` | `api/routers/calendar.py:2370`. |
| `TERM-032` | "coverage n=0" for transcripts | `moot (RG-15 refuted, RG-15a)` | |
| `TERM-033` | `.catch(()=>null)` migration | `building (Lane P)` | Census rail live (77 sites); draining is the remainder. |
| `TERM-034` | I1 spec as rails | `live` | `app/src/pages/research/i1S8Boundary.test.js:562`. |
| `TERM-035` | Market clock as code | `live` | `app/src/lib/marketClock/marketClock.js:194`. The L0 strip is V7, not this. |
| `TERM-036` | Dividends onto Massive | `live` | `api/services/reference_corp_actions.py:62`. |
| `TERM-037` | Panel set from surfaces | `building (Lane T1)` | Inert declaration (`app/src/surfaces/panelSet.js:158`), parked to 2026-11-30. Audit V13 mounts it as the shell's one panel vocabulary under D-005. |
| `TERM-038` | Published address space | `live` | `ADDRESS_SPACE_ENABLED` armed; 8 kinds (`api/services/address_space.py:141-170`). |
| `TERM-039` | Feature status at point of use | `live` | `api/services/feature_status.py:118`. |
| `TERM-040` | Warm cold-pack shards | `moot (no server cache; shared-stall diagnosis instead)` | |
| `TERM-041` | Published regime vocabulary | `live` | `api/routers/regime.py:73`. |
| `TERM-042` | Re-source the EOD breadth row | `owner-blocked (set BREADTH_EOD_SOURCE=server after N clean shadow sessions)` | Armed in `shadow` (`api/services/breadth_eod_source.py:102`). |
| `TERM-043` | Figure-to-source-page link | `owner-blocked (rule: may statements be served from the SEC PIT store?)` | `FUNDAMENTALS_PIT_ENABLED` is armed, so the "dark store" premise is stale. |
| `TERM-044` | Span-anchored recap citation | `live` | `app/src/components/calendar/CallRecapSection.jsx:202`. |
| `TERM-045` | EDGAR Form 4 / 13F | `owner-blocked (CUSIP master-file terms for the 13F join; a new source under ADR-0015)` | Form 4 live (`api/routers/research.py:267`). |
| `TERM-046` | Short-interest history | `live` | `SHORT_INTEREST_SOURCE=finviz` armed (`api/services/short_interest.py:99`). |
| `TERM-047` | CoverageLine on result surfaces | `building (Lane S)` | Backend receipts for 3 no-counts surfaces + plain `/api/screener/scan`, then retire the shim. |
| `TERM-048` | Watchlist alerts onto S7 | `live` | `api/services/alert_taxonomy/watchlist_price_alerts.py:80`. |
| `TERM-049` | Per-ticker history join | `live` | `api/services/ticker_history.py:43`; LANES2 armed 10-02. |
| `TERM-050` | One provenance renderer | `building (Notebook)` | Notebook Ask still on `documentProvenance` (`app/src/pages/journal-2-0/components/notebook/AskPanel.jsx:14`). |
| `TERM-051` | Workspace version history restore | `live` | `app/src/pages/charts/ChartsWorkspace.jsx:2461`. |
| `TERM-052` | Three personalization publications | `live` | `app/src/components/chart/chartCeilings.js`. |
| `TERM-053` | Close six dependency-less routes | `live` | `api/open_reads_gate.py:480`. |
| `TERM-054` | Emit `id:` on streams | `live` | `api/routers/stream.py:91`. |
| `TERM-055` | Adjustment as labelled policy | `building (Lane P)` | Raw/unadjusted parallel view + an intraday split detector (`app/src/components/chart/AdjustmentLabel.jsx:20`). |
| `TERM-056` | Command-string interchange | `building (Notebook)` | Note-address half in the Notebook editor (`api/services/address_space.py:387`). |
| `TERM-057` | "Why isn't X here" receipt | `live` | `app/src/components/provenance/AbsenceReceipt.jsx:7`. |
| `TERM-058` | Authoring-time live match count | `live` | `api/routers/screener.py:258`. |
| `TERM-059` | Label stale / proxied values | `building (Lane P)` | NAAIM live (`app/src/pages/breadth/naaimAge.js:13`). AAII, CBOE P/C, CNN F/G and the H8 proxies remain. |
| `TERM-060` | Machine-checkable citation pointer | `live` | `api/services/canonical/claims.py:149`. |
| `TERM-061` | Skill file, whitelist, MCP | `owner-blocked (rule to publish the skill file; MCP also needs RATE_LIMIT_POLICY at enforce)` | `api/services/skill_whitelist.py:52`. |
| `TERM-062` | Publish cooldowns | `live` | `api/services/alert_taxonomy/cooldowns.py`. |
| `TERM-063` | Keyboard registry | `live` | `app/src/pages/command/shortcutRegistry.js:50`. |
| `TERM-064` | One ticker resolver | `building (Lane P)` | Resolver live (`api/services/ticker_resolver.py`). Tweet ingest and the frontend still need to delegate to it. |
| `TERM-065` | DataGrid seed extraction | `building (Lane P)` | Seed live; ratchet of 14 grids to drain. |
| `TERM-066` | One format module | `building (Lane P)` | Module live; 60 formatter sites to drain. |
| `TERM-067` | Form-control layer | `building (Lane P)` | 33 unnamed controls + a `Radio` primitive (`app/src/components/ui/formControls.census.test.js:886`). |
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
| `TERM-078` | AI meters + population cap | `dark` | Meters live; `AI_POPULATION_CAP_MODE` dark (`api/services/ai_population_cap.py:11`). Shadow week, then enforce. |
| `TERM-079` | Typed context channels | `live` | `app/src/lib/context/contextChannels.jsx:71`. |
| `TERM-080` | Per-route rate limits | `dark` | `RATE_LIMIT_POLICY` dark (`api/rate_limit_policy.py`). Shadow week, then enforce. |
| `TERM-081` | Entitlements toolkit + paywall-all | `dark` | OI-12 paywall-all is branch-only (`app/src/constants/freePages.js:21`). The second toolkit's licensing blocker is cleared by D-011 (`api/services/entitlements.py:254`). |
| `TERM-082` | Widen serve_stale | `dark` | `/api/breadth-monitor` (census rank 5) BUILT on `lane/p-platform` (branch-only): bounded `ServeStale` slot per (days,end,anchor), 1,500 s = 5x the body TTL, 16 keys, `Server-Timing` `desc="stale-swr"`; a generation sentinel under the `breadth_history_` prefix every writer already deletes means a collector push is never answered with the pre-push body, and a build straddling a write is never remembered (`tests/test_breadth_monitor_serve_stale.py`). Remainder: the post-deploy p95 read, after deploy. |
| `TERM-083` | Backup rail + restore rehearsal | `live` | `api/services/store_backup.py`. |
| `TERM-084` | ICS token TTL / rotation | `live` | `api/services/ics_export_token.py:73`. |
| `TERM-085` | Wire sentence naming the surface | `dark` | morning-wire PC-side `WIRE_SURFACE_LINE_ENABLED`, unledgered (X-16). Owner sets it on the PC. |
| `TERM-086` | Inbound TradingView alert receiver | `live` | `api/services/inbound_alerts.py:155`. |
| `TERM-087` | Answer returns an editable object | `live` | `api/services/ai_search_scan_object.py:89`; not yet exercised by a live call. |
| `TERM-088` | Decision record member surface | `live` | `api/routers/decision_record.py:32`; armed 10-02. |
| `TERM-089` | Wire archive replay | `live` | `app/src/pages/MorningWire.jsx:404`. |
| `TERM-090` | EP base rate beside the flag | `live` | `app/src/components/tiles/EpBaseRate.jsx:68`. |
| `TERM-091` | Curriculum into the education store | `live` | `api/services/education_curriculum.py:434`. |
| `TERM-092` | Re-time the wire watchdog to 09:35 | `live` | `api/main.py:2567`. |
| `TERM-093` | "What else was open" capture | `dark` | Branch-only (`api/services/what_else_open.py:72`); `WHAT_ELSE_OPEN_CAPTURE_ENABLED` pending. |

## 4. Break-out ledger — BRK-01..BRK-10

| id | item | state | note |
|---|---|---|---|
| `BRK-01` | Pre-trade options analysis | `building (Lane O)` | Chain, surface and expiry payoff live (`api/routers/options_chain.py:85`). Backtest dark (`OPTIONS_BACKTEST_ENABLED`, branch-only). Remainders are the FT-001/011/012/014/015/018 rows. |
| `BRK-02` | Screen universe + expressiveness | `owner-blocked (purchase a second universe; TERM-005)` | Logic built dark (`SCREENER_LOGIC_ENABLED`, `api/services/screener/logic.py:38`). |
| `BRK-03` | Alert authoring grammar | `building (Lane S)` | A typed alert grammar (FT-029); today's grammar is the screener's. |
| `BRK-04` | Mobile push alert channel | `dark` | D-012. `WEB_PUSH_ENABLED` pending, branch-only (`api/services/web_push.py:101`). Owner: `tools/gen_vapid_keys.py` + 3 VAPID vars on web. |
| `BRK-05` | Config-as-citation | `dark` | `SCREENER_NL_COMPILE_ENABLED` (+LOGIC), branch-only (`api/routers/screener_nl.py:44`). |
| `BRK-06` | Programmatic egress | `owner-blocked (rule to publish skill.md / MCP; TERM-061)` | Personal API armed; exports dark (`DATA_EXPORTS_ENABLED`). |
| `BRK-07` | Per-surface status disclosure | `live` | `app/src/pages/Support.jsx:1316` (TERM-039). FT-046 is separate. |
| `BRK-08` | Dealer vocabulary with a base rate | `building (Lane O)` | Vocabulary built dark (`api/routers/options_analytics.py:77`); the base rate (how often levels held) is not computed. |
| `BRK-09` | Transcript / filing retrieval depth | `building (Lane S)` | Boolean/NEAR/synonym operators over transcripts (filings have them, dark). A transcript backfill also needs FMP storage / AI-processing rights read (licensing settled for FMP by D-011). |
| `BRK-10` | Implied-move calibration | `dark` | `IV_HISTORY_ENABLED`, branch-only (`api/routers/iv_history.py:60`). Meaningful at ≥4 logged prints; the log was armed 2026-10-02. |

## 5. Coverage gaps — COV-01..COV-12

| id | item | state | note |
|---|---|---|---|
| `COV-01` | Seasonality | `live` | `api/routers/seasonality.py:59`; armed 10-02. |
| `COV-02` | Options screening | `dark` | `OPTIONS_SCREENER_ENABLED`, branch-only (`api/routers/options_screener.py:55`). Ranks at ≥10/20 logged sessions. |
| `COV-03` | IV percentile / unusual volume | `owner-blocked (set OPTIONS_SCREENER_TAPE_URL on terminal-next-monitor)` | `PUSH_SECRET` is now there (measured 2026-10-03); the tape URL is not. IV ranks also need ≥20 sessions. |
| `COV-04` | Filing blackline | `live` | `api/routers/filing_blackline.py:42`; armed 10-02. |
| `COV-05` | People / executive intelligence | `dark` | `RESEARCH_PEOPLE_ENABLED`, branch-only (`api/routers/research_cov.py:67`). No board/bio source yet (D-008 asks for it). |
| `COV-06` | Version history on user artefacts | `live` | `api/services/artifact_versions.py:81` (all four kinds). |
| `COV-07` | Broker estimates + consensus drift | `owner-blocked (upgrade the FMP plan or add a vendor for named-analyst EPS)` | Drift built dark (`ESTIMATE_HISTORY_ENABLED`, accumulating from 2026-10-02). NG-15 retracted (D-008). |
| `COV-08` | Depth of book / L2 / T&S | `owner-blocked (buy a depth-of-book / Level II feed)` | In scope by D-008. |
| `COV-09` | SEC filings feed (re-id DL-036) | `dark` | `FILINGS_FEED_ENABLED` pending, branch-only (`api/services/filings_feed.py:1`). |
| `COV-10` | Monitor groups / list subscriptions | `building (Lane R)` | List-subscribe live (`api/routers/auth.py:650`). Theme and saved-screen sources, plus more than 4 groups, remain. |
| `COV-11` | Indicator templates object | `building (Lane R)` | Same as FT-070; coordinate with the indicator programme. |
| `COV-12` | Congressional / political-disclosure trackers (was COV-09) | `owner-blocked (FMP key holder probes /stable/senate-trades and /stable/house-trades; counsel reads the eFD/House restriction before any fallback)` | |

## 6. Feature register — FT-001..FT-080

| id | item | state | note |
|---|---|---|---|
| `FT-001` | Risk-profile graph | `building (Lane O)` | Expiry curve live (`app/src/pages/research/tabs/optionPayoff.js`). Missing: a "today at IV" curve and PoP. |
| `FT-002` | Simulated multi-leg trades | `dark` | `OPTIONS_MULTI_LEG_ENABLED`. |
| `FT-003` | Probability analysis | `dark` | `OPTIONS_PROBABILITY_ENABLED`. |
| `FT-004` | thinkBack past-date trade | `dark` | `OPTIONS_BACKTEST_ENABLED`. Needs one live run against our Massive key before arming. |
| `FT-005` | Earnings-reaction panel | `dark` | `EARNINGS_REACTION_PANEL_ENABLED`; the implied leg needs log history. |
| `FT-006` | IV rank header label | `dark` | `OPTIONS_IV_RANK_ENABLED`; ≥20 logged sessions. |
| `FT-007` | Daily implied vs actual | `dark` | `OPTIONS_DAILY_MOVE_ENABLED`; 20 pairs. |
| `FT-008` | Implied-move calibration score | `dark` | `IV_HISTORY_ENABLED`, branch-only. |
| `FT-009` | ATM straddle history | `dark` | `OPTIONS_STRADDLE_HISTORY_ENABLED`. |
| `FT-010` | IV-crush table | `dark` | `OPTIONS_IV_CRUSH_ENABLED`; 4 earnings windows. |
| `FT-011` | Earnings strategy backtester | `building (Lane O)` | 4 strategies on a monthly rule (dark). Missing: earnings-anchored entry and more strategies. |
| `FT-012` | Theoretical-value edge ranking | `building (Lane O)` | BS pricer exists (dark); no edge ranking. |
| `FT-013` | Mid-price backtest caveat | `dark` | `OPTIONS_BACKTEST_ENABLED`. |
| `FT-014` | Chain + builder + finder | `building (Lane O)` | Chain live, builder dark; per-underlying strategy finder missing. |
| `FT-015` | Full Greek set chain | `building (Lane O)` | Rho / lambda / epsilon, a C/P mode, a streamed chain. |
| `FT-016` | Chain → chart → pricer drill | `dark` | `OPTIONS_PRICER_ENABLED`. |
| `FT-017` | OSA what-if fields | `dark` | `OPTIONS_PRICER_ENABLED`. |
| `FT-018` | Implied-vol surface | `building (Lane O)` | Surface live (armed). 25Δ/10Δ RR/BF tenor table + a 3D view missing. |
| `FT-019` | Option monitor EVTS / HV | `dark` | `OPTIONS_MONITOR_ENABLED`. |
| `FT-020` | Volatility endpoints | `dark` | `OPTIONS_VOL_ENDPOINTS_ENABLED`; VRP/rank need the log. |
| `FT-021` | Multi-category screener | `live` | `api/routers/screener.py:274`. |
| `FT-022` | Named preset scans | `dark` | `SCREENER_PATTERN_PRESETS_ENABLED`; owner glance vs the Pattern-Lab pause. |
| `FT-023` | Pine-style screener | `live` | `api/services/screener/query.py:21` (nightly). |
| `FT-024` | AI screener + explanation | `dark` | `SCREENER_NL_COMPILE_ENABLED`. |
| `FT-025` | Screener column presets | `live` | `api/services/screener/filters.py:718`. |
| `FT-026` | All / none / any groups | `dark` | `SCREENER_LOGIC_ENABLED`. |
| `FT-027` | Scan → watchlist / query / alert | `building (Lane S)` | Promote built dark (`SCREENER_PROMOTE_ENABLED`); alerts on spec screens need a membership snapshot. |
| `FT-028` | Live count + as-of | `dark` | `as_of` is branch-only. |
| `FT-029` | `where` grammar | `building (Lane S)` | Typed subjects, `$AAPL`/`#list` scope prefixes, arithmetic. |
| `FT-030` | English → grammar compiler | `dark` | `SCREENER_NL_COMPILE_ENABLED`. |
| `FT-031` | Three alert kinds | `live` | `api/services/alert_conditions.py:44`. |
| `FT-032` | Alert on the position drawing | `building (Lane S)` | Line-drawing alerts live; `alertKindFor` returns null for the position drawing. |
| `FT-033` | Outbound webhook alerts | `dark` | `ALERT_WEBHOOKS_ENABLED`. |
| `FT-034` | Six trigger source types | `owner-blocked (per-type CP4/FLIP ruling; TERM-025)` | A rating-change type is agent-buildable (Lane S) once ruled. |
| `FT-035` | Per-alert lifecycle | `building (Lane S)` | Expiry dark (`ALERT_LIFECYCLE_ENABLED`). Remind needs per-channel read-state; reverse waits on the price_level flip. |
| `FT-036` | Routing rule + suspend | `building (Lane S)` | Dark (`ALERT_ROUTING_RULE_ENABLED`); apply it to the TERM-048 bridge `_deliver_via_s7`. |
| `FT-037` | Four channels incl. SMS / push | `owner-blocked (Twilio or similar + 10DLC registration)` | Email/in-app live; push dark (BRK-04). |
| `FT-038` | Push topics + Telegram bot | `owner-blocked (create a BotFather bot and supply the token)` | Chat-linking is agent-buildable afterwards. |
| `FT-039` | Option-stance fit score | `dark` | `OPTIONS_STANCE_ENABLED`; iv_regime blank under 20 sessions. |
| `FT-040` | MCP + skill.md | `owner-blocked (rule to publish; TERM-061)` | |
| `FT-041` | Excel export + API | `dark` | `DATA_EXPORTS_ENABLED`. |
| `FT-042` | Metered CSV / Excel | `dark` | `DATA_EXPORTS_ENABLED` (a protective cap, NG-06). |
| `FT-043` | Chart data CSV | `dark` | `DATA_EXPORTS_ENABLED`. |
| `FT-044` | Competitor's own "no API" | `moot (describes SpotGamma's absence; nothing to build)` | |
| `FT-045` | Beta pills + today / working-on | `live` | `app/src/components/featureStatus/FeatureStatusStrip.jsx`. |
| `FT-046` | Per-surface how-to checklist | `building (Lane R)` | The mechanism is agent-buildable; the copy needs the owner's voice sign-off. |
| `FT-047` | Named dealer vocabulary | `dark` | `OPTIONS_POSITIONING_VOCAB_ENABLED`. |
| `FT-048` | HIRO | `live` | `api/gex_router.py:12` (different shape). |
| `FT-049` | TRACE heatmaps | `building (Lane O)` | Gamma heatmap dark (`OPTIONS_GEX_HEATMAP_ENABLED`); delta-pressure / charm, projection and 1-min refresh missing. |
| `FT-050` | Options Impact gauge | `dark` | `OPTIONS_IMPACT_ENABLED`; 20-session average. |
| `FT-051` | Two positioning models | `live` | `api/gex_router.py:35`. |
| `FT-052` | Negative OI explained | `dark` | `OPTIONS_DEALER_SHORT_ENABLED`. |
| `FT-053` | Level files into other platforms | `building (Lane O)` | Licensing cleared by D-011, so it is now agent-buildable. No lane listed it in the audit, so it is proposed here for Lane O. |
| `FT-054` | "N minutes ago" overlay | `building (Lane O)` | Needs a durable intraday per-strike exposure store on flow-worker. |
| `FT-055` | Positioning primitives | `dark` | `OPTIONS_MAX_PAIN_ENABLED` / `OPTIONS_NOPE_ENABLED`; GEX live. |
| `FT-056` | Market Tide | `building (Lane O)` | Dark (`OPTIONS_MARKET_TIDE_ENABLED`); per-sector tide missing. |
| `FT-057` | Tide → flow-minute jump | `building (Lane O)` | |
| `FT-058` | Boolean proximity search | `dark` | `FILING_SEARCH_ENABLED` (filings). |
| `FT-059` | Smart synonyms | `dark` | `FILING_SEARCH_ENABLED`. |
| `FT-060` | Section-scoped filing search | `dark` | `FILING_SEARCH_ENABLED`. |
| `FT-061` | Snippet Explorer | `live` | `api/routers/earnings_intel.py:493`. Depth is BRK-09. |
| `FT-062` | Filing blackline | `live` | Via COV-04. |
| `FT-063` | Documents tab (filings) | `live` | `api/routers/filings.py:20`. |
| `FT-064` | EVTS staged events | `dark` | `EVENTS_TIMELINE_ENABLED`. |
| `FT-065` | Seasonals tab | `live` | Via COV-01. |
| `FT-066` | 15-year seasonality | `live` | ~31-year daily window. |
| `FT-067` | Congressional trackers | `owner-blocked (as COV-12)` | |
| `FT-068` | Insider / 13F / FEC / SI / FTD datasets | `owner-blocked (an api.data.gov key + an issuer-to-committee mapping for FEC)` | Insider, 13F and SI live; FTD dark (`FTD_DATASET_ENABLED`, needs `ftd_ingest` to have run). |
| `FT-069` | MNRS history + copy / link | `live` | `api/services/artifact_versions.py:97`. |
| `FT-070` | Indicator templates | `building (Lane R)` | Coordinate with the indicator programme. |
| `FT-071` | Broker estimates + drift | `owner-blocked (as COV-07: named-analyst tier)` | Built dark (`BROKER_ESTIMATES_ENABLED`); should read COV-07's snapshot instead of a second FMP call. |
| `FT-072` | Option / Spread Hacker | `building (Lane O)` | Dark (`OPTIONS_SCREENER_ENABLED`); a saved Spread Book is missing. |
| `FT-073` | Per-strategy option screeners | `building (Lane O)` | 5 of 9 (dark); butterflies, multi-leg, block trades, by-expiration remain. |
| `FT-074` | Unusual options volume report | `owner-blocked (as COV-03: OPTIONS_SCREENER_TAPE_URL)` | |
| `FT-075` | Sizzle Index | `building (Lane O)` | The 5-day window variant. |
| `FT-076` | MGMT surface | `dark` | `RESEARCH_PEOPLE_ENABLED`; bios/board need a source (D-008). |
| `FT-077` | Level II / T&S | `owner-blocked (as COV-08: buy an L2 feed)` | |
| `FT-078` | Candlestick pattern detection | `owner-blocked (a go to re-surface the toggle, given the 9/7 Pattern-Lab pause)` | Overlay mounted (`app/src/components/StockChart.jsx:19753`), but the toolbar toggle is dead code (`app/src/components/chart/ChartToolbar.jsx:1431`, `{false && …}`). |
| `FT-079` | Chart-pattern auto-labelling | `owner-blocked (same toggle as FT-078)` | Fibonacci patterns would be agent-buildable afterwards. |
| `FT-080` | Social-sentiment overlay | `dark` | `MENTION_SERIES_ENABLED`. Polarity needs the owner to reverse the "no message text kept" rule (`buzz_store.py:3`). |

## 7. Untracked promises (scope audit §2; no TERM / RM / FT / COV / BRK row before this file)

| id | item | state | note |
|---|---|---|---|
| `V1` | Fix the false ABSENT answers for OSCR / OBT (`functions.js:121-124`) | `building (Lane T1)` | |
| `V1b` | Codes for the built-but-uncoded Research sections + Depth panels, IV history, Tide, strategy screens, Notebook, Exports | `building (Lane T1)` | |
| `V13` | Doors → panels (26 of 46 codes leave the shell), with one panel vocabulary | `building (Lane T1)` | Includes TERM-037. |
| `V6a` | Honour stored arguments (`ChartPanel.jsx:7` hard-codes `tf="D"`) | `building (Lane T1)` | |
| `V22` | Throwing-panel rail + re-run the five-property walkthrough on `/terminal` | `building (Lane T1)` | Also X-11. |
| `RM-X02` | `/terminal` in `tools/hub_nav_smoke.py` + a pre-authored rollback branch | `building (Lane T1)` | |
| `V2` | `terminal_layout` onto the versioned TERM-021 store + version restore | `building (Lane T2)` | A bad blob silently returns DEFAULT today (`useTerminalLayout.js:48`). |
| `V3` | Named, addressable, shareable terminal boards (FB A-2 for the shell) | `building (Lane T2)` | |
| `V9` | Panel close + undo, duplicate, pop-out | `building (Lane T2)` | |
| `V10` | Channel record instead of A-D+N; `linkable:false`; late panel inherits context | `building (Lane T2)` | |
| `V11` | Recents split by kind + favourites | `building (Lane T2)` | |
| `V12` | Board-level density token + control | `building (Lane T2)` | |
| `V14` | Per-ticker workspace preset | `building (Lane T2)` | |
| `V19` | "Keep the old page" revert preference, or a record that the redirect is the revert | `building (Lane T2)` | |
| `V4` | Global focus key + keyboard panel switching; palette as a second front end of one grammar | `building (Lane T3)` | |
| `V5` | Interpreted-parse echo before Enter | `building (Lane T3)` | |
| `V6b` | Symbol expressions, channel targeting, member aliases, argument shape as you type | `building (Lane T3)` | |
| `V6c` | Published ranking with Reset | `building (Lane T3)` | |
| `V6d` | Every command is a URL | `building (Lane T3)` | |
| `V15` | MOVE / WIIM + per-member "since last visit" diff | `building (Lane T3)` | |
| `V16` | Natural-language fallback + `ASK <question>` | `building (Lane T3)` | |
| `V17` | Server-side command telemetry + personalised ranking | `building (Lane T3)` | |
| `V18` | Comparison modes beyond company-vs-company | `building (Lane T3)` | |
| `HELP` | One-page address space + row-number `<GO>` | `building (Lane T3)` | |
| `V7` | L0 strip (clock, regime, alert inbox, channel), desktop and phone | `building (Lane T4)` | |
| `V8` | Panel freshness / as-of wired to TERM-006 | `building (Lane T4)` | |
| `V20` | MG-7: the hub `calendar` mode resolves under `/terminal/calendar` (the only GAP of 31) | `building (Lane T4)` | The hub is a separate workstream (stage-2 PATRICK-MERGE, H14), so coordinate rather than land blind. |
| `P14a` | Phone shell: stored-panel switcher + panel-count control | `building (Lane T4)` | In scope by D-007 (NG-10 retracted). |
| `P14b` | `/charts` phone: Multi-Chart grid, compare, version-history door | `building (Lane T4)` | In scope by D-007. |
| `NAV` | Nav graduation `to:'/terminal'` + the fresh viewport-lock measurement | `building (Lane T4)` | Runs at arming time (X-02). |
| `EXPORT-FLOW` | Options-flow export from flow-worker | `building (Lane O)` | |
| `SCR-URL` | Grouped logic carried in the screener URL | `building (Lane S)` | |
| `AC-2` | One channel registry instead of per-alert webhook names | `building (Lane S)` | |
| `AC-4` | Per-trigger-type queue caps with a reserve | `building (Lane S)` | |
| `AC-7` | Per-trigger ops monitor + channel-health view | `building (Lane S)` | |
| `AC-11` | Save-time fork: frozen list / re-runnable definition / standing alert (UC-4) | `building (Lane S)` | |
| `D-1` | Three-state earnings-date status with timestamps | `building (Lane R)` | Only a binary `date_est` today (`calendar.py:1221`). |
| `D-2` | "First confirmed" timestamp on `calendar_date_history` | `building (Lane R)` | |
| `D-3` | Index-rebalance dates on the calendar | `building (Lane R)` | |
| `D-4` | Transcript chapters / jump to Q&A + an "AI-generated, not reviewed" recap label | `building (Lane R)` | `CallRecapSection.jsx:216,242`. |
| `D-5` | Tape + transcript replay | `building (Lane R)` | |
| `D-6` | Story versioning and retraction | `building (Lane R)` | |
| `D-7` | Coarse news importance label | `building (Lane R)` | |
| `D-8` | Read / unread on news | `building (Lane R)` | |
| `D-9` | Personalization UC-1: consumers of `/api/member/interest` | `building (Lane R)` | On master with no caller. |
| `D-10` | Personalization UC-3: explain list order | `building (Lane R)` | `calendar/importance.js:74` is a silent boost. |
| `D-11` | Entity UC-1: "formerly / now trades as" notice | `building (Lane R)` | |
| `D-12` | Canonical UC-5: show when two computations of one metric disagree | `building (Lane R)` | |
| `D-13` | FDA / PDUFA dates on the events calendar | `owner-blocked (a PDUFA date source; a new source under ADR-0015)` | |
| `ARCH-5B8` | Store retention registry visible to `disk_watchdog` | `dark` | BUILT on `lane/p-platform` (branch-only): `api/services/store_retention.py` registers 15 stores (member flag, rule, pruned tables, sweep); `disk_watchdog` prints each top consumer's retention or `UNDECLARED`; `may_prune` fails closed and guards `artifact_versions._prune` and the RSS series prune. Declared for the first time: AI Search's per-user caps (100 threads / 200 saved) delete MEMBER rows. Rail `tests/test_store_retention.py`. |
| `ENT-UC2` | Watchlist rows keyed by entity id | `building (Lane P)` | |
| `CAP-A12` | Merge the two drag-and-drop libraries | `building (Lane P)` | |
| `FB-A3` | Doc `file:line` citation resolver | `building (Lane P)` | |
| `FB-A1` | Feature-backlog appendix A-1 | `moot (MOOT by the audit, §1b)` | |
| `PREARM` | Pre-arm "would have fired N" receipt | `moot (dropped by the TERM-062 ruling 2026-09-29)` | |
| `PP-ROLES` | Shared-instance roles (PP §1 #6) | `moot (deferred to need by its own doc)` | |
| `PP-PERSONA` | Persona re-ranking (PP §4) | `moot (deferred by its own doc)` | |
| `NG-12` | Multi-user collaboration | `moot (non-goal NG-12)` | |

## 8. What only the owner can do — the 39 `owner-blocked` rows, grouped

This replaces the 2026-09-26 table in `OWNER-ACTIONS.md`. Each line names the action; the row ids are in brackets.

**Buy, or obtain a key or account**
- Second OPRA connection, $75/mo (TERM-002).
- A second whole-market screener universe (TERM-005, BRK-02).
- A depth-of-book / Level II feed (COV-08, FT-077).
- An FMP plan upgrade or a new vendor for named-analyst EPS (COV-07, FT-071).
- An SMS provider plus 10DLC registration (FT-037).
- A Telegram bot token from BotFather (FT-038).
- An api.data.gov key for FEC (FT-068).
- A PDUFA date source (D-13).

**Read terms or approve a new source** (ADR-0015: one read per new source)
- CUSIP master-file terms for the 13F join (TERM-045).
- Someone with the FMP key runs the senate/house probe, and counsel reads the eFD/House restriction before any fallback (COV-12, FT-067).
- Approve OpenFIGI as a fallback source (OD-FIGI).

**Set one env var**
- `OPTIONS_SCREENER_TAPE_URL` on terminal-next-monitor (COV-03, FT-074).

**Rule on one question each**
- Per-type CP4/FLIP promotion for the 7 shadow trigger types (TERM-025, FT-034).
- Whether statements may be served from the SEC PIT store (TERM-043).
- Whether to publish the skill file / MCP (TERM-061, BRK-06, FT-040).
- A go to re-surface the pattern-overlay toggle despite the 9/7 Pattern-Lab pause (FT-078, FT-079).
- Set `BREADTH_EOD_SOURCE=server` after the clean shadow sessions (TERM-042).
- Retire `/calendar` or coexist permanently (X-12, then X-13).
- Close D-001 (OD-D-001).
- Choose D-003's posture (OD-D-003).
- Settle the seat model (OD-SEAT).
- Answer OI-04: are those subscriptions still paid? (OD-OI04)
- Curated vs browsable news (OD-NEWS).
- Whether U16 is in scope (OD-U16).
- Revisit the CARD 5 corp-actions exclusion (OD-CORP).

**Provide a window or a reading**
- A ≥104-min quiet window spanning the 09:30 open plus a heavy job (TERM-007, TERM-017).
- A read with Cloudflare credentials (TERM-008).
- Ravi records Phase A (X-14).
