# Core Golden Journey #1 — Pine RSI Import → Chart → Save → Reload → Screener

Satisfies addendum item 4 (Core Golden Journeys), item 5 (real frontend, not backend-only), item 9
(negative path), and the master prompt's proof-chain requirement (§8). This is the first real,
browser-driven, end-to-end verification pass in this program — everything before this document was
code/test-level evidence only (see `CURRENT_ARCHITECTURE.md`'s "what's still unknown" section, now
partially resolved).

## Environment (read this before trusting anything below)

- Isolated backend: `uvicorn` launched via a throwaway script that imports `conftest.py` before the app,
  triggering its `SHARED_DATA_ENV_PINS` redirect (normally pytest-only) so every shared-root data path —
  `AUTH_DB_PATH` included — resolved to a fresh temp sandbox, not live `C:\data`. Verified by reading the
  full 48-variable redirect log at startup before doing anything else. Port 18420 (chosen after confirming
  8000, 8077, and 8099 were already bound by other processes on this machine — one, PID 42084 on 8077,
  had been running continuously since 2026-08-31, matching a known "stale backend on live data" hazard
  from prior sessions; none of these were touched).
- Isolated frontend: `vite --port 15173`, with `vite.config.js`'s hardcoded `/api` proxy target
  temporarily pointed at 18420 instead of the occupied 8000. **Reverted exactly** before this document
  was written — confirmed via `git diff` returning empty.
- Auth: fresh account `phasezero@local.dev` created via `POST /api/auth/signup` against the isolated
  backend, auto-promoted to admin (`ADMIN_EMAILS`), `paid_equiv: true` — no paid-plan gate encountered.
- The sandbox starts **empty**: no seeded market universe, no nightly snapshot data, no `MASSIVE_API_KEY`.
  This is deliberate (per the isolation mechanism) and shapes what this journey could and couldn't reach —
  called out explicitly at each step rather than assumed.
- Both background processes (backend, frontend) were stopped via `TaskStop` after this journey completed.

## Fixture

`tests/fixtures/pine/07-rsi.pine` — a real, 97-line, GPL-licensed vendor Pine v3 script (RSI by Alex
Orekhov/everget), chosen because: (a) it's a real corpus fixture, not hand-written for this test, so its
expected classification is independently anchored in the repo's own test suite; (b) confirmed via a live
`vitest --reporter=verbose` run immediately before starting that it sits in the currently-translating
bucket ("parses, budgets, lints, reads back and may be saved" — 3 assertions, all green); (c) it exercises
real translation complexity (a user-defined function with a 19-branch string-keyed source selector, 5
typed inputs, `hline`/`fill` visual pragmas) rather than a trivial constant expression; (d) RSI(close,14)
is a well-known, independently-checkable computation.

## The chain, with evidence at each step

| Step | Result | Evidence |
|---|---|---|
| 1. Real UI, paste | **PASS** | `BuilderSheet` → Indicators → "New formula" → Import tab, real textarea, pasted via one-shot value-set (see "Typing vs. pasting" below) |
| 2. Detection | **PASS** | Import tab's own placeholder names Pine/thinkScript/TC2000 as accepted dialects; syntax-highlighted read-back rendered Pine-correct coloring (`study`, `input`, string literals) |
| 3. Translation | **PASS, correct** | Clicking "Use this formula" produced canonical `rsi(close, 14)` — correctly resolved the `getBaseSource` indirection to its default branch (`srcInput="close"`) and inlined `length`'s default (14). Screenshot evidence captured. |
| 4. Canonical representation | **PASS** | "THIS IS WHAT WILL BE COMPUTED: the 14-bar RSI of close — 3 nodes · 14-bar lookback · 1 series" plus an explicit "✓ Non-repainting" badge with a plain-English explanation — matches master-prompt §19's execution-requirement-contract concept and §41's "here's what UCT understood," live and correct, not aspirational |
| 5. Validation | **PASS** | `LEVELS: 70, 30` auto-populated from the script's `obLevel`/`osLevel` defaults; `PLACEMENT: Own pane` correctly inferred for an oscillator |
| 6. Preview | **PASS** | Live chart preview rendered inside the dialog before saving |
| 7. Chart delivery | **PASS, semantically plausible** | Real subplot pane rendered on the live SPY chart, "RSI Import 55.34" legend label, line oscillating in a visually sane ~20–70 band given SPY's rendered price action. **Not independently recomputed to exact precision** — this is a directional/plausibility check, not a known-answer numeric match. Flagged as a gap, not claimed as more than it is. |
| 8. Save/persistence | **PASS, with a real bug found (see Findings)** | "✓ Saved — version 1, rev 1." confirmation; entry appeared under "YOUR FORMULAS" |
| 9. Reload | **PASS, clean** | Full page reload (`navigate`, not SPA nav): indicator reappeared automatically, single clean instance, value refreshed to 55.39 (proving live recomputation, not a cached image) |
| 10. Screener reach | **PASS, correctly gated** | The pure-numeric `rsi(close,14)` artifact was correctly refused a screener role ("1 saved formula cannot be a screen yet") — see Findings for why this refusal is itself strong positive evidence |
| 11. Screener execution | **ENVIRONMENT-BLOCKED, not a defect** | See "Screener execution" section below |
| 12. Negative path | **PASS, correct refusal** | See "Negative-path test" below |

