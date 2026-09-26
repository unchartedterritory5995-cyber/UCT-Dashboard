---
id: TERM-018
title: "Can every guard fire? - the NOW-horizon verification gate (RM-N15)"
role: a per-guard classification of every alerting and health predicate that ships
status: MEASURED, unsigned. No code changed, nothing committed.
date: 2026-09-26
read_at: origin/master fac059c23 (worktree branch terminal-research); every code claim read via `git show origin/master:<path>`
---

# TERM-018 - Can every guard fire?

> ⛔⛔ **THE UNIT THIS DOCUMENT COUNTS IS THE GUARD: one code site whose predicate
> decides whether a notification is raised.** Not the alert channel, not the file, not the
> feature. A guard that sends through two channels is one guard; two tiers of one metric
> under two thresholds are two guards, because they have two predicates.

> ⛔ **SCOPE, AND WHERE IT STOPS.** The band audited here is the one both known failures
> live in: operator/health alerting, the wire-freshness family, and the S7 alert taxonomy.
> Concretely: every `chart_health_alerts.emit(` call site in `api/`, every `add_alert(` call
> site in `api/`, the freshness family (`engine.expected_wire_date`, `engine.wire_freshness`
> and their callers plus the worker-side twin), the S7 taxonomy sweeps, the guards-of-guards
> that decide whether an emit ever leaves the process, and one ratified acceptance bar.
> ⛔ **DEFERRED, NAMED, AND SIZED:** the member-delivery predicate family upstream of
> `watchlist_alert_service.deliver_alert_payload` - 10 producer call sites (command in
> §1.3). Rows G-43 and G-44 are its two sinks and are classified UNKNOWN on purpose rather
> than assumed good.

> ⛔ **NO FLAG STATE IS ASSERTED ANYWHERE IN THIS DOCUMENT.** There is no Railway access
> here and none was attempted. Where a guard sits behind an environment variable this file
> states the **literal default in the source** and nothing about production. Every "does it
> ship" claim uses three states: **absent** / **admin-mounted, no member surface** /
> **serving members**.

---

## 1 - Headline, derived

### 1.1 The population, and the commands that bound it

Run from `C:\Users\Patrick\uct-worktrees\terminal-research`:

```
# every chart_health_alerts emit call site in api/  -> 22
git grep -h -o -e 'chart_health_alerts\.emit(' -e '_alerts\.emit(' origin/master -- 'api/' | wc -l

# every add_alert occurrence in api/ -> 12 (1 definition + 2 docstring mentions + 9 code call sites)
git grep -h -o 'add_alert(' origin/master -- 'api/' | wc -l
git grep -n 'add_alert(' origin/master -- 'api/' | grep -v 'def add_alert'

# the freshness family and its callers
git grep -n 'expected_wire_date\|wire_freshness' origin/master -- 'api/'

# the S7 taxonomy sweep entry points -> 8 (1 live + 7 dark)
git grep -h -o -e 'def run_dark_sweep' -e 'def run_document_arrival_sweep' \
  origin/master -- 'api/services/alert_taxonomy/' | wc -l

# the DEFERRED band's size
git grep -n 'deliver_alert_payload(' origin/master -- 'api/' | grep -v 'def deliver_alert_payload' | wc -l
```

⚠️ `emit(` alone over `api/` also matches `bar_broadcaster` socket emits and
`fundamentals_pit/restatement_signals`; only the `chart_health_alerts` sink is an alert
channel, which is why the discovery grep names the receiver rather than the bare verb.

### 1.2 The counts, derived from this file's own table

```
grep -c '^| G-' docs/terminal-research/12-decisions/gates/term-018-can-every-guard-fire.md

awk -F'|' '/^\| G-/ {gsub(/^ +| +$/,"",$7); c[$7]++} \
  END {for (k in c) printf "%3d  %s\n", c[k], k}' \
  docs/terminal-research/12-decisions/gates/term-018-can-every-guard-fire.md \
  | sort -k1,1nr -k2,2
```

Output at the time of writing:

```
49   (guards enumerated)
 22  PROVEN
 15  FIREABLE
  6  CANNOT FIRE
  6  UNKNOWN
```

⛔ **The third class is the one this gate exists for, and it is not empty.** Six guards
cannot fire for the condition they are named and documented for. Two of the six were already
recorded (CARD 27, CARD 16) and **both are still unfixed at `origin/master`**; four are new
here.

### 1.3 What the numbers do NOT say

⚠️ **PROVEN here means a test drives the firing path**, per the rubric. For most rows
that is a unit test with an injected input, not a production observation. Exactly **one** row
carries a **recorded production firing**: G-11 (provider-coverage, 2026-08-18, quoted verbatim
in `tests/test_provider_coverage_em_refusals.py:113-115`). ⛔ **So the PROVEN count is a
statement about the test suite, not about the estate.**

⚠️ **And a control is rarer still.** Rows whose evidence cell names a control:

```
grep -c '^| G-.*[Cc]ontrol' docs/terminal-research/12-decisions/gates/term-018-can-every-guard-fire.md
grep '^| G-.*[Cc]ontrol' docs/terminal-research/12-decisions/gates/term-018-can-every-guard-fire.md | grep -o '^| G-[0-9]*'
```

Output: `4` rows - `G-04, G-19, G-24, G-47`. ⛔ Every other row's proof is one-sided:
it shows the guard CAN say yes, and nothing shows it can say no.

