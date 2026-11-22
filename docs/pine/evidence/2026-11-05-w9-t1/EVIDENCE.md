# W9-T1 evidence: S1 broker core ported, gated and dark

Engine bump: no (dark; ledger empty). Base origin/master 7f6dd3714d.

Ported from 34da5eb926 (pine/s1-strategy-broker; c50/r1 branches hold nothing beyond master):
broker.js, strategyBroker.js, strategyBrokerGate.js, ir/lowerIr/program/vm hunks, FE sites F1-F9, F11, F12,
Dockerfile ARG, feature_flags.json, spec, queue, S1 suite. Dropped s1BrokerCensus.measure.test.js.
s1-broker-core.pine: master already holds the extended probe (W9-T3); kept master's.
Changed: opcode 97 -> 100 (after OBJ_DELETE 99); F10 has no counterpart on master (orderOnlyChain is gone), orders in an
`if` lower through the normal statement path, railed; vm: resume/checkpoint disabled for a broker run, probe refused;
brokerRules.js (rule ids -> capture rows); pinned(rule) asked when a run reaches each rule (runtime:strategy-unpinned);
window check (ctx.historyWindowBars, runtime:strategy-start, no JS constant); forming bar needs B-EXEC pinned;
rule 11 (ast/strategyRepaint.js, runtime:strategy-repaint; barstate.isrealtime/isconfirmed and varip are already refused
by their own guards before the broker retry); object door never retries (rule 4); record skeleton keyed by bar time with
per-fill rule; spec gains a pinned-by table.

Mutations (muts.json, run under heavy-mut.lock): control survived; drop-forming-bar-skip, drop-pinned,
drop-rule-11, opcode-97, drop-window-refusal, drop-object-door-gate KILLED. NOTE: muts.json drop-gate (strategyBrokerGate.js returns true) was
KILLED only at a1f5262c33; at 2b91ad5cba it SURVIVED (review B1). It is superseded by muts4.json below.

## Measure-pair (tip a1f5262c33 vs own base worktree at 7f6dd3714d, HEAD asserted before and after each side)
Logs: runs/w9-t1/mpA.log, mpA0 (production lane), mpA1 (runtime-on). An earlier attempt on the shared mpbase3 was void
(another lane moved that base mid-run; its orphaned children were left alone).
- C18 corpus audit and constructed probes: 0 diffs in both lanes (timing field `ms` ignored).
- Census 967 rows both lanes: 0 behavioural diffs. 5 rows differ only by a wall-clock `pine:timeout` (10 s translator
  budget) landing on a different step under load; classified as load noise, not a code diff.
- Vendor harness verdicts byte-identical tip vs base (production 93 MATCH / 103 DIVERGE / 140 INCONCLUSIVE; runtime-on 110/107/119).

## Gate read moved out of the compute closure (final-tip fix)
The first full final-tip failed serverBundle.rail and hostNeutralClosure.rail: the front end read VITE_PINE_STRATEGY_BROKER_ENABLED
inside the server compute closure. The reader is now registered by memberPaneDefinition.js (outside the closure); the front end
holds a default-false reader, so the server stays dark. Mutations (muts2.json): control survived; drop-gate (default true) and
gate-read-in-closure both KILLED. The measure-pair above ran at a1f5262c33; this change only moves where the flag is read
(default off, behaviour identical with the flag off). Unrelated master failures seen in final-tip:
usePreferences.additionsOnly (TodayHome.jsx opaque setPref, red on base 7f6dd3714d too) and useWakeWord.lazy (passes alone).

## Gate registry (second final-tip fix)
pineRuntimeFrontendGate.test.js refused memberPaneDefinition importing pineRuntimeFrontend. The reader now lives in the import-free
engine/strategyBrokerGateRegistry.js; the front end reads it, memberPaneDefinition registers the flag. Mutations (muts3.json): control
survived; drop-gate and gate-read-in-closure KILLED. Failures left in the full run are the master baselines plus usePreferences.additionsOnly
(red on base 7f6dd3714d).

## B1 fix (review W9-T1 NO-GO @2b91ad5cba): the flag reader railed through the product path
New rail strategyBrokerGate.product.test.js: strategyBrokerEnabled() under stubbed env (only '1' opens it); the registry default and
a non-function registration are OFF; memberPaneDefinition.js's registration drives buildRuntimeIr with NO option: env unset/''/'0'/'true'
refuse pine:strategy-call, env '1' retries into broker mode. muts4.json at this tip: control SURVIVED; drop-gate-reader-true,
loosen-to-truthy, register-true, registry-default-true all KILLED. muts3 re-run: control SURVIVED, drop-gate and gate-read-in-closure
KILLED. muts2.json is obsolete (its target text was replaced by the registry; BADMATCH) and is superseded by muts3/muts4.
