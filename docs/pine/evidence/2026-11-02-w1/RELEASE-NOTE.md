# W1 release note: Pine names and robustness (2026-11-02)

Branch `feat/pine-w1-names`. Everything a member can see change when W1 merges, measured
against master, for the PR body. Each item names its evidence so a reviewer can check it.
Formula sources and second witnesses for every name:
`docs/pine/evidence/2026-11-02-w1/formula-sources.md`. Capture rows still owed:
`docs/pine/capture-queue-2026-11-02-w1.md`.

No flag, no environment variable and no production setting changes. `SCRIPT_ENGINE_VERSION`
is not bumped on this branch (the coordinator bumps it at merge), and
`memberDocumentMigration.DOOR_VERSION` stays 1.

## 1. New Pine names

On master every name below is refused. With W1 they translate on the member door, and on
the runtime pane through the same Resolver.

| name | where it draws | what it computes |
|---|---|---|
| `ta.obv`, `ta.pvt`, `ta.wad` | a chart pane only, with the history-depth badge (section 5). A screen still refuses the level, and a drawing is refused (section 4) | TradingView's published reference bodies, each a running total (`cum`) from the first bar the chart loaded |
| `ta.iii`, `ta.wvad` | a pane and a screen | the per-bar bodies; `ta.iii` divides by the volume (section 3) |
| `ta.cmo(source, length)` | a pane and a screen, over a source that cannot be `na` after its first value (section 2) | TradingView's `f_cmo` |
| `ta.cog(source, length)` | a pane and a screen | TradingView's `pine_cog`. The longest window is the node budget's: 32 bars of `close`, fewer for a compound source. A longer one is refused by name at translation, `pine:budget`, in the budget's own words |
| v1-v4 bare `obv`, `pvt`, `wad`, `iii`, `wvad`, `cmo(...)`, `cog(...)` | as the `ta.*` spelling | the same trees |
| v1-v4 bare one-argument `barssince(cond)` | as `ta.barssince(cond)`: on a pane, and that name's refusal on a screen | Pine's exact unbounded count (master refused it `pine:arity`, "add a number") |

Also visible:

- The bounded comparisons are unchanged and still win wherever they apply:
  `ta.obv > ta.obv[k]`, `ta.obv - ta.obv[k]` and `ta.pvt - ta.pvt[k]` keep their `obvN` /
  `pvtN` rewrites, on a pane as on a screen, so a screen script that already worked still
  draws the same column.
- A v5/v6 script that writes a bare spelling (`plot(obv)` in a v6 script) is still
  refused, but by `pine:function` with a sentence naming the `ta.*` spelling, where master
  answered `pine:undefined`.
- An input that sets a `ta.cmo` / `ta.cog` length is folded into the window and is not
  offered as a member knob (the member door refuses that knob by name).

## 2. `ta.cmo` is served only over a source that cannot be `na` after its first value

Coordinator ruling, 2026-11-02. On a source with an `na` after its first value,
TradingView's published `f_cmo` read literally draws a value on that bar and on the
`length` bars after it (an `na` momentum adds 0.0 to `sm1` while `math.sum` skips it in
`sm2`); TradingView's v5/v6 remark says an `na` in the source is ignored; PyneCore answers
`na`. No capture says which TradingView computes, so W1 draws none of them.

- Served: `close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4`, `hlcc4`, also when they
  arrive through `input.source`. A number passes the gate too (it is never `na`), though a
  plot of it alone is one number on every bar and meets that rule instead. A comparison
  (`close > open`) or an `na(x)` test passes for the same reason: it is never `na` itself. The test is the
  engine's existing answer to "can this source be `na` on a bar?" (`pine.js::isBarPriceSource`,
  the rule `ta.vwap(source)` already used, now shared) plus its never-`na` rule
  (`neverNaTree`), never a list of its own.
- Refused by name, `pine:arity`, with the reason and the way forward (for example
  `ta.cmo(close, 14)`): any other source. That includes a source with an `na` arm
  (`close > open ? close : na`), a computed source with no gap in fact (`ta.sma(close, 5)`,
  `close - open`, `close[1]`), and `volume` (a bar may carry none). The rule is a whitelist on
  purpose; widening it is a capture's decision (rows E04/E05). The member door and the
  runtime pane refuse it alike (one Resolver).
- A warm-up is not a gap: `ta.cmo(close, 20)` equals TradingView's exported values on all
  130 finite rows of PyneCore's export fixture, first value on bar `length`.
- On master `ta.cmo` is refused entirely, so this gate stops drawing nothing that matched
  TradingView.

Rails: `app/src/components/chart/engine/ast/pineW1Builtins.test.js` (the reference on bars
with no gap, every bar price and mean, the named refusal on a screen, a pane and the runtime
pane, v6 and v4) and `runtime/__tests__/w1BareConditionalHistory.test.js`.

## 3. `ta.iii` divides by the volume

