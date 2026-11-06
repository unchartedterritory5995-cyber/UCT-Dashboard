VERDICT: GO-WITH-NOTES @0ab2effdcd

Lane: fix/lookback-oracle-deterministic, code tip da1f6b7b5b, HEAD 0ab2effdcd (evidence only).

1. Determinism: translateUnit passes now: FROZEN_CLOCK; pine.js beginTranslateBudget uses opts.now as TRANSLATE_WINDOW_CLOCK and Resolver uses opts.now (pine.js:6958, 7135, 9008), so no clock limb can fire. parse/interpret/lint read no clock. Walk order is sorted readdir x fixed lanes; Map insertion order follows it; timed_out sorted. Ran the test twice at --maxWorkers=1: 10/10 pass, oracle sha256 ff61ca98... both times, identical to committed file.
2. Rows unchanged (146), trees 608->594, 7 units listed (3 scripts both lanes + 1 host-only + ... see file). Python test passes (5) incl. new all-or-nothing test. NOTE: trees from the 4 timed-out scripts are no longer compared by the readers at all; before they were compared only partially and nondeterministically, so nothing deterministic is lost, but these scripts are a visible blind spot (named in timed_out, not silent).
3. Mutation (drop `continue` in collect): CONTROL + live NO-TIMED-OUT rail both fail (2 failed). Restored by copy, cmp ok.
4. contractVersions.test.js 4/4 pass; pine_contract_coverage.py accepts the additive field; version stays 1.
5. Diff vs merge-base: 4 files (test, py test, oracle json, EVIDENCE.md); no product code, no engine bump. git merge-tree vs origin/master clean.
