Resume the UCT-Dashboard Pine full-parity programme on this machine and drive it to completion:
any open-source TradingView Pine indicator or strategy a Pine-fluent member writes or pastes must
run on our platform and match TradingView, on the chart, in the screener, in scans and in alerts.
Accuracy first, then fast chart loads, then simplicity for members. Keep going wave by wave until
everything in WAVE-TASKS.md is shipped and verified live, reporting after each merge.

STEP 1 - read everything before acting (all on branch `docs/pine-parity-programme`, folder
`docs/pine/parity-programme/`; `git fetch origin` first, then read them from that branch):
  a) RESUME-LAPTOP.md  - what is live, machine setup (section 3), the ship loop (section 4), the
     stream table with every branch, its last commit and its exact next step, and owner items.
  b) WAVE-TASKS.md     - every task for W0-W9, Editor and E, definition of done, sequencing, and how
     to pick up a branch from its WIP commit.
  c) PLAN.md           - goal, architecture decision (runtime lane = general interpreter; same
     interpreter server-side as a SEPARATE sandboxed service), editor mockups, honest limits.
  d) AGENT-RULES.md    - rules every worker follows. Its absolute paths are the desktop's; map them
     to this machine.
  e) docs/pine/COVERAGE-MAP-2026-11-02.md on branch `docs/pine-coverage-2026-11-02` (the fresh W0
     scoreboard and per-wave target script lists in docs/pine/coverage-targets-2026-11-02.json).
  f) Claude memory: pull the memory repo (uct-claude-memory) and read the topic file
     project_indicator_ecosystem_resume_2026_10_31.md (bottom sections are newest).
  g) For each stream branch, read its WIP commit message(s):
     `git log --format='%h %s%n%b' origin/master..origin/<branch>`.
     Branches: docs/pine-coverage-2026-11-02, feat/pine-w1-names, feat/pine-w2-arming,
     feat/pine-w3-drawings, feat/pine-editor-status, docs/pine-w5-server-runtime,
     feat/pine-evidence-engine.

STEP 2 - set up this machine (RESUME-LAPTOP.md section 3), then verify the setup before any work:
  - one shared install: worktree `pine-base` at origin/master + `npm ci` in its app/; every other
    worktree links app/node_modules to it (never delete through a link).
  - `_smoke-1031` worktree; Railway CLI logged in and linked; SMOKE_EMAIL / SMOKE_PASSWORD in the
    environment (never in the repo, a log or a chat); a heavy-job lock (uct-clips heavy_lock.py
    or an equivalent) and the env vars the scripts read: UCT_WORKTREES, UCT_RESUME, HEAVY_LOCK.
  - Prove it works: run `scripts/verify_deploy.sh <current production SHA>` and expect
    "SMOKE PASS (authenticated)".
  - Check free RAM before every heavy job. ONE heavy job at a time, vitest --maxWorkers=2, unless
    this machine has the memory headroom to justify two (state the numbers before doing so).

STEP 3 - finish the in-flight streams first, closest-to-done first:
  1. W1 names (feat/pine-w1-names): re-run its targeted files, its mutation job, pytest gates +
     hygiene; independent review; ship through the full loop with an engine bump (+1).
  2. Editor status panel (feat/pine-editor-status, flag VITE_PINE_EDITOR_STATUS, dark): run its
     4 new test files, flag-off byte-identical rail, mutations M1-M4, gates; review; ship dark.
  3. E evidence engine (feat/pine-evidence-engine): re-run its 17 rails, 8 mutations, gates;
     review; ship (offline tooling only). Then give me the exact command for a capture batch with
     my dedicated Chrome rig, and the top-priority probes to capture.
  4. W0 (docs/pine-coverage-2026-11-02): run gate pytest + hygiene; merge the doc.
  5. W2 arming (feat/pine-w2-arming): finish the measurements in its commit message, write
     docs/pine/ARMING-PACKET-2026-11-02.md, close small gaps (railed + mutation-proved), then bring
     me the go/no-go packet. NEVER change Railway variables or flags without my explicit go.
  6. W3 drawings (feat/pine-w3-drawings): run its measure harness, then slices S1..S8 in
     WAVE-TASKS order, each shipped separately.
  7. W5 (docs/pine-w5-server-runtime): bring me its owner questions (R3, Q2-Q8) with your
     recommendation; then build T1/T3/T5/T6/T12 as the first wave. No production infra without my go.
Then W4 (after W2 stage 1 is armed), W6, W7, W9, W8, re-running W0 after every couple of merges.

STEP 4 - non-negotiable rules for every change:
  - Refuse by name anything not proven exact against TradingView; never stop drawing a value that
    matched TradingView; never draw where TradingView hides (na / transparent colours).
  - Every new guard mutation-proved; restore mutated files by rewriting saved bytes, never
    `git checkout`. One authority per value; no copied rules.
  - Independent opus reviewer GO before every merge; fix every real finding, re-review.
  - Merge origin/master first; full `src/components/chart` + `src/hooks` vitest on the merged tip;
    deploy-gate pytest (incl. tests/test_script_engine_version_gate.py) + check_repo_hygiene.py.
  - Engine changes: scripts/measure-pair.sh vs a base worktree at the same master (C18 audit,
    probes, census, harness); classify every diff; 0 unintended.
  - Bump SCRIPT_ENGINE_VERSION +1 per merge that changes translator output (the server reads the
    JS declaration; keep it on one line).
  - One master merge at a time; wait for any other session's merge to promote; `gh pr create`
    then `gh pr merge --merge`; then scripts/verify_deploy.sh <merge-sha> until SMOKE PASS.
  - Known pre-existing failures that are not ours: pollingSites.rail, converseClient.conversationId
    random-id flake, definition_concierge x5, require_paid sentence, test_entitlements NUMBERS one
    place, test_vendor_batch_capture manifest test.
  - Never touch other projects' worktrees or processes; never kill a process you did not start;
    commit messages end with the Co-Authored-By line from the repo's convention.

STEP 5 - keep the hand-off pack current: after each merge or at any stopping point, update the
stream table in RESUME-LAPTOP.md (branch, SHA, state, next step) on `docs/pine-parity-programme`,
push it, and append a short dated entry to the memory topic file.

Report format: after every merge, one ASCII code block with the live SHA at top and bottom,
listing each piece shipped, its PR, live commit, smoke result, and what is next. Ask me only for
decisions that are mine: runtime-lane arming stages, W5 owner questions, W7 data contracts,
capture sessions on my dedicated Chrome rig, and any production variable change.
