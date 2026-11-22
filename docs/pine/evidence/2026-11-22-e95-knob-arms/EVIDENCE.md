# A `switch` on a member's setting is a live setting, pruned at bind (train e95, unit 2b, 2026-11-22)

Train e95, unit 2b. Engine number: NUMBER PENDING (the coordinator numbers the train). Counts and verdicts only: no
licence-held script is named, every TradingView value stays in the local capture store, and TradingView's built-in
source is never committed (it is held locally and named by its sha256 only, ruling F1).

## The defect

TradingView's built-in VWAP picks its anchor with `switch anchor` on an `input.string` ("Anchor Period": Session,
Week, Month, Quarter, Year, Decade, Century, Earnings, Dividends, Splits). The host lane reduced a `switch` on a
setting to its DEFAULT arm at translate time, so the anchor was no member setting at all: the 7 event-anchor captures
of the built-in were graded "the capture was taken at settings our side cannot set: "Anchor Period" (anchor) was
moved and is not a setting of our document".

## The coordinator's ruling (2026-11-22): prune at BIND time

Build every arm at translate time; at bind, keep the arm the member's setting picks. An arm the setting does not pick
never withholds or refuses the chart; a refused arm refuses only when the setting picks it. The saved formula text
keeps every arm; only the bound program is pruned. Two walls the ruling did not cover were put to the coordinator and
ruled the same day:

- **An arm the translator itself refuses** (the built-in's Quarter / Year / Decade / Century arms read
  `timeframe.change("3M" | "12M")`, which this engine holds for D, W and M only): ruled **(B), the refusing leaf**. The
  arm stands in the tree as `refusedArm(k)`, a closed-table leaf no script can spell, and the bind refuses THAT plot by
  name, quoting the translator's own sentence, only when the setting picks it.
- **The install budget**: every arm built, the built-in reads 10 to 12 distinct series against the cap of 8. Ruled:
  every install-time measurement reads the tree **pruned at the knobs' defaults** (the program the member's chart draws
  until a knob moves); the compute-time budget reads each binding's own bound tree, so a setting that picks an
  over-budget arm refuses that plot by name.

## The change

| part | where |
|---|---|
| A `switch` whose subject is a declared `input.string(…, options)` knob builds every arm as a chain, each test the knob against an option's index (`enumCompare`'s leaf); a label outside the options or repeated is dropped (Pine's first-match rule); a no-match is covered by the default arm or by every option being labelled | `pine.js::Resolver.enumSwitch`, `enumKnobTest` |
| An arm the translator refuses stands as `refusedArm(k)`, entry `k` of the translation's `knobArmRefusals` (its own guard, and a sentence naming the setting and the option); the member door stamps the list on the document (`meta.knobArmRefusals`). ⛔ A knob is offered only where the program its DEFAULT picks translates: a default arm the translator refuses keeps the switch folded and refused exactly as before. ⛔ The step budget and the door's clock propagate, never become a leaf | `pine.js::Resolver.refusedArmLeaf`, `memberPaneDefinition.js` |
| `refusedArm` in the closed table (one `int` argument, lookback 0); evaluated, it refuses by name (`interpret:refused-arm`) on both evaluators; a script that spells it is refused (`pine:builtin`) | `closedTable.json`, `interpret.js::FN.refusedArm`, `ast_interpret.FN["refusedArm"]`, `pine.js::Resolver.resolveTableCall` |
| THE BIND: a ternary whose test is made of knobs and constants (a knob, `knob == c`, `knob != c`, and `and` / `or` / `not` over those and numbers; never a bar, a clock flag, an ordering or arithmetic) is the arm the binding's inputs pick | `bind.js::knobTestValue` / `pruneKnobArms`, inside `foldBound`; Python twin `ast_bind.knob_test_value` / `prune_knob_arms` inside `fold_bound` |
| The chart lane decides EVERYTHING per binding on the bound document: the static gates, the other-symbol and event decisions (and their per-plot refusals), the block-run check and the evaluator; the document's stamps of what it reads (`meta.otherSymbols`, `meta.lowerTf`) are narrowed by exactly what the pruned arms alone read; a picked refused arm refuses that plot with the translator's sentence | `knobBind.js::boundDocument` / `armRefusalOfTree`, `astColumns.js::astColumnsUnstopped` |
| The Python lane binds at its interpreter's entry (the inputs it is handed fix every knob) | `ast_interpret.interpret` |
| Install budgets at the knobs' defaults: the registry, the door's budget pass, the door's install sentence, the up-front static refusals, the server's save gate | `astColumns.js::defaultBoundDocument`, `nativeRegistry.js::validateAstLane`, `bind.js::pruneAtLeafDefaults` (`builderInputs.js`), `memberPaneDefinition.js::hostInstallRefusalOf` / `staticRefusals`, `user_definitions._admit_new_maths` |

## What the member sees

Before: TradingView's built-in VWAP drew at its Session anchor, and its "Anchor Period" was not a setting.
After: "Anchor Period" is a setting with the script's ten options. Session, Week and Month draw; Dividends and Splits
draw from UCT's corporate events where the events door serves them; Earnings is refused by name (the built-in's arm
reads `earnings.standardized`, which UCT does not hold); Quarter, Year, Decade and Century are refused by name with the
translator's own sentence (`timeframe.change` holds D, W and M). Each refusal names the setting and the option, and
appears only when the member picks it. Its band settings ("Bands Calculation Mode", the three multipliers) became
settings too (the default-bound budget fits them).

