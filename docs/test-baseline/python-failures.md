# Python test baseline

**Status: COMPLETE. 71 of 71 batches ran.** The sweep did **not** stop on the 3 GB
memory floor — the lowest free-memory reading all run was **11.31 GB**, nowhere near
it. One group of 10 files is **UNRUNNABLE** and is recorded as such below rather than
re-run.

The machine-readable baseline is `docs/test-baseline/python-failures.json`. The rail
reads that file, and the table in this document is generated from it, so the two cannot
drift.

## Headline — the "9 pre-existing failures" figure is NO LONGER TRUE

**It is 66, across 21 files.** Not 9, and not concentrated in one place.

That said, **66 failing tests is not 66 defects.** Four clusters account for 39 of
them, and inside each cluster every test dies of one cause:

| cluster | tests | the one cause |
|---|---|---|
| `test_implied_backfill` | 15 | test fakes' signatures drifted — `unexpected keyword argument` |
| `test_screener_wave2_analyst_store` | 9 | `fetch_one` returns `None` |
| `test_web_capture_coverage` | 8 | `KeyError: 'text_origin'` |
| `test_ticker_meta` | 7 | 5 × `NameError: name '_log' is not defined` + 2 mapping mismatches |

⭐⭐ **One of these is a LIVE PRODUCTION DEFECT, shipped today, and the sweep is what
surfaced it.** `api/services/ticker_meta.py:145` calls `_log.warning(...)`; every other
line in that file uses `_logger`, and `_log` is never defined there. It landed at
**12:01 today in `553f6b68b`** (D1 G1 tranche 1) and **is on `origin/master` now**.

The irony is exact: it sits inside the `except` handler that commit added *to keep* the
function's docstring promise — *"Never raises — mirrors `_from_finnhub`'s
all-None-on-failure contract exactly"*. The handler meant to preserve that contract is
the thing that breaks it.

⚠️ **Blast radius, traced not assumed: contained, but it destroys evidence.**
`_base_meta` catches it one frame up (`except Exception as e_fmp`) and falls back to
Finnhub, so no request 500s. What is lost is the *real* error: every FMP profile
failure — network, 5xx, auth, rate limit, all of which the typed adapter now raises —
is reported as `ticker_meta FMP failed for X: name '_log' is not defined`, with the
actual provider error destroyed. Diagnosing a genuine FMP outage from these logs would
be impossible.

⛔ **Not fixed here** — this is a docs-only commit and the fix belongs to whoever owns
D1. Recorded so it cannot go quiet again.

⚠️ **Three rows are environment artefacts and must not be counted as code failures** —
`test_frontend_deps_installed` (no `npm ci` in this worktree),
`test_obsidian_parity_fixtures` (CRLF), and `test_no_cr_in_tracked_text_blobs` (one
tracked file, `tools/wave_p_cert_corpus/manifest.json`, re-run in isolation and not
touched this weekend). Net of those, **63**.

⛔ **Where the "9" came from is NOT established here, and this document does not
guess.** It was neither confirmed nor located: the first 12 batches held exactly one
failure — which is how the earlier partial write-up reached "1 so far" — and the count
then climbed steadily to 66 over the remaining 59 batches. A figure of 9 matches no
prefix of this run, no single file, and no cluster.

## Final counts

| | |
|---|---|
| batches run | **71 of 71** |
| test files enumerated | 1407 |
| tests collected | **23849** |
| failed | **66** |
| errors | 0 |
| skipped | 55 |
| unrunnable groups | **1** (10 files — below) |
| min free memory | 11.31 GB (floor is 3.0 GB — never approached) |
| elapsed | 106.9 min |

## ⚠️ Two things that qualify this run — both recorded, neither corrected

