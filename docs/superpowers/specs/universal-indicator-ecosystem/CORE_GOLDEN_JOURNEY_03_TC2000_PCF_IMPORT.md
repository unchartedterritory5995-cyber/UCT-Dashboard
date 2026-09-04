# Core Golden Journey #3 — TC2000/PCF Import → Chart → Save → Reload → Screener

Third Core Golden Journey (addendum item 4). Same isolation mechanism, same sandbox and test account as
Journey #2 (carried forward without restarting, per that document's "Housekeeping" note).

## Fixture

`tests/fixtures/ast/pcf_corpus.json` entry `long_term_uptrend`: source `(C > AVGC50) AND (AVGC50 >
AVGC200)`, corpus-declared expected native `(close > sma(close, 50)) && (sma(close, 50) > sma(close,
200))`. Chosen because it's a real corpus fixture with a pre-declared expected answer (a built-in
known-answer check, not something this journey had to derive independently), and because — unlike CGJ#1's
and CGJ#2's picks — its top-level operator is `AND` over two comparisons rather than a single arithmetic
expression, which turned out to matter (see "A real, useful divergence from CGJ#1/#2" below).

## The chain, with evidence at each step

| Step | Result | Evidence |
|---|---|---|
| 1. Real UI, paste | **PASS** | Same Import-tab mechanism, one-shot `form_input` |
| 2. Detection | **PASS** | Import tab correctly identified the source as TC2000 syntax (`Read as TC2000 formula`, later `Read as TC2000 PCF`) |
| 3. Translation | **PASS, correct, matches the corpus's own expected answer** | Plain-English canonical read: "(1 when close is greater than (the 50-bar average of close) and 0 otherwise) and (1 when (the 50-bar average of close) is greater than (the 200-bar average of close) and 0 otherwise)" — this is exactly `(close > sma(close,50)) && (sma(close,50) > sma(close,200))` in the engine's own words, matching `pcf_corpus.json`'s declared expected native **exactly**, not approximately |
| 4. Canonical representation | **PASS** | Execution contract: "8 nodes · 200-bar lookback · 1 series" plus "✓ Non-repainting — every bar this output depends on is at or before its own index" |
| 5. Validation | **PASS, and this is where the door genuinely differs (see below)** | "This column is a number, so it can be charted as it is. To SCREEN with it, say what you are looking for: `(C > AVGC50) AND (AVGC50 > AVGC200)` [is above ▾] [value] — Leave this blank to keep the column as it is — you can still chart it." Left blank deliberately, to test whether the underlying AND-of-comparisons was still recognized as boolean without an explicit threshold |
| 6. Preview | **PASS, isolated evidence this time** | A live mini-chart of SPY rendered inside the dialog before Save was clicked, on the "Formula" tab the UI auto-switched to after "Use this formula" |
| 7. Chart delivery | **PASS, and independently checkable to exact precision — stronger than CGJ#1/#2** | Legend read "PCF Long-Ter... 1.00". Unlike an oscillator value, a 0/1 flag is exactly checkable: SPY's close is currently above its 50-day average, which is above its 200-day average (both visible directly in the same chart's own EMA/SMA overlay values), so **1.00 is not just plausible, it is the provably correct value**. The rendered subplot's historical shape (a step function reading 1 through most of the visible year, dropping to 0 during the visible pullbacks around Jun/Jul-Aug, recovering after) is consistent with SPY's real price history over that window — a genuine, if informal, backtest-shaped sanity check that CGJ#1/#2's continuous-valued oscillators didn't offer |
| 8. Save/persistence | **PASS, single save, no double-click repeated** | "Saved — version 1, rev 1." |
| 9. Reload | **PASS, clean** | Full page reload: "PCF Long-Ter... 1.00" and the step-shaped history both reappeared intact, single instance |
| 10. My Formulas listing | **PASS** | Listed under "MY FORMULAS" as "PCF Long-Term Uptrend Test," tagged `PCF Long-Ter`, `Your formula`, full plain-English text restated, alongside the CGJ#2 thinkScript artifact in the same list — confirms the listing surface is genuinely door-agnostic, three languages now observed in it together |
| 11. Screener reach | **PASS, ACCEPTED — a real, correct divergence from CGJ#1/#2 (see below)** | See next section |
| 12. Screener execution | **ENVIRONMENT-BLOCKED, not a defect** | Applying the filter produced the chip "PCF Long-Term Uptrend Test — first sweep tonight" — the identical honest-status mechanism CGJ#1 documented for its accepted Pine boolean case |
| 13. Negative path | **PASS, correct refusal, third language confirmed** | See "Negative-path test" below |

## A real, useful divergence from CGJ#1/#2 — and why it's correct, not a bug

