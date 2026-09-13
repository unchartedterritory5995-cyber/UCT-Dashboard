# NOTEBOOK PROGRAMME — RESUME HERE

**Last verified against git:** `bd57ffaf7ab6` · **2026-09-13T22:13:07Z**
**Sunday gate CLOSED KEEP 2026-09-13 18:05 ET** — the planned restart did NOT
happen (uptime 49 h at the checkpoint); no scheduled run was missed.

---

## ⭐ RESUME FIRST — the first five actions, in order

```bash
# (1) the Notebook programme's working tree
cd /c/Users/Patrick/uct-worktrees/notebook-k

# (2) refresh every worktree from master (MERGE, never rebase)
git fetch origin master
for wt in notebook-k notebook-s notebook-q2a notebook-r4a notebook-f5 notebook-flip; do
  git -C "/c/Users/Patrick/uct-worktrees/$wt" merge --no-edit origin/master
done
#     ⛔ NOT notebook-primary-platform — see §5.

# (3) the three scheduled tasks are Ready, and the rig is opted OUT on disk
powershell -NoProfile -Command "Get-ScheduledTask | ? { $_.TaskName -match 'WaveQ1' } | % { $i=$_|Get-ScheduledTaskInfo; '{0,-20} {1,-7} next={2}' -f $_.TaskName,$_.State,$i.NextRunTime }"

#  EXPORT THE PROFILE FIRST, IN THE SAME SHELL -- and this line must come
#  BEFORE the python call. resolve_profile(None) falls back to THIS worktree's
#  .worktrees/, which does not exist, and then reports exists:False value:None.
#  Absence reads as OPTED IN under the server default, so the wrong path hands
#  you a FALSE ALARM about the rig. Caught doing exactly this during the
#  pre-restart check, 2026-09-13.
export UCT_Q1_RIG_PROFILE='C:\Users\Patrick\uct-worktrees\notebook-primary-platform\.worktrees\canary-chrome-profile-persistent'
python -X utf8 -c "import importlib.util,sys; s=importlib.util.spec_from_file_location('w','tools/window_check.py'); m=importlib.util.module_from_spec(s); sys.modules['w']=m; s.loader.exec_module(m); m.use_profile(m.resolve_profile(None)); print(m.PROFILE); print(m.localstorage_on_disk(m.FLAG_KEY))"
#     expect the printed profile to be the notebook-primary-platform one,
#     exists=True, and value '0'.
#     exists=False => WRONG PROFILE PATH, not a rig problem. Re-export, retry.
#     value != '0' => the rig is opted IN; fix BEFORE the next sampler run.

# (4) if it is past 17:15 CT, read the Sunday verdict and post it VERBATIM
cat "/c/Users/Patrick/uct-q1-observe/wave-q1-gate-verdict.md"

# (5) continue at the track table in §3 — the F5 discriminator is the next
#     measurement, and it needs a CLEAR rig window (§6).
```

### Reopening the Claude Code sessions

These sessions were started as ordinary interactive `claude` sessions in each
working directory, so **`claude --continue` is the command** — it resumes the most
recent session for that directory. `claude --resume` (no argument) lists sessions
to pick from if `--continue` lands on the wrong one.

| what | commands |
|---|---|
| **this session** (Notebook programme) | `cd C:\Users\Patrick\uct-worktrees\notebook-k` then `claude --continue` |
| Wave S | `cd C:\Users\Patrick\uct-worktrees\notebook-s` then `claude --continue` |
| Q2-A | `cd C:\Users\Patrick\uct-worktrees\notebook-q2a` then `claude --continue` |
| R-4a | `cd C:\Users\Patrick\uct-worktrees\notebook-r4a` then `claude --continue` |
| F5 drivers | `cd C:\Users\Patrick\uct-worktrees\notebook-f5` then `claude --continue` |
| docs/roadmap | `cd C:\Users\Patrick\uct-worktrees\notebook-flip` then `claude --continue` |

⚠️ **PowerShell loses `setx` variables only for sessions started BEFORE they were
set — a fresh shell after the reboot has them.** The T-12 runner needs
`MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD`; if a shell does not see them:

```powershell
$env:MEMBER_SMOKE_EMAIL = [Environment]::GetEnvironmentVariable('MEMBER_SMOKE_EMAIL','User')
$env:MEMBER_SMOKE_PASSWORD = [Environment]::GetEnvironmentVariable('MEMBER_SMOKE_PASSWORD','User')
```