1. **Another session ran pytest concurrently on this box from ~17:22 CDT**
   (`tools/pytest_chunks.py`, plus a `pattern_engine` pytest child at 17:44), against a
   sweep that started at 16:04. Roughly the last third of the batches therefore ran
   under competing load. This repo carries two standing lessons about exactly that — a
   rail can be green alone and red in company, and an intermittent red can be a
   population rather than a test. **No row below has been re-run in isolation to
   separate the two**, except the one that was
   (`test_no_cr_in_tracked_text_blobs`). Treat load-sensitive candidates as unconfirmed
   until re-run alone.
2. **A commit landed mid-sweep.** `0164051dc` (the `bar_provenance` D/W/M fix) was
   pushed at 17:13, touching `api/services/bars_disk_cache.py` and adding
   `tests/test_bar_provenance_dwm.py`. The file list was enumerated once at 16:04, so
   the new test file is **not** among the 1,407 and contributed nothing; batches after
   17:13 ran against the edited `bars_disk_cache.py`. No row below is a bars-cache test.

## The UNRUNNABLE group — batch 37.2, 10 files, NOT re-run

```
tests/test_discord_chart_prefs.py
tests/test_discord_chart_warm_budget.py
tests/test_discord_close_note.py
tests/test_discord_index_close.py
tests/test_disk_watchdog.py
tests/test_dividends_calendar.py
tests/test_dockerfile_vite_build_args.py
tests/test_document_ocr.py
tests/test_double_bottom_is_in_noise_territory.py
tests/test_down_alert.py
```

**Reason:** the batch hit pytest's `--timeout=120` inside a real `sleep()` —

```
rc=1 atrick\uct-worktrees\flow-watch-rail\api\services\discord_index_close.py", line 170, in wait_until_warm
    sleep(wait)
+++++++++++++++++++++++++++++++++++ Timeout +++++++++++++++++++++++++++++++++++
```

(The tool stores the last 200 characters of the batch's output, which is why the path
is clipped mid-word — not corruption.)

`api/services/discord_index_close.py::wait_until_warm` sleeps in a loop, and the
timeout killed the process **before the JUnit XML was written**, so the
split-and-retry had nothing to parse either. Those 10 files' results are **lost, not
red**: the baseline records them as unmeasured and `check` will not pretend otherwise.

⛔ Left unrunnable deliberately, per instruction. Re-running it needs a per-test
timeout raise or a fake clock, not another sweep.

## The complete failure table (66)

Generated from `python-failures.json`.

#### `api.services.journal_two.test_obsidian_parity_fixtures` — 1

**Probably ENVIRONMENT.** CLAUDE.md records that `core.autocrlf=true` on this box rewrites the committed fixtures to CRLF and makes this exact test report every fixture stale for a line-ending reason unrelated to converter drift. Compare bytes before treating it as real. **Not bisected.**

| test | first line of the failure |
|---|---|
| `test_regeneration_is_byte_identical_to_the_committed_fixtures` | AssertionError: committed obsidian_parity fixtures are STALE relative to the current provider pre-pass ou |

#### `tests.test_discord_activity` — 3

Same family as `test_discord_chart`: guild scoping and the command roster.

| test | first line of the failure |
|---|---|
| `test_chart_reply_components_carry_the_guild_so_the_launch_button_can_be_scoped` | AssertionError: assert 'Open in Discord' in ['D', 'W', '60m', '15m', '5m', '◀ Earlier', ...] |
| `test_launch_command_is_an_admin_only_entry_point_registered_only_on_request` | AssertionError: assert ['chart', 'c'...buzz', 'flow'] == ['chart', 'c'...ings', 'buzz'] Left contains one |
| `test_open_in_discord_button_only_in_activity_guilds_and_it_launches` | assert (0 == 1) + where 0 = len([]) |

#### `tests.test_discord_chart` — 5

Component/row-shape drift in the chart message builder - row counts, `custom_id` parsing, the collapse control, emoji encoding.

