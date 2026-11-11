# PR: Compare a whole group: add, remove, a group's scale (C1-035, C1-037, C1-040)

Branch `agent/pl/compare-groups-exec` (pl-exec), on master `9c9e64681a`. It is one family and can be released on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence.

## What a member can now ask

Tools → Compare Symbols can add a whole theme, sector or industry as overlay lines, remove a group with the group row's ×, and set a group's scale with its "Same % scale" / "New price scale" buttons. Before this change the Agent could only compare single tickers (`chart.compare`). The new capability `chartSetup.compareGroup` does the three group controls on ONE chart:

| Row | Request | What runs | Undo |
|---|---|---|---|
| C1-035 | "compare this chart against the AI Chips theme" | the group picker's click: `compareGroups.withGroupAdded` over the members from `/api/compare/group-members` | exact (the comparison list before) |
| C1-037 | "remove the Semiconductors group from this chart" | the group row's ×: `compareGroups.withoutGroup` | exact |
| C1-040 | "put the Semiconductors group on the main price scale" | the group's scale buttons: `compareGroups.withGroupScale` | exact |

The panel and the Agent now compute the next list with the same three helpers. Before this change the panel computed the list inline. The Agent's result is checked against the list the real panel passes to `setComparison` after the same click (`agentCompareGroups.test.jsx`, the parity tests).

## Safety rules

1. The group name is matched by UCT, not the model. One match acts. More than one asks with the real names ("More than one group matches “semis”: Semiconductors (industry), Semiconductor Equipment (industry). Which one did you mean?"). No match says there is no such group. An exact name beats partial ones.
2. If a group list could not be read, the Agent never says "no such group". It says the list is unavailable, and nothing is changed. The panel's own picker still shows "No matches" there; `readGroupList` (new) returns null on failure, and `fetchGroupList` keeps master's body unchanged.
3. Remove and scale act only on groups that are compared on this chart. If the name matches no group, or no name is given while two or more groups are compared, the Agent asks with the chart's own group names.
4. A percent or log scale is switched off when a group gets its own % scale (the rule `chart.compare` and `chartSetup.compareDisplay` already follow).
5. Removing a group asks nothing, the same as the panel's ×. It is undoable, so there is no confirmation card. The receipt comes only from a committed write that the chart kind read back.

Mutants (each one turned at least one test red, then was reverted):
- An unregistered capability (failing first): every test that runs the capability went red.
- A failed list read treated as empty: the "never no such group" test went red.
- An ambiguous name resolved to its first match: the ask test and the matcher test went red.
- `withoutGroup` dropping every group: the remove parity test went red.

## The move out of the Compare panel: is it behaviour-identical?

Yes. The panel's three group list writes moved from `CompareSymbolsPanel.jsx` (master) into `app/src/pages/charts/compareGroups.js`. Side by side:

**Add a group (`addGroup` → `withGroupAdded`)**

| master, inline in `addGroup`'s `setSymbols(prev => …)` | this PR, `compareGroups.withGroupAdded(prev, name, members, pickColor)` |
|---|---|
| `const have = new Set(prev.map(x => x.sym))` | same |
| `const used = new Set(prev.map(x => String(x.color).toLowerCase()))` | same |
| `let idx = prev.length` / `const additions = []` | same |
| `for (const s of members) { if (have.has(s)) continue` | same |
| `const color = pickComparisonColor(idx++, used)` | `const color = pickColor(idx++, used)`: the panel passes `pickComparisonColor` in as `pickColor` (and so does the Agent) |
| `used.add(color.toLowerCase())` | same |
| `additions.push({ sym: s, enabled: true, color, scaleMode: 'new', group: name })` | same |
| `if (!additions.length) return prev` | same, inside the helper |
| `const next = [...prev, ...additions]` | `return [...prev, ...additions]` |
| `apiRef.current?.setComparison(next); return next` | in the panel: `const next = withGroupAdded(…); if (next === prev) return prev; apiRef.current?.setComparison(next); return next` |

The fetch, the empty-members early return, `setGroupType(null)`, `setGroupQuery('')` and the `catch` stay in the panel unchanged.

