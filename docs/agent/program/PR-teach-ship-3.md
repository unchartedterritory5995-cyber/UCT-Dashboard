# teach-ship-3: guide targeting — relative, negated and "other" chart references (AUDIT T1–T1f, T2)

Base: ship-2. Stack position: 3 of 5. Local only; not pushed.

## Behaviour changes
- **Words reach `answer()`.** The member's words always travel to `answer()`, which reads the chart they name against the real board (selection oracle flow-ring-named).
- **T1/T2.** `guide/namedChart.js` calls deixis.js's exported `relativeChart` and `negatedPointer`; there is no copy.
  - "the chart below this one" rings the neighbour.
  - "every chart except this one" is asked about, never walked on the click.
  - A relation with no neighbour, or with two, is said or asked.
  - A bare "this" stays the click.
- **T1b.** deixis exports `saysOtherChart`. "the other chart" or "a different chart" with one other chart goes to that chart; with several, it asks; never the click. `OTHER_CHART` is unchanged for execution.
- **T1c.** A bare "another one" is never another chart.
- **T1d.** A chart word that is the click itself ("this chart") never makes "another one" a chart.
- **T1e.** The definite "the other one" is the other chart, as execution reads it.
- **T1f.** After a preposition, "the other one" is the location, so the other chart. Only as the verb's object, with a same-kind thing named before it, does it stand for that thing.
- **T2.** An agreement test runs the same probe set through `namedChart`, `deixis.chartsNamedBy` and execution's `OTHER_CHART` reading.

## Touches deixis / useAgent / runtime / host
**Yes: `deixis.js`.** It adds the exported `saysOtherChart` reader and its helpers. The file is byte-identical to teach-on-b's. That includes `05dba2dbe2`'s own lines, which a file-level split of `f72e5a1e56` had dropped; a labelled commit restores them.