| test | first line of the failure |
|---|---|
| `test_a_posted_chart_is_one_row_and_the_gear_opens_the_rest` | AssertionError: assert (4 == 3) + where 4 = len([{'components': [{'custom_id': 'c2\|NVDA\|D\|house\|3\|auto\|no |
| `test_an_id_minted_before_the_gear_still_parses` | Failed: DID NOT RAISE <class 'api.services.discord_interactions.CommandError'> |
| `test_chart_components_reflect_the_image_and_round_trip_through_parse_component` | AssertionError: assert ('#x1F53C' == '▲' - ▲ + #x1F53C) |
| `test_fetch_ticker_choices_uses_the_dashboards_search_and_never_raises` | AssertionError: assert [] == [{'name': 'NV...lue': 'NVAX'}] Right contains 2 more items, first extra item |
| `test_the_collapse_control_survives_a_full_toggle_row` | AssertionError: the way back must exist exactly once assert 0 == 1 + where 0 = len([]) |

#### `tests.test_frontend_deps_installed` — 1

**ENVIRONMENT, not code.** `app/node_modules` is not installed in this worktree. CLAUDE.md states the rule outright: a fresh worktree has no `node_modules` and needs `npm ci` before any test claim.

| test | first line of the failure |
|---|---|
| `test_the_frontend_manifest_is_actually_installed` | AssertionError: app/node_modules does not satisfy app/package.json, so every backend rail that crosses in |

#### `tests.test_implied_backfill` — 15

**One cause.** Every one is `TypeError: ... got an unexpected keyword argument` raised by the test's own fake providers - their signatures have drifted from the production function they stand in for. Not 15 defects.

| test | first line of the failure |
|---|---|
| `test_an_empty_finnhub_response_is_retried_not_accepted` | TypeError: TestFinnhubPacing.test_an_empty_finnhub_response_is_retried_not_accepted.<locals>.<lambda>() g |
| `test_every_finnhub_call_is_actually_paced` | TypeError: TestFinnhubPacing.test_every_finnhub_call_is_actually_paced.<locals>.<lambda>() got an unexpec |
| `test_gives_up_after_the_attempt_budget` | TypeError: TestFinnhubPacing.test_gives_up_after_the_attempt_budget.<locals>.<lambda>() got an unexpected |
| `test_no_finnhub_call_at_all_when_fmp_has_nothing` | TypeError: TestFinnhubPacing.test_no_finnhub_call_at_all_when_fmp_has_nothing.<locals>.<lambda>() got an  |
| `test_a_far_away_period_is_refused_not_least_wrong` | TypeError: TestFiscalJoin.test_a_far_away_period_is_refused_not_least_wrong.<locals>.<lambda>() got an un |
| `test_distinct_quarters_all_survive` | TypeError: TestFiscalJoin.providers.<locals>.fake_fmp() got an unexpected keyword argument 'timeout' |
| `test_future_announcements_are_excluded` | TypeError: TestFiscalJoin.providers.<locals>.fake_fmp() got an unexpected keyword argument 'timeout' |
| `test_off_calendar_filer_gets_the_right_quarter` | TypeError: TestFiscalJoin.providers.<locals>.fake_fmp() got an unexpected keyword argument 'timeout' |
| `test_one_quarter_is_never_claimed_twice` | TypeError: TestFiscalJoin.test_one_quarter_is_never_claimed_twice.<locals>.<lambda>() got an unexpected k |
| `test_september_filer_gets_the_right_quarter` | TypeError: TestFiscalJoin.providers.<locals>.fake_fmp() got an unexpected keyword argument 'timeout' |
| `test_an_exception_from_fmp_falls_back_instead_of_escaping` | TypeError: TestFmpIsThePrimaryFiscalSource.test_an_exception_from_fmp_falls_back_instead_of_escaping.<loc |
| `test_falls_back_to_finnhub_rather_than_dropping_the_symbol[None-a shrug \u2014 the provider never answered]` | TypeError: TestFmpIsThePrimaryFiscalSource.test_falls_back_to_finnhub_rather_than_dropping_the_symbol.<lo |
| `test_falls_back_to_finnhub_rather_than_dropping_the_symbol[fmp_result1-answered, but with no history]` | TypeError: TestFmpIsThePrimaryFiscalSource.test_falls_back_to_finnhub_rather_than_dropping_the_symbol.<lo |
| `test_falls_back_to_finnhub_rather_than_dropping_the_symbol[fmp_result2-answered, but the income statement carried no fiscal identity]` | TypeError: TestFmpIsThePrimaryFiscalSource.test_falls_back_to_finnhub_rather_than_dropping_the_symbol.<lo |
| `test_the_real_fmp_leg_is_wired_up_end_to_end` | TypeError: TestFmpIsThePrimaryFiscalSource.test_the_real_fmp_leg_is_wired_up_end_to_end.<locals>.fake_fmp |

#### `tests.test_launch_hardening` — 1

| test | first line of the failure |
|---|---|
| `test_theme_warm_is_throttled_and_capped` | AssertionError: second immediate poll should be throttled assert 0 == 1 + where 0 = len([]) |

#### `tests.test_no_cr_in_tracked_text_blobs` — 1

**Pre-existing, and attributed.** Re-run in isolation: the single offender is `tools/wave_p_cert_corpus/manifest.json`, not any file touched this weekend.

| test | first line of the failure |
|---|---|
| `test_no_tracked_text_file_is_staged_with_cr_line_endings` | AssertionError: these tracked files would be committed with CR line endings, which makes `git blame` attr |

#### `tests.test_scan_screener_auth` — 3

**One cause.** `stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user'` - test-fake drift, the same shape as `test_implied_backfill`.

| test | first line of the failure |
|---|---|
| `test_a_PAID_member_still_gets_200_on_EVERY_route` | TypeError: stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user' |
| `test_a_TRIAL_member_is_treated_as_paid` | TypeError: stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user' |
| `test_an_ADMIN_gets_200_everywhere_including_the_refresh_route` | TypeError: stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user' |

#### `tests.test_screener_wave2_analyst_store` — 9

**One cause.** `fetch_one` returns `None`, so eight die on `'NoneType' object is not subscriptable` and the ninth on `assert None == {...}`.

| test | first line of the failure |
|---|---|
| `test_fetch_one_30day_window_is_boundary_inclusive` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_30day_window_only_counts_upgrade_downgrade_actions` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_a_raising_leg_nulls_only_its_slice` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_all_four_legs_answer` | AssertionError: assert None == {'consensus': 'Buy', 'downgrades_30d': 1, 'eps_next_y_growth': 50.0, 'pt_t |
| `test_fetch_one_growth_needs_two_distinct_fiscal_years` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_growth_pairs_current_and_next_fy_not_the_payload_edges` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_negative_base_growth_is_refused` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_pt_target_falls_back_to_median` | TypeError: 'NoneType' object is not subscriptable |
| `test_fetch_one_zero_total_consensus_refused_but_other_legs_survive` | TypeError: 'NoneType' object is not subscriptable |

#### `tests.test_screener_wave2_earnings_dates` — 4

`run_pull` produces an empty result set where rows are expected.

| test | first line of the failure |
|---|---|
| `test_run_pull_earliest_future_date_wins_and_receipt_rows_is_deduped_union` | assert 84 == 0 |
| `test_run_pull_et_evening_does_not_discard_a_report_dated_todays_et_date` | AssertionError: assert 'TODAYREP' in {} |
| `test_run_pull_flags_a_chunk_at_the_fmp_row_cap_but_keeps_its_rows` | AssertionError: assert [] == ['2026-08-27'] Right contains one more item: '2026-08-27' Use -v to get more |
| `test_run_pull_malformed_rows_are_skipped_not_fatal` | AssertionError: assert {} == {'GOOD': {'da...sion': 'tbd'}} Right contains 1 more item: {'GOOD': {'date': |

#### `tests.test_shared_state_landmines` — 1

| test | first line of the failure |
|---|---|
| `test_no_test_module_binds_into_sys_modules_at_import_time` | AssertionError: import-time sys.modules bind(s) — install AND remove it in a fixture, or delete the stub  |

#### `tests.test_ticker_explain` — 1

| test | first line of the failure |
|---|---|
| `test_requires_auth` | assert 200 == 401 + where 200 = <Response [200 OK]>.status_code |

#### `tests.test_ticker_logos` — 4

FMP profile-row parsing returns `None` for both accepted shapes, so the FMP leg never contributes and the Finnhub fallback assertions fail with it.

| test | first line of the failure |
|---|---|
| `test_finnhub_logo_bytes_fmp_5xx_marks_transient_then_finnhub_still_tried` | assert False is True + where False = <function _was_transient at 0x0000024D83008CA0>() + where <function  |
| `test_finnhub_logo_bytes_uses_fmp_image_when_present_and_skips_finnhub` | AssertionError: assert None == b'\x89PNG\r\n\x1a\nfmp-logo' |
| `test_fmp_profile_row_parses_bare_dict_shape` | AssertionError: assert None == {'companyName': 'Apple Inc.'} |
| `test_fmp_profile_row_parses_list_of_one_shape` | AssertionError: assert None == {'companyName': 'Apple Inc.', 'sector': 'Technology'} |

#### `tests.test_ticker_meta` — 7

**Two causes, and the first is a REAL production defect:** five raise `NameError: name '_log' is not defined`, which would raise at runtime, not only under test. The other two are FMP-vs-Finnhub mapping mismatches.

| test | first line of the failure |
|---|---|
| `test_fmp_field_mapping_happy_path` | NameError: name '_log' is not defined |
| `test_fmp_is_tried_before_finnhub_and_finnhub_skipped_on_fmp_hit` | AssertionError: assert {'exchange': ...r': None, ...} == {'exchange': ...hnology', ...} Omitting 2 identi |
| `test_fmp_market_cap_unit_conversion_asserts_magnitude` | NameError: name '_log' is not defined |
| `test_fmp_missing_marketcap_key_entirely_yields_none` | NameError: name '_log' is not defined |
| `test_fmp_no_api_key_short_circuits_without_network_call` | NameError: name '_log' is not defined |
| `test_fmp_none_fields_yield_none_not_fabricated` | NameError: name '_log' is not defined |
| `test_fmp_partial_then_finnhub_fills_remainder` | AssertionError: assert {'exchange': ...r': None, ...} == {'exchange': ...hnology', ...} Omitting 3 identi |

#### `tests.test_two_engines_do_not_agree` — 1

| test | first line of the failure |
|---|---|
| `test_the_shipped_thresholds_have_not_moved` | AssertionError: these thresholds changed since the agreement table was measured: vcp/engine: [('_TREND_TE |

#### `tests.test_web_capture_coverage` — 8

**One cause.** `KeyError: 'text_origin'` in all eight - a single key missing from the coverage envelope.

| test | first line of the failure |
|---|---|
| `test_a_reference_only_capture_offers_NO_body_text_to_answer_from` | KeyError: 'text_origin' |
| `test_a_PDF_page_STILL_says_p_N` | KeyError: 'text_origin' |
| `test_a_web_capture_is_labelled_a_CAPTURED_PASSAGE_not_a_page` | KeyError: 'text_origin' |
| `test_a_PDF_page_still_carries_document_complete` | KeyError: 'text_origin' |
| `test_a_row_with_NO_capture_type_is_treated_as_a_pre_wave_L_pdf` | KeyError: 'text_origin' |
| `test_a_web_passage_page_carries_selected_passage_only` | KeyError: 'text_origin' |
| `test_a_web_reference_carries_metadata_only` | KeyError: 'text_origin' |
| `test_selected_passage_only_can_NEVER_map_to_document_complete` | KeyError: 'text_origin' |

#### `tests.test_yf_guard_binds` — 1

| test | first line of the failure |
|---|---|
| `test_every_yfinance_module_has_a_binding_proof_or_a_named_reason` | AssertionError: these modules reach yfinance and have no binding proof: api/services/financial_statements |

## Cross-check against the recorded `gate_shards` baseline

That baseline (`docs/plans/joystick/gate-baseline.json`, measured 2026-09-10 at
`62a228e5d`, corroborated at two merge-bases) covers the **JS/vitest** suite, not
pytest — the two do not overlap, so there is nothing for this sweep to confirm or
contradict. It records **7 failures across 5 files**, plus three names deliberately
**not** baseline entries because each fails only under full-shard load and passes
alone. A timeout is never banked, because banking one leaves a slot a real failure can
occupy unnoticed — which is exactly why the 10 unrunnable files above are recorded as
unmeasured rather than as passing.

## The rail

```sh
python tools/python_failure_baseline.py check --files <explicit paths>
```

- **0** the red set matches the baseline
- **1** it changed — a baseline failure started PASSING, or a NEW failure appeared
- **2** INCONCLUSIVE — the subset could not run, or collected 0 tests. **Never a pass.**

**Mutation-proved, four ways, 2026-09-12:**

| mutation | result |
|---|---|
| none (2 known-red files) | **0** — "red set matches the baseline (7 failing, 44 tests run)" |
| drop the 4 `test_ticker_logos` ids | **1** — four `NEW FAILURE` lines, each named |
| add one ghost id | **1** — `NOW PASSING`, named |
| a path that collects nothing | **2** — INCONCLUSIVE, not a pass |

⭐ The first case is also a **corroboration**: re-running those two files in isolation
reproduced 7 of the 66 independently of the sweep.

⚰️ **Four bugs were fixed in `check` to make that proof honest**, and every one of them
would have made the rail lie in the flattering direction:

1. `rstrip(".py")` strips a CHARACTER SET, not a suffix — `tests/test_happy_py.py`
   became `tests.test_happy_`. Now an explicit suffix strip.
2. `want = {...} or set(base["ids"])` fell back to the **whole baseline** when its
   prefix match found nothing, so a subset naming files with no recorded failures
   reported every other file's failures as "now passing". The fallback is gone.
3. Module matching was a substring test, so `test_bar` matched `tests.test_bars::x`.
   Now matched at a dot boundary.
4. A run collecting **0 tests** returned 0 — "red set matches" — a green light for a
   typo in the file list. Now INCONCLUSIVE. *(The non-vacuity control: an empty result
   is a failed invocation until proven otherwise.)*

**On-demand, not CI.** A full sweep is ~107 minutes, far past the ~5-minute bar for a
CI job. `check` over a named subset is the CI-shaped half.

## Method

`tools/python_failure_baseline.py sweep --batch-size 20`

- **1407 test files** — 1,263 under `tests/`, 144 under `api/`.
- 71 batches of 20, **by explicit file path**, sequential, never parallel.
- `-p no:cacheprovider --timeout=120`, JUnit XML per batch.
- Free physical memory read via `ctypes.GlobalMemoryStatusEx` before every batch; the
  sweep **stops** rather than pushing through below 3 GB. It never had to.
- A batch that crashes, is interrupted or times out is **split in half and retried
  once**; a group that still cannot run is recorded UNRUNNABLE with its reason, never
  skipped silently.

⛔ **Never `pytest tests/` and never `-k`.** Collection over the whole tree has reached
6.6 GB here and a full run reached 18 GB before the OOM killer took it. `-k` filters
AFTER collection, so it contains nothing — which is exactly why a run that *looked*
scoped killed two background tasks.