## Typing vs. pasting — a real, if narrow, reliability finding

Character-by-character `type`-ing the full ~2KB script into the paste textarea coincided with the browser
tab becoming unresponsive (CDP `Page.captureScreenshot` timing out at 5s and once at 30s; the page's own
live clock stopped advancing during this window) on two separate occasions. Setting the same content in
one shot via a direct value-set (`form_input`, functionally equivalent to a real user's Ctrl+V paste)
worked instantly, both times, with no hang. **This means the primary real-world interaction (paste) is not
implicated** — nobody pastes a script one keystroke at a time — but very fast/scripted typing into this
field is a genuine, reproduced (2/2) soft spot. Not filed as a user-facing bug; filed as a note for anyone
building further automation against this dialog. A separate, large (25-tick) scroll inside the syntax-
highlighted read-back panel also coincided with one non-recovering-within-budget hang, consistent with
that panel being expensive to repaint under rapid interaction. See RISK-011.

## Findings (new, from this journey)

**RISK-012 (real defect, minor): double-clicking Save creates a duplicate chart instance.** Clicking Save
twice on the same "New formula" dialog created two identical rendered instances on the chart AND two
identical rows under "YOUR FORMULAS" (confirmed via screenshot both in the dialog's own list and on the
live chart legend). The button does not disable itself or debounce during the save round-trip. Deleting
one of the two duplicate *definitions* left one duplicate *chart instance* behind (only cleared on a full
reload) — the two are not tightly coupled at delete time. Neither duplicate corrupted the surviving,
correctly-persisted single instance (confirmed clean after reload). Severity: S3 (degraded, self-inflicted
by double-clicking, not silently wrong) — logged, not fixed, per the Phase Zero authorization's "no broad
fixes" instruction.

**Positive finding: input/parameter fidelity is partial, and this is worth tracking, not alarming.** The
original script's five `input()`-declared, member-adjustable parameters (`length`, `obLevel`, `osLevel`,
`highlightBreakouts`, `srcInput`) did not carry over as adjustable inputs on the saved artifact — only
`length`'s and the two levels' *default values* did (as literals in the formula and as the `LEVELS` field,
respectively). "INPUTS YOU CAN CHANGE LATER: None yet" was shown throughout. This is a real translation-
fidelity gap relative to the source script, not a bug (nothing crashed, nothing lied) — logged as RISK-013
for the eventual capability matrix; whether auto-detecting which Pine `input()`s should become adjustable
inputs is in scope for a future phase is a product question, not resolved here.

