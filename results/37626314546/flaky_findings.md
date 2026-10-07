# Flaky tests — DERIVED

⚠️ Written by `tools/ci_inventory.py --flaky`. **Not hand-edited, and not a quarantine list**: it is re-derived from the record on every run, so a test leaves it the moment the evidence stops supporting it.

**The rule (F-CI-30).** A test is FLAKY when the record shows it in BOTH states across two runs that no code change can distinguish — the same commit SHA, or a diff that cannot reach a test. It leaves after **5** consecutive stable runs. ⛔ There is NO rerun-on-failure anywhere in this pipeline.

| FLAKY_SIZE | FLAKY_NEW | FLAKY_FIXED |
|---|---|---|
| **8** | 2 | 0 |

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
| #238 → #239 | **UNREADABLE** | the diff a39cce5ce..46d03d3c4 is UNREADABLE (shallow checkout?) |
| #239 → #24 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #24 → #240 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #240 → #241 | no | .gitignore is referenced by 10 source file(s); api/data/naaim_history.csv is referenced by 4 source file(s); api/main.py is referenced by 1112 source file(s) |
| #241 → #244 | no | api/main.py is referenced by 1114 source file(s); api/routers/market_indicators.py is referenced by 18 source file(s); api/services/market_indicators/cboe_store.py is referenced by 5 source file(s) |
| #244 → #245 | no | api/routers/bars.py is referenced by 1708 source file(s); edge/bars-edge-router/worker.js is referenced by 420 source file(s); edge/bars-edge-router/worker.test.mjs is referenced by 2 source file(s) |
| #245 → #246 | no | api/routers/bars.py is referenced by 1708 source file(s); tests/test_market_indicators_edge_routing.py is referenced by 1 source file(s) |
| #246 → #247 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #247 → #248 | no | api/services/alert_taxonomy/price_level_compare.py is referenced by 6 source file(s); api/services/alert_taxonomy/price_level_projection.py is referenced by 13 source file(s) |
| #248 → #249 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #249 → #25 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #25 → #252 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #252 → #253 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #253 → #256 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #256 → #257 | no | api/routers/ticker_search.py is referenced by 21 source file(s); api/services/breadth_sentiment_history.py is referenced by 15 source file(s); api/services/market_indicators/aaii_store.py is referenced by 3 source file(s) |
| #257 → #259 | no | api/services/journal_two/test_wave_g_thesis.py is referenced by 1 source file(s); api/services/journal_two/thesis_changelog.py is referenced by 2 source file(s); app/src/pages/journal-2-0/components/notebook/FolderSidebar.module.css is referenced by 1 source file(s) |
| #259 → #26 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #26 → #260 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #260 → #261 | no | api/services/market_indicators/registry.py is referenced by 714 source file(s); api/services/market_indicators/series.py is referenced by 1049 source file(s); app/src/components/StockChart.jsx is referenced by 386 source file(s) |
| #261 → #262 | **UNREADABLE** | the diff 317516151..af1f757cb is UNREADABLE (shallow checkout?) |
| #262 → #263 | **UNREADABLE** | the diff af1f757cb..798d5dacd is UNREADABLE (shallow checkout?) |
| #263 → #264 | **UNREADABLE** | the diff 798d5dacd..ffa77ef69 is UNREADABLE (shallow checkout?) |
| #264 → #265 | **UNREADABLE** | the diff ffa77ef69..57d0602b3 is UNREADABLE (shallow checkout?) |
| #265 → #266 | no | app/src/pages/journal-2-0/components/notebook/CaptureConnectPage.module.css is referenced by 2 source file(s); app/src/pages/journal-2-0/components/notebook/CaptureDialog.module.css is referenced by 1 source file(s); app/src/pages/journal-2-0/components/notebook/CapturedSourceSheet.module.css is referenced by 1 source file(s) |
| #266 → #267 | **yes** | no changed file can reach a test |
| #267 → #269 | **yes** | no changed file can reach a test |
| #269 → #27 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #27 → #270 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/darkpool_aggregator.py is referenced by 10 source file(s); api/data/canonical_address_book.json is referenced by 7 source file(s) |
| #270 → #271 | no | tests/test_signature_router.py is referenced by 2 source file(s) |
| #271 → #274 | no | api/data/bars_ordinal_census.json is referenced by 2 source file(s); tests/test_signature_router.py is referenced by 2 source file(s); tools/bars_ordinal_census.py is referenced by 1 source file(s) |
| #274 → #275 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #275 → #276 | no | app/src/components/mobile/ResponsiveTable.jsx is referenced by 3 source file(s); app/src/pages/journal-2-0/components/notebook/BlockedBadge.jsx is referenced by 6 source file(s); app/src/pages/journal-2-0/components/notebook/BlockedBadge.module.css is referenced by 1 source file(s) |
| #276 → #278 | no | app/src/pages/journal-2-0/components/connectors/ConnectTilesCompact.jsx is referenced by 4 source file(s); app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx is referenced by 18 source file(s); app/src/pages/journal-2-0/components/notebook/FolderSidebar.module.css is referenced by 1 source file(s) |
| #278 → #279 | no | app/src/pages/journal-2-0/components/notebook/WidgetPalette.jsx is referenced by 2 source file(s) |
| #279 → #28 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #28 → #280 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/darkpool_aggregator.py is referenced by 10 source file(s); api/data/bars_ordinal_census.json is referenced by 2 source file(s) |
| #280 → #281 | no | api/routers/modelbook.py is referenced by 45 source file(s); api/services/modelbook_service.py is referenced by 17 source file(s); app/src/pages/research/ResearchPage.jsx is referenced by 34 source file(s) |
| #281 → #283 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #283 → #285 | no | api/routers/journal_two.py is referenced by 467 source file(s); api/services/journal_two/notes.py is referenced by 694 source file(s); api/services/journal_two/test_wave4_search_evolution.py is referenced by 2 source file(s) |
| #285 → #287 | no | app/src/components/StockChart.jsx is referenced by 391 source file(s); app/src/components/chart/legendHandoff.test.js is referenced by 1 source file(s); app/src/components/chart/liveBarClassify.js is referenced by 2 source file(s) |
| #287 → #289 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #289 → #29 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/darkpool_aggregator.py is referenced by 10 source file(s); api/data/canonical_address_book.json is referenced by 7 source file(s) |
| #29 → #291 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #291 → #293 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #293 → #294 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #294 → #297 | no | api/data/bars_ordinal_census.json is referenced by 2 source file(s); api/data/canonical_address_book.json is referenced by 7 source file(s); app/src/pages/journal-2-0/GlobalAddPositionProvider.jsx is referenced by 13 source file(s) |
| #297 → #298 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #298 → #30 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/darkpool_aggregator.py is referenced by 10 source file(s); api/data/canonical_address_book.json is referenced by 7 source file(s) |
| #30 → #300 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #300 → #301 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #301 → #306 | no | app/src/components/admin/ChatModerationPanel.jsx is referenced by 2 source file(s); app/src/components/admin/CompassHealthPanel.jsx is referenced by 2 source file(s); app/src/components/research/EarningsResearchModal.jsx is referenced by 26 source file(s) |
| #306 → #307 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #307 → #309 | **yes** | no changed file can reach a test |
| #309 → #31 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #31 → #312 | no | .github/workflows/full-suite-report.yml changed OUTSIDE `jobs:` — every job sees that; api/darkpool_aggregator.py is referenced by 10 source file(s); api/data/bars_ordinal_census.json is referenced by 2 source file(s) |
| #312 → #315 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #315 → #316 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #316 → #318 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #318 → #319 | **UNREADABLE** | the diff a0adf6a9f..9bb79cbe5 is UNREADABLE (shallow checkout?) |
| #319 → #32 | **UNREADABLE** | the diff 9bb79cbe5..4c4ba1cb1 is UNREADABLE (shallow checkout?) |
| #32 → #320 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #320 → #321 | **UNREADABLE** | the diff ecdfef01e..6ec3ebf1e is UNREADABLE (shallow checkout?) |
| #321 → #322 | **UNREADABLE** | the diff 6ec3ebf1e..bab3f8b5c is UNREADABLE (shallow checkout?) |
| #322 → #323 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #323 → #324 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #324 → #325 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #325 → #326 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #326 → #327 | no | api/main.py is referenced by 1145 source file(s); api/routers/fundamentals_pit.py is referenced by 42 source file(s); api/services/fundamentals_pit/__init__.py is referenced by 391 source file(s) |
| #327 → #328 | no | api/services/fundamentals_pit/backfill.py is referenced by 260 source file(s); tests/fundamentals_pit/test_pipeline.py is referenced by 1 source file(s) |
| #328 → #329 | no | api/main.py is referenced by 1146 source file(s); api/services/fundamentals_pit/backfill.py is referenced by 261 source file(s); api/services/fundamentals_pit/derive.py is referenced by 311 source file(s) |
| #329 → #33 | **UNREADABLE** | the diff c44be58a8..026a6693f is UNREADABLE (shallow checkout?) |
| #33 → #330 | **UNREADABLE** | the diff 026a6693f..057c085eb is UNREADABLE (shallow checkout?) |
| #330 → #334 | no | app/src/components/admin/DataPipelineHealthPanel.jsx is referenced by 2 source file(s); app/src/components/admin/ThemeEngineHealthPanel.jsx is referenced by 2 source file(s); app/src/components/screener/reachable.test.js is referenced by 22 source file(s) |
| #334 → #338 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #338 → #339 | no | api/services/bars_prewarm.py is referenced by 26 source file(s); api/services/bars_universe_crawler.py is referenced by 5 source file(s) |
| #339 → #34 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #34 → #340 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #340 → #341 | **UNREADABLE** | the diff 51a61a8b8..475fe1699 is UNREADABLE (shallow checkout?) |
| #341 → #342 | **UNREADABLE** | the diff 475fe1699..47faa70b8 is UNREADABLE (shallow checkout?) |
| #342 → #343 | **UNREADABLE** | the diff 47faa70b8..e2ca7407f is UNREADABLE (shallow checkout?) |
| #343 → #345 | no | api/routers/auth.py is referenced by 774 source file(s); api/routers/charts_layouts.py is referenced by 4 source file(s); api/services/charts_layout_service.py is referenced by 5 source file(s) |
| #345 → #346 | no | api/services/desk_creative.py is referenced by 14 source file(s); api/services/desk_daily_session.py is referenced by 18 source file(s); api/services/desk_thumbnail.py is referenced by 7 source file(s) |
| #346 → #348 | no | api/data/canonical_address_book.json is referenced by 7 source file(s); api/gex_router.py is referenced by 5 source file(s); api/routers/live_prices.py is referenced by 48 source file(s) |
| #348 → #349 | no | app/src/context/AuthContext.jsx is referenced by 272 source file(s); app/src/hooks/livePriceStore.js is referenced by 14 source file(s); app/src/hooks/livePriceStore.test.js is referenced by 1 source file(s) |
| #349 → #35 | **UNREADABLE** | the diff 3207690b4..217ae7230 is UNREADABLE (shallow checkout?) |
| #35 → #350 | **UNREADABLE** | the diff 217ae7230..0b42d050c is UNREADABLE (shallow checkout?) |
| #350 → #352 | no | app/src/pages/screener/shell/FilterRail.jsx is referenced by 4 source file(s); app/src/pages/screener/shell/ScannerShell.module.css is referenced by 14 source file(s) |
| #352 → #353 | no | api/services/bars_prewarm.py is referenced by 27 source file(s) |
| #353 → #354 | no | app/fundamentals-gap-harness.html is referenced by 3 source file(s); app/src/components/StockChart.jsx is referenced by 395 source file(s); app/src/components/chart/engine/__tests__/fixtures/fundamentalsGolden.v4.json is referenced by 2 source file(s) |
| #354 → #355 | **UNREADABLE** | the diff 451aed688..415c5346f is UNREADABLE (shallow checkout?) |
| #355 → #356 | **UNREADABLE** | the diff 415c5346f..ef0c79480 is UNREADABLE (shallow checkout?) |
| #356 → #357 | **UNREADABLE** | the diff ef0c79480..aea50bf2e is UNREADABLE (shallow checkout?) |
| #357 → #358 | **UNREADABLE** | the diff aea50bf2e..6e7b10407 is UNREADABLE (shallow checkout?) |
| #358 → #36 | **UNREADABLE** | the diff 6e7b10407..d25a84ae4 is UNREADABLE (shallow checkout?) |
| #36 → #360 | **UNREADABLE** | the diff d25a84ae4..5fd248c40 is UNREADABLE (shallow checkout?) |
| #360 → #362 | no | api/routers/barspack_router.py is referenced by 4 source file(s); app/src/lib/barsPackClient.js is referenced by 6 source file(s); app/src/lib/barsPackClient.test.js is referenced by 1 source file(s) |
| #362 → #37 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #37 → #370 | **UNREADABLE** | the diff 35ce385b5..a6dfa7d05 is UNREADABLE (shallow checkout?) |
| #370 → #378 | **UNREADABLE** | the diff a6dfa7d05..2024d4a26 is UNREADABLE (shallow checkout?) |
| #378 → #38 | **UNREADABLE** | the diff 2024d4a26..d25eddf49 is UNREADABLE (shallow checkout?) |
| #38 → #383 | **UNREADABLE** | the diff d25eddf49..9cfcbfe88 is UNREADABLE (shallow checkout?) |
| #383 → #39 | **UNREADABLE** | the diff 9cfcbfe88..e4b2658ec is UNREADABLE (shallow checkout?) |
| #39 → #393 | **UNREADABLE** | the diff e4b2658ec..8452b14d8 is UNREADABLE (shallow checkout?) |
| #393 → #396 | **UNREADABLE** | the diff 8452b14d8..12705f187 is UNREADABLE (shallow checkout?) |
| #396 → #398 | **UNREADABLE** | the diff 12705f187..24092c91d is UNREADABLE (shallow checkout?) |
| #398 → #399 | no | api/services/bars_universe_crawler.py is referenced by 6 source file(s) |
| #399 → #40 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #40 → #400 | **UNREADABLE** | the diff 8568d13ad..357bef0c7 is UNREADABLE (shallow checkout?) |
| #400 → #401 | **UNREADABLE** | the diff 357bef0c7..bd9d7cd6d is UNREADABLE (shallow checkout?) |
| #401 → #403 | **UNREADABLE** | the diff bd9d7cd6d..351a1c906 is UNREADABLE (shallow checkout?) |
| #403 → #404 | **UNREADABLE** | the diff 351a1c906..7fd9e19f9 is UNREADABLE (shallow checkout?) |
| #404 → #407 | **UNREADABLE** | the diff 7fd9e19f9..0c12a200e is UNREADABLE (shallow checkout?) |
| #407 → #408 | **UNREADABLE** | the diff 0c12a200e..09a218e86 is UNREADABLE (shallow checkout?) |
| #408 → #409 | **UNREADABLE** | the diff 09a218e86..b8774ae2a is UNREADABLE (shallow checkout?) |
| #409 → #41 | **UNREADABLE** | the diff b8774ae2a..327413600 is UNREADABLE (shallow checkout?) |
| #41 → #410 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #410 → #411 | **yes** | no changed file can reach a test |
| #411 → #413 | **yes** | no changed file can reach a test |
| #413 → #415 | no | app/src/components/screener/reachable.test.js is referenced by 27 source file(s); app/src/pages/OptionsFlow.jsx is referenced by 73 source file(s); tools/hub_nav_smoke.py is referenced by 5 source file(s) |
| #415 → #418 | no | api/routers/auth.py is referenced by 780 source file(s); app/src/pages/Watchlists.jsx is referenced by 96 source file(s); app/src/pages/charts/ChartsWorkspace.jsx is referenced by 71 source file(s) |
| #418 → #419 | no | api/services/desk_session_audit.py is referenced by 6 source file(s); tests/test_desk_session_audit.py is referenced by 3 source file(s) |
| #419 → #42 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #42 → #421 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #421 → #423 | no | api/flow_db.py is referenced by 50 source file(s); api/flow_router.py is referenced by 33 source file(s); api/services/alert_taxonomy/dark_report.py is referenced by 2 source file(s) |
| #423 → #426 | no | api/flow_db.py is referenced by 50 source file(s); api/flow_router.py is referenced by 33 source file(s); api/flow_ticker_card.py is referenced by 6 source file(s) |
| #426 → #428 | no | api/flow_db.py is referenced by 50 source file(s); api/flow_router.py is referenced by 33 source file(s); api/services/flow_card_from_page.py is referenced by 2 source file(s) |
| #428 → #429 | **UNREADABLE** | the diff ba6d4fb64..6bd8fd319 is UNREADABLE (shallow checkout?) |
| #429 → #43 | **UNREADABLE** | the diff 6bd8fd319..925948522 is UNREADABLE (shallow checkout?) |
| #43 → #434 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #434 → #435 | **UNREADABLE** | the diff 2316c8ca4..dc49f74ec is UNREADABLE (shallow checkout?) |
| #435 → #439 | **UNREADABLE** | the diff dc49f74ec..9f07cca40 is UNREADABLE (shallow checkout?) |
| #439 → #440 | **UNREADABLE** | the diff 9f07cca40..2c3ed3093 is UNREADABLE (shallow checkout?) |
| #440 → #444 | **UNREADABLE** | the diff 2c3ed3093..f126dbec9 is UNREADABLE (shallow checkout?) |
| #444 → #445 | **UNREADABLE** | the diff f126dbec9..eea9818e4 is UNREADABLE (shallow checkout?) |
| #445 → #447 | no | api/main.py is referenced by 1158 source file(s); api/routers/chart_edge_service.py is referenced by 2 source file(s) |
| #447 → #448 | **UNREADABLE** | the diff 8ecf428bc..67f533cf1 is UNREADABLE (shallow checkout?) |
| #448 → #449 | **UNREADABLE** | the diff 67f533cf1..271a078b6 is UNREADABLE (shallow checkout?) |
| #449 → #45 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #45 → #451 | **UNREADABLE** | the diff ca18aff7f..b43822d2f is UNREADABLE (shallow checkout?) |
| #451 → #453 | **UNREADABLE** | the diff b43822d2f..b6e566a3c is UNREADABLE (shallow checkout?) |
| #453 → #454 | **UNREADABLE** | the diff b6e566a3c..f883e0996 is UNREADABLE (shallow checkout?) |
| #454 → #455 | **UNREADABLE** | the diff f883e0996..fa0dabb6a is UNREADABLE (shallow checkout?) |
| #455 → #456 | **UNREADABLE** | the diff fa0dabb6a..f250a434c is UNREADABLE (shallow checkout?) |
| #456 → #46 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #46 → #466 | **UNREADABLE** | the diff 56f6a6fe9..8f14cbbfc is UNREADABLE (shallow checkout?) |
| #466 → #467 | **UNREADABLE** | the diff 8f14cbbfc..2e0598bfa is UNREADABLE (shallow checkout?) |
| #467 → #468 | no | app/src/pages/InternalsRender.jsx is referenced by 4 source file(s); app/src/pages/breadth/views/TreemapView.jsx is referenced by 9 source file(s) |
| #468 → #469 | **UNREADABLE** | the diff ac52bea4c..c155bce27 is UNREADABLE (shallow checkout?) |
| #469 → #470 | **UNREADABLE** | the diff c155bce27..6e8dc4e62 is UNREADABLE (shallow checkout?) |
| #470 → #471 | **UNREADABLE** | the diff 6e8dc4e62..caf6d1b9e is UNREADABLE (shallow checkout?) |
| #471 → #472 | **yes** | no changed file can reach a test |
| #472 → #473 | **UNREADABLE** | the diff be9ca78b6..8a2c709a8 is UNREADABLE (shallow checkout?) |
| #473 → #475 | **UNREADABLE** | the diff 8a2c709a8..01a5783c9 is UNREADABLE (shallow checkout?) |
| #475 → #476 | **UNREADABLE** | the diff 01a5783c9..35ec761a8 is UNREADABLE (shallow checkout?) |
| #476 → #477 | **UNREADABLE** | the diff 35ec761a8..b11e2ed87 is UNREADABLE (shallow checkout?) |
| #477 → #479 | **UNREADABLE** | the diff b11e2ed87..510c3a19d is UNREADABLE (shallow checkout?) |
| #479 → #48 | **UNREADABLE** | the diff 510c3a19d..6b15b6b99 is UNREADABLE (shallow checkout?) |
| #48 → #480 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #480 → #481 | **yes** | no changed file can reach a test |
| #481 → #483 | **UNREADABLE** | the diff 6e7785b52..7b4ffbb34 is UNREADABLE (shallow checkout?) |
| #483 → #484 | **UNREADABLE** | the diff 7b4ffbb34..c6a8a9d3a is UNREADABLE (shallow checkout?) |
| #484 → #486 | **UNREADABLE** | the diff c6a8a9d3a..afa928c10 is UNREADABLE (shallow checkout?) |
| #486 → #49 | **UNREADABLE** | the diff afa928c10..cd3c92923 is UNREADABLE (shallow checkout?) |
| #49 → #490 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #490 → #492 | **UNREADABLE** | the diff 3d1849c02..b805aada5 is UNREADABLE (shallow checkout?) |
| #492 → #495 | **UNREADABLE** | the diff b805aada5..9310ae0b0 is UNREADABLE (shallow checkout?) |
| #495 → #496 | **UNREADABLE** | the diff 9310ae0b0..cca29a57d is UNREADABLE (shallow checkout?) |
| #496 → #499 | **UNREADABLE** | the diff cca29a57d..5eda463e9 is UNREADABLE (shallow checkout?) |
| #499 → #50 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #50 → #501 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #501 → #503 | **UNREADABLE** | the diff 80296d952..69ccc0b69 is UNREADABLE (shallow checkout?) |
| #503 → #507 | **UNREADABLE** | the diff 69ccc0b69..033fce514 is UNREADABLE (shallow checkout?) |
| #507 → #508 | **UNREADABLE** | the diff 033fce514..a974d0d1b is UNREADABLE (shallow checkout?) |
| #508 → #51 | **UNREADABLE** | the diff a974d0d1b..6685707af is UNREADABLE (shallow checkout?) |
| #51 → #511 | **UNREADABLE** | the diff 6685707af..bbd6c0e85 is UNREADABLE (shallow checkout?) |
| #511 → #518 | **UNREADABLE** | the diff bbd6c0e85..7f726450b is UNREADABLE (shallow checkout?) |
| #518 → #519 | **UNREADABLE** | the diff 7f726450b..f5f6fafb4 is UNREADABLE (shallow checkout?) |
| #519 → #52 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #52 → #520 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #520 → #521 | **UNREADABLE** | the diff 1f4d7a309..3175aed5f is UNREADABLE (shallow checkout?) |
| #521 → #522 | **UNREADABLE** | the diff 3175aed5f..a73c4e5f6 is UNREADABLE (shallow checkout?) |
| #522 → #523 | **UNREADABLE** | the diff a73c4e5f6..9b28d4fa4 is UNREADABLE (shallow checkout?) |
| #523 → #524 | **UNREADABLE** | the diff 9b28d4fa4..9c8a1fce4 is UNREADABLE (shallow checkout?) |
| #524 → #525 | **UNREADABLE** | the diff 9c8a1fce4..d732584e6 is UNREADABLE (shallow checkout?) |
| #525 → #526 | **UNREADABLE** | the diff d732584e6..6d253e4be is UNREADABLE (shallow checkout?) |
| #526 → #527 | **UNREADABLE** | the diff 6d253e4be..d9e887ca0 is UNREADABLE (shallow checkout?) |
| #527 → #528 | no | app/src/components/chart/engine/ast/pine.community.guards.test.js is referenced by 2 source file(s); app/src/components/chart/engine/ast/pine.guardCensus.test.js is referenced by 1 source file(s); app/src/components/chart/engine/ast/pine.js is referenced by 458 source file(s) |
| #528 → #530 | **UNREADABLE** | the diff 582419311..0f070e03a is UNREADABLE (shallow checkout?) |
| #530 → #532 | **UNREADABLE** | the diff 0f070e03a..0bbfd3f68 is UNREADABLE (shallow checkout?) |
| #532 → #535 | **UNREADABLE** | the diff 0bbfd3f68..70c75ff53 is UNREADABLE (shallow checkout?) |
| #535 → #537 | **UNREADABLE** | the diff 70c75ff53..b1aa04ed6 is UNREADABLE (shallow checkout?) |
| #537 → #54 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #54 → #543 | **UNREADABLE** | the diff 17219a837..9622f7318 is UNREADABLE (shallow checkout?) |
| #543 → #546 | **UNREADABLE** | the diff 9622f7318..f88d18515 is UNREADABLE (shallow checkout?) |
| #546 → #550 | **UNREADABLE** | the diff f88d18515..1d0066c2f is UNREADABLE (shallow checkout?) |
| #550 → #551 | **UNREADABLE** | the diff 1d0066c2f..d247e5b81 is UNREADABLE (shallow checkout?) |
| #551 → #553 | **UNREADABLE** | the diff d247e5b81..9eee93976 is UNREADABLE (shallow checkout?) |
| #553 → #554 | **UNREADABLE** | the diff 9eee93976..b0fcf4c7c is UNREADABLE (shallow checkout?) |
| #554 → #555 | **UNREADABLE** | the diff b0fcf4c7c..1fd92f278 is UNREADABLE (shallow checkout?) |
| #555 → #556 | **UNREADABLE** | the diff 1fd92f278..e818a15c1 is UNREADABLE (shallow checkout?) |
| #556 → #558 | **UNREADABLE** | the diff e818a15c1..d424f4ada is UNREADABLE (shallow checkout?) |
| #558 → #561 | **UNREADABLE** | the diff d424f4ada..38bb9a421 is UNREADABLE (shallow checkout?) |
| #561 → #562 | **UNREADABLE** | the diff 38bb9a421..fc7755b29 is UNREADABLE (shallow checkout?) |
| #562 → #563 | **UNREADABLE** | the diff fc7755b29..ca4da8bbc is UNREADABLE (shallow checkout?) |
| #563 → #564 | **UNREADABLE** | the diff ca4da8bbc..b5a1d6f30 is UNREADABLE (shallow checkout?) |
| #564 → #566 | **UNREADABLE** | the diff b5a1d6f30..7d664813d is UNREADABLE (shallow checkout?) |
| #566 → #568 | **UNREADABLE** | the diff 7d664813d..3b6cd17e8 is UNREADABLE (shallow checkout?) |
| #568 → #569 | **UNREADABLE** | the diff 3b6cd17e8..65c744c59 is UNREADABLE (shallow checkout?) |
| #569 → #57 | **UNREADABLE** | the diff 65c744c59..e3d2a1b1c is UNREADABLE (shallow checkout?) |
| #57 → #573 | **UNREADABLE** | the diff e3d2a1b1c..405693fa4 is UNREADABLE (shallow checkout?) |
| #573 → #574 | **UNREADABLE** | the diff 405693fa4..8f5d9755b is UNREADABLE (shallow checkout?) |
| #574 → #577 | **UNREADABLE** | the diff 8f5d9755b..fa78fa457 is UNREADABLE (shallow checkout?) |
| #577 → #578 | **UNREADABLE** | the diff fa78fa457..a3da446d3 is UNREADABLE (shallow checkout?) |
| #578 → #579 | **UNREADABLE** | the diff a3da446d3..952d389bc is UNREADABLE (shallow checkout?) |
| #579 → #58 | **UNREADABLE** | the diff 952d389bc..4f3955406 is UNREADABLE (shallow checkout?) |
| #58 → #582 | **UNREADABLE** | the diff 4f3955406..17133396d is UNREADABLE (shallow checkout?) |
| #582 → #583 | **UNREADABLE** | the diff 17133396d..396f58f06 is UNREADABLE (shallow checkout?) |
| #583 → #585 | **UNREADABLE** | the diff 396f58f06..f4cec49be is UNREADABLE (shallow checkout?) |
| #585 → #589 | no | api/routers/ai_search.py is referenced by 61 source file(s); api/routers/calendar.py is referenced by 859 source file(s); api/routers/regime.py is referenced by 456 source file(s) |
| #589 → #59 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #59 → #590 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #590 → #592 | **UNREADABLE** | the diff 322d92f86..0c2d9cfca is UNREADABLE (shallow checkout?) |
| #592 → #593 | **UNREADABLE** | the diff 0c2d9cfca..5acc73133 is UNREADABLE (shallow checkout?) |
| #593 → #594 | **UNREADABLE** | the diff 5acc73133..4ba2c0974 is UNREADABLE (shallow checkout?) |
| #594 → #597 | **UNREADABLE** | the diff 4ba2c0974..98b82f751 is UNREADABLE (shallow checkout?) |
| #597 → #599 | no | api/routers/education.py is referenced by 130 source file(s); api/services/education_curriculum.py is referenced by 4 source file(s); app/src/components/chart/ChartSettingsIndicators.jsx is referenced by 17 source file(s) |
| #599 → #60 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #60 → #600 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #600 → #601 | **UNREADABLE** | the diff 14cb488e5..8a551cacf is UNREADABLE (shallow checkout?) |
| #601 → #602 | **UNREADABLE** | the diff 8a551cacf..e4a018324 is UNREADABLE (shallow checkout?) |
| #602 → #604 | **UNREADABLE** | the diff e4a018324..7ffd8e655 is UNREADABLE (shallow checkout?) |
| #604 → #607 | no | Dockerfile.web is referenced by 13 source file(s); api/services/breadth_session.py is referenced by 3 source file(s); api/services/indicator_compute.py is referenced by 72 source file(s) |
| #607 → #609 | no | Dockerfile.web is referenced by 13 source file(s); api/data/entitlements_manifest.json is referenced by 2 source file(s); api/main.py is referenced by 1404 source file(s) |
| #609 → #61 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #61 → #613 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #613 → #617 | **UNREADABLE** | the diff a8e31ca83..b5c907749 is UNREADABLE (shallow checkout?) |
| #617 → #619 | **UNREADABLE** | the diff b5c907749..164aaa3ae is UNREADABLE (shallow checkout?) |
| #619 → #622 | **UNREADABLE** | the diff 164aaa3ae..1ecfc946a is UNREADABLE (shallow checkout?) |
| #622 → #624 | **UNREADABLE** | the diff 1ecfc946a..5b4da7874 is UNREADABLE (shallow checkout?) |
| #624 → #63 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #63 → #630 | **UNREADABLE** | the diff 5f21367b2..8093bab53 is UNREADABLE (shallow checkout?) |
| #630 → #633 | **UNREADABLE** | the diff 8093bab53..5b95ffffd is UNREADABLE (shallow checkout?) |
| #633 → #639 | no | .env.example is referenced by 42 source file(s); .gitattributes is referenced by 5 source file(s); api/auth_surface_read_baseline.json is referenced by 3 source file(s) |
| #639 → #64 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #64 → #642 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #642 → #643 | no | api/routers/auth.py is referenced by 971 source file(s); api/services/rollout_gate.py is referenced by 5 source file(s); app/src/context/AuthContext.jsx is referenced by 343 source file(s) |
| #643 → #644 | **UNREADABLE** | the diff 706f89b83..dac8e2c95 is UNREADABLE (shallow checkout?) |
| #644 → #645 | **UNREADABLE** | the diff dac8e2c95..1f92e2f2d is UNREADABLE (shallow checkout?) |
| #645 → #646 | no | api/services/ast_interpret.py is referenced by 96 source file(s); app/src/components/StockChart.jsx is referenced by 412 source file(s); app/src/components/chart/builder/graphWireFixture.test.js is referenced by 1 source file(s) |
| #646 → #647 | no | api/main.py is referenced by 1444 source file(s); tests/async_route_no_await_baseline.json is referenced by 1 source file(s) |
| #647 → #649 | no | api/gex_service.py is referenced by 10 source file(s); api/routers/rs_ranking.py is referenced by 25 source file(s); api/services/rs_ranking.py is referenced by 25 source file(s) |
| #649 → #654 | no | api/event_loop_watchdog.py is referenced by 5 source file(s); api/routers/ticker_search.py is referenced by 25 source file(s); api/services/ast_interpret.py is referenced by 98 source file(s) |
| #654 → #659 | no | .gitattributes is referenced by 5 source file(s); api/routers/ticker_search.py is referenced by 25 source file(s); api/services/market_indicators/registry.py is referenced by 864 source file(s) |
| #659 → #66 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #66 → #663 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #663 → #665 | **UNREADABLE** | the diff 20c58838c..cab05f08e is UNREADABLE (shallow checkout?) |
| #665 → #669 | **UNREADABLE** | the diff cab05f08e..a7ef61788 is UNREADABLE (shallow checkout?) |
| #669 → #67 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #67 → #674 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #674 → #678 | **UNREADABLE** | the diff f974dd65e..9288d97d2 is UNREADABLE (shallow checkout?) |
| #678 → #679 | **UNREADABLE** | the diff 9288d97d2..a680b0d40 is UNREADABLE (shallow checkout?) |
| #679 → #68 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #68 → #680 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #680 → #681 | no | app/src/components/chart/ChartToolbar.jsx is referenced by 64 source file(s); app/src/components/ui/Textarea.jsx is referenced by 6 source file(s); app/src/components/ui/formControls.census.test.js is referenced by 1 source file(s) |
| #681 → #682 | **UNREADABLE** | the diff f771f3d0b..ca562aa47 is UNREADABLE (shallow checkout?) |
| #682 → #683 | **UNREADABLE** | the diff ca562aa47..87df77c43 is UNREADABLE (shallow checkout?) |
| #683 → #685 | **UNREADABLE** | the diff 87df77c43..80a50517c is UNREADABLE (shallow checkout?) |
| #685 → #686 | **UNREADABLE** | the diff 80a50517c..c75bf6ea0 is UNREADABLE (shallow checkout?) |
| #686 → #687 | no | api/services/ast_bind.py is referenced by 14 source file(s); api/services/ast_interpret.py is referenced by 100 source file(s); app/src/components/chart/builder/memberPane/memberPaneDefinition.js is referenced by 82 source file(s) |
| #687 → #688 | no | api/services/ast_interpret.py is referenced by 101 source file(s); app/src/components/chart/builder/BuilderSheet.jsx is referenced by 117 source file(s); app/src/components/chart/builder/builderInputs.js is referenced by 81 source file(s) |
| #688 → #689 | no | api/services/fundamentals_pit/incremental.py is referenced by 55 source file(s); api/services/fundamentals_pit/v5_acceptance.py is referenced by 4 source file(s); api/services/fundamentals_pit/v5_ops.py is referenced by 1 source file(s) |
| #689 → #69 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #69 → #690 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #690 → #691 | **UNREADABLE** | the diff 22f07e1bd..009ee6be5 is UNREADABLE (shallow checkout?) |
| #691 → #692 | **UNREADABLE** | the diff 009ee6be5..dca1dbb6f is UNREADABLE (shallow checkout?) |
| #692 → #695 | no | Dockerfile.web is referenced by 13 source file(s); api/data/entitlements_manifest.json is referenced by 2 source file(s); api/main.py is referenced by 1493 source file(s) |
| #695 → #696 | no | api/services/alert_user_series.py is referenced by 49 source file(s); api/services/ast_bar_index_shift.py is referenced by 1 source file(s); api/services/ast_interpret.py is referenced by 109 source file(s) |
| #696 → #699 | no | api/services/breadth_authority.py is referenced by 11 source file(s); api/services/breadth_daily_ohlc.py is referenced by 57 source file(s); api/services/breadth_symbols.py is referenced by 46 source file(s) |
| #699 → #70 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #70 → #700 | **UNREADABLE** | the diff 3bf13974a..d72ceaf3f is UNREADABLE (shallow checkout?) |
| #700 → #701 | **UNREADABLE** | the diff d72ceaf3f..69bd6b920 is UNREADABLE (shallow checkout?) |
| #701 → #702 | **UNREADABLE** | the diff 69bd6b920..cfc25c195 is UNREADABLE (shallow checkout?) |
| #702 → #703 | **UNREADABLE** | the diff cfc25c195..9cd36ee95 is UNREADABLE (shallow checkout?) |
| #703 → #704 | **UNREADABLE** | the diff 9cd36ee95..f473d00b3 is UNREADABLE (shallow checkout?) |
| #704 → #706 | no | api/flow_proxy.py is referenced by 26 source file(s); api/main.py is referenced by 1505 source file(s); api/routers/ai_search.py is referenced by 61 source file(s) |
| #706 → #707 | **UNREADABLE** | the diff 0a995e50f..66096c053 is UNREADABLE (shallow checkout?) |
| #707 → #709 | **UNREADABLE** | the diff 66096c053..33300e80f is UNREADABLE (shallow checkout?) |
| #709 → #711 | **UNREADABLE** | the diff 33300e80f..5564cca92 is UNREADABLE (shallow checkout?) |
| #711 → #712 | no | api/routers/wire_feedback.py is referenced by 5 source file(s); app/src/pages/MorningWire.jsx is referenced by 26 source file(s); app/src/pages/MorningWire.module.css is referenced by 4 source file(s) |
| #712 → #713 | no | api/main.py is referenced by 1505 source file(s); tests/test_pre_push_guard.py is referenced by 3 source file(s); tools/pre_push_guard.py is referenced by 9 source file(s) |
| #713 → #714 | no | api/main.py is referenced by 1507 source file(s); api/routers/pine_libraries.py is referenced by 5 source file(s); api/services/pine_library_store.py is referenced by 5 source file(s) |
| #714 → #715 | no | api/routers/user_definitions.py is referenced by 119 source file(s); api/services/ast_interpret.py is referenced by 110 source file(s); api/services/runtime_definitions.py is referenced by 10 source file(s) |
| #715 → #716 | no | app/src/pages/ChartRender.jsx is referenced by 46 source file(s) |
| #716 → #717 | no | api/services/discord_chart_prefs.py is referenced by 15 source file(s) |
| #717 → #718 | **UNREADABLE** | the diff 01c5a7697..376db363a is UNREADABLE (shallow checkout?) |
| #718 → #719 | **UNREADABLE** | the diff 376db363a..daf850b8d is UNREADABLE (shallow checkout?) |
| #719 → #72 | **UNREADABLE** | the diff daf850b8d..593b3da4a is UNREADABLE (shallow checkout?) |
| #72 → #720 | **UNREADABLE** | the diff 593b3da4a..a0509fae9 is UNREADABLE (shallow checkout?) |
| #720 → #723 | no | api/auth_surface_read_baseline.json is referenced by 3 source file(s); api/data/entitlements_manifest.json is referenced by 2 source file(s); api/flow_worker_main.py is referenced by 24 source file(s) |
| #723 → #724 | no | api/flow_watchdog.py is referenced by 4 source file(s); api/massive_ws_worker.py is referenced by 34 source file(s) |
| #724 → #725 | **UNREADABLE** | the diff 32ef5e453..5966a4dc2 is UNREADABLE (shallow checkout?) |
| #725 → #726 | **UNREADABLE** | the diff 5966a4dc2..fa8933f2e is UNREADABLE (shallow checkout?) |
| #726 → #729 | **UNREADABLE** | the diff fa8933f2e..657b10969 is UNREADABLE (shallow checkout?) |
| #729 → #732 | no | api/backfill_from_patches.py is referenced by 5 source file(s); api/flow_gap_autofill.py is referenced by 17 source file(s); api/flow_heal_enrich.py is referenced by 8 source file(s) |
| #732 → #733 | **UNREADABLE** | the diff 7928962e8..040555d1d is UNREADABLE (shallow checkout?) |
| #733 → #734 | **UNREADABLE** | the diff 040555d1d..d29823d5e is UNREADABLE (shallow checkout?) |
| #734 → #736 | **UNREADABLE** | the diff d29823d5e..117644864 is UNREADABLE (shallow checkout?) |
| #736 → #74 | **UNREADABLE** | the diff 117644864..888791525 is UNREADABLE (shallow checkout?) |
| #74 → #741 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #741 → #742 | **UNREADABLE** | the diff 25d503a32..6037e447e is UNREADABLE (shallow checkout?) |
| #742 → #748 | **UNREADABLE** | the diff 6037e447e..a34c7625e is UNREADABLE (shallow checkout?) |
| #748 → #75 | **UNREADABLE** | the diff a34c7625e..3d8c20edc is UNREADABLE (shallow checkout?) |
| #75 → #750 | **UNREADABLE** | the diff 3d8c20edc..68dd14966 is UNREADABLE (shallow checkout?) |
| #750 → #751 | **UNREADABLE** | the diff 68dd14966..5d9423214 is UNREADABLE (shallow checkout?) |
| #751 → #752 | no | api/main.py is referenced by 1534 source file(s); tests/test_live_trading_room_page.py is referenced by 1 source file(s) |
| #752 → #753 | no | api/main.py is referenced by 1534 source file(s); api/routers/landing_analytics.py is referenced by 5 source file(s); app/public/live-trading-room/index.html is referenced by 1709 source file(s) |
| #753 → #757 | no | api/data/pine_runtime_allowlist.json is referenced by 4 source file(s); api/main.py is referenced by 1541 source file(s); api/routers/auth.py is referenced by 1100 source file(s) |
| #757 → #761 | no | api/routers/auth.py is referenced by 1105 source file(s); api/routers/research.py is referenced by 819 source file(s); api/services/research/estimates_consensus.py is referenced by 3 source file(s) |
| #761 → #764 | no | app/src/components/provenance/AbsenceReceipt.jsx is referenced by 8 source file(s); app/src/components/provenance/AbsenceReceipt.test.jsx is referenced by 1 source file(s); app/src/lib/swallowedFetch.baseline.json is referenced by 1 source file(s) |
| #764 → #765 | no | app/src/components/FundamentalSnapshot.jsx is referenced by 6 source file(s); app/src/components/calendar/CallRecapSection.jsx is referenced by 18 source file(s); app/src/hooks/useFilings.js is referenced by 9 source file(s) |
| #765 → #768 | no | app/src/App.jsx is referenced by 147 source file(s); app/src/hooks/pollingSites.rail.test.js is referenced by 14 source file(s); app/src/hooks/useMobileSWR.js is referenced by 140 source file(s) |
| #768 → #769 | no | api/main.py is referenced by 1545 source file(s); api/rate_limit_policy.py is referenced by 4 source file(s); api/routers/ltr_call_request.py is referenced by 3 source file(s) |
| #769 → #77 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #77 → #770 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #770 → #775 | no | api/gex_service.py is referenced by 16 source file(s); api/main.py is referenced by 1546 source file(s); api/routers/auth.py is referenced by 1113 source file(s) |
| #775 → #777 | no | api/services/research/estimates.py is referenced by 150 source file(s); api/services/research/financials.py is referenced by 56 source file(s); api/services/research/iv_history.py is referenced by 13 source file(s) |
| #777 → #782 | no | api/main.py is referenced by 1547 source file(s); api/services/broker_estimates.py is referenced by 7 source file(s); api/services/catalyst/store.py is referenced by 1713 source file(s) |
| #782 → #789 | no | api/breadth_v2_producer_main.py is referenced by 2 source file(s); api/main.py is referenced by 1563 source file(s); api/routers/analyst.py is referenced by 248 source file(s) |
| #789 → #79 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #79 → #790 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #790 → #791 | no | app/src/components/terminal/PanelSkeleton.jsx is referenced by 7 source file(s); app/src/components/terminal/PanelSkeleton.module.css is referenced by 1 source file(s); app/src/components/terminal/PanelState.jsx is referenced by 5 source file(s) |
| #791 → #793 | no | api/routers/research.py is referenced by 858 source file(s); api/services/fundamentals.py is referenced by 273 source file(s); api/services/research/estimates_consensus.py is referenced by 6 source file(s) |
| #793 → #796 | no | api/main.py is referenced by 1567 source file(s); api/services/broker_estimates.py is referenced by 8 source file(s); api/services/earnings_intel.py is referenced by 35 source file(s) |
| #796 → #798 | no | .github/workflows/master-deploy-gate.yml changed the suite-running job(s) gate; api/flow_worker_main.py is referenced by 24 source file(s); api/main.py is referenced by 1571 source file(s) |
| #798 → #80 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #80 → #800 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #800 → #801 | **UNREADABLE** | the diff 08dc18314..437ee9c82 is UNREADABLE (shallow checkout?) |
| #801 → #805 | **UNREADABLE** | the diff 437ee9c82..ea2cfdb40 is UNREADABLE (shallow checkout?) |
| #805 → #81 | **UNREADABLE** | the diff ea2cfdb40..c7ac0b7bc is UNREADABLE (shallow checkout?) |
| #81 → #811 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #811 → #818 | no | api/routers/calendar.py is referenced by 1086 source file(s); api/routers/ticker_history.py is referenced by 7 source file(s); api/routers/uct_agent.py is referenced by 6 source file(s) |
| #818 → #819 | no | app/public/live-trading-room/index.html is referenced by 1801 source file(s); app/public/live-trading-room/privacy.html is referenced by 57 source file(s); app/public/live-trading-room/terms.html is referenced by 187 source file(s) |
| #819 → #822 | no | api/services/ast_lint.py is referenced by 46 source file(s); api/services/definition_conversation.py is referenced by 13 source file(s); app/public/live-trading-room/index.html is referenced by 1801 source file(s) |
| #822 → #83 | **UNREADABLE** | .github/workflows/clock-parity-fixture.yml is UNREADABLE at one of the two commits |
| #83 → #85 | no | app/src/hub/HubKnob.jsx is referenced by 15 source file(s); app/src/hub/hub.module.css is referenced by 26 source file(s); app/src/styles/tokens.css is referenced by 256 source file(s) |
| #85 → #89 | no | api/services/screener/live_tier.py is referenced by 14 source file(s); api/services/wisdom/extract/batch.py is referenced by 300 source file(s); api/services/wisdom/extract/prescreen.py is referenced by 4 source file(s) |
| #89 → #90 | **UNREADABLE** | the diff 9abba727b..05e8c59c4 is UNREADABLE (shallow checkout?) |
| #90 → #91 | **UNREADABLE** | the diff 05e8c59c4..8ad9e1d62 is UNREADABLE (shallow checkout?) |
| #91 → #92 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |
| #92 → #93 | **UNREADABLE** | the diff e38d47b55..cafed9844 is UNREADABLE (shallow checkout?) |
| #93 → #94 | **UNREADABLE** | the diff cafed9844..47e2ad559 is UNREADABLE (shallow checkout?) |
| #94 → #96 | no | api/services/calendar_personalization.py is referenced by 10 source file(s); app/src/pages/Calendar.jsx is referenced by 170 source file(s); app/src/pages/calendar/FeedView.jsx is referenced by 10 source file(s) |
| #96 → #99 | **UNREADABLE** | .github/workflows/promote-production.yml is UNREADABLE at one of the two commits |

