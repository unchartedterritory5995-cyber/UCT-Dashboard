# The expected_red mutation proof — what it proves, how it broke, how to re-run it

**Written 2026-09-14.** Read this before touching `tools/_mutate_expected_red.sh`,
`scripts/gate_shards.py`'s verdict, or `docs/plans/joystick/gate-baseline.json`.

This is a handoff document. It assumes no context from the session that produced it.

---

## 1. What the rail is, and what the proof established

`gate-baseline.json` holds two kinds of known-red, and collapsing them loses the
distinction that matters:

| key | meaning | who owns it |
|---|---|---|
| `failures` | a measurement OF MASTER. The file's own invariant: *"Nothing here is the hub's"* | whichever workstream broke it |
| `expected_red` | a DELIBERATE reproduction a branch added, red BECAUSE the defect is real | the branch that added it |

The note beside `expected_red` claimed *"Each entry names the fix it waits on."*
The entries were bare strings naming neither. ⛔ **A note asserting a property the
data does not have** is the defect this programme keeps finding one layer up.

`compare_failures()` takes `set(expected_red)`, so entries must stay hashable
strings. The reason therefore lives BESIDE the list in `expected_red_reasons`,
keyed byte-identically, and `unexplained()` (`tests/test_gate_shards.py:651`) is
the one predicate that stops the two drifting apart.

### Proven in both directions, before the rail was called done

```
reason stripped  -> 1 failed (exactly the pairing test), 2 passed   # it FIRES
reason present   -> 3 passed                                        # it does not cry wolf
whole file       -> 30 passed (27 pre-existing + 3 added)
```

A rail nobody has seen fail is decoration.

---

## 2. Which list does a red row go in? The `/admin/wisdom` worked example

The fix-4 merge gate reported 1 NEW failure:

```
src/surfaces/manifest.test.js > S1 CP1 > every Layout-hosted route has a declaration
AssertionError: routes with no manifest row: /admin/wisdom
```

It went into **`failures` + `additions`**, NOT `expected_red`. The reasoning is the
part worth copying:

- `expected_red` is for a reproduction **this branch deliberately added**. This row
  is master's ordinary breakage; filing it there would corrupt the meaning of both
  lists.
- Classified **by direction, not by assumption**: the test landed in `b7e7541a0`
  (the S1/S4 surfaces workstream), which IS an ancestor of `origin/master`; it was
  ABSENT at the baseline SHA `62a228e5d`; this branch's entire `app/src` diff is six
  files under `pages/journal-2-0/lib/offline/`; and BOTH of the test's inputs
  (`app/src/App.jsx` and the whole `app/src/surfaces/` tree) are byte-identical
  between HEAD and `origin/master`.
- ⭐ **Decisive evidence, read out of master's own blobs** rather than inferred:
  `origin/master:app/src/App.jsx:650` declares `<Route path="/admin/wisdom" …/>`,
  and `origin/master:app/src/surfaces/manifest.js` contains **0** occurrences of
  `admin/wisdom`. The condition the assertion forbids is present in master's own
  committed content.

### Two rails enforce the two sides, strict in opposite directions

| rail | catches |
|---|---|
| `test_every_expected_red_entry_names_a_reason_and_what_it_waits_on` | an `expected_red` entry with no reason |
| `test_a_reason_for_an_entry_that_is_not_declared_red_is_also_a_drift` | a reason left behind after its entry was removed |
| `compare_failures`' `expected_red_stale` | an `expected_red` that turned GREEN — its defect is fixed, so the slot is one a real failure could occupy unnoticed |

⚠️ Adding an `expected_red_reasons` entry for `/admin/wisdom` would make the second
rail FAIL, correctly. That was asked for once and refused for exactly this reason.

---

## 3. The five defects the proof harness shipped with

The first version lived only in a session scratchpad, which is part of why none of
it was reviewed.

### D1 — MSYS path mangling

A POSIX path crossing into a Python string literal is rewritten by MINGW64.
`pathlib.Path(r'/c/Users/.../baseline.orig')` became a path with leading
backslashes and no drive. The capture never wrote, so the restore never ran, and
the tree sat mutated.

