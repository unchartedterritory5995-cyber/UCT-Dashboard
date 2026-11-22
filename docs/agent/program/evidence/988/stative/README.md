# #988 stative / price clause (AUDIT probe 2) — evidence, LOCAL / SIMULATED

Blocker: "make it weekly, it is right above support" (c2 clicked) answered "You said not the chart you clicked…" and applied nothing.
Cause confirmed by a rule-firing log (`confirm-rule-91cf48dc79.log`): rule=STAY_CLICK, clause=` it is right above support`
(bare "it" subject + "right" read as "the click is fine as it is").

Commits on 91cf48dc79: 673c024ed4 RED rail (`red-91cf48dc79.log`: 26 failed | 33 passed), d5b4b863c7 STAY_CLICK guards + "You said not"
only with a negation word, 341f5eb788 KEEP_SET_CLICK ("keep this one daily, make the others weekly"; also broken on master).

Guards (families, not sentences):
- (i) subject must NAME the chart (this one / this chart / the clicked|selected one / the one I clicked…), never bare it / this / here
- (ii) fine / right / ok / good must END the clause (optional "as it is", "the way it is", "where it is", "for now", "already")
- (iii) stays / remains is never followed by a price place (above / below / under / near / around / between, at|on a level)
- (iv) "You said not …" only when a negation word is present; otherwise "You asked me to leave out the chart you clicked…"
- (v) keep / leave the click AT A SETTING excludes it only when the words also name the rest of the board

## Mutant x control matrix (one mutant per guard; runs on 341f5eb788, tree restored and verified after each)

| mutant | agentStativePriceClause (104) | zzAuditProbe2 (24) | zzAuditProbe21 (11) | agentNegatedClickAct (335) |
|---|---|---|---|---|
| M1 subject (i) | 3 failed | pass | pass | pass |
| M2 clause end (ii) | 2 failed | pass | pass | pass |
| M3 price place (iii) | 3 failed | pass | pass | pass |
| M4 "You said not" (iv) | 12 failed | pass | pass | pass |
| M5 keep-setting (v) | 43 failed | pass | pass | pass |
| M6 rest-words guard (v) | 2 failed | pass | pass | pass |

Every guard is load-bearing on the rail; the probe-2 case itself is held by more than one guard, so no single mutant re-breaks it.

## AUDIT probes 1-21 + guides (25 zzAudit files, local copies, never committed)

- 341f5eb788 (+ the two rails): 4 failed | 717 passed (721). The 4 = zzAuditGuide_another / zzAuditGuide_t1c "how do I add another one…",
  which fail identically on master 1c4c20bb12 (pre-existing, not #988).
- master 1c4c20bb12: 50 failed | 232 passed (282).
- 91cf48dc79 (AUDIT HOLD): 5 failed | 277 passed (282) = the same 4 guide tests + the probe-2 blocker.

## Asks (an ask text appeared in the DOM), 282 probe tests

- 341f5eb788: 122. 91cf48dc79: 123 (the fix removes the probe-2 ask, adds none; 0 dev-only asks vs 91cf in any set).
- master 1c4c20bb12: 109, but most of master's non-asks are failing tests (wrong or no application).
  Asks on 341f where master passed WITHOUT asking: 4 (probe 11 x1, probe 18 x1, probe 19 x2), all identical on 91cf48dc79,
  i.e. carried from the AUDIT-held base, not from this fix.

Raw logs, TSVs and the measurement scripts are kept out of the repo (they quote held-out probe sentences):
C:/Users/blake/uct-backups/988-whole-tree/stative-341f5eb788/ with SHA256SUMS beside them.

## Scoped suite (PC stability mode: no whole-repo run)

61583d7823, under the suite lock, BelowNormal, node_modules Junction: src/agent (zzAudit excluded) + 7 tests outside it that import
the agent: Test Files 342 passed | 5 skipped (347), Tests 13431 passed | 6 skipped | 24 todo (13461), EXIT 0, 855.6 s.
(`vitest related` on the two changed files could not be used: it aborts resolving @picovoice/web-voice-processor.)
Log: scoped-61583d7823.log in the backup folder above (sha256 291e53fd071f9552…).
