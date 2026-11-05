VERDICT: GO-WITH-NOTES @9822dfb19053

# r2 delta re-review: 9af15dce85a0 -> 9822dfb19053 (commit 9822dfb190). Read-only static review, nothing executed.
- B8 FIXED. final-tip.sh errs_of sums every '^ *Errors +N' line from the stripped js.log, which in shard mode is the concatenation of all shards. It writes errors=N and shard_errors to FINAL_DONE.
  ready-check.sh fails when errors!=0, and also when the key is missing (old-format FINAL_DONE).
  The fd parser cannot pick up 'shard_errors=' as 'errors=', because the key must sit at line start or after a space.
- No other changes since r1. B1-B7 stay fixed, and notes N1-N8 still apply (non-blocking).
- Adoption condition, unchanged from r1: the first real measure-pair run with MP_CACHE on must show BASE CACHE FILLED, then HIT, with byte-identical base outputs. Until that run exists, cache-HIT evidence is not accepted, and MP_CACHE=0 is always acceptable.
- Merge order: tooling and docs only, independent of the parity lanes, no engine bump.

---
# r1 review (kept for history; its verdict is superseded)

# r1 delta re-review: 36bc5aacc388 -> 9af15dce85a0 (commits 3e6d7a44cb, 9af15dce85)
Read-only static review of `git diff 36bc5aacc388 9af15dce85a0`. Nothing was executed and the builder's self-tests were not re-run.

## r0 blockers: status
- B1 FIXED. measure-pair.sh MP_ENV_RE (AUDIT_C18_|VENDOR_|VITE_|PINE_|... plus MP_CACHE_EXTRA_ENV): if any of these vars is set, even to an empty value, there is no key, so nothing is used or filled. This fails closed: a broad list only costs speed.
- B2 FIXED. cache_key refuses on any untracked file (only .uct-session-owner is allowed) and on any ignored file under corpus/, tests/fixtures/ or app/src (`git ls-files -o -i`).
- B3 FIXED. The key now includes app/node_modules/.package-lock.json, node_modules/vitest/package.json, app/package-lock.json and app/.env*. A missing file means no key.
- B4 FIXED. side_clean removes the base outputs before the side runs. cache_fill needs exactly the expected number of step rc lines (3, +1 census, +6 rev), all rc=0. MANIFEST is a sha256 list. Restore runs `sha256sum -c` plus a file-count check, so a mismatch is a miss.
- B5 MOSTLY FIXED. FINAL_DONE now carries scope, every rc, shard_rcs, totals, jsfail and integrity. ready-check FAILs on scope!=full, integrity!=ok, totals!=ok, gate/hyg!=0, py not in {NA,0}, js!=0 with no named file, or a named failing file outside BASELINE_FAIL_RE. An old-format FINAL_DONE fails. See B8 for the remaining gap.
- B6 FIXED. has_totals is checked per shard. A missing summary sets totals=missing, prints "AGG INCOMPLETE" and exits 6. JS_RC is the highest shard rc.
- B7 FIXED. Any untracked file refuses with exit 5. At the end, HEAD and the tree are checked again; a change sets integrity!=ok and exits 6.
- ram_gate: three unreadable readings in a row mean return 1. Fixed.

## BLOCKING (new, small)
B8 (MED) ready-check.sh js-failure policy (fd js / jsfail block) together with final-tip.sh JSFAIL (the `^ *FAIL +` parse).
  An error is masked when vitest reports an UNHANDLED error (summary line `Errors  N error(s)`, rc=1) that produces no `FAIL <file>` line, and in the same run a baseline file (pollingSites.rail / settingsScope.rail) fails.
  In that case jsfail lists only baseline files, and ready-check prints READY-CHECK PASS while the lane's own error is hidden. OPS-SPEED's own self-test shows a baseline pair failing on older trees, so the coincidence is realistic.
  Without a baseline failure the gap is closed: js!=0 with jsfail=none fails.
  Fix: final-tip sums `^ *Errors +([0-9]+)` from the stripped logs into `errors=N` in FINAL_DONE. ready-check FAILs when errors is non-zero or the key is missing. That is a few lines and needs no full run.

