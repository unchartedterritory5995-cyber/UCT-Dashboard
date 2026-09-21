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
| #190 → #191 | **UNREADABLE** | the diff a7176a764..dc791510e is UNREADABLE (shallow checkout?) |
| #191 → #192 | **UNREADABLE** | the diff dc791510e..5141c74c4 is UNREADABLE (shallow checkout?) |
| #192 → #194 | **UNREADABLE** | the diff 5141c74c4..9daa6e131 is UNREADABLE (shallow checkout?) |
| #194 → #196 | **UNREADABLE** | the diff 9daa6e131..eac4dd3a8 is UNREADABLE (shallow checkout?) |
| #196 → #198 | **UNREADABLE** | the diff eac4dd3a8..14d3566bc is UNREADABLE (shallow checkout?) |
| #198 → #199 | **UNREADABLE** | the diff 14d3566bc..a15242eee is UNREADABLE (shallow checkout?) |
| #199 → #20 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #20 → #200 | **UNREADABLE** | the diff 03ebbd7f7..ee26ba604 is UNREADABLE (shallow checkout?) |
| #200 → #202 | **UNREADABLE** | the diff ee26ba604..fa296d6e7 is UNREADABLE (shallow checkout?) |
| #202 → #203 | **UNREADABLE** | the diff fa296d6e7..42d6e439c is UNREADABLE (shallow checkout?) |
| #203 → #204 | no | api/services/journal_two/notes.py is referenced by 688 source file(s); app/src/pages/journal-2-0/components/notebook/NoteGraphView.jsx is referenced by 7 source file(s); app/src/pages/journal-2-0/components/notebook/NoteGraphView.test.jsx is referenced by 1 source file(s) |
| #204 → #205 | **UNREADABLE** | the diff 3cee6c6ae..2be7a17e6 is UNREADABLE (shallow checkout?) |
| #205 → #206 | **UNREADABLE** | the diff 2be7a17e6..2e70032bc is UNREADABLE (shallow checkout?) |
| #206 → #207 | no | app/src/pages/journal-2-0/components/notebook/FolderSidebar.module.css is referenced by 1 source file(s); app/src/pages/journal-2-0/components/notebook/ResearchHome.module.css is referenced by 1 source file(s); app/src/pages/journal-2-0/tabs/NotebookTab.module.css is referenced by 2 source file(s) |
| #207 → #208 | **UNREADABLE** | the diff 270606777..b6932a79a is UNREADABLE (shallow checkout?) |
| #208 → #209 | **UNREADABLE** | the diff b6932a79a..541529320 is UNREADABLE (shallow checkout?) |
| #209 → #21 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #21 → #210 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #210 → #211 | **UNREADABLE** | the diff f243fe3f7..0f5308ebf is UNREADABLE (shallow checkout?) |
| #211 → #213 | **UNREADABLE** | the diff 0f5308ebf..fee9a7721 is UNREADABLE (shallow checkout?) |
| #213 → #214 | **UNREADABLE** | the diff fee9a7721..af6069781 is UNREADABLE (shallow checkout?) |
| #214 → #215 | **UNREADABLE** | the diff af6069781..cbc7b177b is UNREADABLE (shallow checkout?) |
| #215 → #216 | **UNREADABLE** | the diff cbc7b177b..a2c635cde is UNREADABLE (shallow checkout?) |
| #216 → #217 | **UNREADABLE** | the diff a2c635cde..e9ded2770 is UNREADABLE (shallow checkout?) |
| #217 → #218 | **UNREADABLE** | the diff e9ded2770..8a4b8ddd1 is UNREADABLE (shallow checkout?) |
| #218 → #219 | **UNREADABLE** | the diff 8a4b8ddd1..67bfadd05 is UNREADABLE (shallow checkout?) |
| #219 → #22 | **UNREADABLE** | the diff 67bfadd05..9fa4ee150 is UNREADABLE (shallow checkout?) |
| #22 → #220 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #220 → #221 | no | api/routers/watchlists.py is referenced by 145 source file(s); api/services/screener/snapshot_db.py is referenced by 94 source file(s); api/services/watchlist_prebuilt.py is referenced by 20 source file(s) |
| #221 → #222 | no | api/routers/watchlists.py is referenced by 145 source file(s) |
| #222 → #224 | **UNREADABLE** | the diff 4fec5bb99..e952059c6 is UNREADABLE (shallow checkout?) |
| #224 → #225 | **UNREADABLE** | the diff e952059c6..602f8865a is UNREADABLE (shallow checkout?) |
| #225 → #226 | **UNREADABLE** | the diff 602f8865a..276d7107c is UNREADABLE (shallow checkout?) |
| #226 → #227 | **UNREADABLE** | the diff 276d7107c..69b05f97c is UNREADABLE (shallow checkout?) |
| #227 → #228 | no | api/data/screener_buyout_exclude.json is referenced by 1 source file(s); api/routers/screener.py is referenced by 548 source file(s); api/services/screener/screener_universe.py is referenced by 3 source file(s) |
| #228 → #229 | **yes** | SAME SHA — the strongest form of the rule |
| #229 → #23 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #23 → #230 | **UNREADABLE** | the diff ce615a2eb..0cd80feca is UNREADABLE (shallow checkout?) |
| #230 → #232 | **UNREADABLE** | the diff 0cd80feca..be66e9031 is UNREADABLE (shallow checkout?) |
| #232 → #233 | **UNREADABLE** | the diff be66e9031..66b182fcb is UNREADABLE (shallow checkout?) |
| #233 → #234 | **UNREADABLE** | the diff 66b182fcb..7ac9ff5ce is UNREADABLE (shallow checkout?) |
| #234 → #235 | **UNREADABLE** | the diff 7ac9ff5ce..af1b1b57e is UNREADABLE (shallow checkout?) |
| #235 → #236 | **UNREADABLE** | the diff af1b1b57e..267d512ce is UNREADABLE (shallow checkout?) |
| #236 → #237 | **UNREADABLE** | the diff 267d512ce..c35da9445 is UNREADABLE (shallow checkout?) |
| #237 → #238 | **UNREADABLE** | the diff c35da9445..a39cce5ce is UNREADABLE (shallow checkout?) |
| #238 → #24 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
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

