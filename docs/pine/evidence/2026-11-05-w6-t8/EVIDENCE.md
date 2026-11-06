NEXT STEP: heavy jobs, in the coordinator's order: (1) mutate.py batch, (2) measure-pair runtime-on (0 C18 verdict diffs, `adx-and-di-for-v4` unmoved, classify every diff), (3) merge origin/master again, then final-tip FULL + ready-check. None of them has run yet (heavy-job rule: stopped for the coordinator).

# W6-T8 `map.*` on the runtime lane (lane w6-t8)

Base: origin/master f9651f47ee (engine 21). Spec: W6-BREAKDOWN T8 + section 3 (origin/docs/pine-w6-breakdown @1889bbedd7).
Worktree `C:/Users/Patrick/uct-worktrees/pine-dsk-land19`, branch `feat/pine-w6-t8-map`. Logs:
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w6-t8/`. Node 20.20.2 (`dsk/node20.sh`) for every vitest run,
`--maxWorkers=1`, after `ram_gate`.

**Engine bump: yes** (refusals become served values on the runtime pane; the coordinator bumps at landing).

## Authorities (quoted in each rail of `runtime/__tests__/w6Map.test.js`)
- REF: the Pine v6 reference entries `map.new<type,type>`, `map.put`, `map.get`, `map.contains`, `map.remove`, `map.keys`,
  `map.values`, `map.copy`, `map.size`, `map.clear`, `map.put_all`, read 2026-11-06 through
  `tools/pine_survey/pine_reference_extract.js` (the JSON stays out of the repo).
- MAN: the Pine user manual, Maps page, https://www.tradingview.com/pine-script-docs/language/maps/, read 2026-11-06.

## Served (runtime pane only)
- `runtime/maps.js` (new, sibling of `collections.js`): `buildMapFns({ CollectionError })` merged into `collections.js`'s
  ONE table (`ARRAY_FNS`), so one VM op (`OP.ARRAY`) and one FE admitter (`admitArrayCall`); `isMap`, `mapFromParts`,
  `MAP_WRITES`, `MAP_MAX_PAIRS`. A map is `{[Symbol.for('uct.pine.map')]: true, kt, m: Map}`: a reference (aliases on
  assignment), never frozen.
- `map.new<K, V>()`: K in int, float, bool, string, color (REF: "`keyType` can be a primitive type or enum. For example:
  int, float, bool, string, color."). An enum key stops by name (waits for W6-T10).
- `put` (REF: "The previous value associated with `key` if the key was already present in the map, or na if the key is
  new."), `get` (MAN: "This function returns the value if the `id` map contains the `key`. Otherwise, it returns na."),
  `contains`, `remove` (REF: previous value or na), `size`, `clear`, `keys` / `values` (REF: a copy, insertion order),
  `copy` (MAN: shallow, independent of the original), `put_all` (MAN: "in their insertion order … without affecting their
  initial insertion order"), and the method form (`m.put(k, v)`) through the existing `methodNsOf` site.
- Re-put of a present key keeps its place (REF `map.put` / `map.new` remark: "Note that the order does not change when
  inserting a pair with a `key` that's already in the map."). ⚠️ The spec kept this refused until W6-K1; the reference
  sentence states it, so per the brief it is served and K04 confirms it.
- Remove-then-put lands at the END. ⚠️ REVIEWER CALL: this rests on two sentences read together (REF put: the key "is
  new"; MAN: "The only exception is if the script completely removes the key beforehand."), not on one sentence that
  says "at the end". K05 confirms it. If the reviewer rules it unpinned, the fix is a per-map removed-key set that stops
  by name (and is encoded by `vmState`).
- MAN cap: "the maximum number of key-value pairs that a map can contain is 50,000." The 50,001st new pair stops by name;
  a replacement at the cap is served. `ARRAY_ELEMENTS` is peaked at 2 x pairs (MAN: "up to 100,000 elements in total").
- `vm.js::heldNow` walks map values (a drawing held as a map value is held in a collection: the C7 collector withholds).
- `vmState.js`: `encodeState` encodes a map by key type and pairs IN ORDER; `cloneValues` deep-copies it, aliasing kept.

## Refused / stopped by name (each has a rail that reaches it)
- An `na` key on put / get / contains / remove: `… with an \`na\` key — … (W6-K1)`, `runtime:CollectionError`.
- An `na` map id: `` `map.size`: the map is `na` … `` (no VM kind sentence: map arguments are declared `any`, checked in
  `maps.js`).
