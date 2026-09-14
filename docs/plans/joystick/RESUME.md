# Joystick hub — RESUME after the 2026-09-13 restart

> ⛔ **READ THIS FIRST, THEN `CLAUDE.md` → "Joystick hub".** Written at checkpoint time so a resumed
> session re-derives nothing. Every claim below carries a `file:line` or a SHA. Where a claim is a
> SNAPSHOT (deployments, flags) it says so — re-read those, do not quote them.

## Where the programme is

**LAUNCHED is 2 of 6** (`closure.md` §"DEFINITION OF LAUNCHED"). Boxes 3 (post-deploy client smoke)
and 4 (preference-key validation) are ticked on evidence. Boxes 1 (G0 flick) and 2 (glass
acceptance) **need Patrick's own phone** — a BrowserStack Live mirror measures a 260–427 ms floor
against `FLICK_MS = 120` and cannot hold a press, so they are not agent-runnable at all. Box 5
(stage 3) and box 6 (rewrite this as LAUNCHED) follow them. The **stage-2 branch is PREPARED and PUSHED** —
`launch/stage-2-member-preview` at **`e60545210`** — it has now been **GATED, and it FAILED with 9
attributable NEW failures** (next section). The **§4 freeze is
in effect**: it must not be opened as a PR until Patrick's marked-up `owner-run.md` and trace are in
and boxes 1 and 2 are ticked on evidence.

## ✅ READY-AND-GATED — `2ae7e98aa`, manifest `gate-runs/2026-09-13T17-57-36.md`

⚠️ **Supersedes the `640dcd8d1` / `15-55-29` run cited here until 2026-09-13.** Master had moved
102 commits past the merge base, so master was **merged into** the branch (never rebased) — merge
commit `2ae7e98aa`. 24 non-test `app/src` files outside the hub arrived with it, which is the
stated re-gate trigger, so the gate was re-run. `640dcd8d1` is an ancestor of `2ae7e98aa`, not
lost history — it is simply no longer the branch tip.

**Zero attributable NEW.** Full six-shard gate, run on a box verified clear first
(pre-flight reading, not recorded in the manifest: `foreign-shard=0, freeGB=13.7`):

```
tree   2ae7e98aa11b5f859a26b9bd4830b850ad22662c  (start) -> same (end)
files  1325 on disk — RECONCILES with the summed shard total
totals 8 failed / 19,489 passed / 19,506
```

Baseline (`258c5609d`) has **7**; observed **8**; **NEW = 1**, and it is not this branch's:

| NEW failure | verdict |
|---|---|
| `components/screener/reachable.test.js > …nothing committed is connected to nothing` | ❌ **NOT attributable — R-29**, S4's `focusDivergence.js` orphan |

⭐ **Classified by DIRECTION, not by memory.** The branch's diff touches neither
`focusDivergence.js` nor `reachable.test.js`; the module already exists at the merge base
`d6ac61816`; and the rail was RUN at that base in a detached worktree and failed **identically**,
on a tree containing none of this branch's changes. R-29 stays in `requests.md`, owned by S4.

⚰️ **The nine settings failures from the 08-02 run are GONE** — that run found 10 NEW, nine of them
this branch's (`JoystickSettingsCard.test.jsx` ×8, `joystickSettingsControls.test.jsx` ×1). They
were correct tests of the wrong stage; `640dcd8d1` (now in `2ae7e98aa`) updates them, and fixing them surfaced two real
defects recorded in that commit.

⛔ **READY-AND-GATED IS NOT MERGED.** The §4 freeze stands: the stage-2 PR stays unopened until
Patrick's marked-up `owner-run.md` and trace are in and boxes 1 and 2 are ticked on evidence — and
**Patrick merges it**, because a member-facing rollout is not an agent's call.

## ⚰️ SUPERSEDED — the 08-02 run that found 9 attributable NEW

**Manifest: `docs/plans/joystick/gate-runs/2026-09-13T14-13-39.md`** (+ `.json`), committed.

The box cleared during the watch and the waiter started the gate before it was stopped. The run is
**valid**, not INVALID: tree `e6054521030293ea7e645d3888099ec4fc58ef4e` at **both** start and end,
wrapper blob pinned, **1317 test files on disk RECONCILING with the summed shard total**, and a
totals line — **17 failed / 19,423 passed / 19,449** across six shards.

