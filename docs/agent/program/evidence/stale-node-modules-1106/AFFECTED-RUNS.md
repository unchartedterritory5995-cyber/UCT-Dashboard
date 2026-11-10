# Runs on the stale 11-06 node_modules (C:\w\pl-auto\app\node_modules), AUDIT VOID

Compiled 2026-11-10 by pl-auto from evidence, not memory. Sources: the "on <scratch> scratch: <tree>" lines in `runs/*.out`, the chain
scripts, file dates, harness tree hashes, worktree junctions (Get-Item LinkType / Target), and a read-only grep of the PR docs.

## The install
- `C:\w\pl-auto\app\node_modules` was a real directory, created 11-06 23:09 local. It is renamed to `node_modules.stale-1106` and kept.
  It was replaced 2026-11-10T21:43:10Z by a junction to `C:\w\pl-mc-fw\app\node_modules`.
- **Stale vs good install:** exactly 5 top-level packages differ, all missing from the stale one: html2canvas 1.4.1,
  base64-arraybuffer, css-line-break, text-segmentation and utrie (`nmdiff.txt`, made by `nmdiff.mjs`). html2canvas reached master on
  11-09 in 24d15bb679. The only other package-file change since 11-05 is 452e8ee75c, which changes a build script and no dependency.
- Only `pages/OptionsFlow.jsx`, `OptionsFlow_admin.jsx` and `journal-2-0/lib/{edge,trade}CardPng.js` import html2canvas. So, technically,
  only trees that contain 24d15bb679 and load those modules could behave differently. The run logs that show this are the nlb attempt-1
  builds (already labelled) and the 8a3977c833 whole tree (OptionsFlow x2). AUDIT voids every run on the stale install regardless, and
  that is the rule applied below.
- **Worktrees that used it** (each app\node_modules is a junction to C:\w\pl-auto\app\node_modules): pl-auto-cs (made 11-10 02:22),
  pl-auto-mc (02:33), pl-auto-cr (02:49), pl-auto-h12 (03:16), pl-tefix (11-09 01:01). Through the new junction they now resolve to the
  good install.