⚠️ **UNKNOWN is a measurement, not a shrug.** Every UNKNOWN row in §4 carries the
cheapest read that would settle it, and none of them needs a deploy.

---

## 2 - The four shapes, and where each one is actually present

The method named four shapes drawn from real instances. Found at `origin/master`:

| Shape | Real instance at master | Row |
|---|---|---|
| A comparison whose two sides come from the same drifting source | `api/main.py:2512-2513` - `wire_date < _expected_wire_date()` at 09:05 ET, and `expected_wire_date` rolls back before 09:30 | G-01, **CANNOT FIRE** |
| A bucket/threshold that empties the population it measures | `tools/bars_warmth_audit.py:28` puts `stale-swr` in `COLD`, so the WARM set empties and `if warm_ms:` at `:109` has no `else` | G-49, **CANNOT FIRE** |
| A counter that resets before it can trip | `wisdom/registry.py:395` measures age from `max(last_ok, _BOOT_WALL)` - a redeploy resets the clock, and `allowed = 2 * expected_every_s` reaches **70 days** for the monthly packet | G-33, **CANNOT FIRE** |
| A counter that resets before it can trip (second, unsettled) | `desk_session_insights.py:1296` - `streak == 4` on an in-process dict | G-27, **UNKNOWN** |
| A suppression set whose population is a rotating sample | **FIXED.** `fundamentals_monitor.py:88-92` moved defect state to disk and `run_cycle` writes back **only for the tickers this cycle checked** | G-12, still UNKNOWN for other reasons |

⭐ **One shape not on the list, found twice:** a guard whose *reachability* is zero because
nothing calls it (G-38, G-39) or nothing implements it (G-40). A dead emitter is
indistinguishable from a quiet one.

---

## 3 - The guards

Columns: name | file:line | predicate | the input that makes it TRUE | schedule or trigger | class | evidence that anything has seen it fire.

### 3.1 Freshness family

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-01 wire_missed | `api/main.py:2513` | `wire_date < expected` where `expected = _expected_wire_date()` | payload is >= **2** sessions stale | cron mon-fri 09:05 ET, `WIRE_WATCHDOG_ENABLED` default `"1"` | CANNOT FIRE | none. `git grep -l wire_missed origin/master -- tests/ app/` returns nothing. CARD 27 |
| G-02 wire_freshness stale badge | `api/services/engine.py:573` | `"fresh" if wire_d >= expected_wire_date() else "stale"` | payload dated <= prior session, read **after** 09:30 ET | read-time on every breadth/exposure serve (`_stamp_wire_status:500`) | FIREABLE | no Python test names it; `app/src/pages/dashboard/ZoneRead.test.jsx:242,314` covers the CONSUMER of the verdict only |
| G-03 leadership staleness | `api/routers/engine_data.py:87` | same compare through the alias at `:58-68` | same | per `/api/leadership` request | FIREABLE | none found |
| G-04 bars store watchdog | `api/worker_main.py:497-502` | `not healthy and not bad` -> `stale`; re-nag on `now - last >= renag_s` | prewarmer heartbeat dead, or daily store stale | worker bars-watchdog loop | PROVEN | `tests/test_bars_freshness_watchdog.py:19` (**control**: healthy never alerts) + `:24-33` drives stale -> still_stale -> recovered |

### 3.2 Bars and chart health

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-05 bars_store_unhealthy | `api/services/bars_continuous_audit.py:104` | `not bars_sqlite.store_health()["ok"]` | the `ohlcv` table is missing or unreadable | web-pod thread, every 5 min | PROVEN | `tests/test_bars_store_health_monitor.py:38` collects emits on that key; `:216-218` is an AST rail over the monitor's source |
| G-06 bars_daily_store_stale | `bars_continuous_audit.py:129` | `daily_freshness_report().get("stale")` | newest daily session < expected session | every 5 min | FIREABLE | split proof: `tests/test_bars_freshness_watchdog.py:58-62` proves the INPUT returns `stale=True` at 7 days behind, and `tests/test_chart_health_discord.py:20-24` proves this key pages - **nothing drives the emit itself** |
| G-07 intraday_hotset_stale critical | `bars_continuous_audit.py:170` | `hot_ratio >= 0.20` | >=20% of the hot set >=1 session behind | every 5 min | FIREABLE | no test. Population reachable: `_record_intraday_request` is called from the request path at `bars_fetch.py:2437` and `:3048`, same process as the audit thread |
| G-08 intraday_hotset_stale warning | `bars_continuous_audit.py:180` | `0.08 <= hot_ratio < 0.20` | 8-20% behind | every 5 min | FIREABLE | no test. ⚠️ shares ONE throttle key with G-07 - see §5.1 |
| G-09 daily_drift_detected | `api/services/bars_reconciliation.py:356` | one or more fail-severity daily diffs, current-session bar excluded | a closed daily bar diverging >~0.5% from canonical | reconcile cycle, `RECONCILE_CYCLE_SECONDS` default 1800 | PROVEN | `tests/test_reconcile_detect_only_daily.py:58-61` asserts key and severity. ⚠️ severity is `"warn"` - see §5.2 |

