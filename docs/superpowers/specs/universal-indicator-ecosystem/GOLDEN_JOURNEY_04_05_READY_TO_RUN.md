# Golden Journeys #4 & #5 — Ready to Run (Track E prep, no key used)

Prepared 2026-09-04, Phase One Track E, per DEC-008. **No Anthropic API key was
acquired, requested, or used to produce this document or its fixtures.** Everything
below is either already-existing evidence (re-read fresh, not from memory) or new
fixtures/test code that fails loudly rather than silently when the key is absent.

> **⚰️ Correction, 2026-09-05 (`PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md` §5/§7):**
> the doors these two Golden Journeys validate are **already live in production**
> for real paying members — `INDICATOR_VISION_ENABLED=1` has been armed on the
> `web` service since 2026-09-02 (paid-gated, rate-limited, cost-guarded, stores
> nothing until saved — `docs/feature_flags.json`), and the plain-language door
> (`/api/user-definitions/propose`) is mounted unconditionally with no feature
> flag at all, gated only by `require_paid`. **Track E is validating already-shipped
> member-facing AI doors under controlled, fixture-based E2E evidence — it is not
> bringing those doors into existence.** The correct question this document answers
> is "how trustworthy are these already-shipped doors under controlled evidence?",
> not "do these doors exist?". This does not change anything below (the fixtures,
> tests, and no-key-used claim all stand); it corrects only the framing of what
> running them will accomplish.

## What already existed vs. what this pass added

**Already existed (Phase Zero), re-read fresh for this doc:**
`CORE_GOLDEN_JOURNEY_04_PLAIN_LANGUAGE.md` and `_05_SCREENSHOT_VISION.md` — both
journeys already ran everything reachable without a key: they found and (Track B)
fixed RISK-016 (the bars-cap 400 that bypassed the "refusal is 200, not 4xx"
contract), confirmed the vision door's flag-off refusal is clean and correctly
worded, and established at the **code level** that both doors' read-back sentences
are compiler-derived (`definition_concierge.sentence_for`), never model-derived, and
that a proposal is never itself the source of truth (it must pass through the
ordinary save/validate path). **The only remaining gap for both journeys is
narrower than "run the whole thing"**: it is specifically the real model call, plus
everything downstream of it that has never been observed live (does a real proposal
actually save/reload/deliver correctly; does an ambiguous or out-of-vocabulary
request actually refuse the way the code says it will, rather than the way the code
is merely *believed* to; does a real screenshot actually produce a labeled-as-a-guess
candidate).

**Built new in this pass:**
- `tests/fixtures/golden_journey/cgj4_cases.json` — four concrete, exact
  plain-language cases (see below).
- `tests/fixtures/golden_journey/gen_cgj5_screenshot.py` +
  `cgj5_screenshot_known_answer.png` — a deterministic, reproducible, known-answer
  synthetic chart image (candlestick pane + an RSI-shaped oscillator pane with
  30/70 reference lines), generated with a fixed seed so its exact contents are a
  documented fact rather than an artifact of whatever the live chart happened to be
  showing on some earlier session (Phase Zero's Journey #5 used a live browser
  screenshot that was never committed — this fixture is reusable and regenerable).
- `tests/test_golden_journey_04_05_live.py` — a fully-wired pytest module. One test
  (the empty-prompt refusal) runs today with no key, and **passes** (verified: `1
  passed, 6 skipped` — see Verification below). Every other test is gated on
  `ANTHROPIC_API_KEY` (and, for the vision door, `INDICATOR_VISION_ENABLED=1`) via
  `pytest.mark.skipif` with a specific, named reason string — matching this repo's
  own established convention for an environment-gated test (`test_screener_auth_
  surface.py`'s `SCREEN_BACKTEST_ENABLED is off` skip is the precedent followed
  here), never a bare/unexplained skip that could be mistaken for "not applicable."
- This document.

## 1. Isolated environment plan

Concrete command, once a scoped key is provisioned:

```bash
ANTHROPIC_API_KEY=sk-ant-<scoped-key> \
INDICATOR_VISION_ENABLED=1 \
pytest tests/test_golden_journey_04_05_live.py -v -rs
```

