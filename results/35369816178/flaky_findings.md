# Flaky tests — DERIVED

⚠️ Written by `tools/ci_inventory.py --flaky`. **Not hand-edited, and not a quarantine list**: it is re-derived from the record on every run, so a test leaves it the moment the evidence stops supporting it.

**The rule (F-CI-30).** A test is FLAKY when the record shows it in BOTH states across two runs that no code change can distinguish — the same commit SHA, or a diff that cannot reach a test. It leaves after **5** consecutive stable runs. ⛔ There is NO rerun-on-failure anywhere in this pipeline.

| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED |
|---|---|---|
| **5** | 0 | 1 |

## The pairs the record could compare

| runs | comparable | why |
|---|---|---|
| #15 → #16 | no | .github/workflows/full-suite-report.yml changed the suite-running job(s) pytest |
| #16 → #17 | no | .github/workflows/full-suite-report.yml changed the suite-running job(s) pytest; tools/ci_extract.py is referenced by 1 source file(s); tools/ci_summarize.py is invoked by the suite's own jobs |
| #17 → #18 | no | tools/ci_aggregate.py is referenced by 2 source file(s) |
| #18 → #19 | no | .github/workflows/full-suite-report.yml changed the suite-running job(s) pytest |
| #19 → #20 | **yes** | no changed file can reach a test |
| #20 → #21 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that |
| #21 → #22 | **yes** | no changed file can reach a test |
| #22 → #23 | **yes** | no changed file can reach a test |
| #23 → #24 | no | tests/test_ast_math_parity.py is referenced by 2 source file(s); tools/pytest_shards.py is invoked by the suite's own jobs |
| #24 → #25 | no | tools/pytest_shards.py is invoked by the suite's own jobs |
| #25 → #26 | **yes** | no changed file can reach a test |
| #26 → #27 | **yes** | no changed file can reach a test |
| #27 → #28 | no | .github/workflows/full-suite-report.yml changed the suite-running job(s) collect_profile, pytest, vitest |
| #28 → #29 | **yes** | no changed file can reach a test |
| #29 → #30 | no | tools/pytest_shards.py is invoked by the suite's own jobs |
| #30 → #31 | no | tests/conftest.py is referenced by 88 source file(s) |
| #31 → #32 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that |
| #32 → #33 | **UNREADABLE** | the diff 4c4ba1cb1..026a6693f is UNREADABLE (shallow checkout?) |
| #33 → #34 | **UNREADABLE** | the diff 026a6693f..d50fadadf is UNREADABLE (shallow checkout?) |
| #34 → #35 | **UNREADABLE** | the diff d50fadadf..217ae7230 is UNREADABLE (shallow checkout?) |
| #35 → #36 | **UNREADABLE** | the diff 217ae7230..d25a84ae4 is UNREADABLE (shallow checkout?) |
| #36 → #37 | **UNREADABLE** | the diff d25a84ae4..35ce385b5 is UNREADABLE (shallow checkout?) |
| #37 → #38 | **UNREADABLE** | the diff 35ce385b5..d25eddf49 is UNREADABLE (shallow checkout?) |
| #38 → #39 | **UNREADABLE** | the diff d25eddf49..e4b2658ec is UNREADABLE (shallow checkout?) |
| #39 → #40 | no | api/routers/auth.py is referenced by 725 source file(s); api/services/feature_flag_index.py is referenced by 13 source file(s); app/src/context/AuthContext.jsx is referenced by 245 source file(s) |
| #40 → #41 | no | api/routers/breadth_monitor.py is referenced by 70 source file(s); api/services/breadth_timing.py is referenced by 11 source file(s) |
| #41 → #42 | no | requirements.txt is referenced by 37 source file(s) |
| #42 → #43 | no | api/main.py is referenced by 1023 source file(s); tests/test_oi44_loop_blockers_gate.py is referenced by 2 source file(s) |
| #43 → #45 | no | api/main.py is referenced by 1024 source file(s); api/routers/breadth_monitor.py is referenced by 71 source file(s); api/services/wisdom/extract/batch.py is referenced by 296 source file(s) |
| #45 → #46 | **yes** | no changed file can reach a test |
| #46 → #48 | no | tools/wisdom/extract_golden_gate.py is referenced by 8 source file(s) |
| #48 → #49 | no | api/services/wisdom/extract/prompt.py is referenced by 225 source file(s) |
| #49 → #50 | **yes** | no changed file can reach a test |
| #50 → #51 | no | app/src/components/StockChart.jsx is referenced by 349 source file(s); app/src/components/StockChart.verticalViewLock.test.jsx is referenced by 1 source file(s); app/src/components/chart/engine/__tests__/controlDoorCensus.test.js is referenced by 8 source file(s) |
| #51 → #52 | no | api/main.py is referenced by 1027 source file(s); api/routers/breadth_monitor.py is referenced by 71 source file(s) |
| #52 → #54 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #54 → #57 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #57 → #59 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |

⛔ **8 of 38 consecutive pairs were comparable.** A pair that is not comparable contributes NO evidence in either direction — it cannot make a test flaky and it cannot clear one.

## `pytest` · `tests.test_massive_ws_stop`

**test_stop_sends_close_frame_and_joins**

- changed state across: #21→#22
- consecutive stable runs since: **4** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestRestoreGuarantee`

**test_the_file_is_byte_identical_after_a_detected_mutation**

- changed state across: #21→#22, #25→#26
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_a_detected_mutation_passes_the_check**

- changed state across: #45→#46
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_expect_red_naming_the_right_test_passes**

- changed state across: #21→#22, #25→#26, #26→#27
- consecutive stable runs since: **3** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `vitest` · `src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

**an engine-drawn indicator still appears in the crosshair legend > ⛔⛔ A HOVER REACHES THE RENDERER NOT AT ALL**

- changed state across: #49→#50
- consecutive stable runs since: **0** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## Left the set (5 consecutive stable runs)

- `pytest` · `tests.test_discord_close_note` · test_a_note_that_cannot_be_written_still_posts_the_charts
- `pytest` · `tests.test_theme_index_watchlist` · test_overlay_today_replaces_stale_and_appends_missing
- `pytest` · `tests.test_ticker_explain.TestRoute` · test_requires_auth
- `pytest` · `tests.test_ticker_logos_prewarm` · test_run_pass_skips_warm_and_resolves_cold
- `vitest` · `src/components/research/sections/CatalystsSection.test.jsx` · CatalystsSection > shows the finding state while catalysts generate and lands on its own (polls)
- `vitest` · `src/context/AuthContext.test.jsx` · AuthContext fetchUser — transient vs definitive session-check failures > 503 on a REFETCH with a logged-in user → user and plan state PRESERVED
- `vitest` · `src/pages/screener/ScreensManager.test.jsx` · a second attempt replaces the previous refusal rather than stacking one under it

