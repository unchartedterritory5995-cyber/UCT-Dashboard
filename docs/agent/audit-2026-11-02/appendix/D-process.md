# Audit D — UCT Agent program: development-process measurements

Read-only measurement, 2026-11-02. Worktree `C:/w/aaudit`, detached at `origin/master` = `cfc35a3b3f` (2026-11-02 16:36 -0600).
Repo `unchartedterritory5995-cyber/UCT-Dashboard`; `gh` authenticated (read-only use). No real market values appear below.

Agent paths used everywhere a path filter is written as `$P`:

```
P='app/src/agent api/services/uct_agent api/routers/uct_agent*.py tests/test_uct_agent*.py docs/agent app/src/components/chart/builder/agent*.js'
```

Program timeline anchors (from git): first agent commit `81cfb46fd9` 2026-10-06 22:48 -0400 ("UCT Agent foundation"); today 2026-11-02 → the program is **27 days old**.

---

## 1. Commits touching agent paths

```
git log origin/master --since=2026-09-28 --format='%ad' --date=format:'%G-W%V' -- $P | sort | uniq -c
git log origin/master --since=2026-09-28 --format='%H' -- $P | wc -l              # 577
git log origin/master --no-merges --since=2026-09-28 --format='%H' -- $P | wc -l  # 448
git log origin/master --since=2026-09-28 --format='%an <%ae>' -- $P | sort | uniq -c | sort -rn
git log --all --since=2026-09-28 --format='%H' -- $P | wc -l                      # 729 (every ref, incl. unmerged branches)
```

| ISO week | dates | commits (reachable from master, incl. merges) |
|---|---|---|
| 2026-W40 | 09-28 – 10-04 | 0 |
| 2026-W41 | 10-05 – 10-11 | 180 |
| 2026-W42 | 10-12 – 10-18 | 87 |
| 2026-W43 | 10-19 – 10-25 | 15 |
| 2026-W44 | 10-26 – 11-01 | 272 |
| 2026-W45 | 11-02 (one day) | 23 |
| **Total** | | **577** (448 non-merge + 129 merge) |

On every ref (`--all`): 729 commits — ~150 more sit on branches not yet in master (open PR stacks, RC branches, local-backup refs).

Distinct authors (by name+email): 6 identities, but they are one person/seat plus automation:

| author | commits |
|---|---|
| unchartedterritory5995-cyber `<email redacted>` | 302 |
| Blake Bracco `<email redacted>` | 261 |
| Blake Bracco `<YOUR_GITHUB_EMAIL>` (unconfigured git identity) | 7 |
| Patrick Gosz `<email redacted>` | 3 |
| Claude Fable 5 `<email redacted>` | 3 |
| agent-qa `<email redacted>` | 1 |

Effectively **one GitHub account** (all 400 PRs in the window have author `unchartedterritory5995-cyber`); the different names are different sessions/worktrees, not different people. Commit rate ≈ 21 agent commits/day over 27 days, with two bursts (W41 foundation, W44 Sprint 1/2) and a quiet W43.

---

## 2. Lines added/removed by category (since 2026-10-01) and current totals

```
git log origin/master --no-merges --since=2026-10-01 --numstat --format='' -- $P | awk ... (category by path)
git log origin/master --no-merges --since=2026-10-01 --numstat --format='' -- $P | awk ... (by extension)
```

### 2a. Churn (origin/master, non-merge commits)

| category (path rule) | added | removed | file-touches |
|---|---|---|---|
| agent code, non-test (everything not below) | 130,458 | 13,349 | 1,038 |
| agent tests (`tests/test_uct_agent*.py`, `*.test.*`, `__tests__/`) | 43,579 | 1,681 | 732 |
| docs/agent | 42,034 | 648 | 283 |

The "code" number is dominated by generated JSON fixtures. Splitting the non-docs churn by file kind:

| kind | added | removed |
|---|---|---|
| source (js/jsx/py/css, non-test) | 36,142 | 2,888 |
| tests (vitest + pytest files) | 43,579 | 1,681 |
| fixtures / JSON (`__fixtures__`, `*.json`, golden manifests, SAT request captures) | 94,316 | 10,461 |

By extension, non-test non-docs: js +25,599 / jsx +1,619 / py +8,374 / css +784 / json +93,956 / md +126.
docs/agent by extension: md +9,101 / json +32,530 / txt +340 / patch +63 (the JSON is gate-B/gate-C/NL-intent eval baselines).

Across every ref (`--all`), the same categories are larger (code +150,124; tests +51,844; docs/agent +116,446 with −37,953), i.e. ~74k docs/agent lines were written on branches and later reworked/removed before reaching master.

### 2b. Current size (`wc -l` on the worktree)

