NEXT STEP: final-tip FULL + ready-check on the merged tree, on the coordinator's go (holding). measure-pair DONE (0 C18 diffs both runtimes); origin/master 61f49a2843 merged.

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

## r1 — review B1 (NO-GO @acfbbeba50, `dsk/reviews/W6-T8.md`)
- B1: a v6 bool-valued map answered `na` for a missing key (a v6 bool is never `na`). Fix:
  - the map carries its VALUE type: `map.new<K, V>` hands `K,V` to the run (`pineRuntimeFrontend.js::mapTypeArg`,
    `maps.js::MAP_TYPE_SEP`); `vt` survives `map.copy`, `cloneValues` and is part of `encodeState`; `vmState.js` now
    imports `isMap` / `mapFromParts` from `maps.js` (note N3: one authority for the tag);
  - `maps.js::naAnswerable`: a missing-key answer is `na` only where the value type can hold it (every v6 type but
    `bool`) or the script is v5 or older (MAN's answer stands there). Otherwise the run STOPS by name: a `get` of a
    missing key, and a `put` of a new key / `remove` of a missing key whose answer is READ (the FE marks a value use
    `MAP_ANSWER_READ`; as a statement the answer is dropped and the call is served). An unknown value type or version
    fails closed;
  - other value types checked: int, float, string, color, a user type and a drawing all hold `na` in v6; only `bool`
    cannot. Rails cover int, string and color in v6 and bool in v5;
  - queue row W6-K1 gains N05 (probe rows N05a-c, a v6 `map<string, bool>`).
- Remove-then-put rail now also quotes MAN: "Pine Script internally maintains the insertion order of a map's key-value pairs."
- Rails: `w6Map.test.js` 44 tests (6 new). Targeted batch on the r1 tree: 22 files, 682 tests pass (`runs/w6-t8/targeted-r1.txt`).
- Hand mutations (`runs/w6-t8/handmut-b1.py`, `handmut-b1.log`): B0 no-op control GREEN (44/44); killed: B1 guard dropped (3 red),
  B2 FE read flag dropped (1), B3 value type not carried (9), B4 v5 exemption dropped (2), B5 copy drops the value type (1),
  B6 checkpoint drops the value type (1).
- Not changed (non-blocking notes): N1 a missing string-valued key answers `na` (representable in v6; a later `str.*`
  stops with the VM kind sentence, fail-closed); N2 colour keys compare packed RGBA.

## mutate.py batch (coordinator GO @01cea6311c)
`runs/w6-t8/mutjob.sh` under `dsk/heavy-mut.lock`, ram_gate 6 GB, one mutation per call of a `--maxWorkers=1` copy of
`mutate.py` (`runs/w6-t8/mutate-w1.py`; the shared script hard-codes 2), free RAM checked >= 4 GB before each (lowest
10.8 GB). Test files: `w6Map.test.js`, `objectDoorGate.test.js`. 21 mutations (`runs/w6-t8/muts.json`, output
`mutate.out`): M0 no-op control SURVIVED (correct); M1-M14 and B1-B6 all KILLED. Tree clean after (`git status` empty).

## measure-pair (coordinator GO @85f954989f; `runs/w6-t8/mp.sh`, `mp-all.log`, `mp0/`, `mp1/`)
Lane-owned base `C:/Users/Patrick/uct-worktrees/pine-dsk-w6t8-base` (detached at the merge-base f9651f47ee; node_modules
junction to mpbase2's), lock `dsk/heavy-mp4.lock`, ram_gate 6 GB, `VITEST_MAX_WORKERS=1`, census sequential. Free RAM never
fell below 5 GB (watched every 20 s). HEADs unmoved on both runtimes. The earlier queue on mp2 was reaped while waiting
(nothing ran).
- **C18: audit 395 rows / probes 69 rows, 0 diffs on runtime 0 AND runtime 1.**
- `adx-and-di-for-v4`: identical harness verdicts on both runtimes (not in any diff).
- Census runtime 1, 15 rows differ, all classified:
  - INTENDED (11): the reference examples `map.clear`, `contains`, `copy`, `get`, `keys`, `new<type,type>`, `put`,
    `put_all`, `size`, `values` and `types:map` now ATTACH (`attached`, `reachedAfterPeel` false -> true).
  - INTENDED, first wall moves (3): `supply-demand-mtf-flux-charts` (step 0 `runtime:array` -> `runtime:block-value`, a W4
    wall: the expected mover "with W4"), `support-resistance-mtf-flux-charts` (`runtime:array` -> `pine:builtin`),
    `divergence-screener-trendoscope` (step 3 `runtime:array` -> `pine:statement`).
  - NOISE (1): `multi-timeframe-trend-indicator` (refusal count 3 vs 2 at a host step; no `map.` in the script; the same
    row moved the other way on runtime 0).
- Census runtime 0, 16 rows differ: the same 11 examples (`runtime.attached`, INTENDED); NOISE (5, none uses `map.`):
  `multi-timeframe-trend-indicator`, `volatility-coil-edge-bullbyte`, `halftrend-longshort-signal-engine-bigbeluga`,
  `mirage-liquidity-sweep-pro-willyalgotrader` (host `pine:timeout` steps landing differently), and
  `luxy-momentum-trend-and-breakout…` (host `pine:function` step `attemptedOps` 244 vs 0, the luxy timeout noise T5 named).
- Harness: runtime 0 identical (93/103/140 both). Runtime 1 tip 111/107/118 vs base 112/107/117: the ONE moved capture is
  `delta-rsi-oscillator-strategy-rddt-1d` (4 plots MATCH -> INCONCLUSIVE "computeFor returned no column"), the brief's
  named wall-clock flake: re-run ALONE it is INCONCLUSIVE on BOTH the tip and the base (`runs/w6-t8/drsi-rerun*`,
  `drsi-base*`), and the script has no `map.`. Not a lane effect.
- 0 unintended diffs.

## Merge
origin/master 61f49a2843 merged (clean; master moved only with study and W6-T1 tooling; `SCRIPT_ENGINE_VERSION` still 21).
Targeted rails after the merge: w6Map, objectDoorGate, w6TypeDescriptor, p3StatementsBlockValues, w6ForIn, w6ArrayMembers
352/352. W6-T7 is not on master yet; when it lands, keep both sides in objectDoorGate.test.js and re-run the trial-merge rails.
