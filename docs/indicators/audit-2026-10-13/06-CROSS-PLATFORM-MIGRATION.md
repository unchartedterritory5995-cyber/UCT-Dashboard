# UCT Indicators — Cross-Platform Indicator Migration Report

**Audit date:** 2026-10-13
**Baseline:** master = production `84164aee3d`
**Priority:** owner-designated top tier.

**Sources:**
- Pine: `workstreams/WS5-pine-migration.md`
- thinkScript, TC2000 PCF and the other doors: `workstreams/WS6-thinkscript-pcf-other-imports.md`
- Market landscape: `workstreams/WS7-competitor-research.md` §3–4

**Corpus.** All corpus scripts were written for this audit (no third-party text) and live in `migration-corpus/{pine,thinkscript,pcf}/`. Evidence JSON is in `migration-corpus/results/` and holds counts and verdicts only; market values are redacted.

> **Bottom line.**
> - **The foundation is good and its maths is right.** Every import that reaches the chart computes correctly, with three exceptions, all P0s:
>   - TC2000 `STOC`;
>   - thinkScript weekly/monthly reads wrapped in a function;
>   - Pine `ta.cum`.
> - **The weakness is honesty and completeness.** What the importer *tells* the member does not reliably match what it *did*. Most visual styling is lost on the thinkScript and Pine chart doors. Stateful Pine scripts (the majority) are blocked in production, although the dark runtime computes them exactly.
> - **Cross-platform script import is a real market gap.** No competitor offers deterministic import from several languages. TrendSpider's AI translation is the nearest alternative. UCT already owns this position. Closing the honesty gap is what turns it into a moat.

## 1. Stage definitions

A script counts as migrated only if it passes all five stages.

| Stage | Meaning | How we verified it |
|---|---|---|
| **P** — Parses | The lexer or parser accepts it | Real importer entry points (`inspectSource`, `translatePine`, the PCF reader) |
| **T** — Translates | A UCT formula tree is produced, in the lane that will draw | The strict host lane for the Pine chart door; the Import tab for thinkScript and PCF |
| **E** — Executes correctly | Values match an independent implementation of the same maths | Scratch harnesses on synthetic bars, plus the repo's own TradingView captures |
| **R** — Renders as authored | Plot style, colours, levels, fills, objects and placement survive | Saved definition inspected; one browser session |
| **S** — Saves, reloads and stays editable | Round-trips through `validateUserDefinitions`; inputs remain knobs | Client-side round trip (server `save()` not exercised) |

## 2. Verified compatibility matrix

Legend:
- ✅ yes
- ⚠️ partial or with a caveat
- ❌ no
- **D** — runs exactly in the dark Pine runtime VM, refused in production

### 2a. Pine Script (host lane = what members get)

