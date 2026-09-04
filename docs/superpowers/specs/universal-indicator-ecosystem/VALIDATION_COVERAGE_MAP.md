# Validation Coverage Map

Per addendum item 3: default UNVERIFIED absent executable evidence; never infer a green box. Ladder per
addendum item 2 (0 Exists · 1 Unit · 2 Integration · 3 Semantic · 4 End-to-End · 5 Adversarial ·
6 Regression · 7 Performance/Scale · 8 Staging/Prod-like · 9 Human · 10 Controlled Release). A cell lists
the highest level reached **with a citation**; a blank cell is UNVERIFIED, not assumed passing.

This is scoped to what's actually been touched so far (the translation-layer/BuilderSheet corner). Rows
for Custom Screens/Full-Market-Screener, data providers, telemetry, etc. are intentionally absent — they
don't exist in this map until a wave actually investigates them; adding an empty row would imply attention
that hasn't happened.

| Subsystem | Highest level reached | Evidence |
|---|---|---|
| Pine parser/translator (`pine.js`/`pine_table.py`, generally) | 1 — Unit | `BENCHMARK_REPRODUCTION.md`: 47/47 tests pass on the 21-file vendor corpus; corpus-wide numbers tracked live |
| Pine → canonical AST, specifically `07-rsi.pine` | **4 — End-to-End** | `CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`: real browser, paste→translate→correct canonical `rsi(close,14)`→save→reload |
| thinkScript translator | 1 — Unit | `BENCHMARK_REPRODUCTION.md`: 50/50 tests pass on the corpus |
| thinkScript → canonical AST, specifically `03-adx-dmi-lower.ts` | **4 — End-to-End** | `CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md`: real browser, paste→translate→hand-verified DI+ formula→save→reload; DI-/ADX series not independently hand-verified (scope limit stated in the doc) |
| TC2000/PCF translator | 1 — Unit | `BENCHMARK_REPRODUCTION.md`: 57/57 on its own corpus; **no adversarial/blind corpus confirmed to exist** (RISK-009) — do not read this as stronger than it is |
| TC2000/PCF → canonical AST, specifically `long_term_uptrend` | **4 — End-to-End, plus exact-precision numeric check** | `CORE_GOLDEN_JOURNEY_03_TC2000_PCF_IMPORT.md`: real browser, translation matched the corpus's own declared expected native exactly; rendered value (1.00) independently provably correct (not just plausible) given SPY's own visible MA state; save→reload clean |
| Dual-kernel (JS/Python) conformance | 2 — Integration | `ast_conformance.py --check` passed live, 144 ASTs × 579 bars at 1e-9 tolerance (reproduced independently by two separate wave-one agents) |
| Static analysis / repaint & budget linting | 3 — Semantic, for the RSI case | Journey #1: "3 nodes · 14-bar lookback" + explicit non-repainting badge, correct for the known input |
| Chart delivery (user definition → live pane) | **4 — End-to-End**, one fixture | Journey #1: real subplot rendered, semantically plausible value, survived reload |
| Save/persistence (create, list) | **4 — End-to-End** | Journey #1 |
| Save/persistence (delete) | **4 — End-to-End** | Journey #1: duplicate cleanly removed via UI |
| Save/persistence (edit) | 0 — Exists (unverified) | Pencil icon observed, never exercised |
| Save idempotency (double-submit) | **5 — Adversarial, and it failed** | Journey #1: double-click Save duplicated a chart instance (RISK-012). This is a case where adversarial testing found a real, if minor, defect — recorded as failed-at-5, not silently omitted |
| Numeric-vs-boolean screener gate (client+server stamp) | **4 — End-to-End**, confirmed door-agnostic AND confirmed to be an output-type rule, not a per-door rule | Journey #1: Pine numeric refused, Pine boolean accepted; Journey #2: thinkScript numeric hit the identical refusal; Journey #3: TC2000/PCF boolean (an AND-of-comparisons, no explicit threshold used) correctly ACCEPTED — same underlying rule (`<tree> != 0` on the last confirmed bar) now directly confirmed from the product's own explanatory text, not inferred |
| Screener artifact reachability (definition → filter chip) | **4 — End-to-End** | Journey #1 (Pine), Journey #2 (thinkScript), Journey #3 (TC2000/PCF) — three source languages into the same gate |
| Screener execution (actual scan results) | 0 — Exists (unverified) | Journey #1: architecturally nightly-only, enforced by a dedicated test forbidding request-path execution; not observed completing. See journey doc's "why ENVIRONMENT-BLOCKED" section |
| Negative path: unsupported property access | **4 — End-to-End** | Journey #1: `ta.cmf(20)` correctly refused, Save no-op, specific message |
| Negative path: missing-default-argument ambiguity (assisted-edit offer) | **4 — End-to-End** | Journey #2: thinkScript `SimpleMovingAvg(varhigh,20)` refused to guess `displace`, offered an inspectable "Put this in my script" fix, Save was a no-op until resolved |
| Negative path: missing-capability refusal (no assisted-edit offered) | **4 — End-to-End** | Journey #2: thinkScript `high(period=Period)` cross-timeframe daily-regardless-of-chart-tf aggregation correctly refused as a concept the engine doesn't have, with no false conventional-default offer |
| Negative path: unresolved/unknown name (TC2000/PCF) | **4 — End-to-End** | Journey #3: fabricated `FibExtension(...)` correctly refused, exact character position named, Save no-op |
| Negative paths, broadly (addendum's ~20 named cases) | 0 — Exists (4 of ~20 exercised) | The four cases above; the rest are UNVERIFIED, not assumed similar |
| Alert creation (`Indicator Alerts` dialog) | 0 — Exists (unverified) | Seen by accident during navigation, never exercised |
| Plain-language (AI concierge) door | 1 — Unit, plus one live negative data point | `CORE_GOLDEN_JOURNEY_04_PLAIN_LANGUAGE.md`: live model round-trip is ENVIRONMENT-BLOCKED (no `ANTHROPIC_API_KEY` in the isolated sandbox); found and confirmed a real, environment-independent bug on the way (RISK-016, bars-cap 400); "interpretation visible"/"compilation is final authority" answered at the code level only (`sentence_for`'s determinism, `/propose` stores nothing) — not live-confirmed |
| Screenshot (vision) door | 1 — Unit, plus live-verified UI honesty | `CORE_GOLDEN_JOURNEY_05_SCREENSHOT_VISION.md`: live model round-trip ENVIRONMENT-BLOCKED (`INDICATOR_VISION_ENABLED` unset) — but refused cleanly through the documented 200/`ok:false` contract (contrast with RISK-016's plain-language 400), and the "picture does not tell us the formula / best guess / verify before trusting" disclaimer confirmed live from the actual shipped tab copy, not inferred. Same `sentence_for`-derived read-back authority as the plain-language door, confirmed at the code level |
| Cross-browser | 0 — Exists (unverified) | Chromium only |
| Mobile/responsive | 0 — Exists (unverified) | Not attempted |
| Production/staging behavior | 0 — Exists (unverified) | Everything above is local + sandboxed; nothing checked against Railway |
| Screener/Scanner: nightly-snapshot query engine | 1 — Unit | `test_screener_wave4_query.py`, `test_screener_filters.py`: 101/101 passed live (wave-two #2 archaeology) |
| Screener/Scanner: AST-scan ↔ Finviz-snapshot join, "Honest-None" disclosure | **2 — Integration** | Same test run: `test_never_swept_hash_is_INERT_and_disclosed_not_a_silent_universe` and `test_empty_or_malformed_value_REFUSES_never_the_silent_noop` passed; independently corroborated by Journey #1's live "first sweep tonight" observation (two different evidence angles agreeing) |
| Base & Structure Library (`base_catalog.py`/`lift_ledger.py`) | 1 — Unit | `test_base_count.py`, `test_base_catalog.py` passed live; no browser rendering of the "Structure library" dialog attempted |
| Screener/Scanner: actual filter results in a real browser | 0 — Exists (unverified) | Journey #1 only observed the empty-sandbox state ("0 matches," "nothing in tonight's snapshot") — never a populated result set |

## What this map is not

It is not a capability matrix (that needs the multidimensional MP-033 schema across all doors, not just
Pine) and not a release-readiness verdict. It is a running record of what's actually been earned, updated
as new evidence lands — including recording where adversarial testing *found* something (the Save
double-click row), since a map that only ever moves up would itself be a paper-capability violation of
CL-009.
