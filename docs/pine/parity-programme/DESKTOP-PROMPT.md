# DESKTOP PROMPT v2 (2026-11-03): the desktop as the programme's second build machine

**Before pasting:** open Claude Code on the desktop in the same permission mode the laptop session
uses. Otherwise the session stops at every tool prompt. Then paste this one line:

    Run the Pine parity programme's desktop build lane: cd C:/Users/Patrick/uct-worktrees/pine-handoff && git fetch origin && git merge --ff-only origin/docs/pine-parity-programme (if that fails: git -C C:/Users/Patrick/uct-worktrees/pine-base worktree add --detach C:/Users/Patrick/uct-worktrees/pine-handoff-dsk origin/docs/pine-parity-programme and use that folder instead), then read and follow docs/pine/parity-programme/DESKTOP-PROMPT.md there (full autonomy, same grant as the laptop).

---

## 0. Objective

**Goal:** any open-source TradingView Pine script a member writes or pastes runs on UCT and
matches TradingView, on the chart, screener, scans and alerts. Priorities: accuracy, then
speed, then simplicity. Build the language, not the 679-script sample, which is only the
yardstick.

Until now one machine, the laptop, did everything. Its single heavy-test slot (16 GB, about 2 GB
free) became the bottleneck, and finished lanes waited hours for tests. From now on:

| | LAPTOP: coordinator (existing session) | DESKTOP: build machine (you) |
|---|---|---|
| builds lanes | yes, its own list | yes, **your list in section 4** |
| heavy tests | its own lock | **your own lock**, so the two machines never block each other |
| independent Opus review | **yes, every lane from both machines** | no; you build, the laptop judges |
| merge origin/master, landing checks | yes | only when the laptop asks (state `REFRESH`) |
| SCRIPT_ENGINE_VERSION bump | **yes, only here, at merge** | never |
| PR, merge, deploy verification, live smoke | **yes, only here** | never |
| Railway, flags, arming, production | yes, staged, per owner rules | never |
| reports to the owner and Discord #prompts | yes | no; your status goes to the channel (section 2) |

This split keeps one merge authority, one engine-version counter and one deploy queue.
Nothing races, and two machines run heavy tests.

In this file, `$H` means the pine-handoff folder you fast-forwarded:
`C:/Users/Patrick/uct-worktrees/pine-handoff` (or `pine-handoff-dsk`). `$S` means
`$H/docs/pine/parity-programme/scripts`. Always call the scripts by these absolute paths.

## 1. Read first (from $H/docs/pine/parity-programme/)

1. This file, then `BUILDER-RULES.md`, which every builder you spawn reads.
2. `AGENT-RULES.md`, `WAVE-TASKS.md` and `PLAN.md`.
3. `RESUME-LAPTOP.md` sections 1-4: what is live, the stream table, setup and the ship loop.
4. On master: `docs/pine/W4-BREAKDOWN.md`, the W4 plan (T0-T17, with regions and conflicts in
   section 4), and `docs/pine/SERVER-RUNTIME-DESIGN.md`, the W5 plan (section 7 tasks, section 9.1
   rulings). Read them with `git show origin/master:<path>`.
5. The live channel (section 2): `git show origin/ops/pine-coord:ASSIGNMENTS.md`. **This file
   overrides section 4** if the two disagree.

## 2. The channel between the machines (GitHub, two single-writer branches)

| branch | written ONLY by | file(s) | read by |
|---|---|---|---|
| `ops/pine-coord` | laptop | `ASSIGNMENTS.md` (lane → machine, state, notes); `reviews/<lane>.md` (review findings) | desktop |
| `ops/pine-desktop` | desktop | `DESKTOP-STATUS.md` (one block per lane); `runs/<lane>/*.txt` (summary lines only, optional) | laptop |

- **Write** with `status-push.sh`, which commits without a checkout and runs from any worktree:
  `bash $S/status-push.sh ops/pine-desktop "W4-T2 READY f00ba12345" DESKTOP-STATUS.md=<local file>`
- **Before every edit**, rebuild your local copy from the remote, so a restart never loses
  history: `git fetch -q origin ops/pine-desktop && git show origin/ops/pine-desktop:DESKTOP-STATUS.md > <local file>`.
  On the very first push, this fetch fails, which is fine.
- **Read** with `git fetch -q origin ops/pine-coord && git show origin/ops/pine-coord:ASSIGNMENTS.md`.
- The branches have their own history, contain no repo files, and are never merged.
- Never write the other machine's branch.
- **Poll** with one background command (run_in_background). It exits when the laptop writes:

      old=$(git rev-parse origin/ops/pine-coord); until git fetch -q origin ops/pine-coord && [ "$(git rev-parse origin/ops/pine-coord)" != "$old" ]; do sleep 900; done; echo COORD_CHANGED

  On COORD_CHANGED, read ASSIGNMENTS.md, act, and re-arm the poll. Also read it whenever a
  builder finishes. Never sleep in the foreground.

