# Builder rules (Pine parity programme, either machine) - every builder agent reads this fully first

Goal: any open-source TradingView Pine script runs on our platform and matches TradingView.
Priorities: accuracy first, then speed, then simplicity. Scope rule: fix the LANGUAGE, never one
script. Full rules: AGENT-RULES.md (this folder). Its absolute paths are the desktop's.
`$UCT_*` below come from `scripts/env-desktop.sh` (desktop) or `scripts/env-laptop.sh` (laptop).

## Setup (your own worktree, your own branch)
1. `git -C $UCT_WORKTREES/pine-handoff worktree add $UCT_WORKTREES/<wt> -b <branch> origin/master`
2. Then, inside the worktree:
   - run `git branch --unset-upstream`;
   - write `.uct-session-owner` with "pine-parity <machine> session <id>";
   - junction node_modules to the shared install:
     `cmd //c "mklink /J <wt>\app\node_modules <pine-base>\app\node_modules"`.
     Without it, Python rails that shell out to node fail with "Cannot find module 'acorn'".
     Remove a junction only with `cmd //c rmdir`, never by deleting through it.
3. Source the env file at the start of EVERY Bash call; shell state does not persist between calls.

## Heavy jobs (one at a time per machine, through that machine's lock)
- Heavy means any of: more than 2 vitest files, census, harness, measure-pair, the deploy-gate
  pytest, final-tip.
- Run each as ONE batched job: `hl <label> -- bash -c '...'`, with vitest `--maxWorkers=2`.
  Running 1-2 vitest files, or a pytest file under 30 s, directly is fine.
- Do all coding and light checks first, then queue ONE heavy job holding every heavy step.
- NEVER end your turn while a job you launched is queued or running. A reviewer will judge
  unfinished work. Wait with ONE blocking foreground until-loop (`sleep 300`) on your job's output
  marker. Re-run it if it times out.
- Scripts in `docs/pine/parity-programme/scripts/` (pine-handoff worktree):
  - `measure-pair.sh <out> tip:<wt> base:<base-wt> <runtimeOn 0|1> 1` compares tip with base. Run it
    with both 0 and 1. The base must be the tip's OWN master. Set it INSIDE the same hl job:
    `M=$(git -C <wt> merge-base HEAD origin/master); git -C <base-wt> switch -q --detach $M && test "$(git -C <base-wt> rev-parse HEAD)" = "$M" || exit 3`.
    `<base-wt>` is the machine's measure-pair base worktree (desktop: `pine-dsk-mpbase`;
    laptop: `pine-base`), with the node_modules junction. Record M as tested-on-master.
    Run `npm ci` only inside an hl job.
  - `final-tip.sh <wt> <label> [pytest files]` runs the gate pytest, hygiene and the full chart+hooks
    vitest.
  - `mutate.py <muts.json> <test files...>` is the mutation proof. Restores are byte-exact.
- Known vitest baseline failures (not ours): `targetScriptReport.measure`, `pollingSites.rail`.

## Files and git
- Inside worktrees, use bash (cat/sed/grep/python heredocs). Never use the Read/Edit/Write tools
  there: each one loads a very large CLAUDE.md.
- Never commit licence-held content: TradingView script sources, capture payloads, reference text,
  the pine-sample cache. Cite; never paste.
- Never use git checkout/stash/reset to restore files. Touch only your own worktree and branch.
  Never touch other projects' worktrees or processes.
- Do NOT bump SCRIPT_ENGINE_VERSION; the laptop coordinator bumps it at merge. Say whether a bump
  is needed.
- End commit messages with the attribution lines your session's system reminder gives.
- `git push -u origin <branch>`. Never `--no-verify`. No PR. No merge. No Railway. No flags.

## Definition of done
- Every behaviour change has a rail test (red on master, green on the tip).
- Mutation proof: every new guard and rule is broken once and a test catches it. Name any
  equivalent survivor as equivalent.
- An engine change has measure-pair on BOTH lanes against pine-base at the same master. Classify
  every census, C18 and harness diff as intended or not; 0 unintended.
- final-tip on the final tree, compared with the baseline. Hygiene clean.
- `docs/pine/evidence/<YYYY-MM-DD>-<lane>/EVIDENCE.md` on the branch. The reviewer on the other
  machine cannot read your local logs, so this file carries everything they need:
  - for each check: the command, the tip SHA and tested-on-master SHA, and the totals line;
  - the names of the rail tests that fail on master and pass on the tip;
  - a mutation table (mutation → the test that kills it; equivalent survivors named as such);
  - the measure-pair `== side` SHAs for runtime 0 and 1, with every census, C18 and harness diff
    classified;
  - log paths.
  No licence-held text. The status branch `runs/` takes summary lines only, never census/,
  harness-* or out-*.json.
- Final text: a report of 250 words or fewer with the final SHA, what changed, the checks with
  their numbers, the open items, and whether an engine bump is needed.

## Ops rules (OPS-SPEED.md has the tools and self-tests)
- (a) `final-tip.sh` is the LAST step, after the last non-docs commit, on a clean tree. Then push and run
  `scripts/ready-check.sh <wt> $UCT_RESUME/runs/<label>`; it must print `READY-CHECK PASS`. Only docs may change after TIP.
- (b) Job scripts live under `$RUN` (`lane_env <lane>` creates `$UCT_RESUME/runs/<lane>/`), never in a shared scratchpad
  or `/tmp`: another lane's file of the same name gets run instead of yours.
- (c) Never run pytest, or `--collect-only`, over the whole `tests/` tree. Name the files.
- (d) Contract first: when lanes share an interface (wire schema, time units, a result shape), the first lane commits a
  shared conformance fixture that both sides must pass BEFORE other lanes build on it.
- (e) Use `lane_env <lane>` for locks: `"$UCT_PY" "$HEAVY_LOCK" run --path "$LOCK_FINAL2" -- ...` (also `LOCK_MUT`,
  `LOCK_MP2`, `LOCK_MP3`, `LOCK_FINAL3`). Never place a lock under `C:/Users/Patrick/.claude/`.
- When a lane is merged and pushed, `scripts/retire-worktree.sh <wt>` frees the worktree (junction-safe).