| bucket | files | lines |
|---|---|---|
| app/src/agent source (js/jsx/css, non-test, non-fixture) | — | 23,277 |
| app/src/components/chart/builder/agent*.js (non-test; Indicators seams) | — | 2,217 |
| api/services/uct_agent/**/*.py + api/routers/uct_agent*.py | 35 py | 7,846 |
| **agent source, non-test, non-fixture** | | **33,340** |
| agent fixtures/JSON (app `__fixtures__` 58,244 + other app json 4,180 + api json 21,528; largest: `prod-probe-qa.json` 21,734, `scan/sat/section_b_requests.json` 18,479) | 47 json | 83,598 (+113 README.md) |
| app/src/agent tests (144 `*.test.*` files) | 144 | 26,808 |
| builder agent*.test.js | 12 | 2,701 |
| tests/test_uct_agent*.py | 59 | 12,916 |
| **agent tests total** | **215 files** | **42,425** |
| docs/agent, all files | 90 | 41,355 |
| docs/agent markdown only | 72 | 8,504 |
| docs/agent json/txt/patch (eval baselines, transcripts) | 18 | 32,851 |
| docs/indicators AGENT-* / agent-seams (Indicators-side contracts & handoffs) | 8 | 1,673 |

Test-to-source ratio (lines): 42,425 / 33,340 = **1.27 : 1**. Test cases: 1,721 vitest `it/test(` in agent tests + 771 pytest `def test_` = **~2,490 agent test cases**.

---

## 3. Pull requests

```
gh pr list --state all --limit 400 --json number,title,createdAt,mergedAt,closedAt,baseRefName,headRefName,additions,deletions,changedFiles,author,isDraft > prs.json
gh api "repos/.../pulls?state=all&sort=created&direction=desc&per_page=100&page={5,6}"      # #102..#301 (coverage check)
gh api "repos/.../pulls/N" (x42)                                                          # sizes for the 42 Oct master PRs below #302
node pr-analysis.js ; node pr-oct-norm.js   (scratchpad scripts)
```

Window: the 400-PR listing covers #302..#701 (created 2026-10-09 → 2026-11-02). REST pages confirmed **no agent PR exists before #302** (the first agent PR is #310 on 10-09; agent work before that went straight to master, see §6). Agent filter = head branch or title contains "agent" (case-insensitive). Two false positives were kept in the headline set and are flagged: #688 (`fix/media-fetch-user-agent`, "User-Agent" header) and #537 (News picker, mentions UCT Agent). Hours = createdAt → mergedAt.

### 3a. Agent PRs (130 since 10-09)

