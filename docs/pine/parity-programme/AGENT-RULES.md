# Rules for every Pine-parity agent (read fully before doing anything)

Programme plan: `C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\PINE-FULL-PARITY-PLAN.md`.
Repo: UCT-Dashboard. Existing measurements: `docs/pine/COVERAGE-MAP.md`,
`docs/pine/PHASE3-RUNTIME-PLAN.md`, capture queues `docs/pine/capture-queue-*.md`.

## Scope rule: fix the language, never the script (owner, 2026-11-02)
The goal is infrastructure: ANY open-source Pine indicator can be written or pasted here and runs
exactly as on TradingView, on the chart, in screens, scans and alerts. The 679-script sample is the
yardstick that ranks which language features block real code; it is not the target list.
- Every change implements a Pine language capability (a built-in, a statement form, a type, a
  drawing primitive, a semantic rule) for every script that uses it, proven by its own rail against
  TradingView's published behaviour or a capture. Never special-case a script, its title, its
  author or its text.
- Report progress in two measures: scripts transferred on the sample, and Pine v6 reference items
  (functions, variables, constants, types, keywords) that work exactly per lane (the
  language-coverage scoreboard).

## Agents, models and concurrency (owner, 2026-11-02)
- Up to 6 concurrent agents plus the integrator for this programme (owner request 2026-11-02; the
  same cap as the Terminal programme's D-013). CLAUDE.md's memory check still applies: print free
  memory before every launch and stay at 3 when it is under ~4 GB. At most 3 top-tier (Fable/Opus)
  agents at once (five concurrent Opus agents once hit the account's rate limit).
- Model by task: Fable for the hardest engine design and builds; Opus for fix rounds and every
  merge-gating independent review (the independent opus reviewer GO rule stands); Sonnet for
  routine work from a precise spec (tests, tools, measurement runs, docs, capture-queue rows);
  Haiku for mechanical extraction, log parsing and file-list checks.
- Heavy jobs stay serialized through the lock whatever the agent count.

## Machine paths
Paths below are the desktop's. On the laptop, `source docs/pine/parity-programme/scripts/env-laptop.sh`
(it sets UCT_WORKTREES, UCT_RESUME, HEAVY_LOCK, UCT_PY and the `hl <label> -- <cmd>` helper).

## Machine safety (the owner's PC froze yesterday: page file on a slow HDD)
- Every vitest / pytest / census / harness run goes through the lock, ONE job at a time:
  `python C:/Users/Patrick/uct-clips/tools/heavy_lock.py run --label <you>-<what> --timeout 14400 -- <cmd>`
- vitest: from `app/`, `node node_modules/vitest/vitest.mjs run <files> --maxWorkers=2`. Targeted
  files only, never whole folders (the coordinator runs full folders before merge).
- Never `--force-concurrent`. Never kill a process you did not start. Waiting for the lock is normal.

## Worktrees and installs
- Create your own worktree from origin/master in `C:\Users\Patrick\uct-worktrees\<name>`.
- Do NOT npm install. Link the shared install (from PowerShell):
  `cmd /c mklink /J <worktree>\app\node_modules C:\Users\Patrick\uct-worktrees\pine-base\app\node_modules`
  Wait until `C:\Users\Patrick\uct-worktrees\pine-base\app\node_modules\vitest` exists.
  Never delete recursively through a junction; remove a junction with `cmd /c rmdir`.
- Never `git stash` bare; never `git checkout` to restore a mutated file (rewrite the saved bytes
  with python). Never push to master or production. Push only your own branch. No PR.

## Engine house rules
- Refuse by name (pine:*, runtime:*) anything not proven exact against TradingView.
- NEVER stop drawing a value that matched TradingView; NEVER draw where TradingView hides
  (na / transparent colours hide output).
- Every new guard is mutation-proved: remove it -> a named rail goes red; restore from saved bytes.
- One authority per value: never copy a rule into a second place; derive or call the one function.
- The C18 object door is LIVE for members (memberPaneDefinition -> probeObjectRuntime /
  runtimeObjectValues, opts.objectDoor=true): any runtime-lane change must show 0 unintended
  C18 diffs (coordinator measures).
- Output-changing engine work: do NOT bump SCRIPT_ENGINE_VERSION yourself; the coordinator bumps
  once per merge (app/src/components/chart/engine/scriptEngineVersion.js; server reads it).
- New VITE_* reads need a Dockerfile.web ARG + ENV line and a docs/feature_flags.json row.
- Before the final push of a work package (and before asking for review): `python -m pytest tests/test_no_shadowed_definitions.py tests/test_dockerfile_vite_build_args.py tests/test_vite_flag_ledger.py tests/test_visibility_flag_ledger.py tests/test_script_engine_version_gate.py -q`
  (via the lock; the integrator runs it again on the merged tip). Before every commit:
  `python tools/check_repo_hygiene.py`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (plus the session's
  `Claude-Session:` line when the coordinator gives one).
- Anything needing a TradingView capture to prove: add a row to a capture queue doc
  (`docs/pine/capture-queue-2026-11-02-<wave>.md`) with the exact probe script, and keep the
  shape refused by name until captured.

## Report back (<= 400 words)
Branch + SHA, what changed (file:line), rails added, mutations killed, targeted test results,
what you left refused and why, capture rows added, anything needing an owner decision.