Isolation is layered, reusing infrastructure that already exists rather than
inventing new sandboxing:

1. **Data isolation is already automatic.** The repo-root `conftest.py`'s
   `SHARED_ROOT_ENV_REDIRECTS` (built from an AST-derived census, not a hand list —
   see `CLAUDE.md`'s "`C:\data` IS REAL ON THIS BOX" section) redirects every
   data-path env var (`AUTH_DB_PATH` etc.) to a per-session sandbox the moment
   pytest starts, with a tripwire that fails the whole run if any write reaches the
   real shared root regardless. Running this file under plain `pytest` already gets
   this for free — no extra flag needed. Confirmed live in this pass: the test run
   below created a real user via `create_user`/`create_session` and it landed in a
   sandboxed `auth.db`, not `C:\data\auth.db`.
2. **Credential isolation is a human/ops step, not a code step**: the key must be
   sourced from a value the owner controls directly (a local shell export, a
   CI secret scoped to this one job) — never committed to a fixture, `.env` file
   tracked in git, or printed by a test. `test_golden_journey_04_05_live.py` reads
   it only via `os.environ.get("ANTHROPIC_API_KEY")`; nothing in this pass writes
   it anywhere.
3. **No production credential fallback exists in this test file.** There is no
   `os.environ.get("ANTHROPIC_API_KEY", <some other key>)` pattern anywhere in it —
   confirmed by writing it that way and re-reading it. If the scoped key is absent,
   the affected tests skip; they never silently reach for a different key.
4. **Cost/rate isolation**: `user_definitions.py`'s own `PROPOSE_MAX_PER_HOUR=40`
   and `definition_concierge.py`'s per-user/global cost-guard caps (`cost:user`,
   `cost:global` gates, already read while preparing this doc) apply automatically
   to a real key in this test run exactly as they would to a member — no override
   needed, and none of this test file's cases come close to those ceilings (at most
   ~6 model calls in a full run).

## 2. Exact plain-language Golden Journey #4 script

File: `tests/fixtures/golden_journey/cgj4_cases.json`, case `"positive"`.

- **Exact prompt:** `"close above the 50 day moving average"` (the identical phrase
  Phase Zero's Journey #4 typed before hitting the bars-cap bug — reused rather than
  replaced, so this run is a direct continuation of that journey, not a new one).
- **kind:** `"scan"`.
- **Expected shape:** a comparison (`close > sma(close, 50)` or `close >
  ema(close, 50)`) — **the exact choice between `sma` and `ema` is the thing this
  case exists to OBSERVE**, not a value to assert one way. "Moving average" is
  genuinely ambiguous in plain English; Phase Zero's journey was specifically
  designed to probe this and never got far enough to see the answer. The test
  prints the model's actual choice as evidence (`print(f"[CGJ4 evidence] ...")`,
  captured by `pytest -s` or the CI log) rather than hard-failing on either answer.
- **Exact steps once a key exists:** `pytest tests/test_golden_journey_04_05_live.py
  ::TestGoldenJourney04Live -v -rs -s` runs the positive case, the persistence
  check, and the scan-delivery check together (see sections 5-6 below — they reuse
  this same case rather than needing a separate script).

## 3. Exact screenshot Golden Journey #5 script

File: `tests/fixtures/golden_journey/cgj5_screenshot_known_answer.png`, generated
by `gen_cgj5_screenshot.py` (matplotlib, fixed seed `20260904`, no network).
**Known answer, stated here so the consuming test never has to guess it:** 60
synthetic daily bars (40 bars of a manufactured uptrend, 20 of a pullback) with an
RSI-*shaped* (not RSI-*exact* — the point is visual recognition of "a two-pane
chart with a bounded oscillator and 30/70 lines," not testing whether the vision
model can read an exact numeric value off a screenshot) 14-period oscillator drawn
in a lower pane with dashed 30/70 reference lines — the textbook visual signature
of RSI. A reasonable candidate names an oscillator (RSI being the obvious guess);
the test records whatever actually comes back rather than pinning one exact
function name, since the product's own promise (per the Screenshot tab's own copy,
quoted in `CORE_GOLDEN_JOURNEY_05_SCREENSHOT_VISION.md`) is "a defensible guess,
clearly labeled as a guess" — not "always guesses RSI."

