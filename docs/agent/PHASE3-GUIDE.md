# UCT Agent Phase 3: product guide expansion (Workstream 3)

Explain, Show me and Do it for me, extended to more real controls and to the product's own settings metadata.

The guide still never changes the workspace by itself. Do it for me still runs an existing capability, through the
normal planner, policy, receipts and Undo.

## New walkthroughs

Each one points at ONE narrow, real control.

| Feature | Asked as | Steps (data-guide targets) | Do it for me |
|---|---|---|---|
| `link` | "how do I link my charts?", "what's the colour dot for?" | `widget.link`: the link dot on the header of the chart being talked about | **`widget.setLink`**. Asks "Which link colour?" (Gold, Blue, Green, Purple, Not linked), then sets it on that chart. Receipted, one Undo. |
| `hideDrawings` | "how do I hide my drawings?" | `chart.drawingsHide`: the eye on that chart's drawing toolbar | Says what to ask for ("hide all my drawings", `drawing.setAllVisible`). The toolbar eye and the Agent action are different writers (a chart setting vs each drawing's own hidden flag), so the Agent doesn't claim to press the eye. |
| `canvas` | "where do I change the chart background / grid lines / crosshair?" | `chart.settings` (waits for the dialog), then `chartSettings.tab.canvas` | Says what to ask for (background, grid, crosshair). |
| `layouts` (extended) | "how do I save a layout?" | adds `workspace.layoutLibraryMenu`, the library itself | unchanged |

**Narrow targets, as in the Phase 2 timeframe fix:**
- The link dot is the 20×20 button, scoped to the chart talked about. `targets.js` now scopes `widget.*` like
  `chart.*`. On the real board, the ring was drawn 4px around that chart's dot, not the watchlist's.
- The eye is the one toolbar button.
- The Canvas step is the one tab.

**New attributes, two of them, attribute-only:**
- `pages/charts/WidgetHeader.jsx`: `data-guide="widget.link"`;
- `components/chart/ChartToolbar.jsx`: `data-guide="chart.drawingsHide"`.

There's no behaviour change, and no Indicators or Breaking News file is touched.

**Specific features match first.** `matchFeature` takes the first match, so the specific features sit before the
general ones whose words they share: canvas before charts ("grid"), link before symbol, hideDrawings before drawing.
A test pins each choice.

## Context-aware explanations, from the product's own metadata

`guide/explain.js` gets a 4th source: the chart-settings descriptor table
(`components/chart/chartSettingsDescriptors.js`, the same table `chart.setSetting` validates against).

**One setting by name.** For example "what does the bar-close countdown do?", "what is the magnet?". The answer is the
setting's label, where it is in Chart Settings, its values, the prerequisite the dialog enforces (e.g. Thin bars only
for Bars / HLC), and whether the Agent can change it:
- an `eligible` row: yes;
- a `known` row: "I can tell you where it is, but I can't change this one for you yet";
- an `owned:indicators` row: it belongs to the indicator settings.

**"These settings", with Chart Settings open.** The guide reads the dialog's selected tab, then lists that tab's own rows
(those whose `ui` path starts "Chart Settings → <Tab>"), grouped by where they sit.
- With nothing open, it asks in one sentence.
- On the Indicators tab, it points at the indicators themselves, which have their own settings.

**Not answered here.** The table has no prose descriptions, so nothing beyond its label, location, values and
prerequisite is said. A setting the table doesn't describe isn't explained here; the model answers it, as before.

## Maintainability

- Every target is still a registered `data-guide` id. `agentGuideTargets.test.js` rails that each step's target and
  `waitFor` exists in real source, and that each feature's `caps`, `topic` and `doIt.action` are registered.
- Explanations come from the descriptor table, not from a second hand-written list.
- `guide.show`'s feature enum reads `GUIDE_IDS`, so the golden manifest was regenerated: 4 new feature ids.

## Verified in the real Charts workspace (agent-harness)

- **Link:** "how do I link my charts?" put the ring on the chart's own link dot. "do it for me" offered the five colours,
  and Blue set the chart to group B ("Linked the Chart (left) to the blue group (B)"). Undo set it back to A.
- **Hide drawings:** "how do I hide my drawings?" put the ring on the toolbar's eye.
- **Canvas:** with Chart Settings open, "where do I change the chart background?" started at the Canvas step ("already
  part of the way there").
- **Explain these settings:** on the Canvas tab, it listed the Canvas rows (Grid, Crosshair, Scale text, Watermark…)
  from the descriptor table.

## Tests

- **`agentGuideP3.test.jsx`:** 15 tests covering Show me for each new walkthrough (board unchanged), starting part way
  with the dialog open, the layouts menu step, feature precedence, Do it for me for the link colour with Undo, the say
  for hide drawings, settings explanations (by name, by open tab, nothing open, Indicators tab, not described), and the
  panel path being instant.
- **Unchanged and passing:** `agentGuide.test.jsx` (28) and `agentGuideTargets.test.js` (22).
- **Full runs:** vitest across `src/agent` and `builder/agentMutations`, 1,800 passed. Pytest
  `tests/test_uct_agent*.py` and `tests/test_agent_eval_run.py`, 683 passed.