CGJ#1 and CGJ#2 each tested one *numeric* artifact (Pine `rsi(close,14)`, thinkScript's ADX line) and found
both correctly refused a screener role. Naively, this PCF artifact's import-time framing — "this column is a
number... to SCREEN with it, say what you are looking for" — looked like it might mean *every* TC2000/PCF
import defaults to non-screenable unless a threshold is explicitly added. **That assumption was tested, not
adopted.** The threshold field was left blank on purpose (the UI's own text: "Leave this blank to keep the
column as it is"), and the resulting artifact was checked directly against the Screens dropdown rather than
assumed either way.

**Result: it was correctly accepted as a filter, with "Use as filter" offered immediately — no threshold
was required.** The reason is now visible directly from the product's own explanatory text, seen for the
first time in this journey (available for CGJ#1/#2's refused artifacts too, but not read that deeply in
those two passes — see "A richer refusal message than previously recorded" below): a scan is defined as
`<tree> != 0` on the last confirmed bar. This PCF formula's AST is a nested `(1 when ... else 0) and (1
when ... else 0)` — its value is mechanically always exactly 0 or 1, so `<tree> != 0` already means exactly
what a user would expect ("is the AND true"). The RSI and ADX cases were refused not because of which door
produced them, but because their trees are genuinely real-valued (RSI ranges continuously 0-100; the ADX
line is a continuous Wilder average) — `<tree> != 0` on either would be true for almost every symbol, which
is precisely the wrong, silently-misleading behavior the gate exists to prevent.

**This is the door behaving correctly, differently, for the right underlying reason** — exactly the
"verify, don't force uniformity" instruction for this wave. The apparent per-door difference (TC2000 offers
a threshold UI; Pine/thinkScript didn't in the cases tested) collapses once the actual server-side rule is
understood: it was never about the door, it was always about whether the tree's output is provably binary.
The threshold offer is a *convenience* for turning a real-valued PCF column into a binary one, not a
*requirement* — and this journey is the first to have actually exercised the "leave it blank" branch rather
than assuming what it did.

## A richer refusal message than previously recorded

Re-opening the Screens dropdown in this journey (with two artifacts now present — this PCF one and CGJ#2's
ADX one) surfaced a **per-formula explanation** more detailed than the terse "1 saved formula cannot be a
screen yet" summary line CGJ#1 and CGJ#2 both recorded and treated as the full message. The complete text
for the ADX artifact reads: *"ADX DMI Import Test — this tree returns a number, not a 0/1 column. A scan is
`<tree> != 0` on the last confirmed bar, so a real-valued tree matches every symbol whose value is not
exactly zero. A screen needs a yes/no answer. Open one, add a plot that compares it — e.g. `rsi(close, 14)
< 30` — and mark that plot 'Scan.'"* This is more precise and more actionable than either prior journey
document credited the product with — it names the exact evaluation rule and gives a concrete fix. Recorded
here as a correction-by-addition rather than editing the earlier, already-committed documents: CGJ#1's and
CGJ#2's "correctly refused, terse message" findings stand, they were simply incomplete about how much more
the product actually says when read further.

## Negative-path test

Pasted `FibExtension(C, 0.618) > 0.5 AND AVGC50 > AVGC200` — a fabricated, TC2000-plausible-sounding but
nonexistent function name, chosen for the same reason CGJ#1's `ta.cmf(20)` was: an unresolved-name case,
now confirmed for a third source language. Result: immediate, specific refusal — "Read as TC2000 formula"
followed by "⚠ THIS SCRIPT — this is not a TC2000 name this reader knows — `FibExtension(...)` at character
0," with the exact failing token underlined in the syntax-highlighted read-back. Clicking Save in this state
was confirmed a clean no-op — dialog stayed open, no save confirmation, nothing persisted. Same discipline
as the two prior journeys' negative paths, third language, still holding.

## What this journey did NOT cover (explicitly, so it isn't assumed later)

- Editing a saved artifact.
- The "is above / value" threshold path itself (only the "leave it blank" branch was exercised — whether
  setting an explicit threshold on an already-real-valued PCF column produces a correctly-thresholded 0/1
  tree was not tested).
- RISK-009's open question (whether an adversarial/blind PCF corpus exists comparable to Pine's) — this
  journey used one ordinary corpus fixture, not a stress case, and doesn't speak to that risk either way.
- Plain-language or screenshot doors (remaining journeys).
- Mechanically re-testing the screener-execution architectural boundary (established door-agnostically in
  CGJ#1, re-confirmed by observation, not re-derived, in CGJ#2 and here).

## Tooling note, not a product finding

Real browser-automation instability recurred this pass, more severely than in CGJ#1/#2: a `left_click`
itself timed out once (`Input.dispatchMouseEvent` after 30s, not just the screenshot capture), and a
subsequent stretch of nearly 90 seconds saw five consecutive failed screenshot attempts before the renderer
responded again. Across this same stretch, `get_page_text` twice returned the bare `/charts` page with no
dialog and none of this journey's in-progress work visible, while a screenshot immediately after each
recovery proved the "New formula" dialog had been open the entire time with all work intact (name field,
formula, preview chart all present, nothing lost). This is the same false "your work is gone" signal
RISK-014 already documented once from CGJ#1 — now confirmed a second and third time in this session alone.
Continues to be treated as a known limitation of that specific diagnostic tool, not a product defect:
`screenshot`, once it succeeds, is the trusted source of truth here, and every case where the two
disagreed, screenshot was the one proven correct.

## Housekeeping

`vite.config.js`'s proxy override remains unreverted, sandbox/backend/frontend still carried forward into
the remaining P1 wave (plain-language and screenshot doors), per the same plan stated in CGJ#2.
