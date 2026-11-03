# UCT Agent W1.1 RC — independent final review (PR #747, agent/rc/w11 @ e4d958cccd, draft, MERGEABLE) — 2026-11-03
VERDICT: HOLD (technical GO). The one open item is CI evidence: the `agent ci` push run 41684501436 is still QUEUED (1/5 jobs done; browser shard 1 passed). The PR run 41687203086 was SKIPPED (draft). Re-check when it finishes; if it is all green, this is GO pending the owner.
Head verified as e4d958cccd; 0 commits behind origin/master.
Local spot checks: pytest repair_b + args_live_shapes + qa_f16 + deploy_gate + contract: 304 passed. vitest RepairA, RepairB, qa/, agentContracts: 331 passed (19 files).
1 BLOCKING-1 FIXED. CLAIM_FAMILIES now covers only indicatorAlerts and rename, and needs a create-type verb with the family as its object. A qualifier (sms, email, export, share, intraday, trades, protected…) exempts the sentence. A repeated claim after repair serves the model's reply (checked: "answer" with the reply kept). Probes:
  - My 6 honest partial limits: 3 pass clean (breadth charts, protected layout, intraday bars).
  - 3 still match: "can't create more than 20 indicator alerts per chart", "renaming a tab to an empty name isn't possible", "alerts on an unsaved draft can't be created".
  - Cost of those 3: one extra paid repair call, then the model's own reply is served. A clarify replaces the reply only when no call is left. NB-A, not blocking.
  - 4/4 genuine false claims are still caught.
2 BLOCKING-2 FIXED. "rs line" is excluded with (?![\s-]line). "composite" needs uct, a score/rating word, or a threshold not preceded by nasdaq/nyse. My 10 public/hidden pairs:
  - All 10 public phrases pass: rs line, highest rs line, nyse composite, nasdaq composite above 200 day, accumulation days, high volume, options volume, rs line over 90, growth rate, sector strength.
  - All 10 hidden phrases are caught.
  - NB-B: "sector rs above 80" maps to rs_rank, not sector_rs_pct (the rs-threshold pattern runs first). It is still refused; only the alternative wording may differ.
3 #725 hardening:
  - NB-1: on string-nullable args only "null" and "" become null, so a list named "None" is kept.
  - NB-3: planOps exposes normalizedOps (non-enumerable), and both protectionRefusal sites use it.
  - NB-5: "$RTY", "MMM" and "ASDF" are no longer the clarify; lower-case "asdf" still is. Upper-case ASDF going to the planner costs at most one model call, which is the intended trade (real tickers win).
  - NB-2 `defaultsWhen` is in scope and safe:
    - It is a NARROWING of #725's own new default: filters:[] applies only when mode is "refine", so a new screen without filters is refused as before.
    - Both server and browser validate it and require a declared default with {arg: [scalars]}.
    - Only screener.run declares it.
    - It is an additive manifest key in contract entryKeys.
    - Master's validate_manifest reads only named keys, so the browser/server mix is safe in both directions.
4 A/D HOLD correct: "accumulation distribution line" still maps to accdis; "a/d line" is not claimed. test_uct_agent_w11_repair_b.py:266-271 fails if the catalog ever gains a second A/D field.
5 Fixtures, all as explained:
  - Golden: same 133 capabilities, none added or removed. Only 6 changed, and only in argAliases/coerce/defaults/defaultsWhen/shape. chart.setSetting also changed args+hints (bgMode enum, the LT-3 descriptor row).
  - NL-1 parity: the indicatorAlerts title only.
  - Cost: d02 is now 0 calls (model calls 64→62, browser requests 31→30, strength 10→8).
  - Fast path: d02 passes (0→1); fastpath-candidates d02 model_turns 1→0.
  - Discovery: label split only. 5 expect_refusal questions moved from the answerable bucket to the refusal bucket; total passed is unchanged at 10.
  - SAT capture: a null body is allowed only for expect_refusal; DRY-RUN tests moved d02→d05/d08.
  - Intended rail inversion: test_legacy_never_coerces became coerce 15→"15", and 7 is still refused.
6 Tree outside Agent paths: two files, both justified.
  - app/src/components/chart/chartSettingsDescriptors.js: a bgMode ELIGIBLE row; data-only, consumed only by Agent.
  - tests/fixtures/nl1_assemble_parity.json: the re-bless.
  - Unchanged vs master: .github/ (master-deploy-gate.yml included), budget.py, limits.py, store.py, api/main.py, and api/routers/uct_agent.py (so require_admin_dark too).
  - No env/flag read is added or changed in code (env names appear only in docs).
  - turn_v2.py changes only under planner v2 (OFF in prod).
CHECKLIST
 1 Scope — MET. Every code change maps to LT-1/3/4/8/9/10/11/12, F-16, or the review fixes. The rest is tests, docs/agent and re-blessed fixtures.
 2 Independent approval — MET by this review (technical). The owner's GO is still required to merge.
 3 Gates — PENDING. Builder full suites: pytest 2350, vitest 2798 + 6 skipped, 0 failed (not re-run by me; spot checks green). `agent ci` on agent/rc/w11: run 41684501436 queued (1 of 5 jobs complete, success); PR run skipped (draft).
 4 No weakening, migration or destructive op — MET.
   - Refusals still run on normalized args.
   - Hidden-field refusal is widened to new screens (stricter).
   - No schema/table change; no file deleted.
   - One rail intentionally inverted (nl1 coercion, recorded).
 5 No new flag or member access — MET. No new env read, no default changed, require_admin_dark untouched.
 6 Gate idle + synced — MET. master deploy gate: no run in_progress or queued, last 3 succeeded. HEAD..origin/master = 0.
 7 Rollback — MET. `git revert -m 1` is clean:
   - code, tests and fixtures only; no data, table or migration;
   - no persisted shape (the protected-name list is pre-existing localStorage);
   - a stale browser that sends the new manifest keys to a reverted server is ignored, because validate_manifest picks only named keys.
 8 Compatible with prod config (all ON; v2 and isolated OFF) — MET. Behaviour changes under the ON flags are the listed fixes only:
   - args tolerance on every path;
   - empty-board chart add;
   - rename and protected-rename routing;
   - nonsense clarify;
   - indicator-alert routing plus the false-claim repair;
   - F-16 hidden phrases on refine AND new screens;
   - next-report wording.
   Under NL1=1 the legacy coercion now applies, as intended. The v2 change is dormant. No new kind is needed in UCT_AGENT_DATA_KINDS.
HOLD reasons: (1) agent ci on e4d958cccd not yet concluded — require all 5 jobs success; (2) owner GO for merge/promote not yet given.
Non-blocking follow-ups:
  - NB-A: add "per-chart limit / empty name / unsaved draft" to _CLAIM_QUALIFIER, or as negative tests.
  - NB-B: order sector_rs before the rs threshold pattern.
