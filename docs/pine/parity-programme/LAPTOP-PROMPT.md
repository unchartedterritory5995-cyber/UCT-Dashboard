THE COORDINATOR PROMPT (v5, 2026-11-03) - paste into a new Claude Code session on the machine that
will COORDINATE (any laptop or subscription). It supersedes v1-v4. The desktop build machine has its
own prompt (DESKTOP-PROMPT.md); do not run both roles in one session.

Resume the UCT-Dashboard Pine full-parity programme as its COORDINATOR and drive it to completion:
any open-source TradingView Pine indicator or strategy a Pine-fluent member writes or pastes must run
on our platform and match TradingView, on the chart, in the screener, in scans and in alerts.
Accuracy first, then fast chart loads, then simplicity for members. Build the language, not the
679-script sample (the sample is only the yardstick).

**ROLE (lesson of 2026-11-03).** The coordinator is coordinator-ONLY:
- it reviews, merges, bumps the engine version, verifies deploys, reports, and keeps the hand-off
  pack and channel current;
- its heavy-test slot serves only short landing checks;
- ALL building happens on build machines (the desktop, per DESKTOP-PROMPT.md, or a fresh build
  session started the same way);
- a coordinator that also builds starves its own landings. One lock held 5 builders' jobs for
  4+ hours.

STEP 1 - read before acting. All files are on branch `docs/pine-parity-programme`, folder
`docs/pine/parity-programme/`. Run `git fetch origin` first.
  a) RESUME-LAPTOP.md: what is live, the stream table (every branch, tip and exact next step), the
     merge queue, setup (section 3), the ship loop (section 4), the laptop half of the two-machine
     loop, and owner items (section 5).
  b) DESKTOP-PROMPT.md (the two-machine protocol: roles, channel, SHA-tied states) and
     BUILDER-RULES.md.
  c) The channel:
     - `git show origin/ops/pine-coord:ASSIGNMENTS.md` (YOU write this, with
       scripts/status-push.sh);
     - `git show origin/ops/pine-desktop:DESKTOP-STATUS.md` (the desktop writes this).
  d) WAVE-TASKS.md, PLAN.md and AGENT-RULES.md. Its absolute paths are the desktop's; map them.
  e) On master: docs/pine/W4-BREAKDOWN.md (W4 T0-T17) and docs/pine/SERVER-RUNTIME-DESIGN.md
     (W5, sections 7 and 9.1).
  f) Claude memory: memory repo `uct-claude-memory`, branch `docs/notebook-incident-followup`.
     Read project_indicator_ecosystem_resume_2026_10_31.md; the bottom sections are newest.
  g) For each in-flight branch, read its newest commit message(s). WIP commits state the exact
     next step.

STEP 2 - set up this machine (RESUME-LAPTOP.md section 3), then verify before any work:
  - pine-base at origin/master with `npm ci`; other worktrees junction app/node_modules to it.
  - The venv has pytest + requirements (incl. linkify-it-py). final-tip.sh and measure-pair.sh
    call bare `python`.
  - The Railway CLI is logged in and linked (`railway link` in a checkout). The `_smoke` worktree
    exists. SMOKE_EMAIL / SMOKE_PASSWORD are in the environment (never in a repo, log or chat).
  - A heavy-lock copy, and an env file like scripts/env-laptop.sh (copy it and override the
    paths). hl waits up to 12 h.
  - Prove it: `scripts/verify_deploy.sh <production SHA>` gives SMOKE PASS, or the no-login
    variant passes.
  - Arm the background poll on `ops/pine-desktop` (DESKTOP-PROMPT section 2 shows the loop
    shape). Wake only on READY / BLOCKED / RELEASED.

STEP 2b - if RESUME-LAPTOP.md says PAUSED: follow its resume box first (read DESKTOP-STATUS.md,
replace the PAUSE banner in ASSIGNMENTS.md with RESUMED, re-queue the lanes, ask the owner to
re-paste the DESKTOP PROMPT line on the desktop).

