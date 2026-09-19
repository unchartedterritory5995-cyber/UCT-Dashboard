# Golden Journey #4/#5 — Live Results

Real Anthropic model-call round trips for Journey #4 (plain-language door) and Journey #5
(screenshot door), Phase One Track E (DEC-008). Two runs, same day (2026-09-05), with a
genuine product fix in between — this document reviews the SECOND, corrected run in full;
the first run's failures and their root-cause/fix are recorded separately in `RISK_REGISTER.md`
and `PROGRESS.md` (search "Track E semantic-safety") rather than duplicated here.

**Run:** `20260905-164214` — full log: `tools/_track_e_runs/golden_journey_04_05_20260905-164214.log`,
mechanically-extracted evidence: `tools/_track_e_runs/golden_journey_04_05_20260905-164214.evidence.json`
(both gitignored, local-only — quoted verbatim below for the permanent record).
**Command:** `python tools/track_e_run_golden_journey.py` (a scoped, isolated-environment-only
dev/test Anthropic credential per DEC-008 — never the production key — `ANTHROPIC_API_KEY` +
`INDICATOR_VISION_ENABLED=1` set by the owner directly in a local shell this session never had
access to; cleared immediately after the run).
**Result:** `7 passed, 0 failed` — every case, no skips (both gates were open for this run).

## The chain, with evidence at each step