**Lane states.** Desktop-owned states are written in DESKTOP-STATUS.md. Laptop-owned states are
written in ASSIGNMENTS.md.

| state | who sets it | meaning |
|---|---|---|
| `QUEUED` | laptop | assigned to you, not started |
| `BUILDING` | desktop | a builder is on it |
| `BLOCKED` | desktop | needs a decision; say exactly which one |
| `READY` | desktop | done, pushed, evidence committed, report in your block |
| `REVIEWING @<sha10>` | laptop | Opus review running on that tip |
| `FIX r<n> @<sha10>` | laptop | NO-GO on that tip; findings in `reviews/<lane>.md` (round n); you run the fix round, then READY again with `round: r<n>` |
| `REFRESH @<sha10>` | laptop | GO on that tip, but master moved in engine paths; merge origin/master, re-run final-tip (+ measure-pair if engine), push, READY |
| `LANDING @<sha10>` | laptop | GO, merging; **from here the branch belongs to the laptop** |
| `MERGED <sha>` | laptop | done; drop the worktree (`cmd //c rmdir` the node_modules junction first, then `git worktree remove`) |
| `WITHDRAWN` | laptop | lane taken back or re-planned; push your WIP, set `RELEASED <tip>`, stop the builder |

**SHA rule** (REVIEWING, FIX, REFRESH, LANDING): act only when `@<sha10>` equals your latest READY
tip. From LANDING on, it may instead equal the tip of `origin/<branch>` after you run
`git merge --ff-only origin/<branch>`. Otherwise wait for the next update. QUEUED, WITHDRAWN and
MERGED apply at once.

**Two-writer rule:** from LANDING on, the laptop may push to the lane branch (a master merge,
the engine bump). If a lane returns to FIX or REFRESH after that, first run
`git fetch origin && git merge --ff-only origin/<branch>` in the lane worktree. Never
force-push. Never rebase a pushed branch; always merge origin/master.

**DESKTOP-STATUS.md block format** (one per lane):

    ## W4-T2
    state: READY            round: r0            updated: 2026-11-03 16:40 CT
    branch: feat/pine-w4-t2-simple-folding   tip: <10-char sha>   tested on master: <10-char sha>
    engine bump needed: yes|no (why)
    evidence: docs/pine/evidence/2026-11-03-w4-t2/EVIDENCE.md (on the branch)
    report: <the builder's <=250-word report>
    next: <only when not READY: the exact next step>

## 3. Set up the desktop (verify before any work)

The desktop is where the programme started, so most of this already exists. Verify each item;
fix only what is missing.

1. Shell state does not persist between tool calls. Start EVERY Bash call, background ones
   included, with `source C:/Users/Patrick/uct-worktrees/pine-handoff/docs/pine/parity-programme/scripts/env-desktop.sh`
   (or the `pine-handoff-dsk` path, with `H` exported to that folder first). It sets `$H` and `$S`.
   Builders' prompts must say the same. Check that `UCT_WORKTREES`, `UCT_RESUME`, `HEAVY_LOCK` and
   `UCT_PY` exist and work. Override in the shell, not in the scripts.
2. **Shared install.** The `pine-base` worktree is detached at origin/master and has `npm ci` in
   `app/`. Run `npm ci` only inside an hl job, and only when `app/package-lock.json` changed.
   Every other worktree junctions `app/node_modules` to pine-base.
3. **measure-pair base.** Create one worktree, `$UCT_WORKTREES/pine-dsk-mpbase`
   (`git worktree add --detach … origin/master`), and junction its `app/node_modules` to
   pine-base. Builders switch it inside their hl job (see BUILDER-RULES).
4. **Python.** final-tip.sh and measure-pair.sh call bare `python`, so
   `python -c "import pytest, linkify_it"` must work. If it does not, install `requirements.txt`
   + pytest for that python.
5. **Licence-held census inputs.** These are never committed, and both must exist:
   - the coverage sample `$UCT_RESUME/pine-sample` (if missing:
     `python tools/pine_coverage/fetch_sample.py --cache <dir>`);
   - the reference `$UCT_RESUME/runs/C/ref_rebuilt.json` (if missing:
     `tools/pine_survey/pine_reference_extract.js`, per docs/pine/COVERAGE-MAP.md "How to re-run").