### 3.3 Providers and data quality

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-10 source_degraded | `api/services/source_circuit_breaker.py:78` | `len(window) >= 20 and pass_rate < 0.95 and _last_state != "degraded"` | one named source with >=20 attempts inside 1 h and >1 in 20 failing | on every `is_ok()`; callers at `bars_fetch.py:3561,3672` | FIREABLE | no test names the key |
| G-11 provider_coverage_regression | `api/services/provider_coverage_monitor.py:734` | a coverage field **newly** below its floor | e.g. `enrichment_with_em` blank on a sampled day | monitor cycle | PROVEN | ⭐ **recorded production firing**: `tests/test_provider_coverage_em_refusals.py:113-115` quotes the 2026-08-18 page verbatim; plus `tests/test_provider_coverage_alerts.py` |
| G-12 fundamentals_regression | `api/services/fundamentals_monitor.py:527` | a `_CRITICAL_KINDS` issue that survives `_heal` and is not in the on-disk defect set | e.g. `dup_quarter` on a sampled ticker twice running | 2 h cycle; `FUNDAMENTALS_MONITOR_ENABLED` default `"0"` in source | UNKNOWN | `git grep -l fundamentals_regression origin/master -- tests/` is empty |
| G-13 fundamentals standing digest | `fundamentals_monitor.py:248` via `_maybe_digest:265` | standing shape defects exist AND `now - last_digest >= _DIGEST_SECONDS` | any standing non-critical defect, once per 86400 s | same cycle | UNKNOWN | four `test_fundamentals_monitor*` files exist; no assertion of this webhook found |
| G-14 ssetf_rebuild_refused | `api/services/single_stock_etfs.py:349` | `n == 2` (exact) consecutive refusals | the **second** consecutive refused rebuild | on each rebuild trigger | PROVEN | `tests/test_single_stock_etfs.py:196` asserts exactly one call with that key across three refusals |
| G-15 perplexity_auth_failure | `api/services/perplexity_search.py:179` | `status in (401, 403)` and >1 h since the last memo | one 401/403 from Perplexity | request path | PROVEN | `tests/test_ai_search_resilience.py:171-172` asserts key and `severity == "critical"` |

### 3.4 Wire and calendar

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-16 wire_coverage_incomplete | `api/services/wire/coverage_monitor.py:88` | a gap that survives a forced calendar build + detector tick | a reported name absent from the feed after the heal | scheduled check; `WIRE_COVERAGE_MONITOR_ENABLED` default `"1"` | PROVEN | `tests/test_wire_coverage_monitor.py:70-77` |
| G-17 wire_coverage_unmeasured | `wire/coverage_monitor.py:109` | `not first.get("measured")` | both Finnhub and FMP legs fail | same | PROVEN | `tests/test_wire_coverage_monitor.py:85-88` |
| G-18 market_calendar milestone page | `api/routers/market_calendar.py:175` | `status == "expiring" and days_remaining in (180,90,30,14,7,3,1)` | the clock reaches ~2027-07-04 (180 days before `_COVERS_THROUGH` 2027-12-31) | per `/api/market-calendar` request | PROVEN | `tests/test_market_calendar_router.py:216-219` pins severity and the per-day key |
| G-19 market_calendar ordinary expiring | `market_calendar.py:175` | `status == "expiring"` and not a milestone day | the clock inside 180 days of the table's end | request | FIREABLE | `tests/test_market_calendar_router.py:222` is the control (stays a feed WARNING) |
| G-20 market_calendar expired/unknown | `market_calendar.py:175` | `remaining < 0`, or `_COVERS_THROUGH is None` | the clock past 2027-12-31, or an empty holiday set | request | FIREABLE | no test names these keys |
| G-21 taxonomy_version_mismatch | `api/routers/push.py:90` | `wire_v and db_v and wire_v != db_v` | a `/api/push` payload carrying a `taxonomy_version` that differs from the stored one | per push | PROVEN | `tests/theme_engine/test_propagation.py:86-87`. ⚠️ production input - see §4.5 |

### 3.5 Missed-slot family

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-22 cream_eod_missed | `api/cream_card.py:167` | `late > grace` and the day is not already recorded done | the flow worker restarts across the EOD slot | `catch_up` every minute, registered in `api/flow_worker_main.py:685`; `CREAM_EOD_ENABLED` default `"0"` | PROVEN | `tests/test_cream_eod_catchup.py:89-97` ("nobody was told") |
| G-23 oi_morning_missed | `api/oi_morning.py:648` | same shape | the worker restarts across the morning OI slot | `flow_worker_main.py:784`; `OI_MORNING_ENABLED` default `"0"` | PROVEN | `tests/test_oi_morning_catchup.py:92-101` |
| G-24 buzz_slot_missed | `api/services/discord_buzz_digest.py:211` | a due slot with no posted record, past the catch-up grace | a dropped buzz checkpoint | `catch_up` from `api/main.py:947` | PROVEN | `tests/test_buzz_digest.py:496-500` plus a **control** at `:526-528` (a posted slot raises nothing) |
| G-25 render loop stall page | `api/services/discord_render/stall_record.py:196` | `page_decision(...)["page"]` - overshoot past the tier floor, outside the volume-held cooldown | the event loop blocked past `alert_ms` | every `LoopWatch.record` sample | PROVEN | `tests/test_stall_record.py` drives `emit` twice |

