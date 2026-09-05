# Core Golden Journey #2 — thinkScript ADX/DMI Import → Chart → Save → Reload → Screener

Second Core Golden Journey (addendum item 4). Explicit instruction for this wave: "do not force identical
behavior across doors if the product intentionally differs" — this document verifies the thinkScript door on
its own terms rather than assuming CGJ#1's Pine findings transfer, and calls out precisely where they do and
don't.

## Environment

- Same isolation mechanism as CGJ#1 (`conftest.py` import trick before `uvicorn.run`), a **fresh** sandbox
  this time (new `tempfile.mkdtemp()` on relaunch — the mechanism creates an empty sandbox on every start,
  so the CGJ#1 test account and its saved indicators did not carry over). Backend re-launched on port 18420,
  frontend on port 15174 (15173 was occupied this session). Test account `phasezero@local.dev` recreated
  fresh in this sandbox, auto-admin via `ADMIN_EMAILS`.
- `vite.config.js`'s `/api` proxy was again temporarily repointed at 18420 for this journey (see "Housekeeping"
  at the end of this document for revert status).
- Both background processes were left running into Golden Journey #3 rather than stopped between journeys,
  to avoid re-paying the sandbox-recreation cost for every fixture; stopped at the end of the full P1 wave.

## Fixture

`tests/fixtures/thinkscript/03-adx-dmi-lower.ts` — a real, unmodified vendor thinkScript study (Wilder's
ADX/DMI, `declare lower`, `AverageType.WILDERS`, 14-period default), chosen for the same reasons as CGJ#1's
RSI pick: a real corpus fixture (not hand-written for this test), independently anchored in the benchmark
suite, non-trivial (3 plots — DI+, DI-, ADX — each depending on Wilder-smoothed intermediate series), and a
well-known, independently-checkable computation.

```
declare lower;
input length = 14;
input averageType = AverageType.WILDERS;
def hiDiff = high - high[1];
def loDiff = low[1] - low;
def plusDM = if hiDiff > loDiff and hiDiff > 0 then hiDiff else 0;
def minusDM = if loDiff > hiDiff and loDiff > 0 then loDiff else 0;
def ATR = MovingAverage(averageType, TrueRange(high, close, low), length);
plot "DI+" = 100 * MovingAverage(averageType, plusDM, length) / ATR;
plot "DI-" = 100 * MovingAverage(averageType, minusDM, length) / ATR;
def DX = if ("DI+" + "DI-" > 0) then 100 * AbsValue("DI+" - "DI-") / ("DI+" + "DI-") else 0;
plot ADX = MovingAverage(averageType, DX, length);
```

## The chain, with evidence at each step

