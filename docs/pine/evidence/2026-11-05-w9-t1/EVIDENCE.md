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

Mutations (muts.json, run under heavy-mut.lock): control survived; drop-gate, drop-forming-bar-skip, drop-pinned,
drop-rule-11, opcode-97, drop-window-refusal, drop-object-door-gate all KILLED.

## Measure-pair (tip a1f5262c33 vs own base worktree at 7f6dd3714d, HEAD asserted before and after each side)
Logs: runs/w9-t1/mpA.log, mpA0 (production lane), mpA1 (runtime-on). An earlier attempt on the shared mpbase3 was void
(another lane moved that base mid-run; its orphaned children were left alone).
- C18 corpus audit and constructed probes: 0 diffs in both lanes (timing field `ms` ignored).
- Census 967 rows both lanes: 0 behavioural diffs. 5 rows differ only by a wall-clock `pine:timeout` (10 s translator
  budget) landing on a different step under load; classified as load noise, not a code diff.
- Vendor harness verdicts byte-identical tip vs base (production 93 MATCH / 103 DIVERGE / 140 INCONCLUSIVE; runtime-on 110/107/119).