### 3.6 Desk session pipeline

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-26 desk_transcript_coverage | `api/services/desk_session_insights.py:1123` | span coverage below `COVERAGE_THRESHOLD`, or unmeasurable; once per video id per process | a short or duration-less stored transcript at the trash gate | insights cron :07/:22/:37/:52 | PROVEN | `tests/test_desk_session_insights.py:764`, `:1580`, `:1762` each assert the exact key and `"critical"` |
| G-27 insights fail streak | `desk_session_insights.py:1296` and `:1560` -> `_fire_fail_streak_alert:1266` | `streak == _FAIL_STREAK_ALERT_AT` (4), on the in-memory `_FAIL_STREAKS` dict | one video raising on **4 consecutive** passes inside ONE pod lifetime (~45-60 min) | same cron | UNKNOWN | no test. ⛔ `api/services/desk_session_audit.py:14-19` states the opposite - see §4.1 |
| G-28 session pipeline incomplete | `desk_session_audit.py:359` -> `_send_alert:340` | `report["incomplete"]` non-empty | a published session past `DESK_SESSION_AUDIT_GRACE_SECS` missing youtube/transcript/chapters/ticker_moments/announced | daily audit job; `DESK_SESSION_AUDIT_ENABLED` default on (`!= "0"`) | FIREABLE | `tests/test_desk_session_audit.py` exists; no assertion of `_send_alert` found in it |
| G-29 library video gone | `desk_session_audit.py:359` (liveness half) | `liveness["gone_new"]` non-empty | YouTube oEmbed answers 400/401/403/404 for a library video | same daily job | FIREABLE | ⭐ the 2026-09-25 walkthrough that motivated it named three real videos (324/353/354) - a recorded **finding**, not a recorded firing of this code |

### 3.7 Wisdom loop

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-30 wisdom capture page | `api/services/wisdom/capture/health.py:86`, gated by `should_page:75` | `health in ("zero","missing") and health in pages and is_trading_session(session_date)` | a registered dataset returning 0 rows, or failing, on a trading session | capture jobs; every wisdom gate in `core/flags.py` defaults `"0"` in source | FIREABLE | `classify`/`should_page` are pure and unit-covered; no assertion of the emit found |
| G-31 wisdom extract pages | `wisdom/extract/batch.py:149`, called at `:695` and `:1127` | extraction stopped at its budget cap; or orphaned requests requeued | a pass whose remaining budget cannot cover it | extract job, `expected_every_s=1800` | FIREABLE | no assertion found |
| G-32 wisdom_job_missed, short-period specs | `wisdom/registry.py:406` | `age > 2 * expected_every_s`, `age` measured from `max(last_ok, _BOOT_WALL)` | core (900 s), extract (1800 s), sources (900 s), tweets (3600 s): 30 min - 2 h of uptime with no success | watchdog every 300 s | PROVEN | `tests/test_wisdom_skeleton.py:244-246`. ⛔ the test must set `_BOOT_WALL` back **10 days** to make it fire |
| G-33 wisdom_job_missed, long-period specs | `wisdom/registry.py:395-406` | same predicate, same line | `wisdom_monthly_packet` needs **70 days** of uninterrupted pod uptime; `wisdom_weekly_chain` 14 days; the five daily specs 2 days | same | CANNOT FIRE | none. Arithmetic in §4.2 |

### 3.8 Member-facing alerts and the S7 taxonomy

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-34 exposure_gate release | `api/services/exposure_gate_watch.py:69` | `release is not None and price >= release`, once per (day, kind) | QQQ trading above the restraint release inside RTH | 2-min tick from `api/main.py:6563`; `EXPOSURE_GATE_WATCH_ENABLED` default `"0"` in source | PROVEN | `tests/test_exposure_gate_watch.py:38` arms the levels and drives a fire |
| G-35 exposure_gate s2 | `exposure_gate_watch.py:81` | `s2 is not None and price <= s2` | QQQ below the FTD low inside RTH | same | PROVEN | same file |
| G-36 regime_change broadcast | `api/routers/push.py:196` | `old_phase and new_phase and old_phase != new_phase` | the brain posts an intraday phase different from the previous push | per `/api/push/intraday` | FIREABLE | `tests/test_alert_research_url_routing.py:157` and `tests/test_alerts_privacy.py:136` exercise the **wrapper**, not this predicate |
| G-37 exposure_shift broadcast | `push.py:202` | `abs(new_exp - old_exp) >= 20` | a 20-point brain exposure move between two pushes | same | FIREABLE | `tests/test_alert_research_url_routing.py:162` exercises the wrapper only |
| G-38 stop_hit | `api/services/alerts.py:533` | n/a | nothing | never | CANNOT FIRE | zero non-test callers - see §4.3 |
| G-39 scanner_match | `alerts.py:539` | n/a | nothing | never | CANNOT FIRE | zero non-test callers - see §4.3 |
| G-40 ep_resolved | `alerts.py:123` | n/a - no implementation exists | nothing | never | CANNOT FIRE | docstring, severity map and `app/src/components/AlertBell.jsx:63` icon only - see §4.3 |
| G-41 document-arrival fire | `api/services/alert_taxonomy/document_arrival.py:134-137` | `newest["accession"] and newest["accession"] != last_seen` | a new SEC filing for a ticker a member has armed | sweep every 20 min from `api/main.py:7166`; `ALERT_TAXONOMY_DOCUMENT_ARRIVAL_ENABLED` default `"0"` in source | PROVEN | `tests/test_alert_taxonomy_document_arrival.py` plus `tests/test_s7_durable_notifications.py`. **Ships as: serving members** - `POST /api/alerts/taxonomy/document-arrival` is `get_current_user`-scoped and `app/src/hooks/useFilingWatch.js:73` calls it |
| G-42 S7 dark-comparison disagreement | the 7 `run_dark_sweep` entry points (`price_level_projection.py:485` and siblings) | per-type `agreed / new_only / legacy_only`, and `verdict_ready` | a legacy-vs-new divergence on an armed **admin-cohort** predicate | per-minute or daily crons, `api/main.py:7189-7469`; every flag default `"0"` in source | UNKNOWN | `dark_report.py:79-88` records that for at least one type arming is **unobservable** from the report - see §4.4 |
| G-43 price-alert in-app sink | `api/services/watchlist_alert_service.py:301` | the predicate is upstream (`_alert_level_now`) | - | - | UNKNOWN | deferred band |
| G-44 multi-channel delivery sink | `watchlist_alert_service.py:474` | the predicate is upstream, in 10 producer call sites | - | - | UNKNOWN | deferred band |
| G-45 notebook task reminder | `api/services/journal_two/note_tasks.py:581` | a task due at the pass hour, not already reminded | a notebook task whose due date has arrived | cron at `REMINDER_HOUR_ET` and `SECOND_PASS_HOUR_ET` + a boot catch-up (`note_tasks.py:555-573`) | FIREABLE | `note_tasks` carries in-repo tests; severity `"info"` so it is in-app only, never a Discord page |