⛔ **Why it is dangerous rather than annoying:** the failure surfaces as
`FileNotFoundError: No such file or directory`, which is *indistinguishable from a
missing file*. Fix: paths travel by ENVIRONMENT and are rebuilt with `pathlib`
inside Python; `_env_path()` asserts absolute + exists and aborts printing the RAW
received string.

⭐ **And the fix caused a second bug, measured:** exporting `MSYS_NO_PATHCONV=1`
GLOBALLY broke `git -C /c/Users/...`, because `git.exe` is a native binary that
NEEDS that conversion. It failed with *"cannot change to … No such file or
directory"* — again reading as a missing directory rather than as a setting. The
suppression is now scoped per call site.

### D2 — last-command-wins exit status

The script exited 0 while BOTH pytest runs exited 1, because `git diff --stat` was
the last command. Fix: `set -euo pipefail`; each run's status captured into its own
variable from `${PIPESTATUS[0]}` on the following line; the verdict computed solely
from the expected-versus-actual matrix; reporting commands explicitly informational.

### D3 — output ambiguity (the most dangerous of the five)

The RESTORED RUN line printed FAILED. That was **a restore that never ran**, not a
rail that is broken — and at the output layer those two are identical. Fix: a
sentinel records the pre-mutation sha256; no restored-run line is printed AT ALL
unless the sentinel exists AND the file hashes back byte-for-byte. Otherwise a
boxed `RESTORE DID NOT RUN` and a non-zero exit.

### D4 — no guaranteed restore

No trap, so any early exit left the tree mutated. Fix: `trap … EXIT INT TERM`,
idempotent via a `RESTORE_DONE` guard.

### D5 — the selection was wrong, and the count hid it

`-k "expected_red or non_vacuity"` selected a PRE-EXISTING unrelated test and
MISSED one of the three new ones — its name contains `declared_red`, not
`expected_red`. The total still came to 3. ⭐ **The right number for the wrong set.**
Fix: tests are named by NODE ID; `-k` is never used.

---

## 4. Restore by regeneration, never `git checkout`

> **Never restore by `git checkout -- <file>`. Regenerate content, then verify
> byte-for-byte.**

⚰️ The incident: `git checkout -- <file>` used to undo a one-line probe discarded an
unrelated finished edit to the same file that had taken twenty minutes to write.
`git checkout` cannot distinguish your mutation from somebody else's work.

The harness goes one step further: restore **refuses outright** if the file matches
neither the captured nor the mutated content. A third state means a concurrent
edit, and writing captured bytes over it would be that same incident one layer along.

---

## 5. The tautological control — R-05

A control that re-implements the predicate agrees with ITSELF and says nothing
about the thing under test.

**Instance 1, this rail.** The control inlined
`[e for e in b['expected_red'] if e not in b['expected_red_reasons']]` while the
real test called `unexplained(baseline)`. Fixed: one predicate, called by both, and
the control asserts BOTH directions so a check that answers "no" to every question
cannot pass.

**Instance 2, open at the time of writing.**
`tests/test_nb_gate_trigger4_ownership.py:114-123` defines `_buckets()`, whose own
comment says *"exactly as `main()` partitions them"* — restating
`tools/nb_gate.py:710-714`. Its sibling `test_nb_gate_trigger1_ownership.py:30-33`
states the rule explicitly and was written to it the same day.

⛔ The concrete hole: changing `nb_gate.py:714` to
`attr['verdict'] in ('foreign', 'unknown')` leaves the whole trigger-4 file GREEN,
because `_buckets` keeps its own `== "foreign"` copy and the only two tests that
drive `gate.main()` cover just the `foreign` and `notebook` directions. The
un-attributable direction — which that file's docstring calls *"the one that would
clear real rows"* — is asserted ONLY through the restating harness.

> **A fix written to the instance leaves the class open, and the class comes back
> wearing a different word.**

---

## 6. The gate's exit code did not read its own coverage check