## Notes (non-blocking)
- N6 MP_SOURCE_ONLY: if this var leaks into the environment of a real run, the script exits 0 without measuring. It also prints no MEASURE_DONE, so evidence that requires MEASURE_DONE is still safe. Consider also refusing when $# > 0.
- N7 The baseline allowlist is a whole-file match. Any new failure inside pollingSites.rail or settingsScope.rail is also excused. Acceptable while these files are the known-red pair, but the list should shrink as soon as they are fixed. This is one authority, in ready-check.sh only.
- N8 Stale outputs on the tip side: side_clean runs only for the base side. The tip side is never cached, so this is the same as before r1, but stale tip files could still survive a crashed step. Running side_clean for both sides costs nothing.
- N1-N5 from r0 still apply (docs/ includes the measuring scripts; hl's RAM behaviour change; lane_env does not resolve paths; retire-worktree deletes the owner marker; final-tip exits 0 on test failures by design).

## Is the missing end-to-end measure-pair run blocking for adoption?
No, for correctness. Every r1 change on the measure-pair cache path fails closed:
- a regex or count mismatch means no fill;
- a manifest or count mismatch means a miss;
- an env var or untracked file means no key.
None of them can serve a wrong base. What has not been proved is that a valid entry actually FILLS and HITS under the new gating; the r0 self-test proved that on the old code. Condition for adoption: the first real use, with MP_CACHE on, on pine-dsk-mpbase2 or a lane base, must show `BASE CACHE FILLED` and then `BASE CACHE HIT`. Its out-base.json, probe-base.json and harness-base must be byte-identical (sha256) to the fresh run's. Until that run exists, evidence quoting a cache HIT is not accepted. MP_CACHE=0 is always acceptable.

Merge order: unchanged. Tooling and docs only; independent of the parity lanes; no engine bump. Re-review after the B8 fix can be a delta of ready-check.sh and final-tip.sh only.

VERDICT: NO-GO @9af15dce85a0 (single small blocker B8; everything else GO)

---
# r0 review (kept for history)
VERDICT: NO-GO @36bc5aacc388

Lane: OPS-SPEED tooling, origin/ops/pine-tooling-speed 36bc5aacc388d351e0346a1342bd16e1d82fbd36
Parent: merge-base with origin/docs/pine-parity-programme = 6319cb21aa26. Own commits: 5fb27439b2, 2e2f0f5459, 36bc5aacc3.
Files: docs/pine/parity-programme/{BUILDER-RULES.md, OPS-SPEED.md, scripts/env-desktop.sh, final-tip.sh, measure-pair.sh, ready-check.sh, retire-worktree.sh}. Docs/tooling only; no app code, no flags, no engine bump; no member exposure.
Review: read-only static review of the lane diff plus the audit/probe/harness tests it caches. Nothing executed.

## BLOCKING

B1 (HIGH) measure-pair.sh:46-58 cache_key leaves out env vars that change the base output.
  zzAuditC18.measure.test.js reads AUDIT_C18_NORT (:72), AUDIT_C18_ONLY (:80) and AUDIT_C18_LIMIT (:81), and engine code reads
  VITE_PINE_MEMBER_PANE_ENABLED / VITE_VOLUME_NUMERIC_PANE_ENABLED (import.meta.env, which vitest takes from the process env).
  None of these is in the key. Example: one quick run with AUDIT_C18_LIMIT=20 fills the cache with a truncated base. After that,
  every full run gets "BASE CACHE HIT" and is compared against that truncated base. The same happens with NORT=1, so the runtime-off
  base gets served to a runtime-on comparison.
  Fix: either put an explicit allowlist of env vars into the key (AUDIT_C18_*, VENDOR_HARNESS_*, VITE_*, PINE_*, REV_*),
  or refuse to use or fill the cache (treat it as a miss) when any of them is set.

B2 (HIGH) measure-pair.sh:48 accepts a tree with untracked files, but the corpus audit lists directories.
  The dirty check uses `--untracked-files=no`. The audit calls fs.readdirSync over corpus/committed and tests/fixtures/pine{,_oos,_blind,_community}
  (zzAuditC18.measure.test.js:26-31, :78). The harness also reads tests/fixtures/vendor/harness. So an untracked .pine file or capture in
  those directories changes the base output, and the key, which is built from the SHA, does not change. A stale or polluted base can then be served.
  Fix: in cache_key, refuse the cache when `git status --porcelain` reports any untracked file under corpus/, tests/fixtures/ or app/src.
  Simpler: refuse it for any untracked file except .uct-session-owner and the zzMP* copies.

B3 (MED-HIGH) measure-pair.sh:52-58 does not key the JS toolchain.
  The key holds only `node -v`. app/node_modules is a junction into pine-base's tree, so its contents are not tied to the base SHA.
  If pine-base reinstalls a different vitest or dependency set, a stale entry gets served.
  Fix: add the sha256 of app/node_modules/.package-lock.json (or of the vitest package.json plus app/package-lock.json) to the key.

B4 (MED) measure-pair.sh:84-89 fills the cache from failed or stale runs.
  cache_fill runs whatever the rc values were. It checks only that each output file exists. If a step crashes before writing, a
  previous run's out-base.json / probe-base.json in the same $O passes that check. It is then stored under the new key and served forever.
  restore checks only COMPLETE plus existence, with no content hash.
  Fix: delete the side's files from $O before run_side. Fill only when every "rc=0" line is present in SIDELOG. Store a sha256 manifest and check it on restore.

B5 (HIGH) a final-tip that failed or ran in affected mode still gets READY-CHECK PASS (ready-check.sh:18-23, final-tip.sh:61).
  FINAL_DONE is written unconditionally and carries no rc values. ready-check checks only that the TIP and FINAL_DONE shas are equal.
  So `js rc=1`, `gate rc=1`, a crashed shard, or `scope=affected` all reach READY-CHECK PASS, and BUILDER-RULES (a) makes
  that line the gate. This breaks the brief's rule that affected mode must not be mistakable for FULL.
  Fix: final-tip records every rc in FINAL_DONE (gate, hygiene, py, js or each shard). ready-check prints scope and rcs and FAILs on
  scope!=full unless READY_ALLOW_AFFECTED=1. It also FAILs on a nonzero rc unless the failure matches a named baseline allowlist.

B6 (MED) final-tip.sh shard aggregation can hide a dead shard (final-tip.sh:43-56).
  A shard that is OOM-killed prints no "Test Files/Tests" line. AGG then sums the surviving shards and shows no "failed". The run as a
  whole never exits nonzero.
  Fix: require N summary lines (one per shard). Treat any shard rc!=0 or a missing summary as "AGG INCOMPLETE" and as a failed run, both in FINAL_DONE and in the exit code.

B7 (MED) final-tip.sh does not check untracked files or check the tree again at the end (final-tip.sh:19-23, 61).
  (i) The `--untracked-files=no` refusal lets a run go green on an untracked new module or test that is not in $SHA. The builder can delete the
  file afterwards, and ready-check, which runs later, then passes.
  (ii) If HEAD moves or files are edited during the roughly 30-minute run, FINAL_DONE still names the start $SHA.
  Fix: refuse untracked files except .uct-session-owner, the same rule ready-check uses (app/node_modules is gitignored, so it does not trip this).
  Before writing FINAL_DONE, check again that HEAD==$SHA and the tree is clean, and fail if not.

## Verified OK
- BASE_HEAD: H0/H1 are checked around each side, the cache is not filled on a move, and the script exits 4 without MEASURE_DONE (measure-pair.sh:79-96).
- Cache entry atomicity: temp dir, then COMPLETE, then mv (:86-89). Census inputs are keyed: run_census.py, ref_rebuilt.json, and a hash of the whole pine-sample tree. REV probes are hashed. Only the base side (idx 2) is cached.
- final-tip: staged and tracked changes are refused (porcelain covers the index). The tracked check ignores the untracked junction and owner file. TIP is written before the tests and stale TIP/FINAL_DONE are removed first. Affected mode is labelled in the console and in FINAL_DONE.
- ready-check: the TIP..HEAD `grep -v '^docs/'` diff plus the LAST-non-docs ancestor check stops a code change after TIP. A rename into docs/ is caught by LAST. local==origin is checked after a fetch.
- retire-worktree: no --force. A junction is checked as a ReparsePoint and removed with `cmd rmdir` (not recursive). A real directory is refused. Dirty, untracked or unpushed worktrees are refused. The branch is kept.
- env-desktop: lane_env refuses .claude paths in both spellings, case-insensitively, before any mkdir or export. ram_gate is bounded (6 h) and logs every 120 s. The hl signature is unchanged.

## Notes (non-blocking)
- N1 ready-check treats all of docs/ as docs-only, including docs/pine/parity-programme/{audit,scripts} (the measuring code). That is fine for final-tip, but measure-pair evidence is not covered by the TIP rule.
- N2 ram_gate: if freeram fails or prints a non-number, the gate waits the full 6 h, logging "free  MB". Fail fast on a non-numeric reading. hl now waits for, or refuses below, 6000 MB free. This is a behaviour change for existing callers and should be announced.
- N3 lane_env does not resolve junctions, symlinks or `..`. It compares the string after cygpath only.
- N4 retire-worktree deletes .uct-session-owner without checking that the owning session is dead. `git worktree remove` also deletes ignored files. If another ignored junction exists (e.g. a root node_modules or .venv junction), check how Git for Windows treats it before relying on this.
- N5 final-tip writes no overall exit code. Callers cannot gate on $?.

Merge order: independent of the parity lanes (tooling and docs only). Merge after docs/pine-parity-programme. Do not use the base cache for evidence until B1-B4 are fixed. Use MP_CACHE=0 meanwhile.

VERDICT: NO-GO @36bc5aacc388