### 3.9 The guards-of-guards - whether an emit ever leaves the process

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-46 Discord page gate | `api/services/chart_health_alerts.py:33-44` | `severity == "critical" and webhook_present and enabled and (last is None or now - last >= 1800)` | a critical emit with a configured webhook, outside the 30-min per-key cooldown | on every `emit` | PROVEN | `tests/test_chart_health_discord.py:20-24` drives page -> suppressed -> page |
| G-47 emit throttle | `chart_health_alerts.py:76` | `now - last >= 600` | a repeat of the same key after 10 min | every `emit` | PROVEN | `tests/test_chart_health_alerts.py:13-33` including `test_emit_throttled_within_window` and an independent-keys control |
| G-48 webhook refusal detection | `api/services/alerts.py:512` | `int(resp.status_code) >= 400` | a 403 from a rotated webhook or a 429 from a rate-limited one | every warning/critical `add_alert` | PROVEN | `tests/test_alert_delivery_channel_truth.py:375-379` drives a literal `status_code = 403` |

### 3.10 Ratified acceptance bars (the CARD 16 class)

| Guard | Site | Predicate | Fires when | Schedule | Class | Evidence |
|---|---|---|---|---|---|---|
| G-49 warm-latency p95 bar | `tools/bars_warmth_audit.py:109-112` | `if warm_ms:` then p95 of the WARM bucket | a served hit classified WARM | on-demand audit run | CANNOT FIRE | `COLD` at `:28` still contains `stale-swr`; no `else` at `:109`. CARD 16, **still unfixed at master** - see §4.6 |

---

## 4 - Every CANNOT FIRE and every UNKNOWN, with the cheapest read that settles it

### 4.1 UNKNOWN - G-27, the insights fail streak, and a contradiction this gate does not resolve

**The code.** `desk_session_insights.py:36` `_FAIL_STREAKS: dict[int, int]` is a module dict.
`:38` `_FAIL_STREAK_ALERT_AT = 4`. `:1296-1298` increments and `:1299` fires on
`streak == _FAIL_STREAK_ALERT_AT` - **exact equality**, so a streak that somehow skipped 4
would never alert (it cannot skip: the increment is `+1`). `:1301` and `:1565`
`_FAIL_STREAKS.pop(vid, None)` on any non-raising pass.

**The contradiction, stated and not resolved.** `api/services/desk_session_audit.py:14-19`
says, in its own module docstring:

> "`desk_session_insights._FAIL_STREAKS` is an in-memory dict that alerts on the 4th
> CONSECUTIVE failure, which needs an uninterrupted hour of 15-minute passes; this pod
> redeploys several times a day, so that streak resets before it can ever fire."

The arithmetic does not obviously agree. "Several times a day" leaves mean uptime of hours,
and 4 passes at :07/:22/:37/:52 is ~45 minutes. ⛔ **Both statements are in the repo and
this document reports both.** It is UNKNOWN, never PROVEN, because settling it needs a number
this gate does not have.

⭐ **A second, independent reset risk on the same dict:** the two increment sites (`:1296`
pending-insights, `:1560` ticker backfill) share one `vid`-keyed dict, and a success on
either path pops the other's streak. If one video can ever be in both populations in the same
pass, the streak is reset by the healthy half and can never reach 4.

**Cheapest read that settles it (no deploy, no pod):**
```
# 1. does the estate ever hold an uptime > 60 min? read the artifact, not a guess:
#    /api/health's uptime field across a day (per the estate's own deploy-verification rule)
# 2. are the two populations disjoint? one read, no runtime:
git show origin/master:api/services/education_service.py | grep -n -A20   'def videos_pending_insights\|def videos_missing_ticker_moments'
```
A test would settle the predicate itself in minutes: drive `_process_one_pending` with a
raising `_run_one_pending` four times and assert one page, plus a control that a success on
pass 3 produces none.