6. **Lock.** `$UCT_PY $HEAVY_LOCK run --label probe --timeout 60 -- echo ok` must work.
7. **Baseline.** Create a fresh worktree `pine-dsk-smoke` at origin/master (with the junction).
   Start `hl dsk-baseline -- bash $S/final-tip.sh pine-dsk-smoke dsk-baseline` **in the
   background**, and start your lanes at once; do not wait on it. When it finishes, record its
   failed files in your DESKTOP-STATUS.md header, then remove the worktree.
   - The laptop baseline is 2 failed files: `targetScriptReport.measure` and
     `pollingSites.rail`.
   - An extra desktop failure is a desktop baseline item; record it and do not chase it.
8. **Agent count.** Free RAM (`freeram`) sets it. Up to 4 builders at once (at most 2 on Opus)
   when free RAM is 6 GB or more, and 3 below that. Heavy jobs always run one at a time through
   the lock.
9. **First status.** Push a first DESKTOP-STATUS.md to `ops/pine-desktop` with a header: desktop
   up, RAM, baseline (pending), and the lanes you are starting.

You never need SMOKE credentials, Railway or the owner's Chrome. If something asks for them,
stop: that work belongs to the laptop.

## 4. Your lanes (initial list; ASSIGNMENTS.md is authoritative)

Start the first four at once. Start the rest in order as slots free up.