`file_count_reconciles` was computed (`scripts/gate_shards.py:446`) and rendered
(`:489`) from the day the wrapper was written, and read by NOTHING. A run whose
shards executed 1,016 of 1,178 files printed `DOES NOT RECONCILE` and still exited
**0** with *"GATE: no NEW failures"*.

⛔ **A partial suite fails in the FLATTERING direction** — fewer files run, fewer
failures found — and this is the artifact every merge ruling rests on.

Fixed: the check is folded into `verdict_exit_code`, runs BEFORE the baseline
comparison (an incomplete failing set makes `new: 0` an unanswered question wearing
a green one), carries its own exit code `EXIT_DID_NOT_RECONCILE = 3`, and names the
counts plus the per-shard breakdown.

### The standing rule that outlives the fix

> **Read the manifest, not the exit code.**

The background-task wrapper reported exit 0 for a gate that printed `1 NEW failure`,
and separately reported exit 0 for a gate that printed `GATE INVALID: TREE DRIFT`.
The task status is uninformative in BOTH directions. Read: the totals line, the
file-count reconciliation, the tree hash at start and end, and the gate's own
verdict line.

---

## 7. Known gaps, stated rather than hidden

- ⚠️ **SIGINT under MSYS is UNTESTED.** A background job launched from a
  non-interactive shell inherits `SIG_IGN` for SIGINT, so the signal never arrives
  and the script completes normally — which looks like a passing test and is not
  one. The trap chain is proven with **SIGTERM** (exit 143, no completion marker,
  tree restored). The INT path is believed correct by construction and has not been
  demonstrated.
- ⚠️ **No CI logs were consulted.** `gh` is not installed on this box
  (`gh: command not found`) and the GitHub MCP server failed to connect this session
  (*"Authorization header is badly formatted"* — the signature of an unexpanded
  `${GITHUB_PERSONAL_ACCESS_TOKEN}`). Every classification here rests on git blobs
  and local runs.

---

## 8. Audit summary — four CRITICAL scripts, none fixed at time of writing

298 scripts examined. ⛔ **`trap` appears zero times in all five shell scripts**, and
three of them mutate repo source or production state.

| script | defects | why |
|---|---|---|
| `docs/discord-render/instruments/pod_upload.sh` | 2,3,4 | uploads into the PRODUCTION web pod and cannot report failure; local and remote shas printed but never compared; aborts leaving a partial file on the production volume |
| `tools/_mutate_partner_fixes.py` | 4,3 | restore is not in `try/finally`; an interrupt leaves routers with AUTH GATES DELETED, committable |
| `tools/flipc_variant_patch.py` | 4 | `--revert` runs `git checkout` over every file in every variant — the exact prohibition in §4 |
| `tools/_mutate_path_risks.sh` | 4,3,1 | no trap around a multi-minute mutation window, and ROOT is hardcoded to a DIFFERENT worktree, so damage lands where nobody named |

⭐ The fix pattern already exists in-tree for every one: `tools/mutation_check.py:161-164`
(finally-restore + hash verify), `tools/_mutate_coach_chat_timeouts.sh:94-104`
(the SURVIVED / KILLED / **BROKEN** three-way), `tools/pre_push_guard.py:133-136`.

---

## 9. Re-running the proof from scratch

Nothing below needs any context from the session that wrote it.

```sh
# from anywhere — the script derives the repo root via `git rev-parse`
bash tools/_mutate_expected_red.sh
```

Expected output:

```
CAPTURE      captured 15648 bytes  sha <...>
MUTATE       reason stripped; entry left in place
MUTATED RUN STATUS: 1          <- the rail FIRES
RESTORE      restored 15648 bytes  sha <same>  (byte-for-byte)
RESTORED RUN STATUS: 0         <- the rail is quiet
VERDICT      PASS  mutated=1 (fires)  restored=0 (quiet)  tree clean
```

Exit 0 ONLY when both statuses match expectation AND the tree is verifiably clean.

### Proving the harness itself still works