### 4.2 CANNOT FIRE - G-33, the wisdom missed-job watchdog on its long-period specs

**The mechanism, in three facts each true on its own.**

1. `api/services/wisdom/registry.py:387` `boot = ... datetime.fromtimestamp(_BOOT_WALL ...)`,
   where `_BOOT_WALL = time.time()` is set at **module import** (`:28`).
2. `:395` `reference = max(last_ok, boot) if last_ok else boot`. When a job is failing -
   exactly the case the watchdog exists for - `last_ok` is older than `boot`, so
   `reference = boot` and `:397` `age = (now - reference).total_seconds()` **is pod uptime,
   not job staleness**.
3. `:396` `allowed = 2 * spec.expected_every_s`.

**The arithmetic, per shipped spec:**

| Job spec | `expected_every_s` | `allowed` | uninterrupted uptime required |
|---|---|---|---|
| `wisdom_monthly_packet` (`publish/jobs.py:56`) | 35 x 86400 | 6,048,000 s | **70 days** |
| `wisdom_weekly_chain` (`publish/jobs.py:46`) | 7 x 86400 | 1,209,600 s | **14 days** |
| `wisdom_daily_chain` (`publish/jobs.py:36`) | 86400 | 172,800 s (+ non-trading-day slack) | **>= 2 days** |
| capture detections / morning / themes / two trading-day specs (`capture/jobs.py:55-62`) | 86400 | 172,800 s | **2 days** |

⛔ **On a pod the repo itself describes as redeploying several times a day
(`fundamentals_monitor.py:88-90`, `desk_session_audit.py:16-17`), `age` never reaches any of
those ceilings.** The watchdog for the six jobs above cannot page.

⭐ **The repo's own test is the proof.** `tests/test_wisdom_skeleton.py:240`
`monkeypatch.setattr(registry, "_BOOT_WALL", time.time() - 10 * 86400)` and then a spec with
`expected_every_s=300`. The suite can only make this guard fire by **fabricating ten days of
uptime**, which is the measurement.

⚠️ Independent of any flag. `watchdog` returns early on `not flags.ingest_enabled()`
(`WISDOM_INGEST_ENABLED`, literal default `"0"` at `core/flags.py:26`); this finding holds
whenever the switch is on and says nothing about whether it is.

**Cheapest read that settles it:** already settled by source + the test above. ⛔ The
cheapest **fix-side** read, for whoever ships it: `reference` should fall back to `boot` only
for the *first* `allowed` window after a cold start and otherwise use `last_ok` (or a
persisted `first_seen`), and the rail is a test with `_BOOT_WALL = now` proving a job whose
`last_ok` is 3 x `expected_every_s` old still pages.

### 4.3 CANNOT FIRE - G-38, G-39, G-40: three alert types with no live producer

| Type | State | Evidence |
|---|---|---|
| `stop_hit` | emitter exists, **zero production callers** | `git grep -n 'alert_stop_hit' origin/master` returns `alerts.py:533` (the def) and `tests/test_alerts_privacy.py:262` only |
| `scanner_match` | emitter exists, **zero production callers** | same command: `alerts.py:539` and `tests/test_alerts_privacy.py:262` |
| `ep_resolved` | **no implementation at all** | `alerts.py:9` (docstring), `:26` (docstring), `:123` (severity map), `app/src/components/AlertBell.jsx:63` (icon), `tests/test_alert_durability_legacy.py:68` (synthetic). No producer anywhere |

⭐ **This is already recorded elsewhere and agrees:**
`docs/uct-terminal/continuity-checkpoint.md:744` and `:4954` call all three "dead/nonexistent
code (zero live callers, or no implementation at all)".

⚠️ **And `alerts.py`'s own module docstring lists all three as live alert types**
(`:7-11`), naming `stop_hit` and `ep_resolved` among the callers that "genuinely have no
user" at `:26`. **A reader of that docstring believes five broadcast types ship; three of
them cannot.** Reported, not resolved.

**Cheapest read that settles it:** the grep above, already run. The decision (delete, or
implement) is the owner's and is out of this gate's scope.

### 4.4 UNKNOWN - G-42, the seven S7 dark comparison sweeps

The comparison harness is the guard: it is supposed to surface a legacy-vs-new disagreement
before a type goes live. Whether any of the seven has ever observed anything cannot be
determined from source, because the answer lives in the production pod's
`alert_taxonomy.db` comparison-span tables. ⛔ `dark_report.py:79-88` records the reason
this is worse than a quiet population:

> "ARMED IS NOT OBSERVED, AND `predicate_count` ONLY EVER SHOWED THE SECOND. A type whose
> predicates are keyed on a FIRE (scan-membership-change) reports nothing at all for a
> subscription that has not fired yet ... Measured 2026-09-25: that took a hand-rolled probe
> on the production pod to discover."

**Cheapest read that settles it, and it needs no code:**
`GET /api/admin/alert-taxonomy/dark-report` (`api/routers/alert_taxonomy.py:103`,
`require_admin`) returns every type's `predicate_count`, per-predicate `report()` and - for
the types that opt in - `arming_census`. One authenticated admin request answers "has any
span ever been opened" for all seven. ⚠️ That endpoint has **no member surface and no
admin frontend caller** (this is the PACKET-Y class of finding); it is curl-only today.