| # | lane | branch to create | model | depends / conflicts | notes |
|---|---|---|---|---|---|
| 1 | **W4-T2** `simple` qualifier folding | `feat/pine-w4-t2-simple-folding` | Opus | none; T9 waits for it | W4-BREAKDOWN T2. Engine change: measure-pair both lanes. Unblocks RSI's attach (with T4). |
| 2 | **W5-T1** server bundle | `feat/pine-w5-t1-server-bundle` | Sonnet | none | SERVER-RUNTIME-DESIGN 7/P0 T1. First measured bare-Node run (5,000 D bars). Build script only, no infra. |
| 3 | **W4-T7** an expression's own series in function bodies | `feat/pine-w4-t7-fn-series` | Sonnet | T8 merges after it | Engine change. |
| 4 | **W4-T11** text builtins over runtime values | `feat/pine-w4-t11-runtime-text` | Sonnet | RT/text.js, FE ~6120-6160 | Engine change. **Do not edit `ast/pineTextFormat.js`** (W3 edits it; one authority). If T11 needs it, set BLOCKED until W3 merges. |
| 5 | **W5-T6** supervisor + protocol + auth | `feat/pine-w5-t6-supervisor` | Opus | after W5-T1 READY: branch from T1's tip; once T1 merges, merge origin/master in | Local only. No Railway, no secrets in the repo; HMAC keys come from env in tests. |
| 6 | **W4-T17 probes + W4-T13 spike** | `docs/pine-w4-t17-t13-probes` | Sonnet | docs and probes only | Probe files plus a spike note. No engine edit. |
| 7 | **W5-T2** host-neutral closure | `feat/pine-w5-t2-host-neutral` | Opus | branch from origin/master **after W5-T1 is MERGED** | The deadline code is in `ast/pine.js` at ~:6844-6961 today (the design doc's :6700-6735 is stale), plus `runtimeColumns.js`. 0 C18 diffs is the bar. |
| 8 | **W4-T12** paint typing | `feat/pine-w4-t12-paint` | Sonnet | first check overlap with laptop's W3: `git diff --stat origin/master...origin/feat/pine-w3-drawings` | If W3 touches `memberPaneDefinition.js` or `RT/colours.js`, set BLOCKED until W3 merges. |

**In-flight laptop regions, checked 2026-11-03.** Your lanes overlap none of these bands.

| branch | where it changes |
|---|---|
| W4-T1 | front end 1223, 4891-4951 |
| W4-T4 | front end 2114-2290, 5333, 5710, and `RT/lowerIr.js` |
| W4-T3 | front end 5093, 10331-10582, and `RT/clockFns.js` |
| W3 | `ast/pine.js` 19357 onward, and `ast/pineTextFormat.js` |

**The laptop keeps:**
- W2 arming, W3 drawings, W5-T3 codec;
- W4 T0/T1/T3/T4;
- the language scoreboard, the E lows and the Editor (parked);
- W5-T11 onward, which needs T3;
- every review, merge, arming step and report.

**Assigned later through ASSIGNMENTS.md** as their dependencies merge:
- W5-T4, T5 and T7-T10. T7 needs T1 and T6; T8 needs T6.
- Batch 3 of W4 (T8, T9, T10, T14, T15).
- The capture-gated tasks.

**Region discipline:** W4-BREAKDOWN section 4 lists the front-end line bands each task owns. If a
fix needs a band another lane owns, stop. Set BLOCKED, name the band, and let the laptop order
the lanes.

## 5. How to run a lane

1. Set the lane to BUILDING in DESKTOP-STATUS.md and push it.
2. Spawn one builder agent with the Agent tool, at the model the table gives. Use the Agent tool,
   not Workflow: Agent-tool builders can be resumed with SendMessage, and Workflow agents cannot.
   The builder's prompt holds:
   - the lane;
   - the spec location (W4-BREAKDOWN `### T<n>` or SERVER-RUNTIME-DESIGN 7);
   - its branch and worktree names;
   - "read $H/docs/pine/parity-programme/BUILDER-RULES.md fully first";
   - the region it owns;
   - "report in 250 words or fewer".
3. When the builder reports, check its report against the definition of done in BUILDER-RULES:
   - rails red on master and green on the tip;
   - mutations;
   - measure-pair on both lanes, every diff classified;
   - final-tip at the baseline;
   - hygiene clean;
   - EVIDENCE.md committed with everything the reviewer needs.
   If anything is missing, resume the same builder with SendMessage. Do not hand-patch.
4. Set READY with the block format above and push it. Pick up the next lane.
5. When the laptop sets **`FIX r<n> @<your tip>`**:
   - read `git show origin/ops/pine-coord:reviews/<lane>.md`;
   - resume the same builder with the findings verbatim. After a session restart, spawn a new
     builder with the branch, `reviews/<lane>.md` and EVIDENCE.md;
   - every finding is fixed or answered with evidence;
   - only the delta is re-run, but final-tip always runs on the final tree;
   - update EVIDENCE.md, then set READY with `round: r<n>`. The laptop re-reviews the delta only.
6. When the laptop sets **`REFRESH @<your tip>`**:
   - merge origin/master into the branch;
   - re-run final-tip;
   - for an engine lane, also re-run measure-pair against the base at the new merge-base;
   - update EVIDENCE.md, push, then set READY with the new tip and tested-on-master SHA.

## 6. Non-negotiable rules (same as the laptop)

**Engine correctness**
- Refuse by name anything not proven exact against TradingView.
- Never stop drawing a value that matched TradingView.
- Never draw where TradingView hides (na, transparent).

**Code discipline**
- Every new guard is mutation-proved, and restores are byte-exact.
- One authority per value; no copied rules.

**Licence and secrets**
- Licence-held content is never committed or pushed: sample scripts, captures, the reference
  text, census, harness or out JSON.
- Secrets stay in the environment, never in git, logs or chat.

**Git and machine hygiene**
- Never touch other projects' worktrees or processes.
- Never kill a process you did not start.
- Many people work in this repo: stay on Pine lanes only.
- Never `--no-verify`, never force-push, never push to master or production, never open a PR
  or merge.
- No SCRIPT_ENGINE_VERSION edits.
- Never git checkout/stash/reset to restore files. Write `.uct-session-owner` in every worktree
  you create. Delete only what this session created.

**Off-limits to you entirely**
- Railway variables, flags, arming, production infrastructure.
- Purchases, data contracts, the capture rig, sign-ins, credentials.
- Raise any of these as BLOCKED with the exact question for the owner.

## 7. Stopping and hand-off

- Keep going until every lane assigned to you is MERGED or BLOCKED on an owner item. Keep the
  poll armed for new lanes.
- If the session must stop:
  - commit and push every lane's WIP, with a commit message stating the exact next step;
  - set each block's state, with a `next:` line;
  - push DESKTOP-STATUS.md.
  The laptop can then pick up any lane from its branch alone.
- Do not post to Discord or message the owner. The laptop reports. The owner can watch
  `ops/pine-desktop` on GitHub.

## 8. What the laptop does with your READY lanes (for your understanding)

1. Poll `ops/pine-desktop`. On READY, set `REVIEWING @tip` and run an independent Opus review
   against the branch and its EVIDENCE.md. The result is GO, or NO-GO, which becomes
   `FIX r<n> @tip` plus `reviews/<lane>.md`.
2. On GO, check the master delta since your tested-on-master.
   - If the delta touches the engine (`app/src/components/chart/engine`, Pine `api/services`)
     and the lane is an engine change, set `REFRESH @tip`.
   - Otherwise set `LANDING @tip`, merge origin/master, and run the short landing checks:
     deploy-gate pytest, hygiene, and the lane's own and affected tests.
3. Bump SCRIPT_ENGINE_VERSION if needed. Numbers are taken in merge order and noted in
   ASSIGNMENTS.md. Open the PR and merge it, then verify the deploy, smoke test, and report to
   the owner.
4. Set `MERGED <sha>`.