⛔ **9 of 467 consecutive pairs were comparable.** A pair that is not comparable contributes NO evidence in either direction — it cannot make a test flaky and it cannot clear one.

## `pytest` · `tests.test_discord_close_note`

**test_a_note_that_cannot_be_written_still_posts_the_charts**

- changed state across: #266→#267, #267→#269, #480→#481
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestRestoreGuarantee`

**test_the_file_is_byte_identical_after_a_detected_mutation**

- changed state across: #471→#472
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_a_detected_mutation_passes_the_check**

- changed state across: #228→#229
- consecutive stable runs since: **2** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_mutation_check.TestVerdicts`

**test_expect_red_naming_the_right_test_passes**

- changed state across: #410→#411, #471→#472, #480→#481
- consecutive stable runs since: **1** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_stream_charge_first_delta`

**test_a_CHARGE_while_auth_db_is_write_locked_never_stalls_the_loop[ask]**

- changed state across: #480→#481
- consecutive stable runs since: **0** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `pytest` · `tests.test_stream_charge_first_delta`

**test_a_REFUND_while_auth_db_is_write_locked_never_stalls_the_loop[writing_help]**

- changed state across: #480→#481
- consecutive stable runs since: **0** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `vitest` · `src/components/voice/VoiceHallucinationsPanel.test.jsx`

**VoiceHallucinationsPanel (Packet AD CP2) > populates the session dropdown and fires a POST re-audit for the selected session, then refreshes the flag list**

- changed state across: #410→#411, #411→#413
- consecutive stable runs since: **0** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## `vitest` · `src/pages/journal-2-0/tabs/NotebookTab.daily.test.jsx`

**Today > a daily template that no longer exists is said in words; the day still opens**

- changed state across: #471→#472
- consecutive stable runs since: **0** of 5 needed to leave the set
- ⛔ excluded from NEW while it is here. It is **not fixed**, and it is not re-run: it is a test whose result this suite cannot trust.

## Left the set (5 consecutive stable runs)

- `pytest` · `tests.test_bars_server_timing` · test_layer_sqlite_on_fresh_stored_rows
- `pytest` · `tests.test_flow_prepare` · test_a_BURST_of_bumps_collapses_to_ONE_roll
- `pytest` · `tests.test_flow_tape_spool` · test_a_window_the_spool_COVERED_is_not_re_read_over_rest
- `pytest` · `tests.test_flow_tape_spool` · test_a_window_with_no_spooled_frames_is_handed_to_rest
- `pytest` · `tests.test_flow_tape_spool` · test_it_never_raises_when_the_qpool_is_unavailable
- `pytest` · `tests.test_theme_index_watchlist` · test_overlay_today_replaces_stale_and_appends_missing
- `pytest` · `tests.test_ticker_logos_prewarm` · test_run_pass_skips_warm_and_resolves_cold
- `vitest` · `src/components/research/sections/CatalystsSection.test.jsx` · CatalystsSection > shows the finding state while catalysts generate and lands on its own (polls)
- `vitest` · `src/pages/charts/widgets/IndexesWidget.test.jsx` · CONTROL — the toast rail fails when the door says nothing
- `vitest` · `src/pages/journal-2-0/components/notebook/CaptureHost.test.jsx` · capture preserves the member context (§5/§20) > closing returns the dialog to nothing