### 4.5 The two rows whose PROVEN is unit-level but whose production input is outside this gate

⚠️ **G-21 `taxonomy_version_mismatch`.** `api/routers/push.py:81`
`wire_v = (payload or {}).get("taxonomy_version")` with an early return on falsy. **Nothing in
this repo writes `taxonomy_version` into a push payload** - `git grep -n taxonomy_version
origin/master` finds the reader, the docstring, a wisdom-capture field and the test, and no
producer. The docstring at `:69-74` says the producer is a one-line change **in the
morning-wire repo**, and: *"Until that ships, payloads carry no `taxonomy_version` and this
check is a no-op."* ⛔ This gate may read only `origin/master` of this repository, so
whether that line shipped is **UNKNOWN**, and the row is classified PROVEN strictly on the
test at `tests/theme_engine/test_propagation.py:86-87`. **Cheapest read:** one grep for
`_wire_data["taxonomy_version"]` in the morning-wire repo, or one `curl` of a recent
`wire_data.json` for the key.

⚠️ **G-18 / G-19 / G-20, market calendar.** `_COVERS_THROUGH` is `2027-12-31`
(`market_calendar.py:66`) and `_EXPIRING_WITHIN_DAYS` is 180, so `_classify` returns `"ok"`
for every date before ~2027-07-04 and `_announce` returns immediately at `:158`. **None of
the three can fire for ~9 more months.** That is a clock input, not an unsatisfiable
predicate, so FIREABLE/PROVEN is correct - but nobody will observe one this year. The
function's own docstring says so at `:141-143`, and also records that its earlier rate claim
was false. ⭐ Left in place deliberately, per that docstring.

### 4.6 CANNOT FIRE - G-49, CARD 16's ratified p95 warm-latency bar, still unfixed

Verified fresh at `origin/master`:

* `tools/bars_warmth_audit.py:28` - `COLD = {"fetch", "stale-swr", "inflight-wait", "disk", "miss", "unknown"}`
* `:4` - the module's own docstring defines the WARM tiers as "mem / sqlite = WARM instant"
* `:109` - `if warm_ms:` with **no `else`**; `:111-112` computes p50/p95 inside it

⛔ **`stale-swr` serves instantly - the member did not wait - and it is filed under COLD.**
On a daily-timeframe run every hit lands in COLD, `warm_ms` is empty, the guarded print is
skipped silently, and the ratified p95 bar is never computed. A reader then takes the cold
line's p50/max as the p95, which is how the bar was reported as met without ever existing.

**Cheapest read that settles it:** already settled - the three lines above. **The cheapest
fix-side rail:** move `stale-swr` to the WARM set (or introduce a third `SWR` tier that is
explicitly neither), and replace the bare `if warm_ms:` with an `else` that prints
`warm p95: NOT COMPUTED (n=0)`. ⛔ A bar whose absence prints nothing is
indistinguishable from a bar that was met.

### 4.7 CANNOT FIRE - G-01, CARD 27, still unfixed and deliberately so

Re-verified at `origin/master`, unchanged from the CARD:

* `api/main.py:2527` - `CronTrigger(day_of_week="mon-fri", hour=9, minute=5, timezone=_ET)`
* `api/main.py:2513` - `if wire_date < expected`
* `api/services/engine.py:545` - `if now.weekday() < 5 and (now.hour, now.minute) < (9, 30): d = d - timedelta(days=1)`

At 09:05 ET, `(9, 5) < (9, 30)` is True, so `expected` is the **previous** session. A wire
that missed this morning is dated the previous session. `yesterday < yesterday` is False. The
job runs once a day, so it does not recover later. It can only fire at >= 2 sessions stale.

⚠️ **Two further facts this gate adds to the CARD.** (1) There is no test anywhere
that names `wire_missed` - the alert type has never been driven, not even synthetically.
(2) The empty-string path *can* fire: if `wire.get("date")` is absent, `wire_date` is `""`
and `"" < expected` is True - so **the only input this guard can currently detect is a
payload with no date at all**, which is a different failure from the one it is named for.

**Cheapest read that settles it:** already settled. **The fix and its required rail are
recorded in `DECISION_CARDS_2026-09-26.md` CARD 27** and are deliberately NOT shipped: master
is production and that needs an explicit owner "deploy" plus a member-impact paragraph.
Nothing in this gate changes that.

### 4.8 The remaining UNKNOWNs, and the one read each needs

| Row | Why UNKNOWN | Cheapest read |
|---|---|---|
| **G-12** fundamentals_regression | no test names the key; the predicate needs a `_CRITICAL_KINDS` violation that survives `_heal` and is not already on disk. Whether any ticker in the rotating sample has ever produced one is a data question | `GET /api/admin/fundamentals-health` returns `flagged_current` and `last_alert_at` from `_state` (`fundamentals_monitor.py:653 get_state`). One admin request |
| **G-13** fundamentals standing digest | four test files exist; none asserts `_send_digest`. `_standing_shape_defects()` may be permanently empty or permanently non-empty and nothing in source says which | same endpoint - `last_digest_at` is stamped into `_state` at `:281` |
| **G-27** insights fail streak | see §4.1 | see §4.1 |
| **G-42** seven dark sweeps | see §4.4 | `GET /api/admin/alert-taxonomy/dark-report` |
| **G-43** price-alert sink | the predicate is `_alert_level_now`, upstream in the deferred band | one read of `watchlist_alert_service._alert_level_now` (`:94`) and its crossing test |
| **G-44** delivery sink | 10 upstream producers, none read in this gate | the deferred-band grep in §1.1, then one pass per producer |