⛔ **10 of 171 consecutive pairs were comparable.** A pair that is not comparable contributes NO evidence in either direction — it cannot make a test flaky and it cannot clear one.

## `pytest` · `tests.test_discord_close_note`

**test_a_note_that_cannot_be_written_still_posts_the_charts**

- changed state across: #45→#46
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestRestoreGuarantee`

**test_the_file_is_byte_identical_after_a_detected_mutation**

- changed state across: #25→#26, #60→#61, #68→#69
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_a_detected_mutation_passes_the_check**

- changed state across: #228→#229, #45→#46, #57→#58, #68→#69
- consecutive stable runs since: **2** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_expect_red_naming_the_right_test_passes**

- changed state across: #25→#26, #26→#27, #57→#58, #60→#61
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `vitest` · `src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

**an engine-drawn indicator still appears in the crosshair legend > ⛔⛔ A HOVER REACHES THE RENDERER NOT AT ALL**

- changed state across: #49→#50
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## Left the set (5 consecutive stable runs)

- `pytest` · `tests.test_massive_ws_stop` · test_stop_idempotency_and_stop_before_start
- `pytest` · `tests.test_theme_index_watchlist` · test_overlay_today_replaces_stale_and_appends_missing
- `pytest` · `tests.test_ticker_explain.TestRoute` · test_requires_auth
- `pytest` · `tests.test_ticker_logos_prewarm` · test_run_pass_skips_warm_and_resolves_cold
- `vitest` · `src/components/research/sections/CatalystsSection.test.jsx` · CatalystsSection > shows the finding state while catalysts generate and lands on its own (polls)
- `vitest` · `src/context/AuthContext.test.jsx` · AuthContext fetchUser — transient vs definitive session-check failures > 503 on a REFETCH with a logged-in user → user and plan state PRESERVED