⛔ Never print them, never write them to a file, never put them in a commit.

---

## 1. What was running at the checkpoint

| | |
|---|---|
| my gates / gauntlets / canaries | **none running** — nothing of mine was in flight, nothing to resume |
| rig Chrome | **closed**, `SingletonLock` released, opt-in key on disk **`'0'`** with Chrome dead |
| deploy | **none in flight** (last `web` SUCCESS `2026-09-13T19:08:29Z`) |
| master merge pending from me | **none** |

⚠️ **Two OTHER sessions had work running that the reboot killed.** Neither is
mine and neither was touched:

- a **six-shard gate** in `uct-worktrees/joystick-launch-close`, started 13:46 CT,
  on shard **6/6**. `gate_shards.py` refuses a partial run and writes an
  `INVALID-*.md` — that is the tool working. **That session re-runs from scratch;
  a half-run is never resumed.**
- two `uct-clips/tools/heavy_lock.py run --label wisdom-*` jobs.

---

## 2. ⛔ THE SCHEDULED TASKS DO NOT CATCH UP — a missed run is LOST

**Measured 2026-09-13: `StartWhenAvailable = False` on all three.** Windows will
**not** run a missed task late. If the machine is down or rebooting at the
scheduled minute, that run simply does not happen and the interval is
**UNOBSERVED** — which the Sunday gate reports as "not clean", correctly.

| task | action | next |
|---|---|---|
| `UCT-WaveQ1-Observe` | `C:\Users\Patrick\uct-q1-observe\nb_observe.cmd` | **16:00 CT**, then every 2 h |
| `UCT-WaveQ1-Canary` | `C:\Users\Patrick\uct-q1-observe\canary_sunday.cmd` | **15:00 CT** |
| `UCT-WaveQ1-Gate` | `cmd /c cd /d C:\Users\Patrick\uct-q1-observe && … python nb_gate.py` | **17:05 CT** |

⭐ The canary fills the ONE trigger the sampler cannot see — *outbox stuck > 5
min* — because the sampler runs opted OUT and its outbox is structurally zero.
Losing it costs that trigger for the whole window.

### Files outside the repo, by absolute path

| | |
|---|---|
| observation log | `C:\Users\Patrick\uct-q1-observe\wave-q1-observation-log.md` |
| gate verdict (written 17:05) | `C:\Users\Patrick\uct-q1-observe\wave-q1-gate-verdict.md` |
| sampler run log | `C:\Users\Patrick\uct-q1-observe\nb_observe.run.log` |
| retired detached runner's log | `C:\Users\Patrick\uct-q1-observe\sunday_runner.log` — **the detached runner is retired; the scheduled tasks replaced it.** No detached process of mine is running |
| T-12 evidence | `C:\Users\Patrick\uct-q1-observe\t12\` — **126 screenshots** |
| deployed tool copies | `nb_observe.py` + `nb_gate.py`, **hash-verified in sync with `tools/`** at the checkpoint |

⛔ **`nb_gate.py` and `nb_observe.py` live OUTSIDE every worktree and drift
silently.** After ANY edit to `tools/nb_gate.py` or `tools/nb_observe.py`: copy
across and re-run `tests/test_nb_observe.py` (the drift rail is parametrized over
both files). Manifest §10.17.

---

## 3. Per-track status — the exact next step

| track | worktree | branch | at | next step, exactly |
|---|---|---|---|---|
| **F5** (freeze) | `uct-worktrees/notebook-k` | `feat/notebook-kill-switch` | `184c3b493` | Run the **discriminator** in the next clear rig window: `append_document_excerpt × drain-first`. Blocked on a named rig limitation — see §4. The 7×6 table resumes with `python tools/q1_f5_matrix.py --resume` |
| **Sunday gate** | same | same | same | After **17:15 CT** read the verdict file and post it verbatim + config-served + `organic members exposed = 0` |
| **T-12 / C-7** | same | same | same | `owner-rig` identity run still outstanding; steps 7 and 8 need the runner's selectors scoped. **C-7 FALSE** |
| **R-1a** | `uct-worktrees/notebook-r4a` | `feat/notebook-wave-r` | `adbcbcdf8` | ⛔ **HELD** until F5's route-change question is settled — R-1a's scanner door fires from a route change by definition |
| **R-3b / R-3c** | `uct-worktrees/notebook-r4a` | same | same | after R-1a |
| **Wave S** | `uct-worktrees/notebook-s` | `feat/notebook-wave-s` | `adbcbcdf8` | S-07 available by judgment |
| **Q2-A** | `uct-worktrees/notebook-q2a` | `feat/notebook-q2a-offline-read` | `adbcbcdf8` | available by judgment |
| **docs/roadmap** | `uct-worktrees/notebook-flip` | `docs/notebook-roadmap` | `c01a10823` | the **15:00 canary runs `tools/window_check.py` FROM HERE** — keep it merged with master |

---

## 3b. The Sunday gate — CLOSED **KEEP**, 2026-09-13 18:05 ET

```
VERDICT: KEEP — no independent member exposure; 0 blocked-baseline events
         measured over 0 real members