| Step | Result | Evidence |
|---|---|---|
| 1. Empty prompt refuses before spending a token | **PASS** | `test_empty_prompt_refuses_before_spending_a_token` — `ok:false`, `gate:"prompt:empty"`, asserted before any model call is even reachable (no `ANTHROPIC_API_KEY` needed for this case at all) |
| 2. Positive case → real model call → canonical AST | **PASS** | Prompt `"close above the 50 day moving average"` → real `claude-opus-5` call → `ast = {op ">" [series "close", call "sma" [series "close", num 50]]}`, `source = "(close > sma(close, 50))"`, `sentence = "1 when close is greater than (the 50-bar average of close) and 0 otherwise"`. The model picked **sma**, not ema, for the underspecified phrase "moving average" — a defensible reading per this case's own note in `cgj4_cases.json` (both are acceptable; sma is the more literal/default reading of unqualified "moving average") |
| 3. Ambiguous language → model self-reports, does not guess | **PASS** | Prompt `"flag it when the vibe turns bullish"` → `ok:false`, `gate:"model:unresolved"`. This is the model's OWN required self-report (`unresolved` field, added same day as the fix — see below) firing correctly on real live input: given the explicit instruction to name any phrase it could not confidently ground, the model named this one rather than inventing a formula. This is the exact prompt that returned `ok:true` with an invented formula on the FIRST live run, before the fix |
| 4. Unsupported named function → refused BY NAME | **PASS** | Prompt `"plot the McGinley Dynamic of the close over 14 bars"` → `ok:false`, `gate:"concept:ungrounded"`, reason: `"McGinley Dynamic" is not one of this door's supported functions or concepts, so there is no formula to expand it into.` This is the PURE-CODE gate (`_named_phrases`, proper-noun-shaped-phrase detection) firing — deterministic, not dependent on the model's cooperation; the refusal happens inside `plan()` before any model call, confirmed by the earlier non-live regression suite (`test_the_named_phrase_refusal_still_happens_before_any_model_call`). This is the exact prompt that returned `ok:true` with a silently-substituted EMA on the FIRST live run, before the fix |
| 5. Persistence survives a reload with the same astHash | **PASS** | `test_persistence_survives_a_reload_with_the_same_astHash` — propose → save (`compute: {kind:"ast", ast:<tree>}`, the corrected schema shape found by this same live-testing pass) → reload → `reloaded["definition"]["compute"]["ast"] == proposed["ast"]`, byte-for-byte, through the real SQLite store |
| 6. Saved definition is scan-deliverable | **PASS** | `test_saved_definition_is_scan_deliverable` — the same positive-case tree, proposed as `kind="scan"`, saves through the ORDINARY save door with no AI-door-specific validation path, confirming the funnel every screener surface reads from accepts a model-proposed condition |
| 7. Screenshot → real vision call → defensible, honestly-confidence-labeled candidates | **PASS** | `cgj5_screenshot_known_answer.png` (synthetic RSI-shaped oscillator pane) → real vision call to `claude-opus-5` (12,249 input / 870 output tokens, $0.082995) → 3 ranked candidates: **RSI(14) of close, confidence 88** (correct — matches the fixture's known answer), a same-shape alternative using typical price at confidence 8, and Stochastic %K at confidence 4. Every candidate carries a compiler-derived `sentence`/`source`, never raw model prose (`concierge._validate` ran on each). The confidence spread is itself evidence of honest calibration: the model did not manufacture false certainty for two structurally-plausible-but-visually-weaker alternatives |

## Reviewer judgment (completed from the executable evidence above, not mechanically)

- **Ambiguous-prompt case:** the model correctly refused rather than silently guessing.
  Quoted response: `ok=False gate=model:unresolved not_understood=[]` (the empty
  `not_understood` confirms this is the MODEL's own self-report firing, not `plan()`'s
  separate pre-model vocabulary excision — the two mechanisms are independently
  distinguishable in the evidence, and this run exercised the model-contract one).
- **Positive case:** the model picked **sma(close, 50)** for "the 50 day moving average."
  Defensible — sma is the literal, unqualified default reading; ema would also have been
  acceptable per the fixture's own design note, but nothing here indicates a fabricated or
  unreasonable choice.
- **Screenshot case:** named **RSI(14) of close** (confidence 88, correct) as the primary
  candidate, with two lower-confidence alternatives (8, 4) offered honestly as
  "cannot be ruled out from the picture" / "low-probability alternative" rather than
  suppressed or overstated. The confidence labeling is honest about being a guess where it
  is one, and confident where the visual evidence (0–100 bounds, 70/30 guides, Wilder
  smoothing) genuinely supports it.
- **Scope limits — what this run did NOT cover** (mirroring
  `CORE_GOLDEN_JOURNEY_02_THINKSCRIPT_ADX.md`'s own convention):
  - Only ONE ambiguous phrasing and ONE unsupported-named-function phrasing were exercised
    live. Broader generalization across many phrasings/names was proven non-live only
    (`tests/test_definition_concierge.py::TestSemanticCoverageGate`, 10 tests, novel prompts
    never used in this live run — "Coppock Curve", "Fisher Transform", "the setup looks
    amazing", etc.) — not re-proven with additional live spend, per the standing instruction
    not to loop live runs.
  - The `unresolved` self-report gate's reliability was observed to work correctly ONCE,
    live. It remains, by design and by explicit prior disclosure, dependent on the model
    honestly reporting its own uncertainty — this run is evidence it behaved honestly here,
    not proof it always will. The pure-code named-phrase gate carries no such caveat.
  - No repair-loop (multi-attempt) case was exercised live — every case here resolved in
    one model call.
  - No multi-turn conversation, no concurrent-request, no cost-cap-boundary, and no
    non-English-input behavior was exercised.
  - Editing a previously-saved definition, sharing, and the screener's actual scan-execution
    path (beyond "the save door accepts it") are separate journeys, not this one.
- **Does this run clear the evidence bar for `VALIDATION_COVERAGE_MAP.md`'s plain-language/
  screenshot rows to move to "4 — End-to-End"?** **Yes, scoped precisely to what was
  tested**: a real member-facing prompt, a real model call, a real canonical-AST
  compilation and validation, a real persistence/reload round trip, and — newly — a real,
  live-fired demonstration of both semantic-safety mechanisms discovered and fixed this
  same day. See `VALIDATION_COVERAGE_MAP.md` for the exact row-level wording; this is not a
  claim that every possible plain-language phrasing or every possible screenshot has been
  exercised live, only that the golden path plus its two known failure modes now have real,
  live, passing evidence where before there was none.

## The semantic-safety defect found and fixed this same day

The FIRST live run (`golden_journey_04_05_20260905-145122.log`, superseded by this one)
returned `6 failed, 1 passed`. All six failures shared one fixture-level root cause (a
missing `catalyst.store`/`user_definitions` schema-init in the test's `client` fixture,
fixed first) — but fixing that surfaced two REAL, independent product defects that had never
been reachable before:

1. **Unsupported named-function silent substitution.** `"plot the McGinley Dynamic..."`
   returned `ok:true` with a silently-substituted EMA tree.
2. **Ambiguous-language silent guessing.** `"flag it when the vibe turns bullish"` returned
   `ok:true` with an invented formula.

Both share one root cause: `definition_concierge.plan()`'s vocabulary matcher only acts on
text it explicitly recognizes; anything unrecognized was silently passed to the model as
ordinary prose with no signal that grounding had failed. Two general, non-blacklist fixes
closed this:

- **`_named_phrases()`** — a run of two-or-more proper-noun-shaped words not already
  grounded is excised the same way an already-refused concept is (reusing
  `concept_vocabulary.GATE_UNGROUNDED`). **Pure code — no model input can bypass it.**
  Proven live in case 4 above, and proven pre-model (the model is never even consulted)
  in the non-live suite.
- **A required `unresolved` tool-schema field.** The model must now explicitly list any
  phrase it could not confidently ground, on every answer. `propose()` refuses,
  deterministically and without a retry, whenever it is non-empty. Proven live in case 3
  above.

**Disclosed, remaining limitations (not closed by this fix, stated rather than hidden):**
- A single-word unsupported proper name (e.g. "Aroon") is not caught by the two-or-more-word
  named-phrase heuristic.
- The `unresolved` self-report mechanism depends on the model honestly reporting its own
  uncertainty; a schema-required field is a materially stronger contract than free-text
  prompting, but is not proof against a model that confidently mis-reports `unresolved: []`.

Full root-cause narrative, the reverted first-attempt design (a syntactic
"any-unanchored-clause-refuses" check, proven too broad against this module's own
pre-existing test suite), and the complete non-live regression evidence are in
`RISK_REGISTER.md` and `PROGRESS.md`.
