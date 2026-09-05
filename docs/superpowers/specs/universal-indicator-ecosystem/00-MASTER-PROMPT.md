# Universal Custom Indicator + Screener Ecosystem — Source Objective

**Status:** authoritative source text. Do not paraphrase from memory — read this file.
**Relationship to prior work:** this program extends and hardens the existing
`docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (approved architecture)
and its shipped Phase A (`api/services/signature/*`, live on `origin/master`). It is
**not** a replacement project and does not supersede that document except where this
file's own reconciliation section says so explicitly.

This file is a verbatim capture of three things, in order:
1. The master project prompt (project owner, 2026-09-04)
2. The Critical Addendum — validation-before-human-testing (project owner, 2026-09-04)
3. The program-scope reconciliation decision (project owner, 2026-09-04), which governs
   how sections 1 and 2 below relate to the pre-existing 7/31 Indicator Platform program

Everything downstream (requirements ledger, constraint ledger, decision records,
progress tracking) derives from this file. If this file and a summary elsewhere disagree,
this file wins.

**Standing anti-drift context:** `GOVERNING_INTENT.md` (recorded 2026-09-05, DEC-011)
restates the owner's product/engineering intent in durable form — read it alongside this
file before scoping any new phase or resuming after a session interruption. It does not
supersede this file; it exists so the *why* behind these decisions survives independently
of any one session's transcript.

---

## 1. MASTER PROJECT PROMPT

# UCT INTELLIGENCE — UNIVERSAL CUSTOM INDICATOR + SCREENER ECOSYSTEM
## MASTER DISCOVERY, ARCHITECTURE, PRODUCT, MIGRATION, TESTING & BUILD PROMPT

You are being appointed as the **Project Lead / Chief Architect / Chief Integrator** for a major expansion of the existing UCT Intelligence custom indicator and custom screener ecosystem.

Read this prompt carefully before making changes.

This project is strategically important and is intended to become foundational infrastructure for UCT Intelligence.

---

### 0. THE MOST IMPORTANT CLARIFICATION

**THIS IS NOT A REPLACEMENT PROJECT.**

UCT Intelligence already has substantial: screener infrastructure, Custom Screens functionality, indicator infrastructure, charting functionality, saved user workflows, backend calculations, data-provider infrastructure, market-data pipelines, scanning jobs, APIs, frontend surfaces, databases, user-facing behavior, tests, production assumptions.

Some of this infrastructure may already be excellent. Some of it may need substantial improvement. Some of it may eventually need replacement.

But: **You are NOT authorized to assume that existing infrastructure should be replaced merely because we are designing a more ambitious system.**

The objective is: **SIGNIFICANTLY IMPROVE, EXTEND, HARDEN, GENERALIZE AND MODERNIZE THE EXISTING ECOSYSTEM** while preserving everything that already works unless there is strong evidence that a change is necessary.

The default decision should be **extend / adapt / encapsulate / migrate** before **rewrite / replace / delete.**

Any recommendation to replace an important existing subsystem must prove: (1) what is wrong with the existing implementation, (2) why incremental improvement is insufficient, (3) what measurable improvement the replacement creates, (4) migration cost, (5) compatibility risk, (6) rollback strategy, (7) effects on existing users, (8) effects on saved screens/indicators, (9) effects on APIs and downstream consumers, (10) how parity with existing behavior will be verified.

---

### 1. THE PRODUCT VISION

We want to build what can ultimately become: **THE UNIVERSAL CUSTOM TRADING LOGIC LAYER OF UCT INTELLIGENCE**

The objective is for members to be able to create, import, recreate, modify, visualize, screen and eventually alert on trading logic regardless of how that logic originally enters UCT.

A member may begin with: Pine Script / TradingView; thinkScript / Thinkorswim; TC2000 PCF; another supported trading syntax in the future; plain English; a screenshot of an indicator; UCT's own future authoring environment.

Regardless of the starting point, the logic should converge into a trustworthy UCT execution system.

A member should increasingly be able to think: "I don't need to rebuild my trading workflows simply because I moved platforms." And eventually: "UCT is actually a better place to create these workflows in the first place."

---

### 2. THE LONG-TERM PRODUCT PROMISE

The eventual experience should approach:

**BRING IT** — Import logic you already use.
**BUILD IT** — Create new logic directly in UCT.
**UNDERSTAND IT** — UCT explains what the formula actually means.
**VERIFY IT** — UCT identifies whether the translation/recreation is exact, partial, inferred or unsupported.
**CHART IT** — Display the output properly.
**SCREEN WITH IT** — Run the logic across the appropriate market universe.
**USE IT AS DATA** — Expose numeric indicator values as columns.
**FILTER IT** — Turn numeric output into conditions.
**ALERT ON IT** — Evaluate the logic according to an appropriate execution cadence.
**MODIFY IT** — Edit parameters or logic.
**SAVE IT** — Persist the resulting indicator/screen.
**REUSE IT** — One piece of trading logic should not need to be manually recreated separately for every UCT surface.

---

### 3. NON-DISRUPTION COVENANT

Before significant implementation begins, create a **Current Ecosystem Preservation Contract**.

Identify every existing system this project might touch. At minimum investigate: existing Custom Screens, existing screeners, existing filters, existing technical indicators, chart indicators, saved indicators, saved screens, scanner execution workers, market universe logic, data-provider abstractions, market-data ingestion, historical bars, intraday bars if present, alert infrastructure, chart rendering, expression evaluators, APIs, database schemas, cache layers, scheduled workers, Railway/backend services, feature flags, authentication/permissions, user settings, frontend routes, current editing interfaces, mobile/responsive behaviors where applicable.

For each, determine: CURRENT BEHAVIOR, DEPENDENCIES, OWNERSHIP, TEST COVERAGE, USER IMPACT, WHETHER THE NEW SYSTEM TOUCHES IT, MIGRATION RISK, ROLLBACK PATH.

---

### 4. FREEZE A BEHAVIORAL BASELINE BEFORE MAJOR CHANGES

Before changing core infrastructure, capture what the current product actually does. Do not rely solely on source-code interpretation. Create behavioral fixtures for important current workflows.

Examples: representative existing Custom Screens, common saved indicators, important technical filters, popular chart indicators, existing scanner queries, numeric columns, threshold filtering, save/edit/delete workflows, scheduled scans, data fetch behavior.

Capture **input → current output** where practical. These become **legacy compatibility goldens**.

The new infrastructure should be capable of proving: "We made the ecosystem significantly more powerful without unknowingly breaking existing functionality."

---

### 5. DO NOT CONFUSE PRESERVING BEHAVIOR WITH PRESERVING BAD ARCHITECTURE

Existing behavior may need to remain compatible even if the implementation changes. Separate **USER CONTRACT** from **INTERNAL IMPLEMENTATION**. A backend component may be replaced eventually if necessary while preserving the user's observable behavior.

Likewise, a flawed behavior may intentionally be corrected if: it is demonstrably wrong, the correction is documented, compatibility impact is understood, migration is safe, tests prove the new semantics.

---

### 6. DISCOVERY BEFORE BUILD

We are intentionally willing to spend meaningful time planning this properly. Do NOT optimize for beginning implementation quickly. Optimize for avoiding months of architectural rework.

The project must begin with **PHASE ZERO — DEEP DISCOVERY**.

The first goal is not "write code." The first goal is "understand the system well enough that the correct build becomes obvious."

Perform: repo archaeology, architecture mapping, dependency mapping, production flow mapping, test-suite analysis, database/schema analysis, data-provider analysis, frontend analysis, performance analysis, compatibility analysis, competitor/product research, technology research, security analysis, migration analysis, UX analysis, telemetry analysis.

Small probes and experiments are allowed. A broad rewrite is not.

---

### 7. CALIBRATION WARNING

Our internal measurements have previously been wrong multiple times. Those errors tended to flatter system capability.

Therefore: **All significant capability claims are provisional until reproduced from executable evidence.**

Current reported measurements include: 38/38 authored/product-goal examples; 43/58 curated regression corpus; 21/48 blind first pass; 28/48 after assisted edits.

These numbers provide context. They are NOT unquestionable truth. Reproduce them. Audit their denominators. Audit classification. Audit the test fixtures. Audit what each benchmark actually measures.

---

### 8. NO PAPER CAPABILITIES

The following alone do NOT prove support: a compatibility document, a README, a manually-maintained matrix, a function name appearing in a registry, a parser recognizing syntax, a translator creating an AST, a unit test that only tests the parser, an LLM saying something is supported.

Prefer an executable proof chain: source input → parser → dialect semantic translation → canonical representation → validation → static analysis → data requirements → execution → chart/screener/alert delivery → verified expected output.

Where practical, compatibility reporting should be automatically generated from this evidence.

---

### 9. PRESERVE THE CLOSED, SAFE EXECUTION MODEL

Current architecture has important properties worth protecting. Examples include: closed grammar, bounded execution, statically discoverable history requirements, deterministic calculations, no arbitrary remote user-code execution, node budget, lookback analysis, repaint analysis, predictable resource requirements.

Do NOT casually sacrifice those properties simply to claim greater syntax compatibility. The destination languages can be broad. The execution engine should remain controlled.

---

### 10. BUT DO NOT FREEZE THE CANONICAL LANGUAGE FOREVER

The current grammar may have artificial limitations caused by representation choices.

Example: If a logically bounded operation expands into hundreds of primitive AST nodes, investigate whether it should become a safe first-class canonical operation. The question should not simply be "Does macro expansion exceed 128 nodes?" It should also be "Can this operation be represented as one safe, bounded, statically analyzable primitive?"

For any canonical grammar expansion evaluate: static decidability, lookback calculation, computational complexity, memory bounds, type safety, repaint properties, scan cost, abuse potential, debugging, vendor semantics, testing complexity.

Preserve the reason for the guardrail, not necessarily its current implementation.

---

### 11. ARRAYS / COLLECTIONS

Arrays/collections have previously been considered and reportedly created a measured delta of zero relevant scripts. Do not reopen major complexity merely because arrays exist in competitor languages. Reopen this only when: new benchmark evidence requires it, real telemetry requires it, an important use case cannot be represented safely otherwise.

---

### 12. TARGET ARCHITECTURAL SHAPE

Investigate whether the optimal architecture resembles:

MULTIPLE LANGUAGE FRONTENDS (Pine, thinkScript, TC2000, UCT native language, future languages) → LANGUAGE-SPECIFIC PARSING + SEMANTIC LOWERING → CANONICAL UCT TRADING IR → TYPE CHECKING → STATIC ANALYSIS → EXECUTION REQUIREMENT ANALYSIS → OPTIMIZATION / NORMALIZATION → SHARED SEMANTIC EXECUTION KERNEL → Chart adapter / Screener adapter / Numeric-column adapter / Alert adapter / Preview/debug adapter

This is a hypothesis to evaluate, not a mandated rewrite. If existing architecture already approximates this successfully, evolve it.

---

### 13. SOURCE MAPPING

If multiple languages compile into a canonical representation, preserve mappings from canonical nodes back to source locations. A member should receive errors like "Line 13: `ta.foo()` cannot execute using daily bars." rather than "IR_NODE_291 failed."

Investigate source maps/provenance throughout: parsing, lowering, rewriting, suggested edits, canonicalization, evaluation errors. This will be critical for excellent UX.

---

### 14. THE FIVE INPUT DOORS

Treat every door as important but measure them independently.

**DOOR A — PINE SCRIPT.** Investigate: supported versions, syntax coverage, variables, inputs, operators, built-ins, namespaces, series semantics, historical indexing, state, timeframes, sessions, plots, alert conditions, repaint behavior, unsupported constructs, strategies vs indicators, scanner-specific limitations. Translation must mean semantic translation, not superficial syntax conversion.

**DOOR B — THINKSCRIPT.** Investigate: syntax, definitions, recursive/stateful patterns, studies, scans, plots, aggregations, data access, time behavior, sessions, functions, input definitions, commonly used trader patterns, constructs that cannot safely map.

**DOOR C — TC2000 / PCF.** Investigate: PCF formulas, condition formulas, indicator formulas, EasyScan workflows, timeframe semantics, commonly used functions, custom indicators, parameter patterns, realistic migration workflows.

**DOOR D — PLAIN LANGUAGE.** Example: "Stocks above the 50-day SMA that pulled back to the 20 EMA on volume less than half their 20-day average." The AI layer should produce a candidate specification. It must NOT become the final execution authority. Architecture: natural language → intent extraction → structured candidate logic → ambiguity detection → canonical compilation → deterministic validation → member-readable explanation → execution. The member should be able to see "Here is how I interpreted your request." Important ambiguity should trigger clarification or multiple interpretations rather than invented certainty.

**DOOR E — SCREENSHOT / VISUAL RECREATION.** Screenshot recognition is inherently different from source translation. Never imply that a screenshot uniquely reveals proprietary source code. Pipeline: image → visual feature extraction → plot identification → axis/panel interpretation → visible parameter extraction → candidate indicator families → candidate logic → confidence → optional clarification → canonical implementation → visual comparison → numeric comparison if known values exist. Expose classifications: EXACT SOURCE IMPORT, VERIFIED RECREATION, HIGH-CONFIDENCE INFERENCE, APPROXIMATE RECREATION, INSUFFICIENT EVIDENCE.

---

### 15. FIRST-CLASS NATIVE CREATION

This project must not stop at importing other languages. We want UCT to become a place where users BUILD custom indicators. Research the proper authoring model.

Candidate approaches: OPTION A — UCT NATIVE DSL; OPTION B — PINE-LIKE AUTHORING MODE; OPTION C — THINKSCRIPT-LIKE MODE; OPTION D — MULTIPLE COMPATIBILITY MODES; OPTION E — VISUAL BUILDER; OPTION F — PLAIN-LANGUAGE-FIRST AUTHORING; OPTION G — HYBRID.

For each evaluate: learning curve, migration value, maintainability, editor tooling, semantic complexity, documentation burden, long-term stability, accessibility to non-coders, power for advanced traders, debugging, compatibility expectations, vendor intellectual-property boundaries, versioning, test burden.

Do not decide this casually. Produce an architecture decision record.

> **Reconciliation note (see section 3 of this file):** the owner has ruled this section is RESEARCH/HYPOTHESIS, not a directive, given the pre-existing 7/31 decision to kill a standalone user-facing scripting language as a product. See DECISIONS.md DEC-002.

---

### 16. ONE SAVED LOGIC OBJECT

Investigate making one saved UCT indicator/screen definition a portable object.

Potential schema — Identity: artifact ID, owner, name, description. Source: original source, source dialect, source version. Compilation: parser version, translator version, IR version, compiler version. Logic: canonical representation, inputs, output types. Visual: plots, styles, panes, levels, colors, labels. Execution: lookback, timeframe, session, required datasets, repaint characteristics, supported run policies. Verification: compatibility tier, semantic verification, vendor fixtures, test status. Product: chart-enabled, screener-enabled, alert-enabled. History: version, previous versions, migrations.

The member should not need three separate implementations of the same idea.

---

### 17. NUMERIC OUTPUTS ARE FIRST-CLASS

A custom indicator does not need to return boolean. Examples: RSI, ATR, ADX, MFI, oscillator values, relative-volume values, distance from moving average.

Numeric output should support: screener column, sorting, thresholds, ranges, comparison operators, crossings where supported, saved conditions, chart display, alerts. Do not misclassify these as failed screens.

---

### 18. SEPARATE LOGIC FROM EXECUTION

Nightly/daily must not define what the language itself means. Separate: CALCULATION (what does the formula calculate?), TIMEFRAME (what bars does it calculate over?), BAR STATE (confirmed vs forming/live bar), SESSION (regular/extended/venue-specific), UNIVERSE (which symbols), DATASETS (price/volume/fundamentals/other), RUN POLICY (nightly, scheduled, run now, intraday periodic, alert/live where supported).

---

### 19. EXECUTION REQUIREMENT CONTRACT

Before running an artifact, calculate what it needs. Example output: `minimum_bars: 200`, `timeframe: 5m`, `session_awareness: required`, `forming_bar: allowed`, `intraday_data: required`, `fundamental_data: false`, `repainting_risk: none`, `estimated_cost: ...`.

The selected execution lane must satisfy this contract. If it does not: **REFUSE CLEARLY.** Do not silently substitute incompatible execution semantics.

---

### 20. INTRADAY / RUN-NOW DISCOVERY

Evaluate early. Do NOT immediately build full tick-level infrastructure. Research bounded capabilities such as 5/15/60 minute + daily, with Run Now, scheduled scans, nightly scans.

Determine actual architecture cost using our existing data infrastructure. Audit: available providers, entitlements, API limits, historical depth, freshness, corporate actions, extended-hours availability, latency, caching, storage, batch cost, Railway/service constraints, universe size.

This decision may unlock more member workflows than additional translator functions.

---

### 21. TECH STACK DISCOVERY — DO NOT SKIP THIS

We want an excellent long-term stack. But do NOT introduce technology because it is fashionable.

Create `TECH_STACK_RFC.md`. For every major layer, document: CURRENT TECHNOLOGY, CURRENT STRENGTHS, CURRENT WEAKNESSES, CANDIDATE ALTERNATIVES, BENCHMARKS, MIGRATION COST, OPERATIONAL COMPLEXITY, TEAM/AGENT MAINTAINABILITY, PERFORMANCE, SECURITY, LOCK-IN, RECOMMENDATION.

---

### 22. PARSER / COMPILER TECHNOLOGY RESEARCH

Evaluate whether current parsers should remain. Candidates: existing handwritten parser, generated parser, incremental parsing technology, Tree-sitter, PEG-style parsers, ANTLR-class approaches, language-specific parser libraries.

Evaluate separately for compiler backend and editor syntax intelligence. The best editor parser does not necessarily need to become the canonical compiler parser. Do not rewrite functioning parsers unless evidence justifies it.

---

### 23. CODE EDITOR TECHNOLOGY RESEARCH

Evaluate building a real authoring environment. Candidate categories: existing editor, Monaco-class editor, CodeMirror-class editor, custom lightweight editor.

Desired capabilities: syntax highlighting, language selection, automatic detection, autocomplete, signature help, hover documentation, function documentation, inline diagnostics, error underlines, warning levels, code formatting, bracket handling, parameter hints, source/translated diff, search, undo/redo, keyboard navigation, accessibility, large-file behavior, custom language providers.

Do not assume a desktop code-editor architecture makes sense on mobile. Design responsive behavior separately.

---

### 24. SEMANTIC KERNEL / EVALUATION ENGINE RESEARCH

Audit the existing evaluator carefully. Determine: current execution language, scalar vs vectorized evaluation, repeated work, caching, symbol batching, memory patterns, computation graph reuse, type dispatch, handling of null/NaN, lookback buffers, performance across thousands of symbols.

Only if evidence requires it, investigate alternatives such as: more aggressive vectorization, optimized dataframe/columnar compute, native extensions, Rust/native kernels, WebAssembly, compilation/JIT, expression-plan optimization. Do not increase implementation complexity unless benchmarks justify it.

---

### 25. DATA ARCHITECTURE RESEARCH

Audit the existing data ecosystem before proposing another provider. Map: provider, dataset, asset classes, timeframes, corporate-action handling, adjusted/unadjusted data, entitlement, historical availability, realtime/delayed status, rate limits, cost, fallback behavior, symbol mapping, exchange mapping, data quality.

Create one canonical internal market-data contract if one does not already exist. The indicator engine should not contain provider-specific assumptions everywhere.

---

### 26. JOB ORCHESTRATION RESEARCH

Audit current: cron, queues, workers, retries, idempotency, crash recovery, concurrency, job status, scheduling, long-running scans.

Only if current architecture cannot meet requirements, evaluate more durable workflow/orchestration technology. Questions include: What happens if a 3,700-symbol scan crashes at symbol 2,400? Is work repeated? Can it resume? Are partial results visible? Can jobs duplicate? How are retries handled? What happens during deployment? How are alerts scheduled?

Do not add a workflow platform if existing infrastructure already solves these problems reliably.

---

### 27. OBSERVABILITY TECHNOLOGY

A custom indicator import should become traceable across services. Desired trace: `request → door_detect → parse → translate → canonicalize → typecheck → static_analyze → requirements → fetch_data → evaluate → deliver`.

Investigate whether the existing observability system is sufficient. If not, evaluate a vendor-neutral instrumentation standard. We want correlated traces, metrics, logs with a stable artifact/import/run ID.

---

### 28. TESTING TECHNOLOGY RESEARCH

Do not rely only on handwritten examples. Evaluate: existing unit-test stack, property-based testing, fuzz testing, mutation testing where useful, browser E2E testing, visual regression testing, performance testing, load testing, contract testing, vendor differential testing, production smoke testing. Choose tools consistent with the languages already used in the repository.

---

### 29. PROPERTY-BASED / GENERATIVE TESTING

Compiler and formula engines are unusually well suited to generative testing. Create properties such as: serialization round-trip, normalization equivalence, bounded lookback invariants, no invalid AST after successful compile, equivalent rewrites produce equivalent outputs, scanner and chart kernel produce equivalent values, deterministic calculations remain deterministic, safe expression generation never escapes resource bounds. Use shrinking/minimization capabilities where available so failures become minimal reproducible formulas.

---

### 30. METAMORPHIC TESTING

When no external oracle exists, investigate mathematical relationships. Example categories: adding a constant to an input affects certain indicators predictably, scaling all prices should preserve dimensionless ratios where mathematically expected, equivalent boolean transformations should produce identical results, moving-average identities, window invariants. Do not create invalid mathematical assumptions. Each property must be reviewed.

---

### 31. DIFFERENTIAL VENDOR TESTING

When vendor runtime can provide truth: vendor result vs UCT result. Use deterministic fixtures. Store: vendor, vendor version, capture date, script, source input, parameters, timeframe, session, symbol if real market data is used, outputs, UCT output, tolerance, result.

---

### 32. VENDOR ORACLE PROTOCOL

Create a repeatable system for ambiguous functions. For TradingView-style ambiguities: (1) construct a minimal input where candidate definitions diverge, (2) execute using the actual vendor runtime, (3) export/output the exact values, (4) retain raw evidence, (5) classify semantics, (6) convert into a permanent regression fixture. Do not rely on multiple open-source reimplementations if all are ultimately interpreting the same ambiguous documentation.

---

### 33. COMPATIBILITY IS MULTIDIMENSIONAL

Avoid one boolean `supported`. Track independently: PARSE COMPATIBILITY, SEMANTIC COMPATIBILITY, NUMERIC PARITY, VISUAL PARITY, DATA COMPATIBILITY, EXECUTION COMPATIBILITY, CHART COMPATIBILITY, SCREENER COMPATIBILITY, ALERT COMPATIBILITY.

Suggested status classes: VERIFIED, SUPPORTED, PARTIAL, EXPERIMENTAL, CORRECTLY REFUSED, UNSUPPORTED, DATA BLOCKED, EXECUTION BLOCKED, VENDOR AMBIGUOUS.

---

### 34. FALSE SUCCESS IS THE WORST CLASS OF FAILURE

Prioritize: SILENT WRONG ANSWER above CORRECT REFUSAL. A script that translates successfully but executes under incompatible market data should be considered a serious correctness bug. Never optimize success rates by accepting more inputs if that increases false success.

---

### 35. BENCHMARK HIERARCHY

Maintain different benchmarks for different purposes: A — PRODUCT-CRITICAL REGRESSION SET (important workflows that must always work); B — BROAD REGRESSION NET (large coverage set); C — FROZEN BLIND CAPABILITY EXAM (externally authored without access to implementation); D — REAL MEMBER CORPUS (once telemetry exists, anonymized/appropriately handled real patterns should influence future priorities).

---

### 36. BLIND MEMBER TASK SUCCESS

Define an outcome-level metric. A task passes only if the requested product outcome is actually achieved. Example: if input translates but cannot produce the requested scanner result: FAIL PRODUCT TASK, while perhaps PASS TRANSLATOR. This distinction is essential.

Track: first-pass task success, assisted task success, correct refusal, false success, semantic mismatch, execution incompatibility, abandonment. A benchmark's denominator may not be modified after results are observed merely to improve the score.

---

### 37. TELEMETRY FIRST

Instrument usage before making long-term prioritization decisions based on intuition.

`import_submitted` — fields: door, dialect, detected version, input size, destination intent, existing/new user context where privacy-safe. Decision unlocked: Which doors actually matter?

`compile_finished` — fields: success, failure, refusal, unsupported functions, failure category, requirements, suggested changes, latency. Decision: Where does compatibility actually break?

`import_accepted` — fields: unchanged, suggested edit accepted, manual edit, abandoned. Decision: Does assisted translation solve the user's problem?

`delivery_configured` — fields: chart, scanner, alert, numeric column, threshold, timeframe, session, cadence, universe. Decision: What are users actually trying to do?

`execution_finished` — fields: success, symbols, hits, duration, error, incompatibility, data freshness. Decision: Does translation become real product delivery?

---

### 38. ADD PRODUCT FUNNEL ANALYSIS

Design queries/dashboards answering: Which import door is most used? Which dialect has highest success? Which dialect has most abandonment? What unsupported names create the most real failures? How often are suggested edits accepted? How often are numeric imports converted to thresholds? What timeframes do members request? How often is Run Now requested? How many screenshot attempts become saved artifacts? How many plain-language artifacts are edited? How many imported artifacts are later used? What percentage reach Chart? Screener? Alert? Where do users abandon?

---

### 39. UI/UX IS PART OF THE CORE PROJECT

Do not architect backend and hand a finished API to design afterward. A web/product designer should participate throughout. Primary workflows need explicit product design.

---

### 40. IMPORT EXPERIENCE

Potential UX: STEP 1 — Paste / describe / upload. STEP 2 — UCT detects the source. STEP 3 — UCT analyzes. STEP 4 — UCT explains what it understood, compatibility, any changes, any uncertainty. STEP 5 — Preview. STEP 6 — Choose: Add to Chart / Use in Screener / Save Indicator / Create Alert when compatible.

Advanced complexity should be available without making the basic workflow intimidating.

---

### 41. TRANSPARENCY

For translated logic, consider exposing ORIGINAL and UCT INTERPRETATION. For plain language: "Here is what UCT understood." For screenshot recreation: "Here is what UCT inferred." For partial compatibility: "These two constructs were changed." For unsupported: "This requires an unbounded accumulator, which UCT's safe execution model cannot currently represent." Make errors actionable.

---

### 42. ERROR TAXONOMY

Create structured errors instead of generic messages. Examples: PARSE_ERROR, UNKNOWN_FUNCTION, UNSUPPORTED_LANGUAGE_FEATURE, TYPE_ERROR, FORMULA_BUDGET_EXCEEDED, UNBOUNDED_LOOKBACK, DATASET_UNAVAILABLE, TIMEFRAME_UNAVAILABLE, SESSION_INCOMPATIBLE, EXECUTION_LANE_INCOMPATIBLE, VENDOR_SEMANTICS_UNVERIFIED, SCREENSHOT_AMBIGUOUS, INTERNAL_ERROR.

Each should have: code, explanation, source range, recoverability, suggested action, internal debug context.

---

### 43. USER TRUST

Provide meaningful verification labels: VERIFIED (differentially checked against authoritative behavior), SUPPORTED (covered by internal semantic testing), INFERRED (AI/vision recreation), PARTIAL (some behavior changed), UNSUPPORTED (cannot safely execute). Do not overwhelm normal users with engineering details. Allow deeper inspection when wanted.

---

### 44. DESIGN FOR BEGINNERS AND ADVANCED USERS

The same product should support beginner ("I want stocks breaking their 20-day high on 2x volume.") and advanced (a large imported script with multiple custom calculations). Progressive disclosure is critical. Do not force advanced complexity into the beginner flow. Do not cripple advanced functionality to make the beginner UI simple.

---

### 45. PRODUCT DESIGN SYSTEM

Audit UCT's existing design language. The new ecosystem should look like UCT. Do not introduce an unrelated application inside the application. Use existing typography, spacing, controls, modals, panels, colors, navigation, tables, chart patterns unless the broader design system itself requires improvement.

---

### 46. CLICKABLE-SURFACE QA

After each major implementation milestone: use an E2E/browser specialist to operate the real frontend. Create a clickable-surface inventory. Test: buttons, dropdowns, context menus, modals, code editor actions, language selector, import, upload, compile, suggested fixes, preview, chart, scanner, alert, save, edit, rename, duplicate, delete, threshold controls, timeframes, sessions, universe selection, sorting, filters, pagination, back navigation, refresh, reload, persistence, error recovery. Do not declare frontend completion because APIs respond.

---

### 47. CROSS-BROWSER TESTING

Test major workflows in the browser environments relevant to UCT. At minimum: Chromium-based browsers, Safari/WebKit behavior, Firefox behavior. Mobile/responsive testing should be included wherever those product surfaces are supported.

---

### 48. VISUAL REGRESSION

For high-value stable surfaces, consider screenshot regression tests. Examples: editor, import analysis, error states, indicator settings, scanner table, chart rendering. Avoid brittle snapshot testing of constantly changing irrelevant pixels. Use visual tests where they protect real UX.

---

### 49. PERFORMANCE

Measure before optimization. Create benchmarks for: compile latency, preview latency, single-symbol evaluation, 100 symbols, ~current market universe, concurrent users, saved nightly runs, Run Now, intraday, memory, data-fetch volume, cache hit rate, compute cost, database load. Define performance budgets after baseline measurement.

---

### 50. SCAN ENGINE OPTIMIZATION

Investigate: common subexpression elimination, shared indicator computation, calculation caching, cross-screen reuse, incremental updates, precomputed common technical series, batching, vectorization, data locality, cache invalidation, repeated market-data fetches. But do not create premature complexity without benchmarks.

---

### 51. SECURITY

Threat-model all five doors. Investigate: malicious source input, parser bombs, pathological formula structure, excessive history, formula complexity attacks, upload attacks, screenshot metadata, injection, stored XSS, unsafe rendering, denial-of-service, cross-user data access, artifact permissions, alert abuse, runaway compute. The advantage of the closed execution language must be preserved.

---

### 52. VERSIONING

Saved user logic must remain stable over time. Version: source dialect, source dialect version, parser, translator, canonical IR, semantic library, compiler, execution kernel, artifact schema. Determine how old artifacts behave after upgrades. Do not silently change an existing member's saved indicator semantics.

---

### 53. MIGRATIONS

Every schema or semantic migration should define: OLD STATE, NEW STATE, MIGRATION, VERIFICATION, ROLLBACK, USER IMPACT, FAILURE MODE. Prefer reversible migrations. Use backfills carefully.

---

### 54. SHADOW MODE

For significant execution-engine changes, strongly prefer running old and new systems side-by-side before cutover when practical. Compare: outputs, hit counts, errors, latency, resource use. Investigate mismatches. Do not expose the new result to users until discrepancies are understood.

---

### 55. FEATURE FLAGS

New functionality should be isolatable. Use the existing feature-flag mechanism if one exists. Possible rollout: internal → development/staging → staff/test accounts → small member cohort → broader cohort → production default. A rollback should not require emergency code surgery.

---

### 56. CANARY RELEASES

For risky backend changes, investigate staged release/canary deployment. Monitor: errors, semantic mismatches, latency, memory, database pressure, scan completion, user abandonment.

---

### 57. NO BIG-BANG MIGRATION

Avoid "Friday night replace old screener engine with new universal engine." Prefer incremental coexistence. Examples: old saved screens continue using existing execution while new imports initially use new execution path; or new engine shadows old execution before selected existing artifacts migrate. The optimal strategy should be determined from repo reality.

---

### 58. ROLLBACK IS A FEATURE

For each major phase, answer: "If this goes badly in production, how do we return to the previous working state?" If there is no credible answer, the rollout design is incomplete.

---

### 59. PROJECT ORGANIZATION

Use specialist agents/workers aggressively. But create hierarchy.

**PROJECT LEAD / CHIEF INTEGRATOR** owns: master architecture, task assignment, conflicting conclusions, evidence quality, decisions, integration, sequencing, scope, progress, release gates. No specialist independently changes strategic direction.

---

### 60. SPECIALIST WORKSTREAMS

Create or simulate specialists appropriate to the available agent system: EXISTING SYSTEM ARCHAEOLOGIST (maps current system); PRESERVATION/MIGRATION ENGINEER (owns compatibility and rollout); COMPILER/IR ARCHITECT (owns canonical language and static analysis); PINE SPECIALIST; THINKSCRIPT SPECIALIST; TC2000 SPECIALIST; FUTURE LANGUAGE/UCT DSL ARCHITECT; NATURAL LANGUAGE INTERPRETATION SPECIALIST; VISION/SCREENSHOT SPECIALIST; DATA ARCHITECT; MARKET EXECUTION ENGINEER; PERFORMANCE ENGINEER; CHART RENDERING SPECIALIST; SCREENER SPECIALIST; ALERTING SPECIALIST; PRODUCT DESIGNER; FRONTEND/EDITOR SPECIALIST; QA/ADVERSARIAL TESTER; BROWSER E2E TESTER; VENDOR PARITY SPECIALIST; SECURITY SPECIALIST; OBSERVABILITY ENGINEER; TELEMETRY/PRODUCT ANALYTICS SPECIALIST; DEVOPS/RELEASE ENGINEER; PRODUCT MARKETING/MIGRATION SPECIALIST. Use additional specialists where evidence shows they help.

---

### 61. PARALLEL WORK RULES

Parallelize independent research (e.g. Pine audit, thinkScript audit, TC2000 audit, frontend audit, data audit can run simultaneously). Do NOT allow multiple agents to make uncoordinated edits to the same compiler core. Assign explicit ownership.

Every agent report should contain: Scope, Evidence, Findings, Unknowns, Recommendations, Risks, Files inspected, Tests run, Confidence.

---

### 62. INDEPENDENT REVIEW

For important architectural recommendations, assign another specialist to challenge the proposal. Examples: architect proposes native UCT DSL → have another agent argue against it; data architect proposes intraday infrastructure → have another agent estimate cost/risk; compiler architect proposes expanding IR → have QA/security challenge complexity. Do not confuse consensus with truth.

---

### 63. MARKETING SPECIALIST

Marketing participates because competitive replacement requires understanding migration. Marketing does NOT decide technical truth. Investigate: why traders use custom indicators, why they stay with competitors, migration pain, terminology, onboarding, trust, compatibility expectations, positioning, demos, documentation, examples. Marketing claims must be backed by product evidence. Never say "Fully Pine compatible" unless the evidence truly supports that scope.

---

### 64. COMPETITIVE RESEARCH

Research actual workflows, not just feature lists. Study: TradingView/Pine, Pine Screener, Thinkorswim/thinkScript, TC2000/PCF, other serious competitors discovered during research. For each: CREATION, IMPORTABILITY, EDITOR, DEBUGGING, CHARTS, SCANNING, ALERTS, TIMEFRAMES, SAVING, SHARING, COMMUNITY, DOCUMENTATION, ERROR UX, PERFORMANCE, LIMITATIONS. Then answer: What can UCT do materially better? Do not blindly clone competitors.

---

### 65. COMPETITIVE REPLACEMENT TEST

For each targeted competitor workflow, create a migration scenario. Example: "An advanced Thinkorswim user has 12 custom studies and 8 scan queries." Can they migrate? Where do they fail? What would they need to manually change? What value would make the switch worthwhile? Do the same for a TradingView user, TC2000 user, plain-English/non-programmer, screenshot-only user.

---

### 66. DOCUMENTATION

A language ecosystem needs documentation. Plan: language reference, supported compatibility reference, examples, migration guides, function documentation, error documentation, timeframe behavior, repaint behavior, scanner behavior, chart behavior, known differences, screenshot limitations, plain-language tips. Where possible, documentation should derive from the same capability metadata used by the engine. Avoid documentation drift.

---

### 67. EXAMPLE LIBRARY

Consider a library of editable templates: moving average pullback, RSI, relative volume, breakout, gap, VWAP, Bollinger Bands, MACD, trend filters, candle patterns, momentum screens. Examples can teach the system without requiring users to begin from a blank editor.

---

### 68. DEBUGGER / EXPLAINABILITY

Investigate future debugging capabilities: current expression value, sub-expression values, bar-by-bar inspection, why symbol matched, why symbol failed, indicator output values, required bars, data source/timeframe, source mapping, execution trace. A custom screening system becomes far more trustworthy when users can answer "Why did NVDA appear in this screen?"

---

### 69. EXPLAIN MATCH

Consider a standardized evaluation explanation, e.g. `Price > SMA(50)` → TRUE, `Volume > AvgVolume(20) * 1.5` → TRUE, `RSI(14) < 70` → TRUE, therefore MATCH. This may be extremely valuable for trust and debugging. Evaluate performance implications.

---

### 70. DATA PROVENANCE

When appropriate, debugging/support should be able to identify: symbol, venue, provider, bar timestamp, adjustment state, session, timeframe, data freshness. Critical when users compare UCT with another vendor.

---

### 71. PARITY INCIDENT PROTOCOL

When "Your RSI differs from TradingView": do not immediately alter RSI. Capture symbol, venue, timeframe, session, parameters, relevant timestamps, confirmed/forming state, source bars, vendor output, UCT output. Classify: DATA DIFFERENCE, CALCULATION DIFFERENCE, EXECUTION MODEL DIFFERENCE, SESSION DIFFERENCE, VENDOR VERSION DIFFERENCE, UCT BUG, UNRESOLVED. Every confirmed semantic bug receives a permanent regression test.

---

### 72. PRODUCT RELEASE QUALITY

We want extremely high reliability. Do not claim literal mathematical "100% bug-free software." Operationalize the goal as: **Zero known critical defects in supported core workflows and zero known silent semantic wrong-answer defects before broad release.** This is a much stronger engineering target than vague "100% quality."

---

### 73. BUG SEVERITY

S0 — FINANCIAL/SECURITY/CATASTROPHIC. S1 — SILENT SEMANTIC WRONG RESULT / CORE SYSTEM FAILURE. S2 — MAJOR WORKFLOW BROKEN. S3 — DEGRADED/WORKAROUND AVAILABLE. S4 — COSMETIC/LOW IMPACT. No known S0/S1 before broad release. Core workflow S2 requirements should be explicitly defined.

---

### 74. BUG WORKFLOW

Every significant bug: (1) reproduce, (2) minimize, (3) write failing test, (4) identify root cause, (5) fix, (6) verify, (7) add regression coverage, (8) examine whether the same bug class exists elsewhere. Do not patch symptoms repeatedly.

---

### 75. PRODUCTION READINESS GATES

Before broad release require explicit evidence for: BACKWARDS COMPATIBILITY, SEMANTIC CORRECTNESS, VENDOR PARITY WHERE CLAIMED, FRONTEND E2E, BROWSER QA, DATA COMPATIBILITY, PERFORMANCE, SECURITY, OBSERVABILITY, TELEMETRY, ROLLBACK, DOCUMENTATION, SUPPORTABILITY, MIGRATION, ZERO KNOWN CRITICAL WRONG-ANSWER DEFECTS.

---

### 76. MASTER PROJECT LEDGER

Create persistent repository documentation. Recommended: `CUSTOM_INDICATOR_MASTER_PLAN.md`, `CURRENT_ARCHITECTURE.md`, `CURRENT_PRODUCT_BEHAVIOR.md`, `PRESERVATION_CONTRACT.md`, `CAPABILITY_MATRIX.md`, `TECH_STACK_RFC.md`, `COMPATIBILITY_CONTRACT.md`, `IR_ARCHITECTURE.md`, `DATA_REQUIREMENTS.md`, `VENDOR_PARITY_PROTOCOL.md`, `TELEMETRY_PLAN.md`, `TEST_MATRIX.md`, `MIGRATION_PLAN.md`, `RELEASE_PLAN.md`, `RISK_REGISTER.md`, `DECISIONS.md`, `PROGRESS.md`. Adjust naming to repo conventions. Do not allow important architectural knowledge to live only in the current Claude context window.

---

### 77. DECISION RECORDS

For every major decision record: Decision, Context, Evidence, Alternatives, Why chosen, Risks, Migration impact, Reversibility, Tests needed, Date. Examples: parser architecture, editor architecture, native UCT DSL, node budget changes, IR extensions, arrays, intraday, job system, market-data abstraction, screenshot pipeline, semantic versioning.

---

### 78. RISK REGISTER

Track risks actively. Examples: semantic mismatch, existing screen regression, data inconsistency, scan cost explosion, intraday data limitations, vendor ambiguity, parser complexity, UI complexity, model hallucination, screenshot false certainty, stateful function incompatibility, migration failures, performance degradation, database migration risk, provider outage, model/provider dependency, alert load. Each risk needs: likelihood, severity, detection, mitigation, owner.

---

### 79. PROJECT PHASES

Do not finalize exact phases until discovery, but start from this conceptual model: PHASE 0 — DISCOVERY + BASELINE (no broad rewrite). PHASE 1 — OBSERVABILITY + TELEMETRY + SAFETY CONTRACTS. PHASE 2 — CORE ARCHITECTURE HARDENING. PHASE 3 — LANGUAGE COMPATIBILITY. PHASE 4 — AUTHORING EXPERIENCE. PHASE 5 — EXECUTION EXPANSION. PHASE 6 — PLAIN ENGLISH + SCREENSHOT HARDENING. PHASE 7 — PRODUCT POLISH / MIGRATION / RELEASE. This order is provisional. Discovery should determine actual sequencing.

---

### 80. EXIT CRITERIA FOR EACH PHASE

Every phase needs: Objective, Inputs, Owners, Deliverables, Tests, Benchmarks, Risks, Rollback, Definition of done. Do not mark work "complete" because code was merged.

---

### 81. COMMUNICATION PROTOCOL

CLAUDE CODE ↔ PROJECT OWNER ↔ CHATGPT. At important checkpoints, produce a CHATGPT REVIEW PACKET containing: CURRENT PHASE, WHAT WAS INSPECTED, WHAT WAS VERIFIED, WHAT CHANGED, TEST RESULTS, BENCHMARK RESULTS, ARCHITECTURE DISCOVERIES, CONFLICTING EVIDENCE, DECISIONS MADE, DECISIONS PROPOSED, RISKS, NEXT RECOMMENDATION, QUESTIONS FOR EXTERNAL REVIEW, RELEVANT FILES, RELEVANT COMMANDS, COMMITS IF APPLICABLE. Keep it compact enough to move between systems while preserving important evidence.

---

### 82. WHEN TO STOP AND REQUEST OWNER REVIEW

Do not interrupt for issues repo inspection can resolve. Request review before: destructive migrations, abandoning important existing architecture, changing fundamental IR guarantees, introducing significant new infrastructure, changing user-visible semantics, changing core data providers, large recurring infrastructure cost, native DSL commitment, broad production migration, irreversible schema decisions.

---

### 83. WHEN NOT TO STOP

Do not ask the owner "Where is the parser?" — search the repo. Do not ask "What tests exist?" — find them. Do not ask "What frontend framework is used?" — inspect it. Do not delegate basic repo archaeology back to the user.

---

### 84. QUESTIONS THE REPO CANNOT ANSWER

Surface real product decisions separately. Example: "Telemetry shows 62% of attempted custom scans request intraday evaluation. Supporting this requires X additional monthly infrastructure cost. Should we prioritize it over Y?" That is a legitimate owner decision.

---

### 85. DEFINITION OF PROJECT SUCCESS

This project succeeds when UCT can increasingly become the place where traders IMPORT their existing logic, RECREATE closed-source or visual ideas responsibly, CREATE new indicators, UNDERSTAND the resulting logic, EDIT it, VERIFY it, CHART it, SCREEN with it, SORT numeric output, FILTER numeric output, ALERT on it, SAVE it, REUSE it, and TRUST THE RESULT.

---

### 86. COMPETITIVE STANDARD

The objective is not merely "We support Pine syntax." The objective is "The overall UCT workflow is good enough that the user no longer needs the competing product for the targeted workflow." This includes compatibility, speed, ease of use, editor quality, interpretation, explainability, charts, screening, alerts, market coverage, reliability, portability, migration, documentation, debugging, UX.

---

### 87. NORTH STAR PRINCIPLE

Every architecture decision should be evaluated against: **Can a trader bring or create trading logic, understand exactly what UCT did with it, execute it over the correct data, and trust the result?** If not, the feature is incomplete.

---

### 88. IMMEDIATE INSTRUCTION — DO NOT BEGIN BROAD IMPLEMENTATION

Start with discovery. Use parallel specialist agents extensively. First: (1) map the existing ecosystem, (2) establish the preservation contract, (3) reproduce current benchmarks, (4) capture behavioral baselines, (5) audit architecture, (6) audit frontend, (7) audit data infrastructure, (8) audit current testing, (9) audit observability, (10) audit telemetry, (11) research competitor workflows, (12) research candidate technologies, (13) identify the highest-leverage structural improvements, (14) identify migration risks, (15) create the proposed architecture, (16) create the phased build plan. Small tests/prototypes are permitted where necessary to answer architectural questions. Do NOT begin a broad rewrite.

---

### 89. REQUIRED FIRST DELIVERABLE

Return a complete **UCT CUSTOM INDICATOR ECOSYSTEM DISCOVERY PACKET** containing: A. EXECUTIVE ASSESSMENT. B. CURRENT PRODUCT MAP. C. CURRENT ARCHITECTURE. D. PRESERVATION MAP. E. BEHAVIORAL BASELINE. F. VERIFIED CAPABILITY MATRIX. G. BENCHMARK REPRODUCTION. H. TECHNICAL DEBT. I. PRODUCT GAPS. J. DATA GAPS. K. COMPATIBILITY GAPS. L. UI/UX GAPS. M. TESTING GAPS. N. OBSERVABILITY GAPS. O. TELEMETRY GAPS. P. SECURITY RISKS. Q. PERFORMANCE BASELINE. R. TECH STACK RFC. S. TARGET ARCHITECTURE. T. MIGRATION STRATEGY. U. AGENT/WORKSTREAM PLAN. V. PHASED BUILD PLAN. W. RELEASE GATES. X. NON-GOALS. Y. RISK REGISTER. Z. OWNER DECISIONS REQUIRED (only genuine decisions).

> **Status note (2026-09-04):** superseded as a literal "first deliverable" by the ingestion protocol (see section 3 of this file) — this packet is now the target output of Phase Zero as it matures, not the first response.

---

### 90. REQUIRED TECH-STACK RECOMMENDATION FORMAT

For every proposed new technology include a table: Category | Existing | Candidate | Evidence for Change | Benefits | Risks | Migration Cost | Recommendation. No recommendation may simply say "industry standard." It must relate to UCT's actual requirements.

---

### 91. REQUIRED BUILD PLAN FORMAT

For every phase: PHASE NAME, Objective, Why now, Specialist owners, Dependencies, Existing infrastructure reused, New infrastructure, Files/services likely touched, Data/schema impact, UI impact, Tests, Benchmark, Migration approach, Feature flag, Rollback, Exit criteria, Risks, Expected capability unlocked.

---

### 92. REQUIRED FIRST IMPLEMENTATION RECOMMENDATION

At the conclusion of discovery, tell the owner exactly WHAT WE SHOULD BUILD FIRST, explaining: why this outranks alternatives, what it unlocks, what existing infrastructure it uses, what it risks, how we test it, how we roll it back, how we'll know it worked.

---

### 93. REQUIRED CHATGPT REVIEW PACKET

At the end, create a separate concise section formatted for direct copy to ChatGPT: ORIGINAL OBJECTIVE, CURRENT VERIFIED STATE, WHAT ALREADY WORKS, BIGGEST DISCOVERIES, BIGGEST RISKS, CURRENT BENCHMARKS, PROPOSED ARCHITECTURE, PROPOSED TECH STACK CHANGES, WHAT WILL NOT BE REPLACED, WHAT MAY BE REPLACED, MIGRATION PLAN, PROPOSED BUILD ORDER, FIRST IMPLEMENTATION PHASE, OPEN QUESTIONS, CLAUDE'S RECOMMENDATION. Used for independent architectural review before major implementation proceeds.

---

### 94. FINAL OPERATING PRINCIPLE

Do not optimize for lines of code, number of supported function names, number of agents, speed of implementation, impressive architecture diagrams, or benchmark manipulation. Optimize for MEMBER OUTCOME, SEMANTIC CORRECTNESS, PRODUCT RELIABILITY, MIGRATION SAFETY, EXTENSIBILITY, PERFORMANCE, EASE OF USE, TRUST. The finished system should be materially more powerful than the ecosystem UCT has today while protecting the working systems that already create value. We are willing to invest substantial time in discovery and planning now to avoid building the wrong infrastructure. Approach this like infrastructure intended to last for years. Begin with Phase Zero.

---

## 2. CRITICAL ADDENDUM — VALIDATION BEFORE HUMAN TESTING

### ASSUME THE CURRENT INFRASTRUCTURE HAS NOT YET EARNED TRUST

The project owner has not personally performed even minor end-to-end validation of much of the custom indicator / custom screener infrastructure that has been built so far. That does NOT mean the infrastructure is defective. It means: **IT IS CURRENTLY UNVERIFIED FROM THE OWNER'S PERSPECTIVE.**

Do not interpret merged code, passing narrow unit tests, previous Claude reports, compatibility matrices, prior benchmark summaries, completed implementation tasks, as sufficient evidence that the complete product is reliable. This is especially important because previous internal measurements and blocker claims have already been discovered to be incorrect multiple times.

Therefore, Phase Zero and the subsequent validation phases must establish actual confidence from first principles.

**1. HUMAN TESTERS ARE NOT OUR FIRST LINE OF BASIC QA.** The owner intends eventually to hire/use real human testers to operate the website manually. However: do not use expensive human testing as a substitute for engineering verification that should happen first. Before broad manual human testing, the infrastructure should already have passed a substantial machine-assisted and engineering validation program. Human testers should find: confusing workflows, UX friction, unexpected user behavior, unclear terminology, difficult onboarding, browser-specific oddities, visual problems, accessibility issues, workflow combinations we did not anticipate, genuine exploratory edge cases. They should NOT be the first people discovering: Save does not work, imported indicators disappear after refresh, Pine formulas silently calculate incorrectly, scanner results use the wrong timeframe, a modal button is dead, an API returns 500, a numeric column cannot filter, a script reports successful import but cannot execute, a chart and scanner disagree, existing Custom Screens were broken by the new system, a previously saved artifact no longer loads. Those defects should be aggressively hunted before human acceptance testing.

**2. BUILD A CONFIDENCE LADDER.** No subsystem moves directly from IMPLEMENTED to READY FOR HUMAN TESTERS without intermediate evidence. Stages: LEVEL 0 — EXISTS (code/infra exists; says nothing about correctness). LEVEL 1 — UNIT VERIFIED. LEVEL 2 — INTEGRATION VERIFIED. LEVEL 3 — SEMANTICALLY VERIFIED (oracle/golden/property-based evidence for calculations). LEVEL 4 — END-TO-END VERIFIED (complete real product workflow, UI through persistence/execution/output). LEVEL 5 — ADVERSARIALLY VERIFIED (malformed inputs, boundaries, failures, resource limits, bad data, timeframes, sessions, recovery paths). LEVEL 6 — REGRESSION VERIFIED (existing UCT workflows still behave correctly). LEVEL 7 — PERFORMANCE/SCALE VERIFIED. LEVEL 8 — STAGING/PRODUCTION-LIKE VERIFIED. LEVEL 9 — HUMAN EXPLORATORY/ACCEPTANCE TESTING. LEVEL 10 — CONTROLLED RELEASE (feature-flagged/canary, observability + rollback). Refine based on repo reality but preserve the principle: confidence must be earned in stages.

**3. CREATE A VALIDATION COVERAGE MAP.** Matrix of major systems × {Exists?, Unit, Integration, Semantic, E2E, Adversarial, Regression, Performance, Human}. Systems include: Pine import, thinkScript import, TC2000 import, plain-English creation, screenshot recreation, canonical compiler, evaluator, Custom Screens, chart rendering, scanner execution, numeric columns, comparison/threshold UX, saved artifacts, editing, deletion, duplication, alerts, market-data fetches, timeframe handling, session handling, nightly scans, Run Now if present, error/refusal paths, migrations, backwards compatibility. Use actual executable evidence. If evidence does not exist: MARK IT UNVERIFIED. Do not infer a green box.

**4. DEFINE CORE GOLDEN USER JOURNEYS** before manual testing: Existing Screen (open → execute → verify → modify → save → reload → execute again); Pine Import (paste → detect → compile → preview → chart → save → reload → use in screener → verify output); thinkScript Import (same path); TC2000 Import (same path); Numeric Indicator (import/build → numeric column → sort → comparison → save condition → rerun); Boolean Screen (create/import → market scan → verify known fixture matches); Plain English (describe known formula → inspect interpretation → compile → verify semantics → execute); Screenshot (upload controlled known screenshot → infer → expose uncertainty → build candidate → verify output); Refusal (unsupported construct → verify explicit correct refusal, no misleading success); Timeframe Incompatibility (intraday-required formula in daily-only lane → verify correct block/explanation); Persistence (create → save → reload → artifact intact); Existing User Compatibility (representative legacy saved workflows before/after infra changes, compare behavior). Derive the real set from the product — not limited to these examples.

**5. TEST THE REAL FRONTEND, NOT ONLY THE BACKEND.** Use browser automation against the actual frontend once a workflow is implemented enough to exercise. Verify: what the member clicks, what appears, what network calls occur, what is persisted, what state survives reload, what errors appear, what happens on back navigation, what happens on retry, what happens with invalid inputs. Capture traces/screenshots where useful. Backend tests cannot prove frontend product reliability.

**6. CREATE A CLICKABLE-SURFACE INVENTORY BEFORE HUMAN QA.** Every meaningful interactive surface: primary/secondary buttons, Save, Cancel, Delete, Duplicate, Edit, Import, Compile, Retry, Apply suggested edit, language selector, timeframe selector, session selector, universe selector, numeric operator selector, threshold field, chart toggles, alert creation, menus, tabs, modals, dropdowns, context menus, settings, pagination, mobile controls. For each: it responds, produces the intended state, handles errors, does not corrupt adjacent state, persistence works where expected.

**7. USE AUTOMATED DIFFERENTIAL CHECKS WHERE TWO PATHS SHOULD AGREE:** chart value vs screener value for the same symbol/bar; preview vs saved-artifact execution; old engine vs new engine during shadow migration; UCT vs authoritative vendor golden where available. Unexpected divergence should block readiness claims until understood.

**8. CREATE KNOWN-ANSWER MARKET FIXTURES.** Deterministic synthetic bar datasets exercising trends, gaps, flat markets, missing bars, zero volume, split-like discontinuities, NaN/null, session boundaries, exact threshold values, crossing conditions, minimum lookbacks, large lookbacks — so the evaluator/screener pipeline can be tested without asking "is zero matches correct today?"

**9. VALIDATE NEGATIVE PATHS AS AGGRESSIVELY AS HAPPY PATHS:** malformed scripts, invalid function names, unsupported functions, type mismatches, excessive node counts, unbounded history, unavailable venue, unavailable timeframe, insufficient bars, data-provider failure, stale data, partial job failure, timeout, worker restart, duplicate job, interrupted save, bad screenshot, ambiguous screenshot, empty natural-language input, nonsensical natural language, conflicting parameters. No generic false-success state.

**10. FAILURE INJECTION.** Where practical, deliberately break dependencies in dev/staging: data provider unavailable, timeout, worker killed mid-scan, database call fails, partial result, rate limit, malformed provider response, cache unavailable. Observe: retries, idempotency, user-visible error, logging, trace, recovery, duplicate prevention.

**11. SCAN CORRECTNESS MUST BE VERIFIED, NOT INFERRED FROM HIT COUNT.** "17 stocks matched" is not proof. For controlled cases: select known symbols/data, compute expected matches, run the actual scan, compare exact symbol membership. Test false positives and false negatives — especially at universe scale.

**12. SHADOW EXISTING SCREENER BEHAVIOR WHERE CHANGES TOUCH IT.** Run old and new side-by-side where practical; generate discrepancy reports; classify every meaningful mismatch as intentional improvement / legacy bug corrected / new bug / data difference / semantic change / timing difference / unknown. Unknown mismatches should not be waved through.

**13. DO NOT LET 100% PASSING TESTS CREATE FALSE CONFIDENCE.** For high-value claims, ask "what evidence would falsify this claim?" "Pine RSI is compatible" needs more than passing unit tests. "Existing Custom Screens were not disrupted" needs actual legacy workflow comparisons. "Save works" needs actual persistence/reload behavior.

**14. MEASURE TEST QUALITY.** Inspect what current tests actually cover, whether assertions are meaningful, whether tests merely prove implementation against itself, fixture diversity, missing negative paths, integration gaps, flaky tests, disabled/skipped tests, mocks hiding real failures. Create a Test Credibility Assessment. Passing 5,000 low-value tests should not create more confidence than 100 strong tests that exercise real behavior.

**15. BUILD A RELEASE-BLOCKING CORE WORKFLOW SUITE.** Identify the small number of workflows that absolutely cannot break (existing Custom Screen execution, creation/import, save, reload, chart delivery, scanner delivery, correct refusals, numeric threshold workflow, data/timeframe correctness) and establish hard release gates that run automatically before high-risk merges/releases.

**16. NO KNOWN SILENT WRONG ANSWERS.** Before human acceptance testing: ZERO KNOWN SILENT SEMANTIC WRONG-ANSWER DEFECTS IN CORE SUPPORTED WORKFLOWS. A correct visible refusal is acceptable; a plausible-looking incorrect trading result is not. Any discovered silent wrong-answer bug receives high severity and blocks broad release until fixed or explicitly disabled/refused.

**17. REQUIRE OBSERVABILITY BEFORE LARGE-SCALE TESTING.** A human tester reporting "this scan seems wrong" must not require days of archaeology. Capture enough structured context to identify artifact, source door, compilation, execution lane, timeframe, session, data source, job, error, result within reasonable privacy constraints.

**18. HUMAN TESTING ENTRY GATE.** Before recommending external manual testers, provide a HUMAN TESTING READINESS REPORT: A. Core workflows tested. B. Automated test results. C. End-to-end results. D. Browser coverage. E. Semantic/vendor parity state. F. Existing-system regression results. G. Performance results. H. Known defects. I. Known unsupported behavior. J. Observability readiness. K. Rollback readiness. L. What specifically we want human testers to investigate. Then one recommendation: NOT READY FOR HUMAN QA / READY FOR LIMITED HUMAN QA / READY FOR BROAD HUMAN ACCEPTANCE TESTING. Do not recommend spending significant human testing time simply because implementation is "finished."

**19. HUMAN TESTER MISSION SHOULD BE PURPOSEFUL.** Different testers, different missions: Beginner Trader (create without scripting?), TradingView User (migrate familiar Pine workflows?), Thinkorswim User (migrate studies/scans?), TC2000 User (migrate PCFs?), Advanced Power User (discover limitations?), UX Explorer (confusing/misleading behavior?), Destructive Tester (break workflows via unexpected interaction?), Cross-Browser Tester (reproduce behavior elsewhere?). Human testing complements engineering verification, not duplicates it.

**20. OWNER CONFIDENCE IS A REQUIRED OUTPUT.** Not "Claude believes it works" — strong enough that the owner understands WHY the system is reliable. Use tables, test results, discrepancy summaries, benchmark runs, behavioral comparisons, known limitations, remaining risk. Never "Everything looks good" — instead "Here is what has been proven, how it was proven, what remains unverified, and what could still fail."

**21. DO NOT DELAY DISCOVERY OF REAL DEFECTS UNTIL THE END.** Validation happens continuously: build small increment → test → adversarial test → browser test → regression check → observe → continue. Do not build the entire ecosystem first and then begin QA.

**22. ADD THIS TO THE MASTER PROJECT DEFINITION.** Three equally important dimensions: CAPABILITY (can UCT do the workflow?), CORRECTNESS (does UCT produce the right result?), RELIABILITY (does the complete product keep doing it through real UI, data, persistence, execution, failure conditions?). A feature is not production-ready until all three are sufficiently demonstrated.

**FINAL INSTRUCTION.** In Phase Zero, determine how much of the current indicator/screener ecosystem is VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / KNOWN BROKEN. Do not assume implementation status equals reliability status. Build the validation program into the architecture plan from the beginning. The owner wants to reach human testing with confidence that the underlying infrastructure is already mechanically, semantically and operationally strong. Human testers should challenge a mature system, not discover whether the basic infrastructure works.

---

## 3. PROGRAM-SCOPE RECONCILIATION (2026-09-04, owner decision — governs how sections 1–2 apply)

During Phase Zero orientation, Claude discovered that this domain already has an approved architecture
(`docs/superpowers/specs/2026-07-31-indicator-platform-design.md`) with Phase A ("Signature Launch":
Dark Pool Levels, Flow-Confirmed Breakout, GEX Walls, append-only signal ledger) **already shipped and
live on `origin/master`** (`api/services/signature/*`), and ongoing, active Pine/thinkScript translation
work continuing past that document's date. The 7/31 document explicitly rules: *"A standalone
user-facing scripting language is killed as a product; its sandbox survives as plumbing for
AI-generated definitions."* This appeared to sit in tension with master-prompt §14–15 (Doors A/B/C,
native-DSL evaluation). Claude flagged this and asked the owner how to reconcile it. The owner's answer,
verbatim policy:

> Use Option 1 — Extend & harden the existing plan as the default operating posture, with the following
> important clarification:
>
> **THE EXISTING 7/31 INDICATOR PLATFORM PROGRAM IS THE BASELINE, NOT AN IMMUTABLE CONSTITUTION.**
>
> Treat the approved architecture, shipped Phase A work, existing proprietary/signature indicators, and
> ongoing Pine/thinkScript work as important existing product/infrastructure that should be preserved
> and extended unless evidence demonstrates a meaningful reason to change something.
>
> Do NOT perform a full reset. Do NOT reopen previously settled decisions merely because the new master
> prompt mentions the topic.
>
> However, Phase Zero should still independently establish:
> 1. what the 7/31 architecture actually intended,
> 2. what portions were actually implemented,
> 3. what portions shipped,
> 4. what has evolved beyond the original specification,
> 5. what is currently in flight,
> 6. whether current product behavior matches that architecture,
> 7. which decisions remain appropriate under the expanded objective,
> 8. which decisions may deserve reconsideration because there is genuinely new evidence.
>
> **SPECIFICALLY ON THE "NO STANDALONE USER-FACING SCRIPTING LANGUAGE" DECISION**
>
> Do NOT interpret the new master prompt as an instruction to reverse that decision. The owner objective
> is NOT necessarily to create another proprietary syntax that users must learn. The much more important
> goal is: **Give users a powerful first-class way to create custom indicators/scanners inside UCT while
> allowing them to use languages and mental models they already know — Pine, thinkScript, TC2000-style
> formulas, plain English, screenshots/recreation, and whatever canonical internal representation UCT
> needs underneath.**
>
> Therefore:
> - Preserve the prior "no standalone UCT scripting language as a product" decision for now.
> - Treat the master prompt's native-DSL section as a RESEARCH/HYPOTHESIS item, not a directive.
> - Only reopen that decision if Phase Zero uncovers specific evidence that a native authoring surface
>   would materially improve the product and cannot be achieved cleanly through the existing architecture.
> - Internal canonical grammar/IR is obviously different from exposing a new proprietary language to
>   users; do not conflate those concepts.
>
> **EXISTING SIGNATURE / PROPRIETARY INDICATOR WORK**
>
> The already-shipped Phase A signature-indicator system is especially important. Preserve it. Understand
> how it relates to the universal custom-indicator infrastructure. Ideally the new ecosystem should make
> the existing indicator world stronger rather than create a competing parallel architecture. Investigate
> whether signature indicators, imported indicators, user-created indicators, custom screens, scanner
> conditions, and chart studies can increasingly share infrastructure underneath while preserving their
> appropriate product distinctions. Do not force convergence where it would harm existing behavior, but
> look for genuine architectural leverage.
>
> **ON CONFLICTS WITH PRIOR DECISIONS** — policy:
> - Prior decision + no new contrary evidence → preserve it.
> - Prior decision + master prompt merely raises an option → do not reopen automatically.
> - Prior decision + new measurable evidence creates a genuine tension → document the evidence and bring
>   the concrete decision to owner/ChatGPT review.
> - Existing implementation differs from the old approved specification → treat current code/runtime
>   behavior as evidence, determine why it diverged, and do not automatically "correct" it back to the
>   document. Consistent with repo/runtime truth > historical documentation, while still respecting
>   deliberate prior architectural decisions.
>
> **THE EXPANDED SCOPE REMAINS REAL.** The existence of the 7/31 program does not reduce the ambition of
> the new project — deeper Pine/thinkScript/TC2000 compatibility, plain-language creation, screenshot
> recreation, creation inside UCT, shared chart/screener/alert infrastructure, semantic verification,
> market-data/timeframe execution, Run Now/intraday where justified, editor/UX quality, telemetry,
> browser testing, observability, migration safety, performance, reliability, competitive migration all
> remain in scope — but build on top of and through the strongest existing UCT architecture wherever
> possible, rather than creating a second indicator platform beside the first one.