- **Not affected:**
  - pl-auto-nlb, which has its own `npm ci` install. Only its two attempt-1 builds used the shared stale one, and both are labelled
    `*.attempt1-shared-node_modules-missing-html2canvas`.
  - pl-auto-star (a junction to pl-auto-nlb's install).
  - pl-auto-shard, pl-auto-promote, pl-auto-cap, pl-auto-u12, pl-auto-exec and pl-auto-inv, which have no node_modules (docs, Python or
    git only).

HB is the harness autotest tree a run used. It is recovered from the run's scratch commit: the
`<scratch>:app/src/testing/agent/autotest` tree hash is matched against the autotest-2 and autotest-u12rel history. Several commits can
share one tree.

## A. #988 batch (FIRST)
| run (out file) | tree | date (local) | HB | fed | re-run |
|---|---|---|---|---|---|
| u13 c01bab958c (unseen10/11/12/14/15/16 + u9refs) | #988 c01bab958c | 11-10 ~11:30-13:00 | 819b1796bc (scratch 65b50f39f4) | #988 140/142, missKinds2 columns, AUDIT | YES: replaced by the 91cf48dc79 run (chain40) |
| chain35 + chain36 | master 388dee7fce | 11-09 23:55 / 11-10 00:07 | 819b1796bc | #988 master baseline **58/142** (7+12+7+6+12+10+4; this was 388dee7fce, not b2300e547d) | YES: master 292983f4bc (chain40) |
| u13-08fb (08fb7314ba), watch988 (d4273558b4), chain38 (da51cba8ea u11-rerun), chain35 (da51cba8ea, HB 2103b915b6), chain36 (3b593d4a47), chain34 / u13-2fbd (2fbda4c317, HB 2103b915b6 / 15b9a7226d), chain29 + u14-fb61 (fb6170315e), chain18 (937d988fb7, 16fb5272a3), chain13 / 14 (9339b1f22f, 9828b67c6e, 16fb5272a3, u12 harness 1fdcf75e7a) | older #988 heads | 11-09 to 11-10 | per out file | #988 rounds sent to AUDIT | no: superseded by the 91cf48dc79 re-run |
| chain34 18a3fee48a unseen15 | master | 11-09 21:15 | 2103b915b6 | unseen15 master baseline | no: superseded by 292983f4bc |

NOT A PAIR: chain35's da51cba8ea (HB 2103b915b6) vs master 388dee7fce (HB 819b1796bc). The harness diff is unseen16 added plus
recount.mjs / run.mjs. The c01bab958c / 388dee7fce pair used the same HB (819b1796bc).

## B. #1027 widget actions
| run | tree | date | HB | fed | re-run |
|---|---|---|---|---|---|
| after6 u13 unseen18 | 8a3977c833 | 11-10 13:32-15:32 | fdcbc2ff44 | 29/42, wrong-target list, missKinds3 (evidence 1c34a20bdb, d167c73cbc) | DONE: a7d44da95a 29/42 on the good install (307fc99085, f67dccd493) |
| u1718-master unseen17 + unseen18 | master b2300e547d | 11-10 13:04 | 70b3420a53 | master 6/42 (unseen18), unseen17 baseline | YES: master unseen18 with HB 6f9abd8515 (chain40); unseen17 when next cited |
| whole tree wt-8a3977c833 + census | 8a3977c833 | 11-10 | none (no harness) | 54 failed, 9 head-only, census 0 head-only (6f9abd8515) | replaced by a7d44da95a (chain39) |
| ledger6 W2 src/agent | 8a3977c833 | 11-10 | fdcbc2ff44 | 5 failing src/agent files | replaced by the a7d44da95a whole tree |

NOT A PAIR: 8a3977c833 (fdcbc2ff44) vs b2300e547d (70b3420a53). The harness diff is prodReport.mjs and productionTarget.mjs only.

## C. Coverage ledger and other evidence
| run | tree(s) | date | HB | fed | re-run |
|---|---|---|---|---|---|
| ledger6 trees M/X/O/W/N | b2300e547d, 6e88f01f1c (70b3420a53); b72b1f711d (86d446a3f9); f31f541a07, c01bab958c (fdcbc2ff44) | 11-10 12:43-14:57 | as listed | reconciled ledger (W2 242/484 V, 193 re-proved, 47 V~, 1 NEW CAP); #1027 doc "225 -> 242" | YES, if the ledger numbers stay cited |
| ledger, ledger2, ledger5 (chain33, chain33b, chain37, pchain on 716cad7aad; ledger2 on 4caa94a532) | 716cad7aad, 4caa94a532 | 11-09 00:39 - 11-10 00:56 | 15b9a7226d / 2103b915b6 / 819b1796bc / 1fdcf75e7a | COVERAGE-LEDGER.md (autotest-2) | YES, if cited |
| chain16 / chain17 / rerun15 (D = 16fb5272a3, P = d98bb86457, 4caa94a532) | | 11-09 14:02-16:29 | 6708925b47 | COVERAGE-LEDGER.md "public 241/245, selection 211/223 ... P vitest 9539 passed" | YES, if cited |
| geo (chain21-24, 28, 30-32): fdd4d73bd1 vs 871f899c0b, 072e5a179b, 6147789bf8, 196427314c, a7a42f9b86 | | 11-09 16:12-20:07 | 429f1e1a4f / 318ed11cb8 / 0f9848a4fc trees | PR-guide-overlay-geometry (corner-drag error, reflow lag) | YES, before that PR merges |
| u9 / u10 / u11 / u12 / u12P (25f049554f, 48e0eabce1, ceb0db2654, b8b09034af, 4caa94a532) | | 11-09 06:53-08:58 | 7a34ac7ffc / c80e8e4a10 / 1fdcf75e7a | unseen9-12 results sent to the r8 and #988 workers (the R8 docs cite them as motivation) | no: superseded |
| round2..round11, run-public, run-set, mut, mut2, repaint, bisect, h14, irn | trees before 24d15bb679 | 11-06 23:19 - 11-08 23:42 | early autotest-2 | public / heldout sweeps; the howto-10 finding (PR-teach-gen-1 #1008 and PR-teach-ship-2 #989 cite it as a defect source, not a pass count); bisects | no: superseded. These trees predate html2canvas, so the stale install matched their lockfile |
| chain12 in pl-tefix (6c7d0dc157, 805073d32e) | | 11-09 01:40-06:40 | ece71ef8ee | #984 tenews-timer-cleanup (merged); its "89/89" doc does not name the runner | check the #984 doc's author; void if it is this run |

## D. PRs whose GO or merge cited these numbers (read-only grep of docs/agent/program on master and the agent/pl/* branches)
| PR | state | cited (run, worktree) |
|---|---|---|
| #1016 exec-chart-settings | MERGED 5fed0561f1 | 225/484 VERIFIED; EXEC-CHART-SETTINGS 45 passed / 7 todo (pl-auto-cs); EXEC-MULTICHART 8 passed / 17 todo (pl-auto-mc); EXEC-CITED-RERUN 10/10 files, 158 -> 193 (pl-auto-cr). ALL on the stale install. docs/agent/CHARTS_EXECUTION_STATUS.md also says "225 of 484 (PR #1016)" |
| #1023 exec-heldout12 | OPEN | heldout12.outcome 33 passed / 4 todo, 225 -> 233 (pl-auto-h12, stale) |
| #1027 exec-widget-actions | OPEN | 242/484 on #1016's 225 base; this file's section B |
| #1029 exec-flow-filters, #1030 exec-multichart-grid | OPEN | inherit the 225/484 base (225 -> 226, 225 -> 241) |
| remove-starred-dead-code (no PR) | open branch | 233/483, inherited from #1023; its own vitest ran on pl-auto-nlb's install (not stale) |
| #988 | OPEN | section A (140/142 vs 58/142) |
| #1022 agent-no-lookbehind | MERGED b2300e547d | GitHub PR body only. The rails ran in pl-auto-nlb on its OWN install (not stale), except the two labelled attempt-1 builds |
| #1025 promote-catchup | MERGED 292983f4bc | Python promote simulations; no node_modules, not affected |
| #1007 full-suite-shard | MERGED 716cad7aad | vitest file-partition count in pl-auto-shard (it has no node_modules now; what it resolved then is unverified). A count, not a pass/fail result |
| #1008, #989 | MERGED | pl-auto howto-10 as a defect source, not a pass count |
| #1014 teach-wl-widget | OPEN | no pl-auto run found; its runs are pl-teach's |