| Construct | P | T | E | R | S | Note |
|---|---|---|---|---|---|---|
| v3/v4/v5/v6, `indicator(overlay)` | ✅ | ✅ | ✅ | ✅ | ✅ | Version-specific palettes honoured |
| `input.int/float/bool` | ✅ | ✅ | ✅ | ✅ | ✅ | Lengths become editable parameters |
| `input.string(options)`, `input.source/timeframe/symbol` | ✅ | ⚠️ | ✅ | — | ⚠️ | Frozen at default (P2-12) |
| `input.enum` (v6) | ✅ | ❌ | | | | |
| `var` that forgets its seed | ✅ | ✅ | ✅ | ✅ | ✅ | As bounded `accum` |
| `var` true state (Supertrend, trailing stops) | ✅ | ❌ **D** | | | | Runtime exact (0 diff over ~1,000 bars) |
| `switch`, `for`, `while`, arrays, UDTs, tuple-returning functions | ✅ | ❌ **D** | | | | |
| `for…in`, `map`, `matrix`, `method`, `varip` | ✅ | ❌ | | | | |
| User functions (inline or block), `if/else`, ternary | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `x[k]`, `x[series]`, `na`, `nz` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `ta.*`: 45 of 68 probed calls | ✅ | ✅ | ✅ | ✅ | ✅ | Missing: alma, swma, variance, cmo, tsi, obv, accdist, sar, supertrend, pvt, … |
| `ta.cum` | ✅ | ⚠️ | ❌ | ✅ | ✅ | **P0-3**: summed over loaded bars only, undisclosed |
| `request.security` HTF, `lookahead_off` | ✅ | ✅ | ✅ | ✅ | ✅ | Last-closed HTF bar; precisely disclosed |
| `request.security` HTF, `lookahead_on` (± `[1]`) | ✅ | ✅ | ✅ | ✅ | ✅ | Reproduces TradingView's history. Wrong repaint flag on `[1]`; "Exact" on the leaking form (P3) |
| `request.security` other symbol | ✅ | ⚠️ | ✅ | ✅ | ✅ | Benchmark roster only |
| Lower TF, `gaps_on`, `request.financial/earnings/economic` | ✅ | ❌ | | | | Lower TF flag dark |
| `plot(color=series)`, histogram/columns/circles/stepline/area | ✅ | ✅ | ✅ | ✅ | ✅ | MACD 4-colour histogram kept |
| `plot(linewidth=)` | ✅ | ✅ | ✅ | ❌ | ✅ | All widths 1, silently (P1-17) |
| `plotshape` | ✅ | ✅ | ✅ | ⚠️ | ✅ | Spurious 0/1 dots (P1-3) |
| `plotchar` / `plotarrow` | ✅ | ✅ | ✅ | ❌ | ✅ | Circle; line (silent) |
| `hline`, `fill(hline,hline)` | ✅ | ✅ | — | ❌ | ✅ | Never drawn by the chart door; the box claims it is carried |
| `fill(plot,plot)`, `bgcolor`, `barcolor` | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `line/label/box/table/linefill.new` | ✅ | ✅ | ✅ | ⚠️ | ✅ | Price pane ✅; own-pane script → price coordinates (P1-2); label text blank without a known tick |
| `polyline.new` | ✅ | ❌ | | | | |
| `alertcondition` / `alert()` | ✅ | ✅ | ✅ | n/a | ✅ | Disclosed; `alert()` is not delivered |
| `strategy()` | ✅ | ✅ | ✅ | ⚠️ | ✅ | Box says "Not supported"; the chart attaches the plots with **no** "orders not simulated" note |
| `import Lib/x/N` | ✅ | ⚠️ | | | | Only libraries the curated store holds (33 of 266 census scripts need one) |

### 2b. thinkScript

| Construct | P | T | E | R | S | Note |
|---|---|---|---|---|---|---|
| `def`, `plot`, `if/then/else`, `crosses above/below`, `IsNaN`, `Double.NaN` | ✅ | ✅ | ✅ | ⚠️ | ✅ | Default style only |
| `Average`, `ExpAverage`, `WildersAverage`, `Sum`, `StDev`, `Highest/Lowest`, `TrueRange`, `ATR`, `Inertia`, `Correlation`, `MovingAverage(AverageType…)` | ✅ | ✅ | ✅ | ✅ | ✅ | ExpAverage seed difference disclosed |
| `RSI(length=…, price=…)`, `BollingerBands(...)` with every argument named | ✅ | ✅ | ✅ | ✅ | ✅ | |
| `RSI()`, `RSI(14)`, `MACD`, `StochasticFull`, `KeltnerChannels`, `ADX`, `DMI`, `VWAP`, `reference X` | ✅ | ❌ | | | | P1-15. Offers a one-click conventional call for RSI |
| `input` numeric / enum | ✅ | ✅ | ✅ | — | ❌ | Frozen at save (P1-14) |
| `declare upper/lower`, `SetPaintingStrategy`, `SetDefaultColor`, `AssignValueColor`, `SetLineWeight`, `SetStyle` | ✅ | ❌ | | ❌ | | Always lower pane, default style (P1-14). Local, unreleased work in `C:/w/rpw` |
| `AddCloud`, `AssignPriceColor`, `AddLabel`, `AddChartBubble`, `AddVerticalLine`, `AssignBackgroundColor` | ✅ | ❌ | | ❌ | | Listed as skipped |
| `close(period = WEEK/MONTH)` bare | ✅ | ✅ | ✅ | | ✅ | |
| `close(period = …)` inside a function or with an offset | ✅ | ⚠️ | ❌ | | ✅ | **P0-2** |
| `close(symbol="SPY")` | ✅ | ✅ | ✅ | | ✅ | Benchmark roster |
| `CompoundValue` / `rec` | ✅ | ⚠️ | ⚠️ | | | Running counters and ratchets refused |
| `fold` | ✅ | ⚠️ | ⚠️ | | | Rolling-sum shape only |
| `Crosses(a,b,dir)` function form | ❌ | | | | | Misleading syntax error |
| `GetTime`, `SecondsFromTime`, `BarNumber`, `AddOrder` | ✅ | ❌ | | | | Honest refusal |
| `Alert(...)` | ✅ | ❌ | | | | Not wired to UCT alerts |
| Scan one-liners using `and` / `or` | ⚠️ | ❌ | | | | Misdetected as TC2000 (P1-16) |