| Step | Result | Evidence |
|---|---|---|
| 1. Real UI, paste | **PASS** | Same Import-tab mechanism as CGJ#1, one-shot `form_input` value-set (see CGJ#1's "Typing vs. pasting" finding — reused here without incident, no hang) |
| 2. Detection | **PASS** | Import tab correctly identified the source as a thinkScript study (`declare lower`, `input`, `def`, `plot "DI+"` syntax); syntax-highlighted read-back rendered thinkScript-correct coloring |
| 3. Translation | **PASS, correct for the checked series** | "DI+" resolved to `100 * rma(high - high[1] > low[1] - low && high - high[1] > 0 ? high - high[1] : 0, 14) / rma(max(close[1], high) - min(close[1], low), 14)`. Independently verified by hand: the denominator `max(close[1], high) - min(close[1], low)` is algebraically the standard True Range identity (`max(high-low, |high-close[1]|, |low-close[1]|)` reduces to exactly this closed form), `plusDM`'s conditional matches the source's `if hiDiff > loDiff and hiDiff > 0` exactly, and Wilder's `MovingAverage(WILDERS, ...)` correctly became `rma(...)` (RMA *is* Wilder's smoothing method — same algorithm, different vendor name). **Scope limit, stated plainly:** only the DI+ series was algebraically re-derived by hand; DI- (a structural mirror of DI+ with `minusDM`) and the final ADX smoothing step (`rma(DX, 14)`, a standard, well-documented formula) were not separately hand-verified — a real but bounded gap, not assumed away |
| 4. Canonical representation | **PASS** | Execution-requirement contract read "22 nodes · 15-bar lookback · 3 series" — the "3 series" figure is internally consistent with the source's 3 `plot` statements (DI+, DI-, ADX), a corroborating detail rather than an isolated claim. Full plain-English explanation shown alongside the formula, same mechanism as CGJ#1 |
| 5. Validation (levels/placement) | **PASS, inferred from rendered result, not a separately isolated screenshot** | No `LEVELS` field applies here (the source declares no overbought/oversold-style constants, unlike RSI's `obLevel`/`osLevel`) — correctly absent rather than fabricated. `PLACEMENT: Own pane` was not read as separate dialog text this pass, but is confirmed by the actual rendered result: `declare lower`'s instruction was honored — the saved artifact rendered as a lower oscillator subplot, not overlaid on price |
| 6. Preview | **Not separately isolated** | The same dialog mechanism as CGJ#1 (which does show a live pre-save preview) was used, but no distinct pre-save screenshot was captured this pass before clicking Save — folded into the translation/canonical evidence above. Logged as a gap in this journey's own evidence chain, not assumed passing |
| 7. Chart delivery | **PASS, semantically plausible** | Legend showed "ADX DMI 30.57" on the live SPY chart with the oscillator subplot rendering; 30.57 is a plausible ADX reading (0-100 scale, "some trend present, not extreme") given SPY's rendered price action. Not independently recomputed to exact precision — same directional-plausibility caveat as CGJ#1's RSI value |
| 8. Save/persistence | **PASS, clean this time** | Saved once (deliberately, learning from CGJ#1's RISK-012 double-click defect) — single clean instance, no duplicate |
| 9. Reload | **PASS, clean** | Full page reload: "ADX DMI 30.57" reappeared automatically in the legend with the subplot rendering correctly, single instance |
| 10. My Formulas listing | **PASS** | Reopening Indicators showed "ADX DMI Import Test" under "MY FORMULAS" with an active checkmark, the "ADX DMI" type tag, a "Your formula" badge, and the full plain-English explanation restated verbatim — same listing mechanism confirmed working for a second, different source language |
| 11. Screener reach | **PASS, correctly gated, same mechanism as CGJ#1** | See "Screener reachability" below |
| 12. Screener execution | **ENVIRONMENT-BLOCKED, not a defect** | Same architectural boundary as CGJ#1 (`scan_evaluator` never imported on any request path, enforced by `test_scan_evaluator_off_request_path.py`) — not re-tested mechanically this pass since CGJ#1 already established it's a door-agnostic, AST-level boundary, not a per-door check |
| 13. Negative path | **PASS, two distinct and more granular refusal mechanisms found** | See "Negative-path test" below — stronger evidence than CGJ#1's single case |

## Screener reachability

Navigated to the Screener surface (`/screener`, left-rail "Screener," confirmed correctly labeled — matches
P2's terminology finding that "Custom Screens" is not used anywhere in the product) and opened the
**Screens ▾** dropdown. Under **MY SCANS — SCAN**, the exact same message CGJ#1 observed for the numeric Pine
RSI artifact appeared for this thinkScript-derived numeric artifact: **"1 saved formula cannot be a screen
yet."** This is good, specific evidence that the numeric-vs-boolean screener gate is keyed on the AST's
*output type*, not on which door produced it — a thinkScript-sourced artifact hits the identical refusal
message and mechanism as a Pine-sourced one. This is exactly the "verify, don't assume, whether doors behave
identically" instruction for this wave — confirmed rather than presumed, for this one gate.

## Negative-path test

Chose `tests/fixtures/thinkscript/09-above-average-price-volume.ts` (an existing, unmodified corpus fixture
already classified `thinkscript:arity` in the test suite) rather than inventing a new adversarial case — this
lets the live browser result be checked against an independent, pre-existing classification.

```
def Period = AggregationPeriod.DAY;
def varhigh = high(period = Period);
...
def SMAHD20 = SimpleMovingAvg(varhigh,20);
...
```

**Finding, more granular than the corpus's single "arity" label:** the live UI surfaced **two distinct,
sequential refusals**, not one:

1. **`SimpleMovingAvg(varhigh,20)` — missing-default-argument ambiguity.** Error: "that thinkorswim call's
   arguments do not fill the parameters it declares — `displace` has no value, and thinkorswim publishes no
   default for it... writing them yourself — `SimpleMovingAvg(close, 20, 0)` translates today." This was
   presented with a precise `LINE 8, COLUMN 15` pointer, the exact failing token underlined, **and** a
   distinct assisted-edit offer box: "thinkorswim doesn't publish these defaults, so this engine won't assume
   them. The conventional call is: `SimpleMovingAvg(varhigh, 20, 0)` [Put this in my script]." Confirmed by
   direct test: clicking "Use this formula" **without** resolving this left the `FORMULA` field empty (no
   guessed value silently populated), and clicking **Save** in that state was a clean no-op — dialog stayed
   open, nothing persisted. This is the same "never silently guess" discipline CGJ#1 documented for
   `ta.cmf(20)`, now confirmed for a different failure class (missing default, not missing name).
2. **After accepting the assisted-edit fix for (1)**, a *second*, deeper issue surfaced underneath:
   `high(period = Period)` where `Period = AggregationPeriod.DAY`. Error: "...DAILY bars ABSOLUTELY, the way
   every thinkorswim aggregation does... this engine resamples only UPWARD from the bars it is handed, so
   there is no code for `tf` to carry. Nothing in the vocabulary spells 'the daily value regardless of chart
   timeframe', so this is a node this engine does not have rather than a fold it has not written." No
   assisted-edit offer was shown for this one — correctly, since there is no safe conventional default for a
   genuinely-missing capability, only for an ambiguous-but-conventional argument.

**Why this matters beyond a pass/fail check:** the corpus's single `thinkscript:arity` label is accurate but
coarser than what the live tool actually does. The live tool distinguishes, in its own explanatory text,
between "I could guess a reasonable default but won't without your say-so" (assisted-edit, resolvable) and
"this concept does not exist in my model at all" (hard refusal, not resolvable via a UI affordance) — two
different epistemic states that a single test-suite classification string collapses into one bucket. This is
worth recording as a documentation-granularity gap, not a product defect: the *test corpus's* label is coarser
than the *product's* actual behavior, which is more honest than the label implies.

**Relevant to RISK-004, as a data point, not a resolution:** RISK-004 documents that Pine's blind-corpus
"assisted-edit floor" test is currently red — none of 21 blocked Pine scripts are lifted by the offer
mechanism in that specific automated test. This live thinkScript observation shows the *same class* of UI
affordance ("Put this in my script") working correctly and landing a syntactically/semantically correct fix
for at least one real construct, in a real browser, for a different source language. This does not resolve
RISK-004 — different language, different mechanism internals, a live example of N=1 is not a corpus — but it
is evidence the general pattern is not conceptually broken everywhere, which narrows what RISK-004's eventual
root-cause investigation should look for (a Pine-specific or corpus-specific gap, not "assisted-edit doesn't
work"). Noted here rather than silently left as a coincidence.

## What this journey did NOT cover (explicitly, so it isn't assumed later)

- Editing a saved artifact.
- Independent hand-verification of the DI- and ADX (final smoothed) series — only DI+ was algebraically
  re-derived (see step 3's scope limit).
- A distinct, isolated pre-save preview screenshot (folded into translation/canonical evidence — see step 6).
- TC2000/PCF, plain-language, or screenshot doors (separate journeys).
- Mechanically re-testing the screener-execution architectural boundary (CGJ#1 already established this is
  door-agnostic at the AST level, not per-door — re-deriving it here would add no new evidence).
- Cross-browser, mobile/responsive.
- Alerts.

## Housekeeping

`vite.config.js`'s temporary proxy override was **not yet reverted** at the close of this journey — both
isolated backend/frontend processes and the fresh sandbox are being carried forward into Golden Journey #3
(TC2000/PCF) to avoid re-paying setup cost across the remaining P1 wave. Will be reverted (confirmed via
`git diff` empty, matching CGJ#1's discipline) once all remaining Golden Journeys in this wave are done.