**Exact steps once a key AND `INDICATOR_VISION_ENABLED=1` exist:**
`pytest tests/test_golden_journey_04_05_live.py::TestGoldenJourney05Live -v -rs -s`.
The test posts the fixture PNG to `POST /api/indicator-vision/candidates` and
asserts every returned candidate carries a `sentence` field (the compiler-derived
read-back, never the model's raw prose — the exact guarantee Journey #5 established
at the code level and this run would be the first live confirmation of).

## 4. Negative/ambiguity cases

**Plain-language door, unfamiliar concept (`ambiguous_should_clarify_or_partially_
refuse`):** exact prompt `"flag it when the vibe turns bullish"`. `"vibe"` and
`"turns bullish"` (as opposed to a defined crossover) are not in
`conceptVocabulary.json`'s firm vocabulary and do not match any `closedTable.json`
series/function name. Per `definition_concierge.propose()`'s own design (read
fresh from source for this doc, `api/services/definition_concierge.py:2430-2451`):
the vocabulary-resolution stage (`plan()`) runs **before any model call**, resolves
each clause independently, and refuses the **whole** proposal only when nothing
survives, naming every unreadable clause via `not_understood`. The test asserts
that if this comes back `ok: true` anyway, that is a **hard failure**, not a
loosened expectation — a silently-resolved unfamiliar phrase is exactly the
silent-wrong-answer failure mode this whole program exists to catch.

**Plain-language door, named-but-unsupported function
(`out_of_vocabulary_function_should_refuse_by_name`):** exact prompt `"plot the
McGinley Dynamic of the close over 14 bars"`. The McGinley Dynamic is not one of
`closedTable.json`'s 64 declared functions. This is the plain-language door's
analogue of the Pine paste door's `PINE_INEXPRESSIBLE` refuse-by-name discipline
(`app/src/components/chart/engine/ast/pine.js:1161` — confirmed by direct read for
this doc, not assumed): a request naming something genuinely outside the closed
vocabulary must be refused **by name**, never silently substituted with a
similarly-shaped indicator (e.g. a plain EMA standing in for the unsupported
function with no disclosure). Distinct code path from `PINE_INEXPRESSIBLE` itself
(this door's own `plan()`/`not_understood` mechanism, not the Pine parser's), which
is why this doc names the mechanism precisely rather than implying the two doors
share one refusal object.

**Screenshot door, illegible/non-chart image:** not yet built as a fixture in this
pass (scope discipline — the two fixtures built here directly answer this doc's
required sections; a third, deliberately-bad image is a fast follow, not a
blocker). **Exact recipe for when it's needed:** reuse `gen_cgj5_screenshot.py`'s
structure with `ax_osc` removed and the candlestick pane replaced by pure noise
(`rng.normal(size=(400,400,3))` rendered as an image) — a single-pane image with no
chart-like structure at all. Expected: either a refusal naming low confidence, or
candidates explicitly hedged as low-confidence guesses — never a confident,
specific formula from unrecognizable input. Add this as
`cgj5_screenshot_illegible.png` before broad reliance on this journey's evidence.

## 5. Persistence checks