**Remove a group (the group row's ×)**: master `push(symbols.filter(x => x.group !== name))` → `push(withoutGroup(symbols, name))`, and `withoutGroup = (prev, name) => prev.filter(x => x.group !== name)`. The filter is verbatim.

**A group's scale (Same % scale / New price scale)**: master `push(symbols.map(x => x.group === name ? { ...x, scaleMode: sm } : x))` → `push(withGroupScale(symbols, name, sm))`, and `withGroupScale = (prev, name, scaleMode) => prev.map(x => (x.group === name ? { ...x, scaleMode } : x))`. The map is verbatim (the parameter is renamed `sm` → `scaleMode`).

**`fetchGroupList`** (the panel's picker and the Rotation tab): byte-for-byte master's body. The Agent's new reader `readGroupList` is a separate function, so the panel's reads do not go through it.

Every logic change, named:
1. `pickComparisonColor` → the `pickColor` parameter. The helper lives below the panel and takes the colour picker as an argument. The panel passes the same function, so the colours are the same.
2. `sm` → `scaleMode` (parameter name in `withGroupScale`). Same value.
3. "No additions" now shows up in the panel as `next === prev`. The helper returns `prev` itself exactly when master returned `prev` (no additions), so the panel still skips `setComparison` and returns `prev` in the same cases.
4. New and not in the panel's path: `readGroupList` (null on a failed read, for the Agent) and `groupsIn` (the Agent lists a chart's groups). The panel calls neither.

Reverted to verbatim in `ae7e483622`, because neither change was needed:
- `withGroupAdded` had added `have.add(s)` inside the loop. That de-duplicated a member listed twice by the server, which master did not do. Removed.
- `fetchGroupList` had become `(await readGroupList(type)) || []`. That changed one case: a truthy non-array `groups` would come back as `[]`. Master's body is restored.

## Tests (single files, no lock)

- `app/src/agent/agentCompareGroups.test.jsx`: 11 tests. They cover parity with the real panel for add, remove and scale; read back; exact Undo; a two-chart wrong-target control (the other chart's settings object is untouched); the ask, none and unavailable cases; the no-op; and routing words.
- Capability-regression corpus intent `compare.group.aiChips`. Through the real chat panel it runs a model op, then plan, commit, receipt and undo (finalState slice 3, plus routing v1 and v2). It passes for 3 phrasings plus undo.
- **The Compare panel's own tests**, run at `ef07f9a4fd` (after merging origin/master `7e9d52d318`), single files, no lock, BelowNormal, node_modules is a Junction to `C:\w\pl-mc-fw\app\node_modules`. All green, 8 files, 96/96:
  - `app/src/pages/charts/CompareSymbolsPanel.test.jsx`: 9/9. The 4 new `group controls` tests click the real panel and check the list it hands `setComparison` against a literal list, not the helper. They cover **add** (members not yet compared, a new colour each, own scale, tagged with the group), add when every member is already compared (no write), **remove** (the group row's × drops only that group), and **scale** (the group's Same % scale, then New price scale, changes only that group's members).
  - `app/src/pages/charts/CompareSymbolsPanel.focus.test.jsx`: 5/5
  - `app/src/pages/charts/CompareSymbolsPanel.rotation.test.jsx`: 15/15 (it uses `fetchGroupList` through the Rotation tab)
  - `app/src/pages/charts/mobile/phoneCompareHistory.doors.test.jsx`: 7/7
  - `app/src/hub/sections/chartSection.test.jsx`: 23/23
  - `app/src/components/chart/comparisonUtils.test.js`: 11/11 (`pickComparisonColor`)
  - `app/src/agent/agentCompareGroups.test.jsx`: 11/11 (the Agent matches the real panel for add, remove and scale)
  - `app/src/agent/agentRouting.test.jsx`: 15/15
  - Not counted as panel tests: `formControls.census.test.js` and `keyListenerCensus.test.js` mention the panel only in a repo-wide census. Each has failing ratchets (3 and 2) whose flagged files are all outside this PR's diff (journal NoteSharePanel, lab pieces, study, breadth drill, StockChart, FeedbackWidget). That is a master/environment red, not this change.
- Related files run together (at 3f86a0e2d7): agentRouting, agentOperatorLive, agentContracts, agentNl1Selection, capreg inventory, agentDiscoveryWordBoundary, agentEvalBaseline, agentConversationUnits, noRegexLookbehind, agentNoLookbehindStrings, CompareSymbolsPanel focus + rotation, agentBatch6, agentChartsOperatorP1. Result: 15 files, 864/864.
- pytest on the 28 server test files that read the regenerated golden, parity, corpus and lock files: 1174 passed, 1 failed. The failure is `test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads`, which lists api/ files this PR does not touch (ai_search.py, groups.py, turn.py and others). It is a master red, not this change.
- Regenerated: `manifest.golden.json` (UPDATE_AGENT_GOLDEN=1), `tests/fixtures/nl1_assemble_parity.json` (UPDATE_NL1_PARITY=1), capreg `coverage/*` (UPDATE_CAPREG=1), `baseline.lock.json` (`tests/test_uct_agent_capreg_baseline.py --update`, additive only).

## Walkthroughs

C1-035, C1-037 and C1-040 are already VERIFIED in CHARTS_TEACH_STATUS.md (`compareAction`: `compare.groups`, `compare.removeGroup`, `compare.groupScale`). Those data-guides are still on the same panel controls (this PR does not change the panel's markup). No change needed.

## Status rows (for the recount at merge, CHARTS_EXECUTION_STATUS.md not edited here)

C1-035, C1-037, C1-040: MISSING → VERIFIED (simulated). Test: `agentCompareGroups.test.jsx` (parity with the real panel) + capreg `compare.group.aiChips`.

## Requests to try live (a chart open on /charts)

1. "compare this chart against the semis group": it should ask which one (Semiconductors or Semiconductor Equipment, whatever the server's industry list holds) and change nothing.
2. "compare NVDA with the Semiconductors industry": the members are overlaid as one collapsible group in Tools → Compare Symbols. Then Undo.
3. "put the Semiconductors group on the main price scale": the group row's "Same % scale" is lit.
4. "remove the Semiconductors group": only that group goes, and single tickers stay.
5. With two groups compared, "remove the group": it should ask which group and name both.

## Known limits

- The Compare panel itself does not cap a group (the server returns at most 50 members). The Agent mirrors this. A truncated group says "the first 50 of its N" in the receipt.
- `chart.compare`'s 5-symbol ceiling (MAX_COMPARISONS, from ComparisonPicker) still applies to single-ticker adds. After a group is compared, "also compare QQQ" is refused as over the ceiling. This is existing behaviour, not changed here.
- As in the panel, a group's member that is the chart's own symbol is overlaid too.
- Group names come from `/api/compare/groups`, so the words must match those names ("semis" works only when exactly one name starts with "semi").
- No fast path: group requests go through the model, which passes the member's words. UCT then matches them.
- "Group only" (hide the base chart) and the per-symbol scale remain `chartSetup.compareDisplay`.
