---
id: BACKLOG-STATUS-2026-10-06
title: TERM-001..093 re-measured against origin/master, 2026-10-06
role: >
  One row per backlog ticket with its state TODAY, the evidence for that state, and the next
  action. It supersedes the STATE column of `backlog.md` §2 and the TERM rows of
  `COMPLETION-LEDGER.md` §3 where they disagree (both were written before the 2026-10-02..06
  merges). It does not re-open any ticket's scope, priority or acceptance criterion.
measured_against: origin/master d46bfb033 (code), plus branch terminal/fn-backlog for the rows marked "this branch"
method: >
  For every ticket: (1) every file the ledger or backlog cites was opened on master (all 93
  resolve; none is missing); (2) every lane a ticket names was checked with
  `git merge-base --is-ancestor origin/<lane> origin/master`; (3) flag state was read from
  `docs/feature_flags.json` on master (the ledger, NOT Railway: a flag's live value is the
  owner's to read); (4) ratchet counts were read from the rail files themselves.
status: living
date: 2026-10-06
---

# Backlog status, 2026-10-06

## 0. The answer in five lines

- **93 tickets.** Shipped 62 (one of them, TERM-055, on this branch) · needs the owner 10 · partial 9 · built and dark (waits for an owner switch) 7 · moot 4 · built but unmerged 1 (the §3 command prints these; re-run it, don't retype them).
- **Every "BUILT on lane/... (not merged)" row in `backlog.md` is now stale in the good direction.** `lane/term-001-006`, `lane/term-004-093`, `lane/p-platform`, `lane/t1..t3`, `integrate/terminal-fixes` are all ancestors of master. TERM-001, TERM-006, TERM-014, TERM-059, TERM-064, TERM-082 and TERM-093 are on master.
- **This branch (`terminal/fn-backlog`) adds three things:** TERM-055 (intraday split label live, raw "As traded" view dark), TERM-067/065 (Radio primitive, 10 more controls named, 5 more grids on the DataGrid seed), and a TERM-033 slice (the DES quote strip and the CMP compare page stop swallowing failed reads).
- **One lane is built, tested (121 pass) and NOT merged because merging it needs a feature-flag ledger edit this session was not permitted to make:** `lane/s2-finish` (TERM-047 + five alert remainders). §4 gives the exact steps.
- **Ten tickets wait on an owner decision or purchase, and seven built ones wait on an owner switch.** §5 lists each with the one command or click.

## 1. How to read a row

| state | meaning |
|---|---|
| `shipped` | On master, reachable, ungated or gate armed in the ledger. |
| `shipped (this branch)` | Done on `terminal/fn-backlog`, not yet on master. |
| `built-dark` | On master; waits for an owner to arm a flag. |
| `built-unmerged` | Built on a lane that is not an ancestor of master. |
| `partial` | Part built; the remainder is agent work (named in "next"). |
| `needs-owner` | Nothing an agent can do moves it. |
| `moot` | Superseded or excluded by a recorded ruling. |

Evidence is `file:line` on master unless it names a commit. Line numbers are as read 2026-10-06 and will drift.

## 2. The register

| TERM | short title | state now | evidence | next action |
|---|---|---|---|---|
| 001 | Board-size bound (16) | shipped | `app/src/pages/charts/boardBound.js:21`; lane/term-001-006 is an ancestor of master | none |
| 002 | Second OPRA connection | needs-owner | Massive answer 2026-09-30, `10-roadmap/2026-09-26-massive-vendor-ask.md` | owner buys it (§5) |
| 003 | Confluence Radar extend/delete | moot | ships as Options Flow tab 8, `app/src/pages/OptionsFlow.jsx:114` | none |
| 004 | One earnings-date authority | partial | `/api/calendar` decided canonical, `12-decisions/2026-10-02-term-004-term-093.md` | TERM-004b (engine conformance) is in the uct-intelligence repo, not this one: needs a uct-intelligence session |
| 005 | Second screener universe | needs-owner | LIC-06 | owner purchase (§5) |
| 006 | Freshness authority in time units | shipped | `app/src/components/provenance/freshnessAge.js:285`, 7 non-test importers | none |
| 007 | Quiet measurement window | needs-owner | both prior windows started after the open | owner declares a window (§5) |
| 008 | Cloudflare rule / cache key | needs-owner | needs a Cloudflare credential read | owner (§5) |
| 009 | Community call record | shipped | `api/services/community_call_record.py:33` | none |
| 010 | First run = UCT Default | shipped | `app/src/pages/charts/ChartsWorkspace.jsx:2216` | none |
| 011 | Ops channel split | built-dark | `api/services/alert_routing.py:114`; inert until two env vars exist | owner creates channel + sets vars (§5) |
| 012 | p95 gate measurable | shipped | `tools/bars_warmth_audit.py:73` | none |
| 013 | Drop-counter reader | built-dark | `api/services/bars_rail_monitor.py:88`; `BARS_RAIL_PAGE_ENABLED` dark | owner arms (§5) |
| 014 | RSS slope + attribution | built-dark | `api/services/rss_series.py`, `tools/rss_slope_report.py` on master; `RSS_SERIES_ENABLED` pending | owner arms (§5) |
| 015 | Cadence heartbeat roll-up | shipped | `api/terminal_next_monitor_main.py:208`; `CADENCE_ROLLUP_ENABLED` armed | none |
| 016 | Durable alert cooldowns | shipped | `api/services/chart_health_alerts.py:130` | none |
| 017 | Loop-lag distribution | needs-owner | histogram built, `api/event_loop_watchdog.py:221` | needs TERM-007's window |
| 018 | Every guard can fire | partial | CI `.github/workflows/term018-guards.yml`; `12-decisions/gates/term-018-guard-observations.json`: 12 observed, **20** declared_unobserved (was 22) | observe the 20 in production; agent-runnable only from production logs |
| 019 | Provenance set + adoption rail | shipped | `app/src/components/provenance/panelAdoption.ratchet.test.js` | adoption is a shrink-only ratchet |
| 020 | Canonical resolver (CP3) | shipped | `api/services/canonical/resolver.py:453` | none |
| 021 | Versioned workspace document | shipped | `api/services/workspace_doc_store.py:231`; armed | none |
| 022 | Massive adapter + retirement queue | shipped | `api/services/massive_adapter.py:63` | per-file migration is follow-on |
| 023 | Entity master member path | shipped | `api/services/entity_master/member_resolve.py:50` | none |
| 024 | Panel declares a need | shipped | `app/src/lib/panelContract.js:126` | none |
| 025 | Seven more trigger types | needs-owner | 8/8 registered, `api/services/alert_taxonomy/registry.py:16` | per-type CP4/FLIP ruling (§5) |
| 026 | Auditor denominator | shipped | `api/auth_surface_check.py:393` | none |
| 027 | Header inside error boundary | shipped | `app/src/pages/charts/WidgetHost.jsx:315` | none |
| 028 | Honest blank for futures | moot | futures removed 2026-07-27; D-004 | none |
| 029 | GEX assumption label | shipped | `app/src/pages/OptionsFlow.jsx:4510` | none |
| 030 | Calendar reader schema assertion | shipped | `api/services/calendar_week_contract.py:107` | none |
| 031 | Derived Fed-speaker list | shipped | `api/routers/calendar.py:2370` | none |
| 032 | "coverage n=0" for transcripts | moot | RG-15 refuted (RG-15a) | none |
| 033 | `.catch(()=>null)` migration | partial | this branch `2c9ee09b5`: QuoteStrip + useComparison moved onto `sectionFetcher`; `app/src/lib/swallowedFetch.baseline.json` 63 → **61** sites | drain the terminal-reached research hooks next (`useEarningsTable`, `useFundamentals`, `useFundamentalSnapshot`, `useExpectedMove`, `useOwnership`); each needs its consumer to render `error` |
| 034 | I1 spec as rails | shipped | `app/src/pages/research/i1S8Boundary.test.js:562` | none |
| 035 | Market clock as code | shipped | `app/src/lib/marketClock/marketClock.js:194` | none |
| 036 | Dividends onto Massive | shipped | `api/services/reference_corp_actions.py:62` | none |
| 037 | Panel set from surfaces | shipped | the shell consumes it: `app/src/pages/terminal/surfacePanels.js:16` imports `SURFACE_PANELS` | none (the ledger's "inert, parked" note is stale) |
| 038 | Published address space | shipped | `api/services/address_space.py:141`; armed | none |
| 039 | Feature status at point of use | shipped | `api/services/feature_status.py:118` | none |
| 040 | Warm cold-pack shards | moot | no server cache | none |
| 041 | Published regime vocabulary | shipped | `api/routers/regime.py:73` | none |
| 042 | Re-source the EOD breadth row | needs-owner | `BREADTH_EOD_SOURCE` armed at `shadow`, `api/services/breadth_eod_source.py:102` | owner sets `server` after clean shadow sessions (§5) |
| 043 | Figure-to-source-page link | needs-owner | `FUNDAMENTALS_PIT_ENABLED` armed | owner rules whether statements may be served from the PIT store (§5) |
| 044 | Span-anchored recap citation | shipped | `app/src/components/calendar/CallRecapSection.jsx:202` | none |
| 045 | EDGAR Form 4 / 13F | needs-owner | Form 4 live, `api/routers/research.py:267` | 13F needs the CUSIP master-file terms (§5) |
| 046 | Short-interest history | shipped | `api/services/short_interest.py:99` | none |
| 047 | CoverageLine on result surfaces | built-unmerged | `lane/s2-finish` (`5afa0b3af`): `api/services/coverage_receipt.py`, receipts on scans/screener/volume-scan, the screener shim retired; `tests/test_coverage_receipts_scans.py` + lane tests 121 passed on a trial merge | merge needs one feature-flag ledger edit (§4) |
| 048 | Watchlist alerts onto S7 | shipped | `api/services/alert_taxonomy/watchlist_price_alerts.py:80` | none |
| 049 | Per-ticker history join | shipped | `api/services/ticker_history.py:43`; armed | none |
| 050 | One provenance renderer | partial (out of this lane's scope) | last surface is Notebook Ask, `app/src/pages/journal-2-0/components/notebook/AskPanel.jsx:14` | Notebook workstream; `journal-2-0/**` is off-limits here |
| 051 | Version history restore | shipped | `app/src/pages/charts/ChartsWorkspace.jsx:2461` | none |
| 052 | Personalization publications | shipped | `app/src/components/chart/chartCeilings.js` | none |
| 053 | Close six dependency-less routes | shipped | `api/open_reads_gate.py:480` | none |
| 054 | Emit `id:` on streams | shipped | `api/routers/stream.py:91` | none |
| 055 | Adjustment as a labelled policy | shipped (this branch), raw view built-dark | merge `1464023a7`: intraday split detector (`api/services/bars_sanitize.py::intraday_unadjusted_splits`), intraday basis (`api/services/adjustment_basis.py::_intraday_basis`), label on intraday charts; raw view `api/services/raw_price_view.py` behind `RAW_PRICE_VIEW_ENABLED` (dark) | owner arms the raw view (§5) |
| 056 | Command-string interchange | partial (out of scope) | Floor half shipped; note-address half is the Notebook editor | Notebook workstream |
| 057 | "Why isn't X here" receipt | shipped | `app/src/components/provenance/AbsenceReceipt.jsx:7` | none |
| 058 | Live match count | shipped | `api/routers/screener.py:258` | none |
| 059 | Label stale / proxied values | shipped | `app/src/pages/breadth/naaimAge.js`, `app/src/pages/breadth/sentimentAge.js` (lane/p-platform merged) | none |
| 060 | Machine-checkable citation pointer | shipped | `api/services/canonical/claims.py:149` | none |
| 061 | Skill file, whitelist, MCP | needs-owner | `api/services/skill_whitelist.py:52` | owner rules to publish (§5) |
| 062 | Publish cooldowns | shipped | `api/services/alert_taxonomy/cooldowns.py` | none |
| 063 | Keyboard registry | shipped | `app/src/pages/command/shortcutRegistry.js:50` | shortcut work is the fn-daily lane's |
| 064 | One ticker resolver | shipped | `app/src/lib/tickerResolver.js`, consumed by `app/src/floor2/Composer.jsx` | none |
| 065 | DataGrid seed extraction | partial | this branch `1b391f926`: UCT 20 + Live Flow sorts on the seed; `dataGridSeed.rail.test.js` BASELINE 14 → **9** | drain the remaining 9 hand-rolled grids |
| 066 | One format module | partial | 46 sites in `app/src/lib/presentation/handRolledFormatters.baseline.json`; `lane/p2-ratchets-a` is SUPERSEDED (visual round 2's `formatCompactTerminal` already migrated QuoteStrip and statementSeries; the lane conflicts on both) | do not merge the lane; drain the 46 sites against `formatCompactTerminal` |
| 067 | Form-control layer | partial | this branch `1b391f926`: `app/src/components/ui/Radio.jsx` + 10 sites named; `UNNAMED_BASELINE` 33 → **23** | name the remaining 23 |
| 068 | Cohort store + kill switch | shipped | `api/services/rollout_gate.py:21` | none |
| 069 | Retire yfinance/BS chain leg | shipped | `tests/test_term069_chain_leg_retired.py:74` | none |
| 070 | market-narrative 20.8 s | shipped | `api/services/market_narrative_swr.py` | none |
| 071 | One regime authority | shipped | `tests/test_regime_authority.py` | none |
| 072 | `_fmp_get` onto D1 adapter | shipped | `api/services/earnings_estimates.py:352` | none |
| 073 | Analyst pass into a timeline | shipped | `api/services/research/analyst_revisions.py:39` | none |
| 074 | Wire view reachable | shipped | `app/src/pages/calendar/viewLadder.js:8` | none |
| 075 | Unify taxonomies | shipped | `api/services/a8_taxonomy.py:150` | none |
| 076 | Device-local vs cross-device | shipped | `app/src/pages/settings/DeviceSyncCard.jsx` | none |
| 077 | Copy-or-link at import | shipped | `api/services/watchlist_origin.py:29` | none |
| 078 | AI meters + population cap | built-dark | meters live; `AI_POPULATION_CAP_MODE` dark, `api/services/ai_population_cap.py:11` | owner: shadow week, then enforce (§5) |
| 079 | Typed context channels | shipped | `app/src/lib/context/contextChannels.jsx:71` | panel linking is the fn-daily lane's |
| 080 | Per-route rate limits | built-dark | `api/rate_limit_policy.py`; `RATE_LIMIT_POLICY` dark | owner: shadow week, then enforce (§5) |
| 081 | Entitlements column + paywall-all | partial | paywall-all shipped, `FREE_PAGES = []` at `app/src/constants/freePages.js:21`; column at `api/services/entitlements.py:254` | second toolkit needs OI-03 (§5) |
| 082 | Widen serve_stale | shipped | `/api/breadth-monitor` slot on master (`tests/test_breadth_monitor_serve_stale.py`) | none |
| 083 | Backup rail + rehearsal | shipped | `api/services/store_backup.py` | none |
| 084 | ICS token TTL / rotation | shipped | `api/services/ics_export_token.py:73` | none |
| 085 | Wire sentence naming the surface | built-dark | morning-wire repo, `WIRE_SURFACE_LINE_ENABLED` (PC-side) | owner sets it on the PC (§5) |
| 086 | Inbound TradingView receiver | shipped | `api/services/inbound_alerts.py:155` | none |
| 087 | Answer returns an editable object | shipped | `api/services/ai_search_scan_object.py:89` | not yet exercised by a live call |
| 088 | Decision record member surface | shipped | `api/routers/decision_record.py:32` | none |
| 089 | Wire archive replay | shipped | `app/src/pages/MorningWire.jsx:404` | none |
| 090 | EP base rate beside the flag | shipped | `app/src/components/tiles/EpBaseRate.jsx:68` | none |
| 091 | Curriculum into education store | shipped | `api/services/education_curriculum.py:434` | none |
| 092 | Wire watchdog to 09:35 | shipped | `api/main.py:2567` | none |
| 093 | "What else was open" capture | built-dark | `api/services/what_else_open.py:72` on master (lane/term-004-093 merged); `WHAT_ELSE_OPEN_CAPTURE_ENABLED` pending | owner arms (§5) |

## 3. Counts (derived from §2)

```
python -X utf8 -c "import re,collections;t=open('docs/terminal-research/10-roadmap/backlog-status-2026-10-06.md',encoding='utf-8').read();rows=re.findall(r'^\| (0\d\d) \| [^|]* \| ([a-z-]+)',t,re.M);print(len(rows),collections.Counter(s for _,s in rows))"
```

The five-line summary in §0 was taken from that command's output; re-run it after any edit.

## 4. Built lanes that are NOT merged, and why

| lane | what it holds | TERM rows | disposition |
|---|---|---|---|
| `lane/s2-finish` (`5afa0b3af`, 3 ahead / 562 behind) | coverage receipts (TERM-047), alert channel registry (AC-2), queue caps (AC-4), ops monitor (AC-7), rating-change trigger, remind (FT-035), transcript operator search (BRK-09); all dark | 047 | **Mergeable, blocked on one edit.** A trial merge has two conflicts, both resolved (ScannerShell.jsx: keep master's meta-error notice AND the lane's CoverageLine; skill.md: regenerate). The lane's 121 tests pass. The merge then re-adds `PINE_RUNTIME_SAVE_ENABLED` at line 64 of `docs/feature_flags.json`, duplicating master's newer entry at line ~2051, which makes the flag-ledger test fail to load. The fix is to delete the lane's stale copy (lines 64-69). Editing the flag ledger was refused by this session's permission rules, so the merge was aborted. See §5 item 1. |
| `lane/s-screen-alert-remainders` | an earlier checkpoint of the same work | 047 | superseded by `lane/s2-finish`; do not merge |
| `lane/p2-ratchets-a` | TERM-066 formatter migrations | 066 | **superseded**: visual round 2 already moved QuoteStrip and statementSeries onto `formatCompactTerminal`; the lane conflicts on both and would re-introduce a second K/M/B ladder. Do not merge. |
| `lane/p2-term055` | TERM-055 | 055 | **merged on this branch** (`1464023a7`) |
| `lane/p2-ratchets-b` | TERM-067/065 | 065, 067 | **merged on this branch** (`1b391f926`) |
| `lane/alrt-centre` | an ALRT alert-centre terminal panel (new function code) | none | not a backlog ticket; a new terminal function. **Handed to the fn-features lane.** |
| `lane/mon-watchlist` | a MON monitor/watchlist terminal panel + TerminalShell edits | none | not a backlog ticket; terminal function + shell. **Handed to fn-features (panel) / fn-daily (shell edits).** |
| `lane/t4-chrome-phone` | TerminalChrome, phone switcher, panel freshness (ledger V7/V8/P14a) | none | shell chrome + phone = **handed to fn-daily.** Note that master already carries `phoneSwitcher.test.jsx` and `panelFreshness.test.jsx`, so part of this lane was re-done; re-measure before merging any of it. |
| `lane/options-log-volume` | options universe log reads `session.volume`; a `railway.json` start-command change | none | not terminal scope, and it edits `railway.json` (a deploy file shared by services). Owner/integrator call. |
| `feat/terminal-for-new-signups` | signup joins the terminal cohort | none | **moot**: master has the same behaviour via `b6887875b` (`tests/test_signup_joins_terminal_cohort.py`). |

## 5. Owner actions (the only things left that an agent cannot do)

Each line is the one command or click. Flag flips follow the repo's rule: after `--set`, confirm a new web boot, then record the flip time in `docs/feature_flags.json` in the same docs push.

1. **Let `lane/s2-finish` land (TERM-047 + alert remainders).** Either allow an agent to edit `docs/feature_flags.json`, or do it by hand: in a merge of `origin/lane/s2-finish` into this branch, keep both sides in `ScannerShell.jsx`, run `UPDATE_SKILL_WHITELIST=1 python -m pytest tests/test_skill_whitelist.py`, and delete the duplicated `"PINE_RUNTIME_SAVE_ENABLED"` block near line 64 of `docs/feature_flags.json` (master's entry near line 2051 is the current one).
2. **Ship this branch:** from the merge worktree, `git merge origin/terminal/fn-backlog` then `git push origin HEAD:master`, one push at a time after the previous web deploy reads SUCCESS.
3. **TERM-055 raw view:** `railway variables --service web --set RAW_PRICE_VIEW_ENABLED=1`
4. **TERM-093 capture:** `railway variables --service web --set WHAT_ELSE_OPEN_CAPTURE_ENABLED=1`
5. **TERM-014 RSS series:** `railway variables --service web --set RSS_SERIES_ENABLED=1` and the same on `terminal-next-monitor`
6. **TERM-013 rail page:** `railway variables --service web --set BARS_RAIL_PAGE_ENABLED=1`
7. **TERM-011 ops split:** create a Discord ops channel and webhook, then set `DISCORD_OPS_WEBHOOK_URL` and `OPS_ALERT_EMAIL_TO` on web (and flow-worker after hours)
8. **TERM-078:** `railway variables --service web --set AI_POPULATION_CAP_MODE=shadow`; after a trading week, `=enforce`
9. **TERM-080:** `railway variables --service web --set RATE_LIMIT_POLICY=shadow`; after a trading week, `=enforce`
10. **TERM-042:** after N clean shadow sessions, `railway variables --service web --set BREADTH_EOD_SOURCE=server`
11. **TERM-085:** on the PC, `setx WIRE_SURFACE_LINE_ENABLED 1` (morning-wire reads it)
12. **TERM-002:** buy the second Massive OPRA connection ($75/mo)
13. **TERM-005:** buy a second whole-market screener universe (LIC-06)
14. **TERM-007 / TERM-017:** declare one 104-minute single-pod, no-deploy window spanning the 09:30 open plus a heavy job
15. **TERM-008:** read the Cloudflare rule and cache key for the flow paths (needs the Cloudflare login)
16. **TERM-025:** one FLIP ruling per shadow trigger type (7)
17. **TERM-043:** one sentence: may statements be served from the SEC PIT store?
18. **TERM-045:** accept or decline the CUSIP master-file terms for the 13F join
19. **TERM-061:** one sentence: publish `docs/api/skill.md` or not
20. **TERM-081:** OI-03 (a)/(b) and OI-12 for a second toolkit
21. **TERM-004b:** open a uct-intelligence session for the engine adapter + parity test (31% date disagreement, `12-decisions/2026-10-02-term-004-term-093.md`)

## 6. What this re-measure found that the older records got wrong

- `backlog.md` §2 still says "BUILT on `lane/term-001-006` (not merged)" for TERM-001/006 and "on `lane/term-004-093`" for TERM-093. Both lanes are ancestors of master.
- `COMPLETION-LEDGER.md` lists TERM-014, 059, 064, 082 as "branch-only (`lane/p-platform`)". That lane is an ancestor of master.
- `COMPLETION-LEDGER.md` lists TERM-037 as "inert, parked to 2026-11-30". The terminal shell imports it (`surfacePanels.js:16`).
- TERM-018's open count is 20, not 22.
- The swallowed-fetch census is 61 sites in 52 files after this branch, not 77 in 68.