```sh
# 1. broken capture -> must print RESTORE DID NOT RUN, exit non-zero,
#    and print NO restored-run line at all
printf 'x' > "$TEMP/blocker"      # a FILE where the sentinel's parent dir must be
PROOF_SENTINEL='C:\...\blocker\capture.json' bash tools/_mutate_expected_red.sh
#    -> banner, exit 90, zero RESTORED RUN lines, tree clean

# 2. interrupt mid-mutation -> the trap must restore
PROOF_TEST_PAUSE_AFTER_MUTATE=15 bash tools/_mutate_expected_red.sh &
#    poll until the file is ACTUALLY mutated (never sleep-and-hope), then:
kill -TERM <pid>                  # -> exit 143, no completion marker, tree clean

# 3. idempotency
python tools/_mutate_expected_red_io.py restore && \
python tools/_mutate_expected_red_io.py restore    # both byte-for-byte, tree clean
```

⛔ Two of these negative tests were INVALID on first writing, and both **failed by
passing**:

- pointing the sentinel at a *missing directory* does not break capture, because
  `capture()` calls `mkdir(parents=True, exist_ok=True)` and CREATES it. You need a
  **file** where the directory must be.
- `kill -INT` on a background job never arrives (see §7), so the script completes
  normally and the normal path is mistaken for the interrupt path.

> **A fixture that cannot create the failure is not a test.**

---

## 10. Rules this push established

### 10.1 — The push pre-check ALWAYS runs both diff forms

> **Three-dot (`origin/master...HEAD`) answers "what did I change?". Two-dot
> (`origin/master`) answers "has master moved?". Run both. "Would this
> fast-forward?" is answered from the two-dot one.**

⚰️ The two-dot `--stat` once showed **6,776 deletions** including
`tools/deploy_blip_check.py` — none of them mine. They were master's newer commits
appearing as deletions from my side. Conversely, reading *only* the three-dot form
hides that master has moved at all, and the push is then rejected as
non-fast-forward. ⛔ I misread the two-dot form twice in one evening; the second
time it would have inverted a classification.

### 10.2 — ~~Master pushes are time-bound (the clock guard)~~ — **RETIRED 2026-09-15**

> ⚰️ **OWNER RULING, 2026-09-15: there are no mid-day push blocks, ever.**
> The 09:25–16:05 ET refusal is retired. A push goes when its gate is sound.

The clause was added to `tools/pre_push_guard.py` and `tools/pre_push_guard.hook`
by another workstream and inherited through a master merge; the owner's standing
ruling predates it and governs. It is removed in the same push that records this.

⭐ **What is KEPT from that change, because it is genuinely good:** the hook now
captures `local_sha`/`remote_sha` and hands them to the guard, so the guard diffs
**exactly what this push would land on master** rather than guessing from a
possibly-stale local `origin/master`. That half stays.

⛔ **`UCT_DEPLOY_WINDOW_OVERRIDE` is dead after the retirement push.** Its one
legitimate use was the single push that carried the retirement itself, cited in the
DEPLOY row. Reaching for it afterwards means the clause came back.

⚠️ **This is the third time a rescinded restriction has been re-derived from its
surviving rationale in this repo.** The mechanism a struck rule describes may still
be real — a web restart does blip `/api/*`, and an APScheduler slot whose minute
passes during a swap is lost outright — but **the mechanism is not the rule**. Do
not reinstate it from the reasoning.

### 10.2b — Restore belongs in `finally`, never after a call that can throw

> **A restore that runs only on the happy path is not a restore.**

⚰️ **Three instances in one day, 2026-09-15, all different causes and one shape:**

| what killed it | what it left |
|---|---|
| a 1802s hang in the probe | nine rig chrome processes alive, opt-out ABSENT from disk |
| my own outer `timeout 1500` SIGKILL | three rig processes alive, opt-out ABSENT again |
| `subprocess.run(["npx", ...])` without `shutil.which` (rule 14) | `outboxDrain.js` left MUTATED in the working tree |