| metric | value |
|---|---|
| total | 130 |
| merged | 114 |
| open | 15 (8 drafts; several "DO NOT MERGE"/"HOLD") |
| closed-unmerged | 1 (#482, superseded by #484 same day) |
| median size (add+del), merged | 287.5 |
| mean size, merged | 2,486.6 |
| p90 size, merged | 5,120 |
| median changed files, merged | 5 |
| median hours to merge | **0.3** |
| mean hours to merge | 2.2 |
| p90 hours to merge | 6.6 |
| max hours to merge | 37.6 |
| merged within 1 h / within 24 h | 88 (77%) / 111 (97%) |
| authors | unchartedterritory5995-cyber: 130 (100%) |

Base branches: **agent/int = 86**, master = 40, stacked-on-another-PR = 4 (`agent/md/lowercase-resolve`, `agent/md/quote-wording`, `feat/uct-news-explain-identity`, `feat/indicators-plain-names`).

Head-branch families: agent/qa = 28, agent/lead = 28, agent/md = 20, agent/sc = 15, agent/rc = 4, p3/ws* = 5, feat|fix/agent-* ≈ 25, other = 5. The four "team" prefixes (qa/lead/md/sc) are the four session roles of the Sprint 1-2 program (all one GitHub account).

PRs created per ISO week: W42 = 1, W43 = 6, **W44 = 60, W45 (one day, 11-02) = 63**. Merged per week: W42 = 1, W43 = 5, W44 = 55, W45 = 53. Note: 63 agent PRs created on a single calendar day (11-02 UTC).

### 3b. Agent PRs by base

| set | n | median add+del | mean | p90 | median files | median h | mean h | p90 h | merged <1h |
|---|---|---|---|---|---|---|---|---|---|
| Agent PRs merged, all bases | 114 | 287.5 | 2,486.6 | 5,120 | 5 | 0.3 | 2.2 | 6.6 | 88 (77%) |
| into agent/int | 76 | 211.5 | 1,616.3 | 1,726 | 5 | **0.2** | 0.4 | 0.7 | 73 (96%) |
| into master | 35 | 564 | 3,861.3 | 10,772 | 13 | 1.6 | 6.1 | 15.1 | 12 (34%) |
| into master excl. RC bundles #616/#682/#697 | 32 | 475.5 | 1,470.6 | 2,962 | 10.5 | 1.8 | 6.6 | 15.1 | 10 (31%) |

### 3c. 15 largest merged agent PRs

| PR | title | add+del | files | hrs to merge | base |
|---|---|---|---|---|---|
| #697 | Agent: quote wording release (#691 + #695) | 37,674 | 30 | 0.4 | master |
| #682 | UCT Agent Sprint 2 release (flags OFF) — RC f479b0ae32, QA GO #672 | 36,017 | 88 | 1.6 | master |
| #695 | feat(agent-md): MD-1 §4.7.5 lowercase ticker resolution from the canonical index | 35,603 | 24 | 0.6 | agent/int |
| #623 | agent-sc: SAT-1 section B as one command (dry run default; metered --run) | 27,358 | 5 | 0.4 | agent/int |
| #696 | agent-qa: §4.7.5 verdict rails for #695 (F-24 blocking, fix measured) | 25,204 | 11 | 0.2 | agent/md/lowercase-resolve |
| #616 | UCT Agent Sprint 1 RC1 (r2) — flags-off foundation release (owner-authorized) | 14,395 | 91 | 0.1 | master |
| #634 | agent-sc: SAT-1 §B recapture on agent/int + #631 + #630 + #626 + #628 | 11,609 | 16 | 0.2 | agent/int |
| #403 | Agent Gate C: session memory, references, in-place indicator edits, approval binding | 10,772 | 52 | 1.9 | master |
| #427 | agent(NL-1): model-first interpretation, DARK | 9,293 | 40 | 2.0 | master |
| #667 | agent-qa: quote held-out at OUTCOME level — FAIL 0 on 44 + 54; md2 rails | 8,409 | 26 | 0.2 | agent/int |
| #609 | Sprint 1 RC: sync agent/int with master cd5dc25b16 | 6,239 | 68 | 0.1 | agent/int |
| #572 | test(agent-qa): program fixtures — fake-provider MD-1/SC-1 envelopes | 5,120 | 22 | 0.8 | agent/int |
| #522 | UCT Agent Phase 3 · WS4: "undo all of that", receipts that name the chart | 4,163 | 38 | 12.1 | master |
| #479 | UCT Agent — Charts operator Phase 1 (Agent-only completion) | 2,962 | 46 | 1.8 | master |
| #439 | agent(NL-1): hybrid action selection under the unchanged 60-action limit (DARK) | 2,587 | 23 | 0.1 | master |

The five largest are 25k-38k lines each and were merged in 0.2-1.6 h; the bulk is generated JSON (probe/QA indexes, SAT request captures), not hand-written code.

### 3d. 15 smallest merged agent PRs

| PR | title | add+del | files | hrs to merge | base |
|---|---|---|---|---|---|
| #640 | agent-lead: OWNERSHIP — SC-2 contracts belong to agent-sc | 1 | 1 | 0.1 | agent/int |
| #452 | fix(agent): golden manifest accepts the Trader Archive page (deploy gate red on master) | 3 | 1 | 0.0 | master |
| #602 | test(agent): strongest-stocks phrase is the screener fast path, not a model fallback (F-SAT-3) | 6 | 1 | 0.0 | agent/int |
| #605 | docs: ADR-005 L7 wording (F-13) and known findings F-11/F-12 | 7 | 1 | 0.0 | agent/int |
| #489 | fix(agent): no timer left running after a test (unblocks #486 promotion) | 9 | 2 | 0.4 | master |
| #700 | docs(agent-qa): G2 (#699) GO — status record | 19 | 1 | 0.0 | agent/int |
| #681 | Agent: MD-1 kinds use named symbol limits (clears the red indicators security suite check) | 21 | 1 | 2.6 | agent/int |
| #690 | Agent: MD-1 kinds use named symbol limits (#681 to master) | 21 | 1 | 0.5 | master |
| #599 | MD-1 gateway: model-isolated kinds dormant server-side (UCT_AGENT_ISOLATED, default off) | 23 | 3 | 0.0 | agent/int |
| #592 | SC-1 v1.3 §2c: relative volume (docs only) | 24 | 1 | 0.1 | agent/int |
| #588 | MD-1 gateway: model-isolated kinds | 26 | 2 | 0.1 | agent/int |
| #571 | test(agent-program): gateway stays dark for every registered kind | 29 | 1 | 0.1 | agent/int |
| #581 | Agent turn scope: currentTurnId() as the MD-1 per-turn budget key | 32 | 2 | 0.1 | agent/int |
| #688 | fix(notebook): image copies send a descriptive User-Agent (false positive) | 33 | 2 | 0.6 | master |
| #484 | perf(agent): NL-1 action selection back to pre-#481 speed (unblocks the master deploy gate) | 36 | 2 | 0.0 | master |

### 3e. Open agent PRs (15) and the one closed-unmerged

Open: #684 (News→Agent, draft, DO NOT MERGE), #672 (QA final verdict Sprint 2 — GO), #666 (F-23 half-day), #665 (News side, draft), #662 (QA NL diagnostic, docs), #661 (F-16 rails, stacked), #659 (HOLD — test stability for master, draft), #657/#654 (F-16 PR-A/PR-B, hide ratings/flow from the Agent), #655 (MD-2 harness, stacked), #645 (HOLD — sentinel tokens for the master gate), #617 (F-15 Pine undo, draft), #600 (ADR-003 draft), #595 (QA verdict docs), #573 (IC-1 draft). Closed-unmerged: #482 (replaced by #484 within the hour).

### 3f. Repo norm: all PRs merged into master in October 2026 (all workstreams, complete #225..#701)

| set | n | median add+del | mean | p90 | median files | median h | mean h | p90 h | merged <1h |
|---|---|---|---|---|---|---|---|---|---|
| All PRs → master, Oct 2026 | 287 | 487 | 29,877 | 37,720 | 8 | **0.2** | 2.9 | 6.9 | 205 (71%) |
| of which non-agent | 261 | 485 | 32,682 | 45,159 | 7 | 0.2 | 2.5 | 5.3 | 198 (76%) |
| of which agent | 26 | 597.5 | 1,720 | 4,163 | 13.5 | 2.0 | 7.1 | 29.5 | 7 (27%) |
| non-agent excl. >100k-line PRs | 242 | 370.5 | 4,796 | 15,091 | 6 | 0.2 | 2.4 | 4.2 | 190 (79%) |

Oct master merges per ISO week (all / agent): W40 = 21/0, W41 = 38/0, W42 = 83/1, W43 = 61/5, W44 = 84/20.

Largest non-agent October PRs: #321 Notebook P2a 1,061,081 lines (864 files), #324 440,086, #331 429,960, #319 325,289, #417 Study 277,819 — the repo norm includes several six-figure PRs merged in 1-17 h. Smallest: 2-9 line docs/flags PRs merged in 0-0.7 h.

Comparison: Agent PRs into master are **~20% larger by median** (598 vs 485 lines), touch **~2x the files** (13.5 vs 7), and take **~10x longer to merge by median** (2.0 h vs 0.2 h); only 27% merge within an hour vs 76% for the rest of the repo. Agent PRs into `agent/int` behave like the repo norm (0.2 h median, 96% within an hour). Mean/p90 size of the repo norm is dominated by the Notebook mega-PRs and is not comparable.

---

## 4. Releases to master

```
git log --merges --first-parent origin/master --since=2026-10-01 --format='%h %ad %s' --date=format:'%Y-%m-%d %H:%M' -- $P   # 79
git log --first-parent origin/master --since=2026-10-01 --format='%ad' --date=format:'%Y-%m-%d' -- $P | sort -u | wc -l    # 19 days
git branch -r | grep -c 'origin/release/agent' ; git branch -r | grep -c 'origin/agent/rc/'
gh pr view N --json mergeCommit  + git merge-base --is-ancestor   (to see how RC PRs landed)
```

Caveat on `--first-parent`: master's first-parent line is tangled. Several PR merge commits (#616 Sprint 1 RC, #682 Sprint 2, #427, #423, #452, #658) are ancestors of master but **not on its first-parent chain** (a feature branch that had merged origin/master was pushed as master). First-parent counts therefore under-count PR releases and over-count "sync" merges.

| measure | value |
|---|---|
| first-parent merge commits on master touching agent paths since 10-01 | 79 |
| of which `Merge pull request #…` | 29 |
| of which deliberate local integration merges ("Integrate Agent Context…", "Merge feat/agent-breadth-s1…", "Merge fix/uct-agent-m3-stab…") | 21 (all 10-10 → 10-12, plus #464 on 10-25) |
| of which `Merge origin/master into <feature>` sync merges that carried agent changes onto the first-parent line | 29 |
| distinct days a first-parent master commit (merge or direct) changed agent paths | **19** (10-06…10-13 daily = 8 days; 10-18, 10-20, 10-25, 10-26, 10-27…11-02 daily = 7) |
| agent PRs merged into master (gh, excl. 2 false positives) | 33 on **12 distinct UTC days** (10-18:1 10-19:2 10-20:1 10-21:1 10-25:1 10-27:1 10-28:6 10-29:4 10-30:5 10-31:3 11-01:2 11-02:6) |
| RC/release-labelled master merges | #403 Gate C (10-18), #427 NL-1 (10-19), #439 NL-1 hybrid (10-20), #464 Phase 2 (10-25), #616 Sprint 1 RC1 r2 (11-01), #682 Sprint 2 (11-02), #697 quote wording (11-02), #692 News→Agent candidate (11-02) |
| `origin/release/agent*` branches | 1 (`release/agent-gate-c`) |
| `origin/agent/rc/*` branches | 4 (`sprint1`, `sprint1-r2`, `sprint2`, `news-agent`) |
| all first-parent merges to master since 10-01 (all workstreams) | 459 |

Two release regimes: **10-06 → 10-13** direct pushes + local integration merges every day (no PRs; M1/M2/M3, Gate B); **10-18 → 11-02** PR-based, 33 agent PRs into master on 12 days, three of them RC bundles of 14k-38k lines.

---

## 5. CI

```
gh run list --limit 400 --json name,status,conclusion,createdAt,updatedAt,headBranch,event,workflowName,databaseId
gh run list --workflow "master deploy gate" --limit 200 --json ...         # 10-24 → 11-02
gh run list --workflow "promote to production" --limit 250 --json ...     # 10-24 → 11-02
gh run list --workflow "indicators security suite" --limit 250 --json ... # 10-13 → 11-02
gh run list --workflow "full suite (report-only)" --limit 250 --json ...  # 10-16 → 11-02
gh run view <id> -R ... --json jobs   (4 recent successful gate runs, step timings)
node run-analysis.js ; node run-analysis2.js
```

The generic 400-run window spans **only 2026-11-02 14:14Z → 22:58Z** (≈ 9 hours → ~45 runs/hour, 284 of them `pull_request` events). Per-workflow in that window:

| workflow | runs | median min | p90 min | success | failure | cancelled | failure rate |
|---|---|---|---|---|---|---|---|
| wisdom rails | 64 | 2.2 | 2.7 | 64 | 0 | 0 | 0% |
| term018 guards | 63 | 2.6 | 2.9 | 63 | 0 | 0 | 0% |
| notebook budgets | 46 | 1.9 | 2.2 | 46 | 0 | 0 | 0% |
| vite build args | 46 | 1.0 | 1.3 | 46 | 0 | 0 | 0% |
| notebook bytes | 44 | 2.3 | 2.7 | 44 | 0 | 0 | 0% |
| preference allow-list | 44 | 1.8 | 1.9 | 44 | 0 | 0 | 0% |
| flow-worker deploy coverage | 41 | 1.7 | 2.1 | 41 | 0 | 0 | 0% |
| promote to production | 20 | 1.9 | 2.3 | 17 | 1 | 0 | 5.6% |
| **master deploy gate** | 15 | **23.4** | 35.1 | 13 | 0 | 1 | 0% |
| indicators security suite | 9 | 7.4 | 13.2 | 2 | 7 | 0 | 77.8% (11-02 only) |
| notebook latency / a11y / joystick / full suite | 8 | — | — | 7 | 0 | 1 | — |

Longer windows (per-workflow queries):

| workflow | window | runs | median min | p90 | max | success | failure | cancelled | failure rate |
|---|---|---|---|---|---|---|---|---|---|
| **master deploy gate** (the gate; push to master only) | 10-24 → 11-02 | 200 | **18.2** (18.9 successful-only) | 25.8 | 104.9 | 177 | 6 | 16 | 3.0% (+8% cancelled) |
| promote to production (workflow_run after the gate) | 10-24 → 11-02 | 250 | 1.7 | 2.2 | 14.9 | 206 | 42 | 0 | 16.9% (most failures are 0.1-0.5 min = refused promotion) |
| indicators security suite | 10-13 → 11-02 | 148 | 7.5 | 8.6 | 625 | 121 | 27 | 0 | 18.2% (21 of 27 failures on 11-02, 8 on master) |
| full suite (report-only) | 10-16 → 11-02 | 250 | 75.8 | 232.9 | 350.6 | 0 | 1 | **249** | report-only; essentially never finishes |

Master deploy gate duration is growing day by day (median of completed, non-cancelled runs):

| day | runs | median min | max |
|---|---|---|---|
| 10-24 | 28 | 15.1 | 25.8 |
| 10-25 | 6 | 14.5 | 15.3 |
| 10-27 | 8 | 15.4 | 16.9 |
| 10-28 | 16 | 17.0 | 26.7 |
| 10-29 | 27 | 16.4 | 33.8 |
| 10-30 | 20 | 19.1 | 24.3 |
| 10-31 | 21 | 20.2 | 29.8 |
| 11-01 | 22 | 20.8 | 76.6 |
| 11-02 | 32 | **23.4** | 104.9 |

Step timings on four successful gate runs of 11-02 (job "gate", 22.8 / 25.7 / 25.6 / 22.8 min): "UCT Agent browser tests" (vitest `src/agent` + `builder/agentMutations`) = **15.9 / 18.0 / 17.9 / 16.3 min**, "UCT Agent server tests" = 1.1-1.4 min; every other step ≤ 1.6 min. The Agent vitest step is **~70% of the master deploy gate for every push to master, all workstreams**. `master-deploy-gate.yml` line 74 records the timeout history: 10 → 15 (10-06) → 25 (10-11, "+ the UCT Agent tests") → 40 min (11-02, "Sprint 1 grew the Agent vitest step to 16.2 min and the gate ran 23.5 of 25 min on c3ba71c343").

Master gate non-success runs (10-24 → 11-02): 6 failures (10-28 ×3, 10-29, 10-30, 11-01) and 16 cancellations (superseded pushes). Promote failures 10-24: 17 in one day.

Agent branches: in the 400-run window, 113 runs had agent-named head branches; **0 failures, 0 cancellations, 0 rerun-pairs** (the per-PR workflows are the 1-3 min guards; the Agent suites only run in the master gate, which only runs on push to master). `gh run list --branch agent/int` returned nothing — no workflow triggers on push to `agent/int`, so the integration branch itself is never CI-tested until an RC PR reaches master.

### Workflow inventory (17 files in `.github/workflows`) and test commands

| workflow | trigger scope | test commands |
|---|---|---|
| master deploy gate | push to master | 6 pytest files (`test_no_shadowed_definitions`, `test_dockerfile_vite_build_args` + `test_vite_flag_ledger`, `test_visibility_flag_ledger`, `test_script_engine_version_gate`, discord render goldens/ops), **`pytest tests/test_uct_agent*.py`** (production venv), **`npx vitest run src/agent src/components/chart/builder/agentMutations`** with a floor of 30 test files |
| promote to production | workflow_run after the gate / schedule | no tests (deploy) |
| indicators security suite | PR + push | `pytest` (indicator security tests) + `npx vitest run` on a listed file set |
| full suite (report-only) | schedule/push | `npx vitest run` all files; sharded `pytest` via `tools/pytest_shards.py` — `continue-on-error`, header says 1,353 vitest / 1,429 pytest files with ~21 / ~85 known failures and CI running 22 and 6 of them (as of 09-15) |
| notebook a11y | PR | `npx vitest run src/pages/journal-2-0/a11y/` |
| notebook latency | PR | `pytest tests/test_notes_cas_is_atomic.py` |
| Options Flow guard | PR | `npx vitest run src/pages/optionsFlow/` |
| preference allow-list | PR/push | `pytest tests/test_preference_key_validation.py` |
| term018 guards, wisdom rails, vite build args | PR/push | single-purpose pytest rails |
| Joystick device suite | PR | `npx vitest run src/testing/device/automatePlanGate.test.js` |
| notebook budgets/bytes, flow-worker deploy coverage, clock parity, OCR cert | PR/push | size/budget scripts, no vitest/pytest |

`app/package.json`: `test` = `vitest run`, plus `test:engine`, `test:builder`, `test:chart`. There is no agent-specific npm script; the gate calls vitest by path.

### Test-suite sizes

| suite | files | cases |
|---|---|---|
| app `*.test.*` (all) | 4,082 (+30 `__tests__`) | 43,792 `it/test(` |
| tests/*.py (top-level) / tests/**/*.py | 2,515 / 2,948 | 36,158 `def test_` |
| agent vitest (`app/src/agent` 144 + builder agent 12) | 156 | 1,721 |
| agent pytest `tests/test_uct_agent*.py` | 59 | 771 |
| **agent share** | 3.3% of files | 3.1% of cases — but it is the only product suite in the master gate |

---

## 6. Direct-to-master commits touching agent paths

```
git log --no-merges --first-parent origin/master --since=2026-10-01 --format='%h %ad %an %s' -- $P   # 110
git log --no-merges --first-parent origin/master --since=2026-10-01 --format='%ad' --date=format:'%G-W%V' -- $P | sort | uniq -c
```

**110** non-merge commits sit directly on master's first-parent line and touch agent paths (vs 587 for the whole repo in the same window → agent = 19%).

| ISO week | agent direct-to-master | repo direct-to-master |
|---|---|---|
| W40 | 0 | 51 |
| W41 (10-05…10-11) | 75 | 275 |
| W42 (10-12…10-18) | 34 | 142 |
| W43 | 0 | 71 |
| W44 | 1 | 32 |
| W45 | 0 | 16 |

All 109 of the October ones are dated **10-06 → 10-13** (UCT Agent foundation `81cfb46fd9`, the "every production turn 500'd" hotfix `0be2ff8004`, Batches 5-8, M1/M2/M3, Gate B Phase 0A-0D, breadth intelligence, the post-release credit-outage hotfix `4a368e80ed`, the gate wiring `68af708c24`/`f70ae41b4b`). The single later one is `d7a2605733` (10-28, `chore(desk)`, sidebar destinations, authored "Claude Fable 5"). Since 10-13 the Agent program has been PR-only; the repo overall still lands ~30-70 direct commits/week. Full list of the 110 is produced by the `git log` command above.

---

## 7. Documentation ratio

```
find docs/agent -name '*.md' | xargs wc -l      # 72 files, 8,504 lines
find docs/agent -type f | xargs wc -l           # 90 files, 41,355 lines
```

| ratio | value |
|---|---|
| docs/agent (all files) : agent source (non-test, non-fixture) | 41,355 : 33,340 = **1.24 : 1** |
| docs/agent markdown only : agent source | 8,504 : 33,340 = **0.26 : 1** |
| docs/agent md + docs/indicators AGENT-* : agent source | 10,177 : 33,340 = 0.31 : 1 |
| docs/agent : agent tests | 41,355 : 42,425 ≈ 1 : 1 |

Distinct planning / status / handoff / report-type markdown docs under docs/agent (name matches plan|status|handoff|roadmap|report|readiness|release|checklist|resume|gate-|progress|trial|startup|ownership|integration|record|audit|proposal): **35 of the 72 markdown files**; the other 37 are design/contract/architecture/ADR docs. Program coordination layer alone (`docs/agent/program/`): 4 status files (agent-lead 15 lines, agent-md 176, agent-sc 51, agent-qa 742), 5 contracts (MD-1, MD-1-phrasings, SC-1, SC-1-SAT-1, SC-2 = 1,046 lines), 4 ADRs (147 lines), README/OWNERSHIP/INTEGRATION/STARTUP-PROMPTS (313 lines). Plus 8 Indicators-side agent contracts/handoffs in docs/indicators (1,673 lines). Eight release checklists / readiness / production-record docs exist (M1, M2, M3, Gate B readiness, Gate B production record, Gate C checklist, RELEASE-2026-10-12, BREADTH-CURRENT-RELEASE).

Docs churn to master since 10-01: md +9,101 / −582. On all refs the docs/agent total is +116,446 / −37,953 with JSON dominating.

---

## 8. Branch / worktree sprawl

```
git branch -r | wc -l            # 1,491 remote branches
git branch -r | grep -ci agent   # 142
git branch -r | grep -c 'origin/agent/'          # 99
git branch | wc -l ; git branch | grep -ci agent  # 330 local, 88 agent
git worktree list | wc -l        # 199
```

| measure | value |
|---|---|
| remote branches, total | 1,491 |
| remote branches matching "agent" | **142** (agent/* = 99; feat/*agent* = 12; fix/*agent* = 9; local-backup/* = 14; worktree-agent-* = 5; release/, handoff/, docs/ = 3) |
| local branches / agent | 330 / 88 |
| git worktrees registered on the main repo | **199** |
| release/agent*, agent/rc/* | 1, 4 |

---

## 9. Program status docs (docs/agent/program/status)

```
grep -oE '\bF-[0-9]+[a-z]?\b' <file> | sort -u | wc -l ; grep -oE '#[0-9]{3}\b' <file> | sort -u | wc -l
grep -rhoE '\bF-[A-Z]+-[0-9]+\b' docs/agent | sort | uniq -c
```

| file | lines | distinct F-ids | distinct PR refs | dates mentioned |
|---|---|---|---|---|
| agent-qa.md | 742 | 24 (F-1 … F-24, contiguous) | 43 | 10-29, 10-30, 10-31, 11-02 (+ a "2026-11-27" typo/forward date) |
| agent-md.md | 176 | 5 (F-6, F-8, F-19, F-20, F-21) | 21 | 11-01, 11-02 |
| agent-sc.md | 51 | 3 (F-4, F-7, F-12) + F-SB-1 | 17 | — |
| agent-lead.md | 15 | 0 | 0 | — (still says "Sprint 0 in flight") |
| **union** | 984 | **24 numbered + 4 lettered (F-SAT-1/2/3, F-SB-1) = 28 findings** | **56 distinct PRs** (#569…#699) | |

Finding lifecycle visible in agent-qa.md: F-4, F-7, F-8 "VERIFIED FIXED"; F-6 mitigated → superseded; F-11/F-12/F-13 accepted as known limitations for the RC; F-15 (Indicators Pine undo) waits on #617; F-16 (hidden UCT ratings reachable through screener fields) got an independent "FINAL RULING" and two PRs (#654/#657) still open; F-17/F-18 (turn.py free-text door, missing `is_local_row` guard) fixed by agent-lead; F-19…F-22 fixed by #638 / `bb3d4f35f0`; F-23 (half-day session) open in #666; F-24 (lowercase resolve) blocking → fixed and measured same day.

Keyword census over the 193 agent-path commits of 10-19 → 11-02 (subject lines, a commit can hit several): MD-1/quote/bars/fundamentals/earnings/news 49; docs/status/verdict/contract 48; F-n references 36; fixture/rail/pin/mutation 32; sprint/RC/release 27; screen/scan/SC- 26; SAT/corpus/held-out/adversarial 26; quote 22; isolation/ADR-005/hidden/rating 21; indicator 19; gate/promote/sentinel/flake/unmount/timer 17; wording/ask/neutral 9; undo 7; news/headline 7; budget/cost/ledger 7; lowercase 6; ETF/fund 5; stale index 4. By prefix: feat 49, test 48, docs 34, fix 30, agent-lead 12, wip 7. By role tag: agent-qa 51, agent-md 41, agent-sc 31, agent-lead 16.

**What the last two weeks (10-19 → 11-02) were spent on, in five lines:**

1. Standing up a four-role "program" (lead / md / sc / qa sessions) with contracts (MD-1 market data v1.0→1.5, SC-1 scanning, SC-2 NL scan draft), ADRs, an ownership checker and a dark gateway, integrating ~76 PRs through `agent/int` and shipping it to master flags-OFF as Sprint 1 RC r2 (#616, 11-01) and Sprint 2 (#682, 11-02).
2. Market-data adapters behind the gateway (quote/quotes, bars.daily, fundamentals/earnings/news, themes, breadth/ratings) plus the screener capability (screen.run/count/saved, SAT-1 acceptance kit, section-B dry-run cost meter blocked on an owner credential) — every one with mutation-checked tests and fake-provider fixtures.
3. QA as a separate adversarial lane: 24 numbered findings (clock-at-import, zero-match staleness, turn-id rails, model-isolation/hidden-ratings F-16, free-text doors F-17/18), held-out and adversarial quote corpora scored at the outcome level, MD-2 panel measurement (0 model turns on fast quote rows), and a formal GO/NO-GO verdict per RC.
4. Quote-answer polish driven by owner rulings on 11-02: lowercase ticker / lowercase cashtag resolution against the canonical index (§4.7.5, #695/#696/#699 stale-index decline), neutral "ask" wording instead of naming a candidate, ETF labelling and the share-price-not-underlying sentence (#691 → #697 to master), half-day session handling (F-23).
5. Keeping the master deploy gate alive: the Agent vitest step grew to 16-18 min (gate timeout raised 25 → 40 min), OpenChart-unmount and timer/teardown fixes, token-aware isolation sentinels (#645/#659 on HOLD), plus the News→Agent "headline conversations" combined candidate (#692 live dark, #684/#665 drafts).

---

## Things not measured / caveats

- **Review / approval time**: no PR has a second human; `createdAt → mergedAt` measures self-merge latency, not review.
- **Authorship**: all PRs and 99% of commits are one GitHub account across several named sessions; "distinct authors" is not a team-size measure.
- **CI on agent branches**: the Agent suites only run in the master gate; nothing runs on push to `agent/int`, so "failures on agent branches" is structurally ~0 and says nothing about suite health before an RC.
- **Agent step duration over time**: only 4 gate runs were inspected at step level (all 11-02); the trend is inferred from per-day gate medians + the timeout comment in the workflow file.
- **Deploys**: "promote to production" runs after every green gate (≈ 20/day); production deploy count per agent release was not isolated.
- **First-parent history** on master is tangled (several PR merges are ancestors but not first-parent), so §4's merge/day counts and §6's direct-commit counts are lower bounds for PR releases and may include foreign-branch sync merges.
- **PR listing**: the 400-PR window begins at #302 (10-09); 42 earlier October master PRs were back-filled via REST for the repo norm; no agent PR exists before #310.
- **Run listing**: GitHub API returned intermittent 502s; windows differ per workflow (noted in each table).
- Line counts treat generated JSON (fixtures, eval baselines, SAT captures) separately where possible; the "docs/agent" headline (41k) is 79% JSON.

Scratch artifacts: `prs.json`, `prs-old-detail.jsonl`, `runs*.json`, `gate-*.json`, `pr-analysis.js`, `pr-oct-norm.js`, `run-analysis*.js`, `agent-merges.txt`, `pr-report.md` in the same scratchpad directory.
