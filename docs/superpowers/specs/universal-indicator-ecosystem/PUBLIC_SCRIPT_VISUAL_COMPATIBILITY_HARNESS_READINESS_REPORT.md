# Public Script + Complex Visual Indicator Compatibility Harness — First Return

Authorized: "PUBLIC SCRIPT + COMPLEX VISUAL INDICATOR COMPATIBILITY HARNESS" (Phase Two,
validation/discovery tranche, not broad feature expansion). This is the required First
Return before implementation: existing-asset inventory, proposed architecture, schema,
taxonomy, fixture ladder, sample strategy, provenance policy, non-vacuity plan,
integration points, exact files, and a bounded sequence. Nothing in this document has
been implemented yet except where explicitly marked; all citations below were verified
by direct read during this research pass (three parallel research agents plus targeted
spot-checks), not assumed from memory.

---

## 1. Existing repo assets we can reuse

**Lane 1's translation-side infrastructure is already ~70% built — do not recreate it.**

| Asset | What it is | Reuse for |
|---|---|---|
| `tests/fixtures/pine/` — 21 real published Pine scripts, verbatim, + `SOURCES.md` (URL/author/repo/description per file) + `README.md` ("somebody else's code," not redistributed beyond what's declared) | An **already-solved provenance pattern** for real third-party scripts | The exact template Lane 1's new capture records should follow |
| `tests/fixtures/pine_community/` — 30 more real published scripts (32 files incl. README/SOURCES), chosen by TradingView's own popularity/boost count across 4 buckets (most-used indicators, swing setups, multi-timeframe, drawings/arrays); `SOURCES.md` records title/URL/author/license/version/publish-date/boosts/description | A **second, deliberately-diverse real corpus** already solving "diversity not popularity" | Lane 1's initial sample should be selected from here first, not a fresh scrape |
| `tests/fixtures/thinkscript/` — 24 real thinkScript fixtures + `SOURCES.md`/`README.md`, same pattern | Confirms the provenance pattern generalizes across dialects | Reuse verbatim for any thinkScript rows added later (out of this tranche's initial scope — Pine only, per the authorization's examples) |
| `tests/fixtures/pine_blind/` (49 synthetic scripts + `INTENTS.json`), `pine_screener/` (30 synthetic), `ast/pcf_corpus.json` (57 TC2000/PCF cases) | Existing SYNTHETIC corpora, translation-only | Not real-public evidence; irrelevant to Lane 1's provenance question but a precedent for Lane 2's own synthetic-fixture format |
| `tools/ast_conformance.py` — `run_js`, `run_py`, `compare_lanes`, `assert_corpus_covers_the_table` | The dual-kernel conformance instrument used throughout this program | Reused as-is for any harness step that needs "does this canonical AST evaluate identically in both lanes" |
| `tools/chart_parity.py` — deterministic, headless, pixel-diff visual regression harness. Drives `/r/chart` (`app/src/pages/ChartRender.jsx`) with `?fixedbars=` (frozen bar fixture via `StockChart`'s `barsOverride` seam) + hermetic mode (every `/api/` call short-circuited), screenshots `#chart-export`, diffs via Pillow. Ships a `--same-build` determinism self-check and a `--perturb-b` non-vacuity control | **Directly reusable, not a different mechanism** | The visual-assertion engine for Lane 2's render checks (Section 3/8) |
| `app/src/components/chart/engine/` schema-v2 (`defSchema.js`, `nativeRegistry.js`, `placement.js`, `paneLayout.js`, `pool.js`, `instances.js`, `binder.js`, `readout.js`) — the real definition/render pipeline, already used by native RSI/MACD/BB/Donchian/OBV via a proven pixel-parity migration (`*FlipParity.test.js` family) | The actual product surface Lane 2's fixtures render through | Ground truth for what's real vs. aspirational in Section 5 |
| `app/src/components/chart/builder/BuilderSheet.jsx` — `plots: [...dataPlots, ...guides]` (verified live, line 512), `placement: {target:'price'}` / `{target:'pane', pane:{height}}` (verified, lines 194/329/392/510) | The real multi-plot + placement authoring surface | Lane 2's Level 2+ fixtures compose N independent AST calls into one document via this, not a new manifest primitive |
| `api/services/screener/scan_evaluator.py:1676` — `if float(value) != 0.0:` on the last confirmed bar | The single chokepoint for screener eligibility | Reused verbatim for the harness's "screener eligibility" step |
| Guard/refusal vocabulary — ~23 distinct strings, identical in both lanes (parser: `canonicalise:empty/member/node/offset-*`; interpreter: `resolve:name/function/arity/window/condition/domain`, `interpret:node/operator/offset/recurrence/timeframe/symbol/steps`; budget: `budget:lookback/nodes/series`) | The REAL production refusal taxonomy | Section 4's taxonomy maps onto these where the mechanism is the same refusal, and only invents new labels for outcomes with no `TableRefusal` (visual, persistence, screener) |
| `tools/track_a_ingest_vendor_capture.py` + `OWNER_VENDOR_CAPTURE_PACKET_V3_1.md` | The vendor-capture cross-validation methodology (a cyclic multi-state oracle script, every rejected candidate plotted alongside the real builtin, refuse-don't-warn on internal disagreement) | Section 8's non-vacuity design and Lane 2's fixture-design discipline |
| Five `CORE_GOLDEN_JOURNEY_0{1-5}_*.md` docs | The established per-step PASS/FAIL/ENVIRONMENT-BLOCKED evidence methodology, run in a fully isolated sandbox (throwaway backend, repointed dev-server proxy, fresh admin account, never touching live `C:\data`) | Section 2's execution model is this methodology, not a new one |
| `RISK-011`/`RISK-014` (browser-automation hang/staleness findings) | Known constraints on any browser-driven capture | Section 2's operational rules (one-shot paste, screenshot as ground truth over `get_page_text`, budget for multi-second-to-90s hangs as retry-not-fail) |

**Real, load-bearing gap found (not to be fixed in this tranche, just discovered by it):**
`closedTable.json` (68 functions / 15 operators / 5 series / 137 scalars / 22 excluded,
verified) has **no multi-output node** — every AST call yields exactly one `num` or `bool`
series. Multi-plot only exists one layer up, in `BuilderSheet`'s document composition
(N independent `{ast, plot}` pairs). This matters for Lane 2's ladder (Section 5): a
"multiple interacting series" fixture is N separate saved AST computations grouped in
one document, not a single richer AST.

**Real, disclosed visual boundaries found (verified by direct code read, not assumed):**
- **Bands** (`style:'band'`, `edges:{upper,lower}`, `defSchema.js:147-162,1577-1664`) are
  genuinely rendered — but only by **native** built-ins (BB, Donchian); `BuilderSheet`'s
  own authoring form has no UI for cross-plot edges (`PLOT_STYLE_CHOICES` excludes it).
  So bands are a real, tested render capability that a **member cannot self-author today**.
- **`plots[].fill:{with:key}`** is schema-validated and persisted but **drawn by nothing**
  — a deliberate, pinned `VALIDATED-BUT-INERT` state (`defSchema.js:1667-1679`, its own
  test block).
- **`colorMode:'sign'`** (above/below-zero coloring, e.g. MACD histogram) is real and
  rendered. **`colorMode:'column:<key>'`** is schema-valid but also `VALIDATED-BUT-INERT`.
- **Per-bar conditional visibility** (a Pine `plotshape`/`plotchar` equivalent) was not
  found anywhere — `hidden` is a static, save-time boolean, not per-bar. Treated as
  **NOT SUPPORTED** until a fixture proves otherwise.
- `RESERVED_PLOT_STYLES = ['zones','bgband','barcolor','fill','cross']` — note the
  name collision: plot-level `style:'fill'` is refused (reserved), which is a **different
  thing** from the cross-plot `plots[].fill:{with}` field above (validated-but-inert).
  The harness's taxonomy must keep these distinct.

No prior discussion of a public-script corpus, a visual-fixture ladder, or a copyright
policy exists in `CURRENT_ARCHITECTURE.md`, `TEST_CREDIBILITY_FINDINGS.md`, or
`PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md` — this is genuinely new ground for the
*strategy* documents, even though the *pattern* (Section 7) already exists in practice
in `tests/fixtures/pine{,_community}/SOURCES.md`.

---

## 2. Proposed architecture

Three layers, mirroring the existing program's own separation of concerns
(translation-layer conformance vs. vendor parity vs. browser-verified journeys):

**Layer A — Static/offline harness (no browser, no TradingView).** A Python driver
(`tools/compat_harness.py`) that, for a given script (real or fixture), runs the parts of
the pipeline that need no browser: parse → dialect detection → translate → canonical AST
→ dual-kernel conformance (`ast_conformance.run_js`/`run_py`) → execution-requirements
extraction (lookback/timeframe/session needs from the AST) → screener-eligibility
classification (numeric-vs-boolean gate, reused from `scan_evaluator.py`) → failure
classification (Section 4) whenever any step raises a `TableRefusal` or fails
translation. This layer runs on every commit, like `ast_conformance.py --check` today.

**Layer B — Visual/persistence harness (browser, no TradingView, own fixtures only).**
Extends `tools/chart_parity.py`'s hermetic `/r/chart` + `?fixedbars=` pattern to drive a
**saved BuilderSheet document** (not just a hardcoded indicator config) through:
render → screenshot-diff against a committed expected PNG → save → reload (asserting the
persisted document round-trips byte-identically, the existing `BuilderSheet.paramReopen`
precedent) → screener-eligibility check on the saved artifact. This is where Lane 2's
fixture ladder (Section 5) is exercised. No TradingView involvement at all — Lane 2 is
entirely self-contained.

**Layer C — Real-script browser capture (browser, needs TradingView, Lane 1 only).**
Follows the Golden Journey methodology exactly (isolated sandbox: throwaway
`conftest`-redirected backend, fresh dev-server with `/api` proxy repointed, fresh admin
account, never touching live `C:\data`): for each selected real public script, capture
source + provenance metadata, then walk paste → dialect-detect → translate → canonical
AST readback → placement inference → preview → chart render → save → reload →
screener-gate → refusal behavior → (where legally/technically appropriate) a vendor
comparison capture using the same cyclic-oracle-script trick `OWNER_VENDOR_CAPTURE_PACKET_V3_1.md`
established, scored PASS/FAIL/CORRECTLY-REFUSED/ENVIRONMENT-BLOCKED per step with cited
evidence (screenshot, network trace, or exact quoted UI text) — exactly the existing
Golden Journey shape, not a new one. **This layer is the ONLY one gated on TradingView
availability**; Layers A and B can be built and run immediately.

A single `tools/compat_harness_report.py` aggregates Layer A/B/C outputs (all conforming
to Section 3's schema) into one queryable result set — the "current failure distribution"
the authorization asks the design to be grounded in.

---

## 3. Machine-readable result schema

One JSON object per script/fixture, one file per result under
`tests/fixtures/compat_harness/results/<lane>/<id>.json` (results are harness OUTPUT,
never hand-edited, mirroring the `conformance_log.json` convention):

```json
{
  "id": "pine_community/12-supertrend-strategy",
  "lane": "public_script | visual_fixture",
  "source": {
    "dialect": "pine",
    "version_declared": "v5",
    "provenance_ref": "tests/fixtures/pine_community/SOURCES.md#12-supertrend-strategy",
    "captured_at": "2026-09-07",
    "capture_method": "browser_paste | local_fixture_file"
  },
  "steps": {
    "parse":               {"status": "SUPPORTED|PARTIAL|UNSUPPORTED|HARNESS_DEFECT", "guard": null, "evidence": []},
    "dialect_detect":      {"status": "...", "detected": "pine_v5"},
    "translate":           {"status": "...", "guard": "resolve:name", "unsupported_constructs": ["ta.supertrend"]},
    "canonical_ast":       {"status": "...", "ast_ref": "..."},
    "execution_requirements": {"status": "...", "lookback": 22, "timeframe_reqs": [], "session_reqs": []},
    "visual_requirements": {"status": "...", "plot_count": 2, "needs": ["band", "sign_color"]},
    "chart_render":        {"status": "...", "screenshot_ref": "..."},
    "persistence_save":    {"status": "..."},
    "persistence_reload":  {"status": "...", "roundtrip_identical": true},
    "screener_eligibility":{"status": "...", "eligible": false, "reason": "yields:num, not bool"},
    "refusal_behavior":    {"status": "CORRECTLY_REFUSED", "guard": "resolve:function"},
    "vendor_comparison":   {"status": "VENDOR_AMBIGUOUS|SKIPPED_NOT_APPROPRIATE|...", "ref": null}
  },
  "failure_taxonomy": ["unsupported_builtin", "unsupported_visual_primitive"],
  "final_classification": "PARTIAL",
  "evidence_artifact_paths": ["tests/fixtures/compat_harness/evidence/..."],
  "harness_version": "compat-harness-v1"
}
```

Every step is independently statused (Section 6 of the authorization's status vocabulary:
`SUPPORTED / PARTIAL / CORRECTLY_REFUSED / UNSUPPORTED / DATA_BLOCKED / EXECUTION_BLOCKED /
VISUAL_BLOCKED / VENDOR_AMBIGUOUS / HARNESS_DEFECT`), so a script that translates but
can't render a band is `PARTIAL` overall while its `translate` step alone reads
`SUPPORTED` — exactly the granularity the thinkScript Golden Journey already demonstrated
is necessary (a coarse pass/fail label hid a finer real distinction there).

---

## 4. Failure taxonomy

Mapped onto the **real existing guard vocabulary** wherever the mechanism is the same
refusal (Section 1's table), with new labels reserved only for outcomes that raise no
`TableRefusal` today:

| Taxonomy label | Maps to |
|---|---|
| `parser_unsupported_syntax` | `canonicalise:*` guards |
| `unsupported_builtin` | `resolve:name` / `resolve:function` |
| `translator_semantic_gap` | a construct parses but the translated tree computes something different from the source's documented meaning (no guard fires — a silent-wrong-answer class, the exact thing this whole program exists to catch) |
| `input_parameter_fidelity_gap` | the RISK-013/Track F precedent — an `input.*` that doesn't survive as an adjustable parameter |
| `execution_policy_mismatch` | `budget:lookback/nodes/series`, or `resolve:window` |
| `timeframe_session_data_mismatch` | `interpret:timeframe`, or an execution-requirement the harness detects the product can't satisfy |
| `unsupported_visual_primitive` | a plot need with no schema support at all (e.g. per-bar conditional visibility — confirmed absent, Section 1) |
| `chart_placement_mismatch` | overlay vs. own-pane inferred wrong |
| `guide_fill_color_style_mismatch` | includes the two confirmed `VALIDATED-BUT-INERT` cases (`fill:{with}`, `colorMode:'column:<key>'`) — these get their OWN sub-label (`validated_but_inert`) rather than being folded into a generic mismatch, since they are a distinct, deliberate, already-tested state, not a bug |
| `save_reopen_drift` | persistence round-trip produces a different document than what was saved |
| `screener_incompatibility` | fails the `scan_evaluator.py:1676` gate, or the yields-type gate |
| `alert_incompatibility` | (out of this tranche's initial scope — no alert-specific step is planned in v1; reserved) |
| `correctly_refused` | any `TableRefusal` that is the RIGHT answer (mirrors the "correctly refused, not a defect" framing already established for `ta.cmf(20)` in Golden Journey #1) |
| `vendor_ambiguity` | multiple plausible readings, no way to adjudicate without a live vendor probe (mirrors RISK-018a's original "ambiguity" framing) |
| `harness_defect` | the harness itself is wrong (found and disclosed, never silently retried away — the tool must fail loudly, per this program's own standing discipline) |
| `environment_blocked` | feature flag off, scoped API key missing, or TradingView unavailable — and per Golden Journey #4/#5's established distinction, this label is used **only** when the block is HONESTLY surfaced; a misrepresenting raw 400 (the RISK-016 shape) is `harness_defect` or `unsupported_visual_primitive` as appropriate, never quietly relabeled `environment_blocked` |

**Do not collapse to "unsupported Pine"** is satisfied structurally: every result carries
BOTH a per-step status and a taxonomy label, so a report can always answer "unsupported at
which layer" rather than one flat verdict.

---

## 5. Initial custom visual-fixture ladder (Lane 2)

Grounded in Section 1's verified boundaries — using only what's confirmed to exist, and
explicitly marking the two known VALIDATED-BUT-INERT capabilities as deliberate probes of
the boundary rather than expected passes:

- **Level 1** — one plot, one input, own pane. E.g. a single SMA on its own pane. Exercises: translate → AST → render → save/reload → screener eligibility (numeric, ineligible by default) → boolean variant (crossover) → eligible.
- **Level 2** — multiple plots (2-3), multiple inputs, guide levels (`levels`/`hlines`, confirmed real). E.g. an RSI-shaped oscillator with 70/30 guides — mirrors the already-proven `07-rsi.pine` Golden Journey case, generalized into a reusable fixture rather than a one-off.
- **Level 3** — overlay + own-pane combination (a fixture with one overlay plot and one own-pane plot in the SAME document, since `plots[]` supports mixed placement per BuilderSheet's real schema) + `colorMode:'sign'` (confirmed real, e.g. a histogram-shaped plot). **Deliberately also probes `colorMode:'column:<key>'`** as a known-inert case — expected classification: `guide_fill_color_style_mismatch / validated_but_inert`, not a harness bug if it renders nothing.
- **Level 4** — **deliberately probes bands** (`style:'band'`) authored via the raw document schema rather than the UI (since the UI form has no band control, per Section 1) — this tests whether the RENDER pipeline honors a band on a user-composed (not native) document, a genuinely unknown boundary worth discovering. Also **deliberately probes `plots[].fill:{with}`** — expected classification: `validated_but_inert`, confirmed not a regression.
- **Level 5** — nested calculations, multiple lookbacks, several interacting series (composed as N independent AST plots per Section 1's finding that the manifest itself has no multi-output node), boolean AND numeric outputs in one document (tests whether screener eligibility is evaluated per-plot or per-document — an open question the harness should answer, not assume).
- **Level 6** — full composite: multiple parameters (Track F `paramManifest`), chart + screener interaction, save → close → reopen → re-tune → save → reload (the exact `BuilderSheet.paramReopen.test.jsx` precedent, generalized to a fixture with 5+ plots instead of 1), and a visual-state change across bars (e.g. `colorMode:'sign'` flipping mid-series) verified via `chart_parity.py`'s pixel-diff at two different `?fixedbars=` windows.

Every fixture's "expected" value is grounded in independently-computable arithmetic
(mirroring the vendor-capture packet's own discipline — property-tested min/max/sum, not
"whatever the renderer produces"), never derived from running the product under test.

---

## 6. Proposed initial public-script sample strategy (Lane 1)

**Reuse before adding.** `tests/fixtures/pine_community/` already contains 30 real,
diversely-sourced, provenance-tracked scripts across 4 categories (most-used indicators,
swing setups, multi-timeframe, drawings/arrays) — per `BENCHMARK_REPRODUCTION.md`, 19/30
currently translate. **Initial batch: select 6-8 scripts from this EXISTING corpus**
(no new scraping yet) spanning the authorization's target categories:

| Category | Candidate source |
|---|---|
| Moving-average system | pick from `pine_community`'s "most-used indicators" bucket |
| Oscillator | pick from the same bucket, distinct from the MA pick |
| Trend indicator | "swing setups" bucket |
| Volatility/band indicator | any script exercising `bb`/`atr`/band-shaped plots — a natural pairing with Lane 2 Level 4's band probe |
| Multi-plot study | "multi-timeframe" bucket (likely to also exercise `interpret:timeframe`) |
| Custom state logic | a script using persistent/recurrence-shaped logic (tests `interpret:recurrence`) |
| Visual-heavy script | "drawings/arrays" bucket (tests the visual-primitive boundary hardest, including likely `unsupported_visual_primitive` hits — informative failures, per the authorization's "failures teach us something" framing) |
| Input-heavy script | whichever candidate declares the most `input.*` calls (stresses Track F param fidelity) |

This is 8 scripts, all already-provenanced, all already known to be either 19 SUPPORTED
or 11 currently-failing at the translate step in the existing benchmark — meaning the
initial batch will surface a genuine mix of `SUPPORTED`/`PARTIAL`/`UNSUPPORTED` results by
construction, not an artificially easy or hard set. **Only after this batch is run and
classified** would a second batch justify fresh scraping beyond the existing corpus.

---

## 7. Copyright/provenance handling approach

**Adopt the existing, already-working pattern verbatim** — `tests/fixtures/pine/` and
`pine_community/`'s `SOURCES.md` + `README.md` convention (title, source URL, author,
license/version/publish-date where available, one-line description, explicit "this is
somebody else's code, not redistributed beyond what's declared" statement). This program
has already solved this problem twice; the new tranche does not need a new policy, only
to extend the same `SOURCES.md` format to whatever capture metadata Layer C's browser
session adds (capture date, TradingView chart id used, any transcription fixes needed —
mirroring the `OWNER_VENDOR_CAPTURE_PACKET_V3_1.md` provenance fields already
established). For any FUTURE script not already in `pine_community/`: store metadata +
harness-derived classification + the minimal snippet needed to explain a specific
failure (e.g. the one unsupported line), never the full script body, unless the script's
own declared license is a copyleft/open license that explicitly permits redistribution
(check per-script, record the check in `SOURCES.md`).

---

## 8. Non-vacuity plan

Three mechanisms, each targeting a different layer, each with its own already-proven
precedent in this repo:

1. **Layer A (parse/translate/AST):** reuse `ast_conformance.py`'s own escape-corpus
   pattern — a known-supported construct's guard is asserted to currently pass; a
   scheduled mutation test breaks one canonicalisation rule and asserts the SAME case now
   fails with the SAME guard name (proving the assertion actually exercises the rule, not
   merely "no exception").
2. **Layer B (visual/persistence):** `chart_parity.py`'s existing `--perturb-b` mechanism
   IS the non-vacuity control — apply it to Lane 2 fixtures directly (perturb one plot's
   color/placement/band-edge and confirm the pixel-diff assertion goes red). For
   persistence, mutate one field of a saved canonical AST directly in the stored document
   (mirroring this session's own Lane B `period=1` mutation-test pattern) and confirm the
   reopen/reload check detects the drift.
3. **Layer C (real scripts) + screener:** for screener eligibility, the mutation is
   structural and already proven in this program (RISK-017's fix pattern) — flip a known
   NUMERIC script's yields-type expectation and confirm `screener_eligibility` flips from
   ineligible to eligible in the harness's own test, never relying on "the real gate
   happened to pass."

No step's assertion may rely solely on "page loaded" / "no exception" — every Layer B/C
step above has an explicit expected VALUE (a pixel hash, a specific guard name, a
specific eligibility boolean) to compare against, per the authorization's own standing
rule and this program's own repeated finding that a green suite without a control number
means nothing (`lesson_gate_that_cannot_fail`, `lesson_a_rail_can_be_green_alone_and_red_in_company`).

---

## 9. Integration with existing Golden Journeys and vendor parity tooling

- **Golden Journeys are not superseded — they are the template.** The new harness's Layer
  C execution model (isolated sandbox, per-step evidence, honest ENVIRONMENT_BLOCKED vs.
  misrepresenting-defect distinction) is the SAME methodology, generalized from
  one-script-at-a-time manual journeys into a repeatable batch driver. A future Golden
  Journey for a specific new door still makes sense; this harness is for BREADTH across
  many scripts, not a replacement for DEPTH on one.
- **Vendor parity tooling is reused directly for the "vendor comparison where
  appropriate" step** — `tools/vendor_parity_compare.py`'s `compare()` and
  `VendorSourceRefused` guard, and this session's own newly-added
  `tools/vendor_parity_lane_b_multibar_audit.py` pattern (rebuild a full input series
  from a preserved artifact, compare every answerable row, use a REJECTED-candidate
  column as the mutation control) generalizes cleanly to any future ambiguous real-script
  construct this harness surfaces — the same standing discipline (DEC-007), not a new one.
- **`ast_conformance.py` is reused as-is** for Layer A's dual-kernel check on every
  translated script.
- Results feed `BENCHMARK_REPRODUCTION.md`'s existing per-door tables as new rows, not a
  parallel reporting system.

---

## 10. Exact files/tools to be added

| File | Purpose |
|---|---|
| `tools/compat_harness.py` | Layer A driver: parse/translate/AST/dual-kernel/execution-requirements/screener-classification for one script |
| `tools/compat_harness_visual.py` | Layer B driver: extends `chart_parity.py`'s hermetic render pattern to a saved BuilderSheet document; save/reload/screener check |
| `tools/compat_harness_report.py` | Aggregates Layer A/B/C result files into a queryable summary (mirrors `ast_conformance.py --coverage`'s reporting style) |
| `tests/fixtures/compat_harness/results/**/*.json` | Machine-readable per-script/fixture results (Section 3 schema) — harness OUTPUT, never hand-edited |
| `tests/fixtures/compat_harness/visual_fixtures/level{1-6}/*.json` | Lane 2's own fixture documents (BuilderSheet-schema JSON, Section 5) |
| `tests/fixtures/compat_harness/visual_fixtures/SOURCES.md` | States plainly these are self-authored, not third-party (mirrors the existing README pattern's honesty) |
| `tests/test_compat_harness.py` | Non-vacuity + schema-conformance regression tests (Section 8) |
| `tests/test_compat_harness_visual.py` | Layer B non-vacuity tests, reusing `chart_parity.py --perturb-b` |
| `docs/superpowers/specs/universal-indicator-ecosystem/COMPAT_HARNESS_INITIAL_SAMPLE.md` | Records the 8-script Lane 1 sample selection + rationale (Section 6), the provenance metadata (Section 7), and becomes the running log of Layer C captures once TradingView is free |

No changes to `closedTable.json`, `interpret.js`, `ast_interpret.py`, or any production
render code are in scope for this tranche — this is a validation/discovery harness
observing the existing system, per the authorization.

---

## 11. Bounded implementation sequence

1. Build Layer A (`tools/compat_harness.py`) and run it over the ALREADY-EXISTING
   `pine_community/` corpus (30 scripts) — zero new capture needed, immediate failure
   distribution data, no TradingView required.
2. Build the Section 3 result schema + `tests/fixtures/compat_harness/results/` and
   backfill Layer A results for that same 30-script run.
3. Build Lane 2's Level 1-2 fixtures + Layer B driver against `chart_parity.py`'s
   existing hermetic pattern; add the Layer B non-vacuity tests.
4. Extend Lane 2 through Level 3-6, each level's fixtures added only after the prior
   level's harness mechanics are proven (mirrors this program's own preference for
   proving the check can fail before trusting it, applied incrementally).
5. Write `tools/compat_harness_report.py` and produce the first aggregate report over
   Layer A + Layer B results — this alone should already surface real, useful failure
   distribution before any browser/TradingView work begins.
6. Only once TradingView is confirmed genuinely free (owner-confirmed, not
   self-reconnected): run Layer C on the Section 6 initial 8-script sample, following
   the Golden Journey methodology exactly, with the browser-hang/staleness handling from
   RISK-011/RISK-014 built into the driver from the start.
7. Return with the first real Layer C results before selecting any second batch or
   widening beyond the initial 8 scripts.

Steps 1-5 require no TradingView access at all and can begin immediately. Step 6 is
explicitly gated on owner confirmation that the account is free, per the standing
concurrency instruction.