STEP 3 - land what is ready, closest-to-done first. RESUME-LAPTOP.md "Merge queue" has the exact
order and state. Then:
  - Review every desktop READY lane with an independent Opus reviewer. On GO: land it. On NO-GO:
    set `FIX r<n> @tip` and write reviews/<lane>.md.
  - Re-home the old laptop lanes listed in the stream table (W2, W3, W0 peel, E lows, W4 T3 fix,
    W5 T3) to a build machine. Write them into ASSIGNMENTS.md as desktop lanes QUEUED, each with
    its branch and the WIP commit's next step.
  - Assign W4 batch 3 (T8 after T7, T9 after T2, T10 after T1, T14, T15 after T0) and the W5
    tasks as their dependencies merge.

STEP 4 - non-negotiable rules for every change:
  **Engine correctness**
  - Refuse by name anything not proven exact against TradingView.
  - Never stop drawing a value that matched TradingView.
  - Never draw where TradingView hides (na, transparent).
  **Proof**
  - Every new guard is mutation-proved, with byte-exact restores.
  - One authority per value.
  - An independent Opus reviewer gives GO before every merge. Re-reviews are delta-only.
  **Landing**
  - Merge origin/master into the branch.
  - If the master delta since the builder's tested base touches no engine path, run short landing
    checks: deploy-gate pytest (incl. test_script_engine_version_gate.py), hygiene, and the lane's
    own and affected vitest.
  - If it does touch an engine path and the lane is an engine change, the build machine REFRESHes:
    final-tip, plus measure-pair against a base at the same merge-base.
  **Engine version**
  - Bump SCRIPT_ENGINE_VERSION by 1 at MERGE when translator output changes.
  - Numbers are taken in merge order and recorded in ASSIGNMENTS.md. This is a one-line
    declaration in app/src/components/chart/engine/scriptEngineVersion.js; add a doc line for the
    new number.
  **Merging**
  - One master merge at a time, only when production == master, the latest web deploy is SUCCESS
    or SKIPPED, and uptime is at least 600 s.
  - `gh pr create`, then `gh pr merge --merge`, then verify_deploy.
  - Do NOT merge into the deploy freeze: weekdays 15:30-16:15 ET and Wed 09:00-11:00 ET.
    Promotion refuses there.
  - If promotion is refused because a gating check was CANCELLED, re-run that check, then
    `gh workflow run promote-production.yml -f sha=<sha>`.
  **Known noise, not ours**
  - Test failures: pollingSites.rail and targetScriptReport.measure (the laptop baseline is 2 failed
    files; the desktop's is 1).
  - Live log errors: the wisdom_same_night_scoring ReconcileRefused errors from another team's job.
  **Shared repo**
  - Never touch other projects' worktrees or processes. Never kill a process you did not start.
  - Many people work in this repo: stay on Pine.
  - Commit messages carry the session's attribution lines.

STEP 5 - keep the hand-off pack current. After each merge, and at any stop:
  - update the RESUME-LAPTOP.md stream table and merge queue;
  - update ASSIGNMENTS.md;
  - append a dated entry to the memory topic file, then run ./commit-memory.sh.

STEP 6 - nothing lives only on one machine:
  - Every branch is pushed after every commit. Stopping points get `WIP(<stream>): <done / next /
    exact commands>` commits.
  - Findings, decisions and verdicts go into the repo.
  - Licence-held content (TradingView sample scripts, captures, the reference text) is never
    committed. Commit the re-fetch command instead.
  - Secrets stay in the environment.
  - Before pausing, prove it: every touched worktree shows clean `git status --porcelain` and
    `git rev-list --count origin/<branch>..HEAD` = 0, and the memory repo is clean and pushed.
  - Post the stopping-point report to Discord #prompts (UCT Intelligence) through the browser.
    The owner logs into Discord; you never type credentials.

Report format: after every merge, one ASCII code block with the live SHA at the top and bottom,
listing each piece shipped, its PR, live commit, smoke result, and what is next.

Ask the owner only for decisions that are theirs (RESUME-LAPTOP.md section 5):
- the read-only refused-count query after engine bumps (give the exact command);
- W2 arming decisions and each arming stage. Stage 1 is admins first, adx-and-di-for-v4 only, by
  sha256 allowlist, with PINE_RUNTIME_ALLOWLIST unset;
- W5 production infrastructure;
- W7 data contracts;
- capture sessions on the owner's Chrome rig;
- any production variable change.
Owner autonomy grant (2026-11-02): full autonomy on the programme. W5 approvals are conditional
on thorough written analysis. Arm in stages. Purchases, the rig and credentials stay the owner's.