Baseline (`258c5609d`) has **7**; observed **17**; **NEW = 10**, of which:

| NEW failure | attributable? |
|---|---|
| `components/screener/reachable.test.js > …nothing committed is connected to nothing` | ❌ **No — R-29**, S4's `focusDivergence.js` orphan. Reds on master for everyone; postdates the baseline. |
| `pages/settings/JoystickSettingsCard.test.jsx > B6 …member who NEVER CHOSE: hidden` **(×8)** | ✅ **YES — mine** |
| `pages/settings/joystickSettingsControls.test.jsx > B13 …the card is still admin-gated` | ✅ **YES — mine** |

⛔ **These nine are the stage-1 exposure rule, asserted in files my scoped run could not see.** I ran
`src/hub` (84 files, 1118 tests, all green) and these live in `src/pages/settings/` — structurally
outside the glob. They assert *"a member who never opted in should not be offered the card"* and
*"the card is still admin-gated"*, which stage 2 deliberately reverses: at member preview every
member has the hub, so every member **must** be able to reach the switch that turns it off. This is
the same class as the eleven hub rails already updated on this branch, and **it is exactly why the
full gate is required and a scoped run is not a substitute for it.**

⭐ The fix is mechanical and specified: update those two files for the stage-2 rule the way the
others were — deliberately, with the reason in the diff, never by relaxing an assertion — then
**re-gate**. `app/src/hub/stageLadderAgreement.test.js` already asserts the property these two
should now hold (*anyone who HAS the hub can reach the switch that turns it off*).

## Next actions, in order

### (a) ✅ DONE — fixed in `640dcd8d1`, carried into `2ae7e98aa`, re-gated clean (see READY-AND-GATED above)

Update `app/src/pages/settings/JoystickSettingsCard.test.jsx` (B6, 8 cases) and
`app/src/pages/settings/joystickSettingsControls.test.jsx` (B13, 1 case) to the stage-2 rule, commit
on the same branch, then re-run the gate. ⛔ **Do not run under load** — require **0 foreign
`--shard` processes** and **≥ 12 GB free**.

```
cd C:\Users\Patrick\uct-worktrees\joystick-launch-close
git rev-parse --short HEAD          # the stage-2 branch, tree clean
python scripts/gate_shards.py --shards 6
```

⛔ **Zero ATTRIBUTABLE NEW is the bar, not zero NEW** — R-29 is S4's and will still be there.

The waiter and its probe are preserved and work; re-create them if the scratchpad is gone
(a session scratchpad does not survive a restart). ⛔ **The probe must carry a visibility control.**
The first version written on 2026-09-13 was inline PowerShell inside a bash single-quoted string;
its embedded quotes collapsed, the WMI filter matched nothing, and it returned `shards=0 total=0` —
a **blind probe that a naive `shards == 0` check reads as a clear box**. It was caught only because
`total=0` is impossible on a machine running 33 node/python processes. Put the probe in its own
`.ps1`, and cross-check its count against `Get-Process`.

Classify the result: **NEW = a failure not in `docs/plans/joystick/gate-baseline.json`**
(7 named `failures` + a `load_sensitive` list that is NOT a bank). ⛔ A `load_sensitive` name is
**re-run alone before classifying**; a timeout is never banked. ⛔ An `INVALID-*.md` manifest is the
environment, never the branch — do not merge on one and do not read it as a signal.

### (b) Hold the stage-2 PR unopened

⛔ **Not yet ready — (a) must go green first.** Once it does, the compare link below is **one click**
and GitHub pre-fills title and body from the commit message, which already contains the
member-impact paragraph. **Patrick merges it** — a member-facing rollout is not an agent's call.

```
https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/compare/master...launch/stage-2-member-preview?expand=1
```

### (c) Analyse Patrick's trace

He produces it from **Settings → Charts → JOYSTICK → Copy trace** (there is no top-level "Joystick"
section; direct link `uctintelligence.com/settings?section=charts`). ⛔ He must reach Settings
**in-app** — a document load empties the trace ring and *Copy trace* then hands back a valid,
well-formed, **empty** capture (measured both ways: `goto` → `recorded 0`; in-app → `recorded 9`).