---

## 5 - Contradictions found, reported and NOT resolved

### 5.1 One throttle key for two thresholds - the warning can swallow the critical page

`bars_continuous_audit.py:170` and `:180` both emit under the key
`"intraday_hotset_stale"`. `chart_health_alerts.emit:76` returns **False and records
nothing** when the same key fired inside 600 s, and that early return happens **before**
`_should_page_discord` is reached (`:84`). The check runs every 300 s. ⛔ So a hot-set
ratio crossing 0.08 and then 0.20 on the next pass has its **critical Discord page dropped**,
and the operator sees only the warning until the throttle clears. Reported; the fix (two
keys, or a severity-aware throttle) is a code change and out of this gate's scope.

### 5.2 A comment that claims a mechanism the code does not provide

`bars_reconciliation.py:353-355`: *"Route to the same ops alert channel the intraday watchdog
uses, so a real daily-drift event **pages someone** instead of hiding in logs."* The emit at
`:358` passes severity `"warn"`. `_should_page_discord` requires `severity != "critical"` to
be False (`chart_health_alerts.py:37`). ⛔ **Nothing is paged**; the entry lands in the
in-memory `deque(maxlen=200)` behind the admin page. ⚠️ `"warn"` is also a **third**
severity string in this estate - `bars_continuous_audit.py:180` uses `"warning"` - and neither
is on the paging path, so the mismatch is currently invisible. The test at
`tests/test_reconcile_detect_only_daily.py:61` pins `"warn"`, so a fix must move the test too.

### 5.3 Two guards whose alert cannot be read where the estate reads alerts

G-22 (`cream_eod_missed`) and G-23 (`oi_morning_missed`) are emitted from
`api/flow_worker_main.py`'s scheduler - a **different service** from the web pod.
`chart_health_alerts._alerts` is a per-process `deque`, and the reader
`GET /api/admin/bars/alerts` (`api/routers/admin_chart_health.py:182`) serves the **web
pod's** deque. ⛔ So the in-app half of these two guards is structurally unreadable; the
Discord page is their only exit from the process, and that depends on `DISCORD_WEBHOOK_URL`
and `CHART_HEALTH_DISCORD_ENABLED` **on that service**, which this gate does not read.
The same applies to any other emit reached from worker code paths.

### 5.4 This gate's scope versus the roadmap's definition of TERM-018

`docs/terminal-research/10-roadmap/roadmap.md:334` and `backlog.md:832` define `TERM-018` as
the **shipping condition for the six new band-1 signals** `TERM-012`...`TERM-017`: "every
guard in lane A has been observed red before green, with an AST rail and a control".
⛔ **This document audits the guards that ALREADY ship, which is a different population.**
Both readings are on the record; neither is withdrawn. ⭐ The overlap is the method:
`backlog.md:838` names ledger **L4** (an AST over `api/main.py` proving an `add_job` id exists,
**with a non-vacuity control**) as the one reusable rail. Only G-05 carries an AST-over-source
rail here (`tests/test_bars_store_health_monitor.py:216-218`), and only the rows the §1.3
command prints carry a control. **That residual - one AST rail, `4` controls across
`49` guards - is what this gate hands forward.**

---

## 6 - What this gate did not do

* ⛔ **No code changed, nothing staged, nothing committed, nothing pushed.** The index is
  shared.
* ⛔ **No flag state asserted.** Every environment variable named above is quoted with its
  **literal source default** only.
* ⛔ **No `pytest` run**, scoped or otherwise; no heavy job; nothing written to `C:\data`.
* ⚠️ **The deferred band is not audited**: 10 `deliver_alert_payload` producers
  (indicator conditions, calendar alerts, catalyst engine x2, catalyst digest, awareness
  engine, AI-search briefings, AI-search deep, the rev migration, the taxonomy delivery
  wrapper). Rows G-43 and G-44 stand in for it as UNKNOWN. That band is the natural second
  pass and its size is derivable with the command in §1.1.
* ⚠️ **The author's own most-likely error is stated in §7.**

---

## 7 - The most likely error in this document

⛔ **That "PROVEN" reads as stronger than it is.** All but one PROVEN row rests on
a unit test with an injected input - which proves the predicate is
*satisfiable*, not that the wire from the real input to the real channel is intact. CARD 27's
guard would have passed any unit test of its comparison; what was broken was the **schedule
it was asked on**. The estate's own rail for that is the AST-over-the-scheduler check, and
only G-05 carries one here. ⭐ **So the honest reading of this table is the §1.2
counts plus §1.3's control count: the CANNOT FIRE and UNKNOWN classes are the finding, and
even the guards that can fire are, with a handful of exceptions, proved only in one
direction.**

A second, narrower risk: the reasoning behind both counter-reset rows, G-33 and G-27, turns on
"how long does this pod stay up", and the only evidence for that number is the repo's own prose
(`fundamentals_monitor.py:88-90`, `desk_session_audit.py:16-17`). G-33 survives that
weakness because 70 days is not a plausible uptime under any reading; **G-27 does not, which
is exactly why it is UNKNOWN and not CANNOT FIRE.**
