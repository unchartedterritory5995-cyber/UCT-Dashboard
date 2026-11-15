// tools/vendor_harness/census_output.mjs
//
// ─── WHAT THE MEMBER-DOOR CENSUS WRITES — one authority for both writers ─────
//
// `memberDoorCensus.measure.test.js` (a single run) and `parallel_run.mjs` (the
// merge of N shard runs) both build the census JSON through `censusDocument`, so
// the merged file is the single run's file byte for byte (`parallel_rail.mjs`
// proves it on a fixed subset).

/** @param {{flag: string, ambientFlagOn: boolean, librariesLoaded: any, files: number,
 *           off: object[], on: object[], runtime: object[]|null, runtimeFlag: string}} c */
export function censusDocument({ flag, ambientFlagOn, librariesLoaded, files, off, on, runtime, runtimeFlag }) {
  const states = runtime ? { off, on, runtime } : { off, on }
  return JSON.stringify({
    generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js',
    door: 'enterMemberDoor (ourSide.js): memberPaneDefinition -> installUserDefinitions',
    corpus: 'corpus/committed',
    flag,
    ambientFlagOn,
    librariesLoaded,
    files,
    attached: {
      off: off.filter((r) => r.attached).length,
      on: on.filter((r) => r.attached).length,
      ...(runtime ? { runtime: runtime.filter((r) => r.attached).length } : {}),
    },
    ...(runtime ? { runtimeFlag } : {}),
    states,
  }, null, 1) + '\n'
}

/** The line the census prints. */
export function censusLine({ flag, runtimeFlag, files, off, on, runtime, out }) {
  return `member-door census: ${flag} off ${off.filter((r) => r.attached).length}/${files}, `
    + `on ${on.filter((r) => r.attached).length}/${files} attach`
    + (runtime ? `, +${runtimeFlag} ${runtime.filter((r) => r.attached).length}/${files}` : '')
    + ` -> ${out}`
}