### 2c. TC2000 PCF

| Construct | P | T | E | S | Note |
|---|---|---|---|---|---|
| `O H L C V` in any case; offsets `C1`, `C.1`, `C(3)`, `AVGC50.5`, `MAXV10.1` | ✅ | ✅ | ✅ | ✅ | PCF text stored as source |
| `AVG/XAVG/HAVG/MAX/MIN` on any field | ✅ | ✅ | ✅ | ✅ | XAVG seed difference undisclosed (P2-18) |
| `WRSI`, `MACDa.b`, `ATR`, `CCI`, `ADX`, `DIPLUS/DIMINUS`, `AROON`, `BOP`, `STDDEV` | ✅ | ✅ | ✅ | ✅ | |
| **`STOCa.b`** | ✅ | ⚠️ | ❌ | ✅ | **P0-1**: wrong argument order, labelled "Exact" |
| `RSI` (TC2000's plain RSI) | ✅ | ❌ | | | Honest refusal that suggests `WRSI` |
| `AND OR NOT XOR …`, arithmetic, comparisons, maths functions, `IIF` | ✅ | ✅ | ✅ | ✅ | |
| `XUP/XDOWN`, `COUNTTRUE`, `TRUEINROW`, `SINCETRUE` | ✅ | ✅ | ✅ | ✅ | Touch-case difference disclosed |
| `Capitalization` / `MarketCap` | ✅ | ✅ | ✅ | ✅ | |
| `EPS`, `PE`, other fundamentals | — | ❌ | | | A bare "not a TC2000 name" (P3) |
| `FAVG`, `WSTOC`, `OBV`, `MS`, `TSV` | ✅ | ❌ | | | Honest: proprietary or unpublished |

## 3. Migration test results

### 3a. Corpus written for this audit

| Platform | Scripts | Translate | Numerically exact | Keep visuals | Honest labels |
|---|---|---|---|---|---|
| Pine | 16 | 13 attach on the chart (the box verdict disagrees on 4) | 26 of 26 attached plots exact | Partial: colours, fills, bg/bar colour and tables kept; widths, hlines and arrows lost | ❌ 4 of 16 box verdicts contradict the chart |
| thinkScript | 18 | 11 (2 Exact, 8 disclosed, 1 partial) | 10 of 11 (07 is P0-2) | **0 of 18** | ❌ "the values are the same" on 07 |
| PCF | 16 | 14 | 13 of 14 (STOC is P0-1) | n/a (scans) | ❌ STOC "Exact" |

**Per-script detail:**
- Pine: WS5 §4. Highlights:
  - EMA ribbon: exact, but linewidths are silently lost;
  - RSI with OB/OS band: value right, 70/30 band lost;
  - Supertrend / ATR trail: blocked in production, exact in the runtime;
  - strategy: attaches undisclosed.
- thinkScript and PCF: WS6 §3.

### 3b. Real-world corpus already in the repo (licence-committed scripts)

**Pine census** (266 scripts):

| Measure | Count |
|---|---|
| Chart door attaches | **85 (32%)** |
| "Exact import" | 5 |
| Of the 85 that attach, the box calls "Not supported" | 37 |
| Additional scripts the dark VM would build | +16 |

**Vendor harness** (336 TradingView captures, 228 scripts, mostly daily SPY/RDDT):
- **Capture level:**
  - MATCH 92
  - DIVERGE 98
  - INCONCLUSIVE 146
- **Plot level:**
  - match 859
  - diverge 149
  - inconclusive 234
- **Why the 149 divergent plots differ:**
  - 62 early-bar seed-window artefacts;
  - 60 `na`-ness differences;
  - 17 real value differences;
  - 10 colour.
- The committed `docs/pine/vendor-harness/summary.md` is stale: it lists 17 captures.

**thinkScript:** 10 of 24 pinned public studies translate.

### 3c. Comparison with original platforms

- **Pine:** compared directly against TradingView captures already in the repo (above). This is the strongest evidence available.
- **thinkScript and PCF:** no captured vendor values exist in the repo. The comparison here is against each platform's *documented* maths (WS7 §3), implemented independently. Before declaring any thinkScript or PCF construct "Exact", the next step is a small set of owner-captured vendor values (see the roadmap).

## 4. Honesty: does UCT report partial conversion truthfully?

**What works well:**
- Refusals carry line, column and caret.
- Many refusals are specific and actionable:
  - TC2000 `RSI` → "use `WRSI14`";
  - thinkScript session functions;
  - `TTM_Squeeze` named as proprietary.
- The higher-timeframe `lookahead_off` disclosure is precise.
- A crash in a translator becomes "Import failed", not a dead box.
- thinkScript partial imports name the plot that was not imported.

**What breaks trust:**

| # | Finding | Evidence | Severity |
|---|---|---|---|
| H1 | Two verdicts on one screen. The paste box uses the lenient lane, the chart uses the strict lane. In 336 captures: 89 say "Partial import" where the chart refuses everything; 67 say "Not supported" where the chart attaches | `PineBox.jsx:322` vs `memberPaneDefinition.js:153-172` | P0-7 |
| H2 | Unlisted note codes default to "presentation only", so "the values are the same". 16 captures with value or `na` divergence carry that headline; 8 diverging captures say "Exact import" | `importOutcome.js:64-73,248` | P0-7 |
| H3 | The chart door discards host-computed notes, including strategy "orders are not simulated" | `memberPaneDefinition.js:716-760` | P0-7 |
| H4 | "Exact import" while values are wrong (STOC); "the values are the same" while values are wrong (thinkScript MTF); silent attach of `ta.cum` | WS6 F1/F2, WS5 P0-1 | P0-1..3 |
| H5 | The box says `hline` "carries it as a level line"; the chart door never draws it. `linewidth`, `plotarrow`, `plotchar` silently changed | WS5 §5 | P1-17 |
| H6 | Screen-framed sentences inside the indicator builder ("a screen has nowhere to deliver"); constant plots described as "hidden by the script itself"; bulk intake tells a valid PCF it is not PCF | WS6 G8, G11 | P2/P3 |
| H7 | Refusal messages of about 900 characters with internal jargon ("static decidability", `closedTable.json::_no_offset_reopened_by`), suggesting `lowest()` for Supertrend | WS5 G6 | P2-7 |
| H8 | Browser, this audit: a Pine script with a label and a line got "Exact import · This script offers 2 columns". The objects appear only under "Show 1 line a screen does not read" | Lead session, synthetic bars | P0-7 |

**Recommended honesty contract (design only, not implemented):**
- One verdict per import, computed by the lane that will draw it.
- Four outcome classes, each with a short line, in this order:
  1. **Values** — exact / differs (with the reason) / not imported.
  2. **Visuals** — kept / changed / dropped, as an itemised list.
  3. **Inputs** — editable / fixed.
  4. **Behaviour** — alerts, orders, repaint.
- Unknown note codes default to "values may differ".
- "Exact" is reserved for constructs with a vendor-capture-backed test.

## 5. UX walkthrough (paste → analyse → convert → preview → adjust → apply → save)

1. **Paste.**
   - One Import tab accepts Pine, thinkScript, PCF and UCT formulas.
   - Language detection is in `dialect.js`. ❌ thinkorswim `and` one-liners are misdetected as TC2000.
   - Bulk intake (`libraryIntake.js`) has its own detector, which rejects valid PCF.
2. **Analyse.**
   - The box shows "Read as Pine script v5 · indicator() · <title>", a verdict ("Exact import", "Imported, with disclosed differences", "Partial import" or "Not supported"), one radio row per column, and "Show N lines a screen does not read".
   - Framing problem: the box is written for **screens**, while the member is building a **chart indicator**.
3. **Convert.** Two actions sit on one screen and can disagree:
   - "Use this formula", the lenient lane, puts a formula in the Formula field;
   - "Add this script to my chart", the strict lane, adds a member pane (Pine only).
4. **Preview.** The member pane previews on the live chart. The thinkScript and PCF imports preview through the Builder.
5. **Adjust.**
   - Pine lengths become parameters.
   - thinkScript inputs are editable only before saving, as paste-time fields.
   - Choice, source, timeframe and symbol inputs are frozen.
6. **Apply.**
   - Pine: as a member pane.
   - thinkScript: always in the lower pane.
   - PCF: as a formula, or as a scan, column or alert where supported.
7. **Save.**
   - Pine and thinkScript are saved as UCT formula trees. **The original source is not kept**, so re-editing means re-pasting.
   - PCF keeps its text and re-reads it on load, which is the best of the three.

**Click count, typical Pine import:** Add to Chart → Create Indicator → Import → paste → Add this script to my chart. That is 4 clicks plus the paste. Admins get the UCT Agent instead, which offers the same doors.

## 6. Compatibility roadmap, ranked by real-world unlock

Ranked by how many real scripts each item unlocks (WS5 census frequencies; WS6 corpus) and by trust impact. "Trust" items come first, because an import that misleads is worse than one that refuses.

| Rank | Item | Unlock / why | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Fix P0-1, P0-2 and P0-3, each with a value-checked test against an independent reference | Correctness of everything already migrated | S–M | STOC: alert migration notice |
| 2 | One honest verdict per import (H1–H3), with the four-class outcome; unknown codes fail honest | Trust in all imports. Cheap relative to its value | M | none |
| 3 | Chart-door visuals: `hline` (13.8% of scripts), `fill(hline,hline)`, linewidth, `plotarrow`/`plotchar`, marker dots, own-pane objects | Most attached Pine scripts *look* right afterwards | M | WS2 renderer fixes P1-2, P1-3 |
| 4 | thinkScript presentation and placement: finish the `C:/w/rpw` UIE-1 work, `declare upper`, constants as levels, histograms, arrows, `AssignValueColor`, `AddCloud`, `AssignPriceColor` | 0 of 18 thinkScript imports keep any styling today | M–L | Coordinate with the rpw owner (do not duplicate) |
| 5 | thinkScript study references with on-screen defaults: `RSI()`, `MACD`, `StochasticFull`, `KeltnerChannels`, `ADX`, `VWAP`; plus scan one-liner detection | The most common thinkorswim pastes. Needs an owner ruling on adopting thinkorswim defaults, with disclosure | M | Owner ruling |
| 6 | Editable choice inputs (`input.string` in 38.6% of scripts, source, timeframe, symbol); thinkScript inputs as live knobs; store the original source | "Works only at defaults" becomes "works" | M | Formula-language length params (P1-9) help |
| 7 | Staged rollout of the Pine runtime VM (owner-gated): grading captures, save gate, admins → cohort | `var` 58.9%, loops 36.6%, arrays ~32%, `switch` 19.9%, UDT 10.6%. The single largest unlock | XL | Owner decision; incremental evaluation and worker (P1-13); honesty contract first |
| 8 | thinkScript `rec`/`CompoundValue` running state and `fold` (via the same runtime) | Trailing stops and streak counters | L | Item 7 |
| 9 | Missing functions shared by every door: supertrend, obv, alma, sar, tsi, cmo, variance, barssince, honest `cum` | Each one unlocks scripts on all three platforms at once | M | Formula table (P2-11) |
| 10 | Vendor-capture programme for thinkScript and PCF (owner-captured values); refresh the stale Pine summary | Earns the word "Exact" | M | Owner captures |
| 11 | `request.security` breadth (non-roster symbols, lower TF, `gaps_on`), libraries (7%), methods, polyline, map/matrix | The long tail | L–XL | Items 7, 10 |

## 7. Local, unreleased work (not touched)

`C:/w/rpw` (branch `feat/uie-gate1`) holds an uncommitted, untested +165-line change to `thinkscript.js` ("UIE-1"). It:
- adds hex values for `Color.*`;
- maps the LINE, HISTOGRAM and BOOLEAN_ARROW painting strategies;
- maps `SetLineWeight` 1–5;
- maps `declare` to overlay;
- adds a `note-carried` note.

**It is incomplete.** `translateThinkScript` never emits the collected presentation. If shipped as-is, the note would claim "the chart draws it that way" while the chart still drew default lines. This is roadmap item 4. It belongs to that worktree's owner, so coordinate with them rather than duplicate it.

## 8. What would make UCT the best place to migrate to

- **A per-script compatibility report** that members can trust:
  - values / visuals / inputs / behaviour, itemised;
  - the translated UCT formula shown alongside a plain-English read-back.
- **"Exact" backed by captures.** TrendSpider's AI translation can't promise this.
- **Import once, use everywhere:** the imported formula drives the chart, candle colours, alerts and scans, and later watchlist columns.
- **A migration inbox:** paste a whole thinkorswim or TradingView export, or a list of TC2000 PCFs, and get a ranked table of what imported exactly, what imported with differences, and what needs a decision. `libraryIntake.js` already exists as the seed for this.