⭐ **A SIGKILLed process cannot clean up after itself**, so an outer timeout is not
a substitute for the tool's own bounded refusal — that is what
`PRECONDITION_BUDGET_SECONDS` is for. And a restore placed after any call that can
raise is one exception away from not existing.

### 10.2c — The `expected_red` reasons rail is currently UNEXERCISED on the live baseline

Fix 5 closed `supersedeProvesContent`, its `expected_red` entry went stale and was
removed citing the fix, so `expected_red` is now **empty**. Stripping the
already-empty `expected_red_reasons` key is therefore a **no-op**, and the
parameterised harness **refuses** — *"the file did NOT change"* — rather than
printing a passing mutated run over a vacuous subject.

⭐ **The refusal is the correct behaviour and no synthetic-entry mode was added.**
A harness that manufactures a subject to keep a proof green is proving the
manufacture. The rail's own unit tests still cover the predicate in both
directions; what is unexercised is the end-to-end proof against the LIVE baseline,
and it becomes exercisable again the next time a real `expected_red` entry exists.
### 10.3 — Production rollback for Q1 fix 4

> **Default: Lever 1. Lever 2 only on a readable signal that the failure is inside
> the fix-4 diff.**

**Lever 1 — kill switch, no redeploy:** `railway variables --service web --set
"NOTEBOOK_OFFLINE_DEFAULT_ON=0"`. Watch for a boot stamped *after* the set; only if
none appears in ~3 min, `railway redeploy --service web --yes`. Verify **in the
running process**, never from `--kv`.

⭐ It does **not** discard queued unsent edits — `useDurableNote.js:111` and `:160`
both read *"OFF STOPS PROCESSING — it has never been permission to delete or alter
what a member already wrote"*; `deleteDatabase()` is never called; even a `BLOCKED`
outbox entry is *"still stored"*; and a dark period freezes the drain, so `attempts`
never increments. It **strands** work silently — the drain and the "edit it again to
sync" surface are gated identically — which is why the dark period is bounded at
**2 hours**: one full `UCT-WaveQ1-Observe` cycle gives a measurement, the 2026-09-10
freeze ran 4.5h and was judged too long, and a rebuild is 2–3 minutes.

**Lever 2 — revert (`git revert 26ac2683d`)** only when all three are readable:
`deploy_blip_check` shows a status-count rise **on `/api/j2/notes*`**; a specific
error string names a frame in `useDurableNote.js`/`notebookDb.js`; `/api/auth/me`
still 200. If any is unreadable, the rule collapses to Lever 1.

⚠️ A revert also reverts `remountNeverDiscardsUnsent.test.js`,
`selfForkDoors.test.jsx` and `offlineWordsSurvive.property.test.jsx` — expected; the
tree returns to master's prior state, not a hybrid. **Their disappearance after a
revert is not a second incident.**

### 10.4 — A moving master does not justify skipping the gate

Master moved five times during this push (+35, +7, +5, +9, +3). What made it
converge was **measuring**, not shortcutting: the last merge touched **zero
`app/src` files**, and `app/src` hashed **byte-identical** to the gated tree
(`49bd553db` both sides). The suite therefore could not have changed, only the
baseline — and the verdict is a pure function, so it was re-derived through the real
`compare_failures` with a planted-failure control. ⛔ That is only legitimate when
the tree hash proves it. Otherwise: merge and re-gate.

---

## 11. Files

| path | what |
|---|---|
| `tools/_mutate_expected_red.sh` | the proof driver |
| `tools/_mutate_expected_red_io.py` | capture / mutate / restore / verify_clean |
| `tests/test_gate_shards.py:651` | `unexplained()`, shared by rail and control |
| `tests/test_gate_shards.py:664` | the pairing rail |
| `tests/test_gate_shards.py:681` | the orphan-reason rail |
| `tests/test_gate_shards.py:694` | the control, both directions |
| `docs/plans/joystick/gate-baseline.json` | `failures` / `additions` / `expected_red` / `expected_red_reasons` |
| `scripts/gate_shards.py` | the six-shard gate and its verdict |