rows read: 22 (3 skipped)
POPULATION: organic = 0 | synthetic = 1 | rig/owner = 1
1 unexplained red PASS · 2 unattributable fork PASS
3 outbox stuck >5 min PASS (canary 2026-09-13T20:00:01Z, outbox 0, 11/11)
4 member console error PASS · do-not-build CLEAN
```

⭐ The window continues to **2026-09-19 00:45 ET**. Trigger 3 was `n/a` in the
run itself and was wired to the canary's stamp afterwards; the line above is
the corrected re-run against the same log.

---

## 4. Open items — verbatim, nothing rounded off

### ⛔ `append_widget_embed × drain-first` is RED and **NOT PUBLISHED**

Measured on production, same ordering, same account, sentinel-timestamped and
orphan-checked:

| cell | verdict |
|---|---|
| `folder`, no navigation | ✅ **GREEN** — and the wire carries the whole mechanism: 3 offline PUTs unanswered → door `200` → **`409`** on the stale baseline → **`200` carrying the sentence** |
| `append_widget_embed`, document-load return | 🔴 RED ×4, identical wire |
| `append_widget_embed`, **SPA return** (editor remounted, `?note=` preserved, drain emptied in 45 s) | 🔴 **RED** |

⭐ **The document load is ELIMINATED as the cause.** What remains between the
GREEN cell and the RED one is the **offline route change away from the Notebook
while work is queued**, and/or **the append door itself** — still confounded.

⛔ **The discriminator is `append_document_excerpt`** (an append door that fires
with no navigation) and it carries a **named rig limitation**: with the real
`tools/wave_p_cert_corpus/native_text.pdf` the preview renders (**2 pages, 25
text-layer spans**) and the span under the cursor reports `user-select: text`,
`pointer-events: auto` — but **neither a real double-click nor a slow multi-step
pointer drag produces any selection**; `getSelection()` stays empty, so the "Save
excerpt" popover the door needs is never created. CDP-synthesised pointer input
does not make a text selection in this renderer. **Nothing about this cell is
published as a product finding until the pair has separated it.**

### F5 table state

| | |
|---|---|
| GREEN | `folder × drain-first` |
| RED (unpublished) | `append_widget_embed × drain-first` |
| INCONCLUSIVE | `append_document_excerpt × drain-first` (rig limitation above) |
| N/A, with reason | the three `append_* × settle-first` cells — the product cannot reach that state; `f5Freeze.test.js` asserts it from the source |
| not yet run | the remaining cells of the 7 × 6 |

Artifact: `docs/notebook/wave-q1-f5-production-matrix.md`, state in the `.json`
beside it. `--resume` re-runs INCONCLUSIVE cells and skips only decided ones.

### T-12 — 7 of 9, C-7 stays FALSE

`member-smoke@uctintelligence.internal`, fresh context, **automated per the
charter amendment of 2026-09-13**. Steps 0–6 **PASS**. Steps 7 (Ask + citation)
and 8 (trash/restore) **INCONCLUSIVE** with named runner limitations. File:
`docs/notebook/t12-smoke-2026-09-13.md`.

⛔ **An unexplained product finding lives in that run:** the member's first action
— *"+ Start a note"* on an empty Notebook — returned **`POST /api/j2/notes` 500
twice**, product showing *"Couldn't create that note. Nothing was saved."* The
third attempt succeeded and every run since has. **No deploy was in flight.**
Recorded as measured, not diagnosed. The route handles only
`NoteValidationError`, so anything else becomes a 500.

### The dirty worktree — CLASSIFIED, not pending

`uct-worktrees/notebook-primary-platform` shows three modified files. Measured
read-only:

- `outboxDrain.js` and `NoteEditorPage.jsx` — **`git diff --numstat` = 0 lines.**
  Byte-identical to that worktree's HEAD after newline normalisation. The dirty
  flag is **CRLF-vs-LF only**.
- `wave-q1-RESUME-HERE.md` — 292 insertions written **2026-09-13 09:00:30**, which
  is the daily Window Check task's own output.

**Classification: STALE SCRATCH / TOOL OUTPUT. No cross-session ownership
finding.** Nothing touches `ringVouchedPlan`, `classifyServerChange`,
`settleNoteWrite`, the landed ring, any door family, the in-flight marker or the
Web Lock. ⛔ **Left untouched by ruling** — do not merge, stash, commit, revert
or delete it.

⚰️ **And the lesson that produced it:** I first reported those two files as
uncommitted edits to the save path, because I read `git status` as a claim about
content. **Provenance is `git show <sha>:<file>`, never `git status`.**

### The K window

| | |
|---|---|
| config-served column | live in the sampler; `0/0 — no member reported` on every row so far |
| **organic members exposed** | **0** — nobody outside the rig has opened the Notebook in this window. Printed in every gate verdict and every end-of-day report until it changes |
| synthetic member | the T-12 runs signed `member-smoke` in as a distinct identity. If an opt-in event appears, the qualifier becomes **"one synthetic member; zero organic members"** |
| ⛔ **the 7 that were ours** | the sampler read `members 7` on 2026-09-13; **all seven were the T-12 smoke account**, proved from that account's own `/api/auth/export-data`. Rows are corrected in place with attribution; the sampler now reports **organic · synthetic · rig/owner**, by distinct identity, never summed |
| ⛔ **consequence for K-1** | if the window closes with 0 organic members, K-1's precondition is **100% of a synthetic population**, and the packet must say so in those words |

---

## 5. Standing rulings — do NOT re-derive these

1. **Q1 outranks everything.**
2. **Dark means dark** — nothing member-visible until the owner flips its key.
3. **Never a scripted `fetch` where a real surface exists.** A door that cannot be
   driven is **INCONCLUSIVE with the limitation named**, never a pass and never a
   fallback.
4. **One master merge at a time, repo-wide** — Railway `web` SUCCESS before the
   next. Cross-session guard before every push.
5. **Rig only when the guard says CLEAR with all tasks IDLE** — not merely
   "not due". A task that is *running now* holds the one profile; taking it costs
   that interval's observation row. `tools/q1_f5_matrix.py::rig_window_refusal`.
6. **Ownership** — no joystick or Options Flow files; do not touch another
   session's worktree.
7. **Merge master in, never rebase. Never force-push. Never touch permissions or
   protections. Never print, log or commit credentials.** Only the rig and
   `member-smoke` identities.
8. **Flips are pre-authorized under conditions**, all of which must be printed in
   one message before the flip: row merged dark with a green production canary ·
   flip packet with every precondition TRUE and evidence · sampler columns live ·
   config-served shows the flag path is reached · no Q1 ANOMALY in the prior 24 h ·
   no deploy in flight. After: verify the served payload, run the real-door
   canary, start the observation window, record it.
9. **The kill switch** (`NOTEBOOK_OFFLINE_DEFAULT_ON=0`) only on a state trigger
   from the Sunday gate rules, or an organic-member fork attributable to a door.
   Post the trigger, set it, report.
10. **K-1 is the owner's** — write its packet when the K window closes, and stop.
11. **Nothing gets passed over.** Anything unfinished gets a named line with an
    owner and what it needs.

---

## 6. The contract, and the warning

⭐ **`docs/notebook/PROGRAM-MANIFEST.md` is the contract.** Read it before
planning anything.

⛔ **Do not plan from any older Notebook doc.** Manifest **§10** enumerates the
traps in them — twenty-one entries now, including today's: the deployed-copy
drift, the seven instrument faults of the F5 matrix, the Sunday gate's four
reading faults, the DO-NOT-BUILD sweep's three self-lies, and the rig-window
"due vs running" hole. Every one of those made the PRODUCT look broken and every
one was caught by a CONTROL, never by review.