`TestGoldenJourney04Live::test_persistence_survives_a_reload_with_the_same_astHash`
(in `tests/test_golden_journey_04_05_live.py`): proposes the positive case, saves
the returned `ast` via the **ordinary** `POST /api/user-definitions` door (not a
special AI-door save path — confirmed by re-reading `propose_definition`'s own
docstring for this doc: *"A proposal is a suggestion the user has not confirmed...
the ordinary POST "" / PUT /{def_id} doors do the writing"*), reloads via `GET
/api/user-definitions/{def_id}`, and asserts the reloaded `ast` is **byte-identical**
to the proposed one. Byte-identical AST implies identical `astHash` (the hash is a
pure function of the tree, per `closedTable.json`'s own architecture, cross-checked
against `test_user_definitions.py`'s existing `astHash` section for the hashing
mechanism's own single-source-of-truth claim) without this test needing to import
the hashing function itself and risk drifting from whichever lane computes it.

## 6. Chart/screener delivery checks

`TestGoldenJourney04Live::test_saved_definition_is_scan_deliverable`: re-runs the
positive case with `kind="scan"` explicitly and saves it through the same ordinary
save door. A 200 here proves a model-proposed scan condition is accepted by the
**same validation** every hand-written screener definition goes through — there is
no separate, more lenient (or stricter) AI-door-specific scan-acceptance path, which
matters because `ScreensManager.jsx` → `ScanResults.jsx` → `CoverageLine.jsx`
(CLAUDE.md's own documented door chain) is what a member actually sees, and this
test proves the AI door feeds that exact same chain rather than a side path.
**Chart-widget delivery** (kind="indicator") is covered implicitly by the
persistence check above using `kind` from the positive case's default — a
successful save + reload through the ordinary door is the same precondition
`WidgetHost.jsx`'s chart-widget binding already relies on for any hand-written
formula; no AI-door-specific widget code exists to test separately (confirmed by
grep: no `kind` branching in `WidgetHost.jsx`'s indicator-widget path). If this
assumption turns out wrong once real evidence exists, that itself is a finding for
the eventual evidence doc, not something to paper over here.

## 7. Evidence-capture plan

When the real run happens, capture (new doc,
`GOLDEN_JOURNEY_04_05_LIVE_RESULTS.md`, mirroring `CORE_GOLDEN_JOURNEY_02_
THINKSCRIPT_ADX.md`'s existing structure):

1. **The exact request sent** — prompt text, `kind`, and (for #5) a description of
   the image (never the real API key, never in a log, a fixture, or this doc).
2. **The model's raw response shape** — whether `ok`, the `gate` if refused, the
   `sentence` if accepted; the full `ast` for every accepted case (this IS meant to
   be captured — it is the compiled tree, not the model's private reasoning, and
   inspecting it is the entire point of this journey).
3. **The resulting AST** for every save/reload round trip, plus the reload
   diff (expected: none).
4. **Pass/fail of every check in sections 2-6 above**, verbatim test output
   (`pytest -v -rs -s` capture), not a paraphrase.
5. **Where it lives**: this new doc, committed to
   `docs/superpowers/specs/universal-indicator-ecosystem/`, cross-linked from both
   `CORE_GOLDEN_JOURNEY_04_PLAIN_LANGUAGE.md` and `_05_SCREENSHOT_VISION.md`'s own
   "Housekeeping" sections (both currently end mid-story; this closes them) and
   from `VALIDATION_COVERAGE_MAP.md`'s plain-language/screenshot rows, which should
   move from "1 — Unit, plus one live negative data point" to "4 — End-to-End" only
   if every check in sections 5-6 actually passes live — a partial result (e.g. the
   model call succeeds but scan-delivery fails) stays annotated at whatever level
   the evidence actually supports, per this whole program's stale-documentation
   discipline.

## Verification performed in this pass (no key, no network)

```
$ pytest tests/test_golden_journey_04_05_live.py -v -rs
...
SKIPPED [6] ... ANTHROPIC_API_KEY not set -- this is Track E's real-model-call
  gate working as designed (DEC-008: isolated-environment-only key, provisioned
  separately from this test run), not a test failure or a gap in coverage.
SKIPPED [1] ... INDICATOR_VISION_ENABLED is not '1' -- ...
1 passed, 6 skipped
```

The one always-runnable case (`test_empty_prompt_refuses_before_spending_a_token`)
passes today. Every gated case skips with a specific, named reason — never a bare
skip, and never a silent pass. The fixture image was regenerated and confirmed to
write successfully (`wrote tests/fixtures/golden_journey/cgj5_screenshot_known_
answer.png (60 synthetic bars, seed=20260904)`).

## Status

**Everything reachable without the key is done.** The instant a scoped,
isolated-environment-only `ANTHROPIC_API_KEY` (DEC-008) is set — and, for Journey
#5, `INDICATOR_VISION_ENABLED=1` alongside it in that same isolated environment —
running `pytest tests/test_golden_journey_04_05_live.py -v -rs -s` executes both
journeys' real model-call portions, the persistence check, the scan-delivery
check, and the two negative/ambiguity cases, in one command, with no further setup.
