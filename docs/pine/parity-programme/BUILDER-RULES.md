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
3. Source the env file.

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
  - `measure-pair.sh <out> tip:<wt> base:<pine-base> <runtimeOn 0|1> 1` compares tip with base.
    Fast-forward pine-base to origin/master first (if clean). Run it with both 0 and 1.
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
- `docs/pine/evidence/<YYYY-MM-DD>-<lane>/EVIDENCE.md` on the branch: numbers, diff
  classifications, log paths. No licence-held text. The reviewer on the other machine cannot read
  your local logs, so this file must carry everything they need.
- Final text: a report of 250 words or fewer with the final SHA, what changed, the checks with
  their numbers, the open items, and whether an engine bump is needed.
