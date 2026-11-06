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