```
python tools/hub_trace_analyze.py trace-15pro.json --control 5 ^
  --expect journal.close:4 --expect journal.moveStop:4 --expect journal.breakeven:4 ^
  --expect journal.planTrade:4 --expect scan.alert:4 ^
  --expect journal.close:1 --expect journal.moveStop:1 --expect journal.breakeven:1 ^
  --expect journal.planTrade:1 --expect scan.alert:1
```

⛔ `--expect` is **positional** and must match the order he actually performed. Exit 2 =
UNREADABLE (a failed capture), not a device result. `--self-check` proves the classifier can fail.

### (d) Tick boxes 1 and 2 on evidence

G0-1 is the trace; D4 is row A1 alone; they are not each other (`owner-run.md` §"What happens with
your answers"). Box 2 additionally releases Block G5's **96 derived sweep rows**, which today all
carry BLOCKED-BY-G0. ⛔ A row that is blocked is neither a PASS nor an INCONCLUSIVE.

### (e) Open the stage-2 PR for Patrick

Only after (a) reports zero attributable NEW and (d) is done. Patrick merges.

### (f) Then sequence a–f in `rollout.md`

"THE STAGE DEFINITIONS" §3: stage-2 PR → one week of member feedback (`[joystick preview]` prefix
to `/support`) → **D-39 before stage 3, not before stage 2** → stage-3 PR → box 5 → box 6 →
post-close housekeeping. ⛔ Stage 3 still waits on one owner decision, recorded in `rollout.md`
§2(b) — resolved as of `e60545210`, since `PREVIEW_MODES` is now empty on that branch.

## Environment checklist — presence only, never values

⭐ A new process after reboot inherits the **User** scope, so these should simply be present; the
`[Environment]::GetEnvironmentVariable(...,'User')` workaround this session needed (because the
shell predated the `setx`) should no longer be necessary. Verify, do not assume.

| variable | at checkpoint |
|---|---|
| `BROWSERSTACK_USERNAME` | present |
| `BROWSERSTACK_ACCESS_KEY` | present |
| `SMOKE_EMAIL` | present |
| `SMOKE_PASSWORD` | present |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | ⛔ **ABSENT** |

⛔ That last one is why the GitHub MCP server failed to connect all session with
*"Authorization header is badly formatted"* — the unexpanded `${GITHUB_PERSONAL_ACCESS_TOKEN}`.
`GITHUB_TOKEN` is **not** read. Setting it needs a Claude Code restart to take effect. Everything
GitHub this session was done through the **browser** instead, which works.

## Tooling checklist

| item | at checkpoint |
|---|---|
| `C:\tools\browserstack\BrowserStackLocal.exe` | present |
| `C:\tools\hub-devicetests\` | present |
| `…\HARNESS-NOTES.md` | present |
| `…\set-smoke-env.ps1` | present |
| `…\traces\` | ⚠️ **does not exist** — the directory holds `results\` and `tests\` instead |
| `…\set-bs-env.ps1` | ⚠️ **does not exist** — `start-tunnel.ps1` is there; BrowserStack creds come from the User env |

- **Chrome extension must be RE-PAIRED after reboot**: `/chrome` in Claude Code, extension signed
  in, a tab open. Browser automation is how PRs get opened and merged here.
- **Railway CLI**: `railway status` to confirm it is still authenticated.
- ⚠️ Two checklist rows above were given from memory and are wrong on disk. They are recorded as
  measured, not as expected — that is the point of checking.

## Worktrees

| path | branch | tip | ahead/behind origin |
|---|---|---|---|
| `C:\Users\Patrick\uct-worktrees\joystick-launch-close` | `launch/stage-2-member-preview` | `e60545210` | **0 / 0**, clean |

Every branch created this programme-phase is pushed, and all but one are **merged to master**:
`fix/d46-d48-closeout` `7e1e115c2` · `docs/d46-d48-sha-fix` `44c1f851b` · `fix/b7-rule12-scope`
`c639cffe1` · `harden/hub-actions-testid` `494106f06` · `fix/g3-15-intro-artifact` `88ed1b2df` ·
`fix/owner-run-trace-path` `f7d8560c2` · `docs/post-owner-run-plan` `fb7dfa792`.
**`launch/stage-2-member-preview` `e60545210` is pushed and deliberately NOT merged.**

⚠️ **`launch/closure` is already merged into master and sits 176 commits behind it.** This file was
asked to live there; it is on **master** instead, because a resume file on a dead branch is not
findable from a normal checkout — which is the one thing it exists to be.

⚠️ **Uncommitted work in sibling joystick worktrees — NOT this session's, not committed by it:**

| worktree | branch | uncommitted |
|---|---|---|
| `uct-worktrees\joystick-inc5` | `feat/joystick-launch-A` | 6 files: `api/main.py`, `scripts/gate_shards.py`, `scripts/hub_sandbox_boot.py`, 3 tests |
| `uct-worktrees\joystick-hub` | `launch/l5-launch-docs` | 2 untracked gate-run manifests (2026-09-11) |
| `uct-worktrees\inc5-final` | detached | 2 untracked gate-run manifests (2026-09-10) |
| `uct-worktrees\inc5-merge` | detached | 2 untracked gate-run manifests (2026-09-10) |

⛔ Left alone deliberately: committing another session's half-finished `api/main.py` on a branch
this session does not own is not a checkpoint, it is a guess. **A reboot does not delete working-tree
files** — they are on disk and survive. Recorded so the knowledge is not lost with the session.

## The standing rules, in five lines

1. **One gate at a time on this machine**, and never under load — on 2026-09-12 three concurrent
   sessions took free memory to 4.8 GB and destroyed a worktree's `node_modules` mid-`npm ci`.
2. **Never touch the tree during a gate** — `gate_shards.py` refuses a dirty tree and records the
   tree hash at start *and* end, precisely so a mid-run edit cannot be mistaken for a clean result.
3. **Provenance is `git show <sha>:<file>`, never `git status`** — and a timeout is never banked.
4. **A citation you cannot quote is struck, not softened**; a run with no totals line is not a run.
5. **No purchases. No Automate — BrowserStack LIVE only.** Production writes limited to the smoke
   account's own preferences/trace/Flag toggles and the login-link rows the feature itself writes.

## Open ledger

| id | what | owner |
|---|---|---|
| **D-38** | Undo-capable toasts may want a longer or pinned duration | joystick — accepted as-is; reopens only on member feedback |
| **D-39** | Chip under page-level fixed furniture — **6 pairs** (journal + notebook @360/375/430) | joystick — non-blocking for stages 1–2 by ruling; **fix before stage 3** |
| **D-40** | Notebook phone note list exposes no per-note DOM id | **Notebook** (rule 12) |
| **D-41** | Two corrections owed to `iteratorGlobalFloor.test.js` | **Notebook** (rule 12) |
| **D-47** | Per-mode action editor — count + reset shipped, reorder/remove deferred | joystick — reopens only on member feedback |
| **D-30** | One `data_root()` helper for every `/data` path | **its own production task** — not a hub task |
| **R-28** | The Desk: 3–4 YouTube thumbnails 404 on the video grid | **The Desk** |
| **R-29** | `app/src/lib/context/focusDivergence.js` is an unlisted orphan; reds `reachable.test.js` for everyone | **S4** |

## Production state — SNAPSHOT, 2026-09-13. Re-read before quoting.

| service | live SHA | status |
|---|---|---|
| `web` | `f49da5ed6` | SUCCESS 19:08:29Z |
| `worker` | `f49da5ed6` | SUCCESS |
| `bars-api` | `f49da5ed6` | SUCCESS |
| `flow-worker` | `f49da5ed6` | **SKIPPED** — correct; the push touched none of its watch paths, and the OPRA tape was never bounced |
| `chart-renderer` | — | SUCCESS 18:48:20Z |

- **`HUB_PREVIEW_ENABLED=true`** · **`SMOKE_LOGIN_LINK_ENABLED=1`** · `COMING_SOON_MODE=1`
  (read via `railway variables --service web --kv`; ⚠️ `--kv` shows the service's CONFIG, which is
  not evidence the running process has it).
- **`ROLLOUT_STAGE = 1` at the live SHA** — read from the source at `f49da5ed6`
  (`app/src/hub/rolloutStage.js:52`), not from the worktree, which is on the stage-2 branch.
- **Smoke account clean.** `smoke@uctintelligence.internal`; its `joystick_hub` preference was read
  back after the §A pre-flight: `traceGestures:false`, `handedness:"right"`, `overrides:{}`,
  `coachMarkSeen:true` — nothing wiped, no trace buffer left behind.
- Last verified green on production: nav smoke **PASS** (16 routes, 27 nav entries) and touch pass
  **OK** (hub on all 16 routes, landscape-immersive hide correct).