**Positive finding: the numeric-vs-boolean screener gate is correct, and there's real institutional memory
behind it.** `api/routers/user_definitions.py`'s `_stamped()` docstring documents a real, since-fixed
historical incident (referenced as "X88"): a numeric formula (`macd(close,12,26)`) was once let through to
"Use as filter" by a client-side check that only verified `compute.ast` shape, not real scannability. The
nightly sweep correctly refused it (`[gate:yields] this tree returns a number, not a 0/1 column`), but
because a refused definition "never earns a receipt," the UI chip stayed stuck reading "first sweep
tonight" **forever** — a real, historical instance of exactly the silent-forever-pending failure mode
addendum §16 warns about. The fix moved the scannability check server-side (`assert_scannable`, the same
canonical check used at evaluation time) so the list endpoint stamps the *correct* answer up front. This
program's own test today reproduced the *fixed* behavior cleanly: a pure-numeric artifact (`RSI Import
Test`) was correctly refused up front with a clear message; a boolean one (`RSI Above 50 Screen`,
`rsi(close,14) > 50`) was correctly accepted and listed as "Use as filter." This is strong evidence the
fix holds, though this journey did not (see below) observe the nightly sweep actually complete.

## Screener execution — why this is ENVIRONMENT-BLOCKED, not FAIL

After applying `RSI Above 50 Screen` as a filter, the screener showed "0 matches" with the chip labeled
**"RSI Above 50 Screen — first sweep tonight"** — an honest, specific status, not a bare zero. Two
independent reasons this could not go further in this environment, both confirmed from code, not assumed:

1. The sandbox has no seeded universe and has never run a nightly cycle (by design of the isolation
   mechanism — a fresh temp directory every launch).
2. More importantly, **the sweep is architecturally forbidden from running on any request path, and this
   is enforced by a test, not just convention.** `api/routers/scan_run.py`'s own header states it "NEVER
   IMPORTS `scan_evaluator`" and that this is verified by `tests/test_scan_evaluator_off_request_path.py`,
   which "walks every module under [the router tree]." There is no admin endpoint, no button, no
   legitimate on-demand trigger — by deliberate design (master-prompt §10: "preserve the reason for the
   guardrail"). Forcing this synchronously would mean either adding a new bypass (out of Phase Zero's
   scope entirely) or fighting a tested architectural invariant — neither appropriate here.

Given the `_stamped()` fix described above specifically prevents the historical failure mode where this
exact state ("first sweep tonight" forever) used to mean something was silently, permanently broken,
confidence is high that this is genuinely pending, not stuck — but this journey did not observe the sweep
complete and a real match materialize. **Classified UNVERIFIED for actual scan execution and result
correctness (addendum §11/§12's requirements are untouched), VERIFIED for "artifact reaches the screener
path with an honest status."** A future pass with a real overnight cycle (or a dedicated offline
invocation of `run_sweep()` outside any router, which was not attempted here to stay clearly on the safe
side of the enforced boundary) is needed to close this out fully.

## Negative-path test

Formula `ta.cmf(20)` (a property/method not in the manifest — confirmed absent from the corpus's resolved-
name list in `BENCHMARK_REPRODUCTION.md`) typed into the Formula tab. Result: immediate inline red
underline on `.cmf`, a specific error box ("property access is not in the table"), the Plots section
fields disabled, and — confirmed by attempting it — **clicking Save while this error was showing was a
no-op**: no save confirmation appeared, no entry was added, dialog state unchanged. Correct refusal, no
false-success state, actionable and specific message. One negative case out of the ~20 addendum item 10
asks for eventually — logged as a start, not treated as adversarial coverage being complete.

## What this journey did NOT cover (explicitly, so it isn't assumed later)

- Editing a saved artifact (pencil icon seen, never used).
- thinkScript or TC2000/PCF through this same UI chain (only Pine was walked end-to-end here).
- The plain-language (AI concierge) or screenshot doors, seen as tabs but not exercised.
- Alerts (an "Indicator Alerts" dialog was seen by accident — RSI/period/condition/threshold/timeframe
  fields, real UI — but not used).
- Cross-browser (Chromium only, via the one available automation surface).
- Mobile/responsive rendering of any of this.
- Independent numeric cross-check of the RSI value to exact precision.
- Actual nightly-sweep execution and scan-result correctness (see above).

## Tooling note, not a product finding

Browser automation in this session showed real instability independent of the app: the extension/tab-group
connection reset three separate times (`tabs_context_mcp` returning a fresh empty group with no warning),
and `get_page_text` was observed once returning stale/cached content while a modal was actually still open
with unsaved work intact (confirmed by a subsequent successful screenshot) — a false "your work is gone"
signal from the diagnostic tool itself, not the app. Both are logged so a future session doesn't waste time
re-diagnosing the same tooling quirks, and doesn't mistake a stale read for a real defect the way this
session almost did.