- A value that is an array / matrix / map (REF: "`valueType` can be of any type except `array<>`, `matrix<>`, and
  `map<>`."); a key of the wrong type; `put_all` across key types; an enum key type.
- `for [k, v] in` a map stays refused (W6-F1, T6's line, untouched). The manual does state the walk order; that is a T6
  follow-up, not this lane.
- C18 object door: every `map.*` member is in `DOOR_GATED_ARRAY` (`heldArray` false), so the door refuses with master's
  guard and sentence. Pinned from master f9651f47ee by running this file's `doorRun` / `paneBuild` with master's four
  engine sources in place (reverse patch, restored and diffed): `runs/w6-t8/door-master.txt` == `door-branch.txt`
  (all 11 shapes `{ok:false, labels:null}`, `runtime:array`, "… — `map.new`"; control `586.915`).

## Rails
- `runtime/__tests__/w6Map.test.js` (new, 38 tests): every member with its quote; insertion order with keys put b, a, c
  (sorted order disagrees); re-put in place; remove-then-put at the end; put_all order; get/put/remove na answers;
  alias + copy + shallow; `var` persistence; every W6-K1 stop; 50,000 cap; roster, `writes`, v6 `for` bound refusal,
  door gating, `kindOf`; `encodeState` / `cloneValues`; collector withholds + control.
- `objectDoorGate.test.js`: W6-T8 block (11 shapes x door draws master's answer / pane builds / door refuses with master's
  sentence, + array control), appended at EOF.
- Updated: `p3StatementsBlockValues.test.js` (the `<string, float>` control now builds and runs), `w6TypeDescriptor.test.js`
  (map receivers are admitted under the map family and stop at run on an `na` map).
- Targeted run, final tree: 22 files, 676 tests pass (`runs/w6-t8/targeted.txt`).

## Hand mutations (`runs/w6-t8/handmut.py`, `handmut-fe.py`; file restored byte-for-byte after each)
M0 no-op control GREEN (38/38, final tree). Killed: M1 keys() sorted (4 red), M2 put returns the new value (3), M3 re-put moves to the
end (1), M4 missing key answers 0 (2), M5 na key admitted (1), M6 no 50,000 cap (1), M7 maps not door-gated (21 red in
objectDoorGate), M8 collector skips map values (1), M9 checkpoint shares the map (1), M10 copy aliases (2), M11 put_all
reversed (1), M12 na map answers a map (1), M13 FE: map.new not a collection binding (25), M14 FE: map.keys binding read
as a map (1; the rail was added after this mutation first survived). Logs `handmut.log`, `handmut-fe.log`.

## Canary / hostParity
No case changes status from this lane: no `services/pine_runtime` canary case and no hostParity corpus case
(`runtime/__fixtures__/hostParity/corpus`, 41 scripts) uses `map.*`, and every withheld case's guard is unrelated
(`runtime:limit`, `runtime:request`, `warmup-never-converges`, …). The engine bump at landing regenerates the digests
as for every bump. Not yet re-run under final-tip.

## Parallel lane W6-T7 (matrix)
Shared-file edits are additive and placed apart from T7's hunks. Trial merge of `origin/feat/pine-w6-t7-matrix`
@f15cc651fb into this branch (`git merge --no-commit`, then `--abort`): textually clean, and w6Map + w6Matrix +
objectDoorGate + w6TypeDescriptor + p3StatementsBlockValues + arrays + functionBodyBlockValue all pass on the merged tree
(413 tests, `runs/w6-t8/trial-merge-t7.txt`). ⚠️ The first trial found a SEMANTIC conflict: T7's held-member line in
`collectionKindOf` answers `map.new` as `array`; fixed here by asking the map family first (`5d41be2b29`), so either
merge order is correct.

## Other findings
- `evidence_engine.py queue --check` FAILs on master f9651f47ee itself (the committed `capture-queue.json` is stale), with or
  without this lane's W6-K1 section; not regenerated here (T5 made the same call).
- Not served by the runtime lane today and outside T8: a method-form initialiser (`c = m.copy()`, and `b = a.copy()` for
  arrays) leaves the name untyped, and a field read off a call result (`m.get(k).v`) is `pine:member`. Both are T9.
- Spec movers (`supply-demand-mtf-flux-charts`, `support-resistance-mtf-flux-charts`) are not in the local 271-script
  sample; `divergence-screener-trendoscope` keys its maps by an enum, so it also needs W6-T10. measure-pair will say.

## Capture queue
`docs/pine/capture-queue-2026-11-06-w6.md` section W6-K1 (placed before Q-W19R2a so T7's EOF append merges cleanly), probe
`tools/visual_conformance/probes/vw-w6-map.pine` (K01-K10 confirm the served rules, N01-N04 ask the `na` key).