## Rails and mutants

- `engine/__tests__/knobArms.test.js` (13): the anchor is an enum setting and the saved tree keeps every arm; the
  refused arm is stamped with its own refusal; the pre-knob door (no live enums) folds as before; a default the
  translator refuses stays folded and refused; a script cannot spell the leaf; the default draws exactly what the
  pre-knob door drew; each option draws what the script written with that anchor alone draws; the bound document holds
  only the picked arm and its narrowed reads, a document with no knob binds to itself; UNPICKED: the translator-refused
  arm, a dark events door and an event read on an intraday chart refuse nothing; PICKED: the translator-refused arm
  refuses with its guard and sentence, a dark events door refuses by name, served events draw anchored on them; a
  switch whose arms together exceed the series cap installs, and the setting that picks its over-budget arm refuses by
  name.
- `ast/knobArmsParity.test.js` and `tests/test_knob_arms_parity.py`: both lanes against ONE pinned fixture
  (`tests/fixtures/ast/knob_arms_parity.json`, neither lane the oracle), the leaf refuses when evaluated (JS, Python),
  the Python interpreter binds at its entry, the server save gate measures at the defaults.
- Mutants `ci/mutants/e95-knob-arms.json`, KA1-KA13: PENDING.

## Census and grade (the train before this unit vs the train with it, both lanes)

PENDING.

## Findings and follow-ups

- **The next unit for E2 (coordinator, 2026-11-22): presence-only reads of a field whose values UCT does not hold.**
  The built-in's Earnings arm only ever tests `not na(earnings.standardized)`, which is PLACEMENT only. A field whose
  VALUES UCT does not hold but whose report DATES it does could be served presence-only when every read of it is
  `na(x)` / `not na(x)`. That would unlock the Earnings anchor, with E2's named date divergences.
- Unchanged by this unit (named, not built): the gates that read a SAVED document without a binding still see every
  arm: the alert lane's static gates (`evaluability.alertAnswer`), the requirement tags stamped at save (an unpicked
  arm's tag refuses the five comparability consumers, never the pane), the builder's `evaluability` chart answer, and
  the secondary-source fetch plan (it may ask for a symbol or the events of an unpicked arm). Each errs on the side of
  refusing or fetching more, never of serving an arm the setting did not pick; this was already true of today's
  live enum ternaries (`enumCompare`).
