# teach-ship-3: guide targeting — relative, negated and "other" chart references (AUDIT T1–T1f, T2)

Base: teach-ship-2 (#989). Stack position: 3 of 5. Master `25f049554f` (with #980 teach-ship-1) is merged in through ship-2. Local only; pushed by the Lead. Evidence: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED.

**Production: not yet verified.**

## Behaviour
- **Words reach `answer()`.** The member's words always travel to `answer()`, which reads the chart they name against the real board.
- **T1/T2.** `guide/namedChart.js` calls deixis.js's exported `relativeChart` and `negatedPointer`; there is no copy.
  - "the chart below this one" rings the neighbour.
  - "every chart except this one" is asked about, never walked on the click.
  - A relation with no neighbour, or with two, is said or asked.
  - A bare "this" stays the click.
- **T1b.** "the other chart" or "a different chart": with one other chart, the guide goes to it; with several, it asks; never the click. `OTHER_CHART` is unchanged for execution.
- **T1c.** A bare "another one" is never another chart.
- **T1d.** A chart word that is the click itself ("this chart") never makes "another one" a chart.
- **T1e.** The definite "the other one" is the other chart, as execution reads it.
- **T1f.** After a preposition, "the other one" is the location, so the other chart. Only as the verb's object, with a same-kind thing named before it, does it stand for that thing.
- **T2.** An agreement test runs one probe set through `namedChart`, `deixis.chartsNamedBy` and execution's `OTHER_CHART` reading.

## Files (against teach-ship-2)
- `app/src/agent/deixis.js` (+30)
- `app/src/agent/guide/namedChart.js`
- `app/src/agent/capabilities/guide.js`
- Tests: `agentGuideRelational.test.jsx` (new), `agentGuideNamed.test.jsx`, `agentGuidePages.test.jsx`
- This doc

## Touches useAgent / deixis / host / runtime
- **deixis.js: yes.** It adds the exported `saysOtherChart` reader and its helpers. `OTHER_CHART` and `ordinalChart` are unchanged. The file is byte-identical to the one AUDIT accepted.
- **useAgent, host, runtime: no.**

## Verification (SIMULATED)
- **Full suite before the restack** (at `297e4621aa`): Test Files 266 passed | 5 skipped, Tests 9295 passed | 6 skipped.
- **AUDIT review (11-08):** ACCEPTED, with T1f fixed.
- **Restack:** ship-2 was merged in with no conflicts. This slice's own files against ship-2 are unchanged by the restack.
- **Post-restack full suite:** run on teach-ship-5 `9a689f56b7`, which contains ship-2 through ship-5 on master `25f049554f`. Path set: `src/agent` plus pl-exec's 9 paths; BelowNormal; LOCAL / SIMULATED. Result: `Test Files 299 passed | 5 skipped (304)`, `Tests 9830 passed | 6 skipped (9836)`. No failures.

## Note
`f72e5a1e56` was split by file: its lifecycle part is in ship-2 and its "the other chart" part is here.