`ta.iii = (2 * close - high - low) / ((high - low) * volume)`: TradingView's v4 reference,
PyneCore, and TradingView's own exported `ta.iii` values (100 of 100 rows of PyneCore's
export fixture). The v5/v6 reference pages print the volume multiplying, which those same
values contradict on every row; W1 was first built from that text and the W1 re-review
fixed it. A bar with `high == low` or a zero volume is a division by zero and draws a gap,
by the engine's existing rule.

## 4. `ta.obv`, `ta.pvt` and `ta.wad` are held from drawings

A table cell or a label that prints one of the three levels is refused by name,
`pine:window-dependent`, at every drawing door: the host object pass, the runtime lane's
object door, and a runtime build that draws its own objects. A drawing carries no
history-depth badge, so it would print a number that moves with where the chart's history
starts (SPY's chart does not start at the listing, so its OBV cell would differ from
TradingView's). A runtime build refused for that keeps its plots where the plots' own build
stands. Pane plots of the levels are unchanged and carry the badge. Phase 1's `ta.accdist`,
`ta.nvi` and `ta.pvi` still reach drawings exactly as on master (open item 1 in
`formula-sources.md`).

## 5. The history-depth badge is now raised by colour rules too

The pane's badge used to be decided by the plotted values only. It now also reads every
colour rule a plot, a fill or a paint (`barcolor` / `bgcolor`) draws from, against the same
roster (`memberPaneDefinition.js::requirementTagsRaised`). It only ever adds the badge;
every paint and colour still draws. So a script whose paint, plot colour or fill colour
reads `ta.cum`, `barstate.isfirst`, `ta.accdist`, `ta.nvi`, `ta.pvi`, `ta.obv`, `ta.pvt` or
`ta.wad` now shows the badge on the member pane. Two cases members will notice:

- **Day-separator shading.** `bgcolor(timeframe.change("D") ? ... : na)`, and the same with
  `"W"` or `"M"`, now raises the badge: `timeframe.change` translates to
  `isfirst ? 0 : <first bar of the period>`, which is TradingView's own answer (the oldest
  loaded bar reads false whether or not it opened a period), and `barstate.isfirst` is a
  history-depth value.
- **atr-support-and-resistance's OBV bar colour** (`obvOnOff and ta.obv > obvEMA ? ... : na`).
  W1 serves `ta.obv` on a pane, so the door carries this paint where master folded it to
  `na`. At the default (`obvOnOff` false) it paints no bar, as TradingView paints none
  (`vendorHarness.b1Paints`: `naBoth` before, `agree` now, on RDDT and SPY), and the script
  now shows the badge.

Census "clean" counts may drop for such scripts. Intended: the badge is a disclosure, never
a refusal.

## 6. Charts already attached show the new badge only after a re-save

The badge's tag is written into the saved document when the member saves it
(`meta.requirementTags`, `memberPaneDefinition.js`), and an attached chart reads it back
from there (`pane/AttachedPineDisclosures.jsx`); nothing on the chart re-derives it.
`DOOR_VERSION` is unchanged, so no migration rewrites old documents. A chart attached
before W1 whose colour rule now raises the badge (section 5) shows it after the member
re-saves the script.

⚠️ One interaction for the merge: W1 does not bump `SCRIPT_ENGINE_VERSION`. If the merge
bumps it (the coordinator's call), every saved script document that holds its source is
re-translated once on the member's next chart load and written back
(`savedScriptUpgrade.js`), and picks the badge up then without a re-save. A document saved
without its source still needs the re-save.

## 7. Runtime pane: an intended, fail-closed change

A v1-v4 bare `barssince(cond)`, `cmo(...)` or `cog(...)` in one arm of a `?:` is now history
and is refused by name, `runtime:conditional-history`, exactly as its `ta.*` spelling is.
Before W1 the bare `barssince` there was served on every bar (Pine runs it only on the bars
that arm is reached) and bare `cmo` / `cog` met `pine:function`. On every bar (not in an
arm) both spellings are served. Rail:
`app/src/components/chart/engine/runtime/__tests__/w1BareConditionalHistory.test.js`.

## 8. Formula Reference page text

The closed table's rulings for `obv` and `pvt` (shown on the Formula Reference page,
`/formulas/reference`) now record W1's ruling: on a pane the Pine door serves the level with
the history-depth badge, a screen keeps refusing it, and a drawing of it is refused by name.
The formula language still cannot spell `obv`, `pvt` or `wad`; nothing it accepts changed.

## Not member-visible

- `app/src/components/chart/supportLoop/doorNameCoverage.json`: 157 reachable names to 161
  (`ta.cmo`, `ta.cog`, `ta.iii`, `ta.wvad`).
- `tools/corpus_metric.json`: one strategy script's guard list changed (the v4 bare
  `barssince` route); it stays refused as a strategy.
- Capture queue W1-A to W1-E and the formula-sources record.
