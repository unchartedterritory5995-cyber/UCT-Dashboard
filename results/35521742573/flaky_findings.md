# Flaky tests — DERIVED

⚠️ Written by `tools/ci_inventory.py --flaky`. **Not hand-edited, and not a quarantine list**: it is re-derived from the record on every run, so a test leaves it the moment the evidence stops supporting it.

**The rule (F-CI-30).** A test is FLAKY when the record shows it in BOTH states across two runs that no code change can distinguish — the same commit SHA, or a diff that cannot reach a test. It leaves after **5** consecutive stable runs. ⛔ There is NO rerun-on-failure anywhere in this pipeline.

| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED |
|---|---|---|
| **5** | 2 | 0 |

## The pairs the record could compare

| runs | comparable | why |
|---|---|---|
| #101 → #102 | **UNREADABLE** | the diff a4257400a..4c7c4c03f is UNREADABLE (shallow checkout?) |
| #102 → #103 | **UNREADABLE** | the diff 4c7c4c03f..09be672f4 is UNREADABLE (shallow checkout?) |
| #103 → #104 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #104 → #105 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #105 → #107 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #107 → #108 | **UNREADABLE** | the diff 1a937192f..2996f606a is UNREADABLE (shallow checkout?) |
| #108 → #110 | **UNREADABLE** | the diff 2996f606a..76fb85247 is UNREADABLE (shallow checkout?) |
| #110 → #111 | **UNREADABLE** | the diff 76fb85247..7696be75f is UNREADABLE (shallow checkout?) |
| #111 → #113 | **UNREADABLE** | the diff 7696be75f..e855f62cd is UNREADABLE (shallow checkout?) |
| #113 → #114 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #114 → #117 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #117 → #120 | no | api/main.py is referenced by 1098 source file(s); api/routers/member.py is referenced by 2105 source file(s) |
| #120 → #122 | no | tools/q1_window_queue.json is referenced by 2 source file(s) |
| #122 → #124 | no | api/services/wisdom/core/flags.py is referenced by 408 source file(s); api/services/wisdom/sources/jobs.py is referenced by 209 source file(s); api/services/wisdom/sources/schema.py is referenced by 488 source file(s) |
| #124 → #125 | **yes** | no changed file can reach a test |
| #125 → #128 | no | api/routers/stream.py is referenced by 394 source file(s); api/services/bar_broadcaster.py is referenced by 15 source file(s); app/src/pages/BreadthCharts.jsx is referenced by 32 source file(s) |
| #128 → #129 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #129 → #132 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #132 → #133 | no | app/src/components/chart/engine/__tests__/fakeChart.js is referenced by 23 source file(s); app/src/components/chart/engine/fillPrimitive.js is referenced by 7 source file(s) |
| #133 → #134 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #134 → #136 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #136 → #137 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #137 → #139 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #139 → #140 | no | app/src/components/TickerPopup.jsx is referenced by 132 source file(s); app/src/pages/ThemeTrackerPage.jsx is referenced by 20 source file(s); app/src/pages/Watchlists.jsx is referenced by 84 source file(s) |
| #140 → #141 | no | app/src/pages/breadth/v2/BreadthChartsV2.jsx is referenced by 7 source file(s); app/src/pages/breadth/v2/presentation.test.jsx is referenced by 2 source file(s) |
| #141 → #142 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #142 → #146 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #146 → #147 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #147 → #148 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #148 → #15 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #15 → #150 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #150 → #151 | no | tools/q1_f5_matrix.py is referenced by 5 source file(s) |
| #151 → #152 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #152 → #155 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #155 → #156 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #156 → #158 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #158 → #159 | no | api/flow_worker_deploy_marker.txt is referenced by 2 source file(s); api/services/alert_taxonomy/indicator_condition.py is referenced by 10 source file(s); api/services/alert_taxonomy/indicator_condition_compare.py is referenced by 5 source file(s) |
| #159 → #16 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #16 → #160 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/data/entitlements_manifest.json is referenced by 2 source file(s); api/main.py is referenced by 949 source file(s) |
| #160 → #161 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #161 → #162 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #162 → #163 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #163 → #165 | no | api/services/wisdom/publish/adapters/drafts.py is referenced by 36 source file(s); tests/test_wisdom_publish_adapters_drafts.py is referenced by 1 source file(s) |
| #165 → #166 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #166 → #167 | no | app/src/hub/HubContext.jsx is referenced by 35 source file(s); app/src/hub/confirmFieldsReachable.test.jsx is referenced by 3 source file(s); app/src/hub/linkTickerWritesTheNote.test.jsx is referenced by 2 source file(s) |
| #167 → #168 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #168 → #169 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #169 → #17 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/main.py is referenced by 945 source file(s); api/routers/bars.py is referenced by 1455 source file(s) |
| #17 → #170 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #170 → #171 | no | app/src/components/chart/engine/ast/bothLanesAreTwoLanes.test.js is referenced by 2 source file(s); app/src/components/chart/engine/ast/objectProgram.js is referenced by 14 source file(s); app/src/components/chart/engine/ast/pine.js is referenced by 346 source file(s) |
| #171 → #172 | no | api/routers/journal_two.py is referenced by 464 source file(s); api/services/journal_two/notes.py is referenced by 687 source file(s); app/src/components/ui/UIcon.jsx is referenced by 368 source file(s) |
| #172 → #173 | **UNREADABLE** | the diff c4f45103b..04d3ca329 is UNREADABLE (shallow checkout?) |
| #173 → #174 | **UNREADABLE** | the diff 04d3ca329..d9983b3d4 is UNREADABLE (shallow checkout?) |
| #174 → #176 | no | api/darkpool_aggregator.py is referenced by 10 source file(s) |
| #176 → #177 | no | api/services/journal_two/note_properties.py is referenced by 12 source file(s); app/src/pages/journal-2-0/components/notebook/CaptureDialog.module.css is referenced by 1 source file(s); app/src/pages/journal-2-0/components/notebook/NoteBoardView.jsx is referenced by 4 source file(s) |
| #177 → #178 | **UNREADABLE** | the diff 15c8059c8..823dc1cfc is UNREADABLE (shallow checkout?) |
| #178 → #179 | **UNREADABLE** | the diff 823dc1cfc..f90af28c6 is UNREADABLE (shallow checkout?) |
| #179 → #18 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #18 → #180 | **UNREADABLE** | the diff c89dd6b81..ada12cc7f is UNREADABLE (shallow checkout?) |
| #180 → #181 | **UNREADABLE** | the diff ada12cc7f..79c4be893 is UNREADABLE (shallow checkout?) |
| #181 → #182 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #182 → #183 | **UNREADABLE** | the diff 87b5735f4..ba3d115f2 is UNREADABLE (shallow checkout?) |
| #183 → #184 | **UNREADABLE** | the diff ba3d115f2..1c29ae5c9 is UNREADABLE (shallow checkout?) |
| #184 → #185 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #185 → #187 | **UNREADABLE** | the diff 8a946b699..079b35544 is UNREADABLE (shallow checkout?) |
| #187 → #188 | **UNREADABLE** | the diff 079b35544..99fedc3f7 is UNREADABLE (shallow checkout?) |
| #188 → #189 | **UNREADABLE** | the diff 99fedc3f7..19e4475f2 is UNREADABLE (shallow checkout?) |
| #189 → #19 | **UNREADABLE** | the diff 19e4475f2..aba219779 is UNREADABLE (shallow checkout?) |
| #19 → #190 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #190 → #20 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
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
| #57 → #58 | **yes** | no changed file can reach a test |
| #58 → #59 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #59 → #60 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #60 → #61 | **yes** | no changed file can reach a test |
| #61 → #63 | no | railway.web.json is referenced by 2 source file(s) |
| #63 → #64 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #64 → #66 | no | api/services/alert_taxonomy/price_level_projection.py is referenced by 12 source file(s) |
| #66 → #67 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #67 → #68 | no | app/src/hub/HubChip.jsx is referenced by 19 source file(s); app/src/hub/HubFan.jsx is referenced by 13 source file(s); app/src/hub/HubRoot.jsx is referenced by 85 source file(s) |
| #68 → #69 | **yes** | no changed file can reach a test |
| #69 → #70 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #70 → #72 | **UNREADABLE** | the diff 3bf13974a..593b3da4a is UNREADABLE (shallow checkout?) |
| #72 → #74 | **UNREADABLE** | the diff 593b3da4a..888791525 is UNREADABLE (shallow checkout?) |
| #74 → #75 | **UNREADABLE** | the diff 888791525..3d8c20edc is UNREADABLE (shallow checkout?) |
| #75 → #77 | **UNREADABLE** | the diff 3d8c20edc..4fc829aec is UNREADABLE (shallow checkout?) |
| #77 → #79 | no | app/src/components/StockChart.jsx is referenced by 352 source file(s); app/src/components/chart/ChartSettingsIndicators.jsx is referenced by 14 source file(s); app/src/components/chart/ChartSettingsModal.jsx is referenced by 51 source file(s) |
| #79 → #80 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #80 → #81 | no | api/services/entity_master_d5_producer.py is referenced by 1 source file(s) |
| #81 → #83 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #83 → #85 | no | app/src/hub/HubKnob.jsx is referenced by 15 source file(s); app/src/hub/hub.module.css is referenced by 26 source file(s); app/src/styles/tokens.css is referenced by 256 source file(s) |
| #85 → #89 | no | api/services/screener/live_tier.py is referenced by 14 source file(s); api/services/wisdom/extract/batch.py is referenced by 300 source file(s); api/services/wisdom/extract/prescreen.py is referenced by 4 source file(s) |
| #89 → #90 | **UNREADABLE** | the diff 9abba727b..05e8c59c4 is UNREADABLE (shallow checkout?) |
| #90 → #91 | **UNREADABLE** | the diff 05e8c59c4..8ad9e1d62 is UNREADABLE (shallow checkout?) |
| #91 → #92 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #92 → #93 | **UNREADABLE** | the diff e38d47b55..cafed9844 is UNREADABLE (shallow checkout?) |
| #93 → #94 | **UNREADABLE** | the diff cafed9844..47e2ad559 is UNREADABLE (shallow checkout?) |
| #94 → #96 | no | api/services/calendar_personalization.py is referenced by 10 source file(s); app/src/pages/Calendar.jsx is referenced by 170 source file(s); app/src/pages/calendar/FeedView.jsx is referenced by 10 source file(s) |
| #96 → #99 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |

⛔ **11 of 130 consecutive pairs were comparable.** A pair that is not comparable contributes NO evidence in either direction — it cannot make a test flaky and it cannot clear one.

## `pytest` · `tests.test_discord_close_note`

**test_a_note_that_cannot_be_written_still_posts_the_charts**

- changed state across: #45→#46
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestRestoreGuarantee`

**test_the_file_is_byte_identical_after_a_detected_mutation**

- changed state across: #21→#22, #25→#26, #60→#61, #68→#69
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_a_detected_mutation_passes_the_check**

- changed state across: #45→#46, #57→#58, #68→#69
- consecutive stable runs since: **2** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_expect_red_naming_the_right_test_passes**

- changed state across: #21→#22, #25→#26, #26→#27, #57→#58, #60→#61
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `vitest` · `src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

**an engine-drawn indicator still appears in the crosshair legend > ⛔⛔ A HOVER REACHES THE RENDERER NOT AT ALL**

- changed state across: #49→#50
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## Left the set (5 consecutive stable runs)

- `pytest` · `tests.test_massive_ws_stop` · test_stop_idempotency_and_stop_before_start
- `pytest` · `tests.test_massive_ws_stop` · test_stop_sends_close_frame_and_joins
- `pytest` · `tests.test_theme_index_watchlist` · test_overlay_today_replaces_stale_and_appends_missing
- `pytest` · `tests.test_ticker_explain.TestRoute` · test_requires_auth
- `pytest` · `tests.test_ticker_logos_prewarm` · test_run_pass_skips_warm_and_resolves_cold
- `vitest` · `src/components/research/sections/CatalystsSection.test.jsx` · CatalystsSection > shows the finding state while catalysts generate and lands on its own (polls)
- `vitest` · `src/context/AuthContext.test.jsx` · AuthContext fetchUser — transient vs definitive session-check failures > 503 on a REFETCH with a logged-in user → user and plan state PRESERVED
- `vitest` · `src/pages/screener/ScreensManager.test.jsx` · a second attempt replaces the previous refusal rather than stacking one under it

