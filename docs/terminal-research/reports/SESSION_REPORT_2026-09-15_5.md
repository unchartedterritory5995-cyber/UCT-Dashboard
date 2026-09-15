# Session report — 2026-09-15, session 5

**SIGNING-SESSION READINESS · THE DERIVED FLAKE POLICY · TWO RETRACTIONS · A SHARD SPLIT**

---

## 1 · ET, trees, poll log

Start **2026-09-15 17:01 EDT Tue**, end **2026-09-15 18:5x EDT Tue**
(`python tools/weekly_exec.py et`). Both worktrees `git status --porcelain` → **0** at start.
**Gate-box lock: ABSENT.**

⛔ **No persistent watcher processes.** Every wait was a bounded poll that returns, one ET
line per poll:

```
build a4e845fe7   17:0x … 17:1x ET   (measuring one web deploy end-to-end)
run  #23          18:08:33 … 18:20:23 ET   (2 bounded calls, 12 polls)
run  #24          18:2x … 18:5x ET
```

**6 commits** — 3 code (`ce615a2eb`, `e02dca955`, `16027f239`), 3 docs. **Nothing signed,
nothing merged, nothing pushed to master. No deploys, flag flips, daemon pauses or
wake-ups.**

---

## 2 · S — signing-session readiness

### S.1 · ⛔ NEITHER SCRIPT WAS IDEMPOTENT, AND THAT IS THE HEADLINE

The question was *"prove both scripts are idempotent."* They are not — measured by running
them twice, which is the only way that question is ever answered:

```
sign_all, second run over two rows it had just signed:
  ⛔ no UNSIGNED `APPROVED AT SHA:` line (every block already carries a fingerprint).
  exit=1        ...raised in PASS 1, at ROW 1, before a single row was classified.

merge_all, second run (measured in a throwaway repo):
  git cherry-pick <already-applied>  ->  exit 1, "the previous cherry-pick is now empty"
  ...and .git/CHERRY_PICK_HEAD is left behind, so the NEXT run dies before it starts.
```

A run interrupted at unit 12 of 37 could not be resumed without hand-editing the manifest.
**Fixed as K CP5.** Both now skip what is already done — `merge_all` by reading **master**
(`git merge-base --is-ancestor <c> origin/master`), never the manifest — and the resume
controls are pasted in `docs/terminal-research/SIGNING_SESSION.md`.

### S.2 · The guard cannot hang, and a docs-only diff buys no exemption

`tools/pre_push_guard.py::main()` calls `latest_deployment()` **once** and `decide()`
**once**, then returns 0/1. **No wait loop, no polling**; the only bound is
`subprocess.run(..., timeout=120)` on the CLI call. So **no K CP was owed for a hang.**

Three further measurements, all live:

- the guard's 502 rule applies to **`refs/heads/master` and `main` only** — pushing the docs
  branch is never gated by it;
- **a docs-only push still builds the web service** — `a4e845fe7`, a docs commit, reached
  SUCCESS **~186 s** after `createdAt`. "No runtime change" is not an exemption and must not
  be given one;
- **`railway deployment list --service web --json` carries no finish time** (only
  `createdAt`, `id`, `meta`, `status`), so a build's duration is UNREADABLE from the list and
  has to be watched.

### S.3 · ⚠️⚠️ AND THE DEPLOY WAIT COULD NOT FAIL

`merge_all.wait_for_success` was `'"SUCCESS"' in out` over the raw JSON of that list. **The
list is history.** Measured live, with no deploy of ours anywhere in it:

```
rows returned: 20   statuses: {'SUCCESS': 1, 'REMOVED': 19}
merge_all predicate  '"SUCCESS"' in out  ->  True
```

The one SUCCESS is the deployment **currently serving** — the previous one. The wait returned
on its first poll every time and collapsed to `sleep(150)` against a build measured at
**~186 s**. ⭐ The consequence is not a member outage — the Layer-0 guard catches it — it is
an **aborted session**: unit 2's push is refused, `merge_all` stops, and before S.1 it could
not be resumed. **Defect 4 is what would have made defect 3 fire, on the owner's first
attempt, at unit 2 of 37.** Fixed: the deployment is found by **our commit hash**.

### S.4 · Wall time, and the one lever that bends a rule

| | |
|---|---|
| units signed | **38** (37 at session start + K CP5 + E CP25) |
| units that push to master | **31** (7 are docs-worktree only and never push) |
| per pushing unit | build **~140–190 s** + settle **150 s** ≈ **5–5.6 min** |
| **total, empty queue** | **2 h 30 m – 3 h 00 m** |
| guard refusals | **expect at least one** — 8+ web deployments landed from other sessions in one 2.5 h window today, several REMOVED |

Over two hours, so a lever is owed. **Proposed, not done:** batching N consecutive units into
one push turns 31 builds into 31/N; at N=4 the session is ~45 minutes. It bends *"ONE UNIT AT
A TIME, AND IT WAITS"* — written after 2026-09-12, when two merges four minutes apart marked
the first deploy REMOVED and `/api/health` served 502 for ~45 s — and the cost is revert
granularity: a bad batch reverts as a batch. ⭐ **The cheaper answer is two sittings**, which
the resumability fix now makes free.

Both dry-runs: `sign_all` **38 rows, 38 ok, exit 0**; `merge_all` **38 units, 30 constraints,
0 already merged, exit 0**.

---

## 3 · F — F-CI-30, the derived flaky set (E CP25)

**Built to the owner's rule**: both states across ≥2 runs at the same SHA, or across
consecutive runs whose diff cannot reach a test; out after **K = 5**; NEW reported
**excluding** FLAKY; **no rerun-on-failure**; and **no hand-maintained list anywhere** — the
set is re-derived from the record every run, so there is no file to edit.

### ⚠️⚠️ The second limb, read literally, is wrong — and the record proves it

Runs **#18 and #19 differ by ONE file**, `.github/workflows/full-suite-report.yml`, which no
test imports. A literal reading calls that pair comparable:

```
#18 -> #19   ran in both 44,353   FLIPPED 130
```

Those 130 are E CP21's `npm ci` fix — **129 real repairs and one real regression**. A literal
reading would have booked the most valuable diff in this record as noise. ⭐ **So a workflow
file is judged by WHICH JOB changed**, with the suite-running jobs derived from the
workflow's own steps. **2 of 7 pairs are comparable**, and they yield **FLAKY_SIZE 5** —
including the three E CP24 found by hand, two of them in one file moving in opposite
directions.

### ⛔ The first limb has never once had evidence

**No commit SHA appears twice in the record.** Every run is at a distinct SHA, so *"both
states at the same SHA"* — the strongest form, needing no reasoning about imports — has never
been available. The cheapest way to change that is one `workflow_dispatch` re-run at an
unchanged SHA, which costs no code.

---

## 4 · ⛔ TWO RETRACTIONS, BOTH OF THINGS THIS PROGRAMME PUBLISHED

### R-1 · "22 STALE TESTS, not environment" — WITHDRAWN

The failures were traced from the record, not from a grep. **14 entries name a git-object
problem; 13 of them are one file**, `tests/test_discord_render_vintage_url.py`, citing
`4eec5e0aa`:

```
git cat-file -e 4eec5e0aa^{commit}          -> FOUND (the object is present)
git merge-base --is-ancestor 4eec5e0aa HEAD -> it IS an ancestor, 292 commits back
git log -1 4eec5e0aa                        -> 2026-09-13, two days ago
positive control: git cat-file -e deadbeefdeadbeef^{commit} -> MISS (the command can say no)
```

**Nothing is stale.** The test is correct and the **CI checkout is depth-1**, so the object is
not there. The 14th failure needs `origin/master`, which a single-branch shallow clone also
lacks. ⛔ **F-CI-31's population is EMPTY** — there is nothing to rewrite or delete — and the
fix is `fetch-depth: 0` on the pytest shards, i.e. F-CI-32.

⚠️ A naive sweep of SHA-shaped literals in the test tree reports **44 "absent"**, of which
almost all are synthetic fixture values (`deadbeef`, `c0ffee01`, `000000a1`). **An absence is
only evidence if the thing was supposed to be present**, and none of them is why anything
failed.

### R-2 · "the two lanes do not agree" (E CP23 §4) — WITHDRAWN

E CP23 baselined `test_ast_math_parity::test_the_two_lanes_agree_everywhere` as *"a JS-lane
parity test that now runs and fails: the two lanes do not agree. Fixing the environment
revealed a real defect."* The record says otherwise, in the fixture's own words:

```
failed on setup with "Failed: the JS lane produced no results, so NOTHING was compared.
exit=0
stdout=
stderr="
```

**The lanes were never compared.** Root cause, measured: the fixture calls
`subprocess.run(LIST, shell=True)`. On POSIX that execs `/bin/sh -c LIST[0]` and hands the
rest to the shell as `$0, $1 …`, so `vitest run <spec>` never reached `npx`:

```
sh -c "echo" "vitest" "run" "spec.js"   ->   (an empty line), exit 0
```

…which is exactly `exit=0`, empty stdout, empty stderr. On Windows the identical call works
(Python joins the list with `list2cmdline`), so **the file passes on the dev box and compared
nothing in CI**. Fixed with `shutil.which("npx")` and no `shell=True`; still 40 passed
locally. An AST sweep over `tests/ tools/ scripts/ api/` (3,256 files) finds **exactly two**
instances of the class; the other is `tools/desk_creative_watch.py:40`, a local operator tool
that never runs in CI — **filed, not fixed**.

---

## 5 · V — `fetch-depth: 0`, measured on one job

Applied to the **publish** job only, because the twelve pytest shards are the expensive place
to be wrong.

```
run #22, shallow:  Run actions/checkout@v4   7s
run #23, depth 0:  Run actions/checkout@v4  13s      +6 s
```

**+6 s against a ≤60 s budget.** Applying it to the shards is therefore justified by
measurement, and doing so is what closes R-1's 14 failures.

---

## 6 · Run #23 — scored, and it named two things

| E CP25 predicted | actual | |
|---|---|---|
| `fetch-depth: 0` adds ≤ 60 s to publish | **+6 s** | ✅ |
| the record store materialises | **yes**, 9 runs / 8 pairs | ✅ |
| FLAKY_SIZE 5 or 6 | **1** | ❌ |
| FLAKY_NEW 5 | **0** | ❌ |
| verdict not INVALID | **INVALID** | ❌ |

⭐ **Every miss is informative, and each failed in the honest direction.**

**(a) PyYAML is absent on the runner.** The publish job installs no requirements by design,
and the equivalence test has to PARSE a workflow to say which job changed — so **7 of 8 pairs
read UNREADABLE** and the set fell 5 → 1. It named the field rather than guessing, and
UNREADABLE is **not** comparable, so no flake was invented and every NEW entry would still
have fired the gate. One dependency added.

**(b) `tests-05` hit the 20-minute cap.** The Run step was cancelled at **1,142 s**:

```
INVALID because: current: shards_success 11 of 12
                 current: shards_without_totals = ['tests-05']
counts: new 0 · fixed 1 · unchanged 100 · MISSING 21 · flaky_size 1
```

⭐ **The whole chain did its job under a real shard loss**: the totals-line assertion failed,
the record recorded the shard by name, the diff read INVALID, and **21 MISSING entries were
never counted as FIXED**. ⛔ The standing rule is that a job which cannot print a totals line
within its cap is **SPLIT, not extended** — `ROOT_BUCKETS` 8 → 12, still a proven partition
(1,430 files, no duplicate, no omission, 16 shards). ⚠️ The partition is by **file count, not
time**, so this is a ~33% cut in expected worst-case work and **not a guarantee**.

---

## 6b · Run #24 — the machinery works, and the split had to be reverted

```
VERDICT: NEW_FAILURES     (valid, not INVALID)
new 41 · fixed 5 · unchanged 117 · MISSING 0 · current_ran 44,353
flaky_size 5 · flaky_new 0 · new_flaky []
```

✅ **FLAKY_SIZE 5, matching the local derivation exactly** — the pyyaml fix worked and the
pair table reads real reasons instead of UNREADABLE. **3 of 9 pairs comparable.** ✅
`#23 → #24` correctly **not** comparable, because the parity test file I edited is
referenced by 2 source files — the conservative call, made by the rule rather than by me.
✅ **MISSING 0** and a full shard set: the 16-shard run completed.

⛔ **And 41 NEW failures, every one in `tests/test_voice_router.py`, every one
`402 Payment Required`:**

```
assert 402 == 401        assert 402 == 200
```

**I caused them.** A finer alphabetical split is **not a neutral operation** — it changes who
shares a process. At 8 buckets that file lands in `tests-08` beside 155 others; at 12 it
lands in `tests-11` beside a different 103, and the paid-subscription state it silently
depended on is no longer set up by a neighbour.

⭐ **The gate caught it inside one run, by name, and excused none of it as flaky**
(`new_flaky []`). That is the entire apparatus of the last four sessions doing its job on a
regression introduced sixteen minutes earlier.

⛔ **REVERTED** — `ROOT_BUCKETS` back to 8. One INVALID run costs less than 41 failures, and
the real fix is a **time-weighted** partition: the alphabet is exactly what re-shuffles
neighbours. `tests-05`'s cap is therefore still open (**F-CI-35**), and the order-dependence
it exposed is **F-CI-36**.

---

## 7 · Findings

| # | finding |
|---|---|
| **F-SIGN-1** | `sign_all.py` was not resumable: a second run raised out of PASS 1 before classifying a row. **FIXED (K CP5).** |
| **F-SIGN-2** | `merge_all.py` had no merged-state check at all; a second run re-cherry-picks unit 1 and leaves `CHERRY_PICK_HEAD` behind. **FIXED (K CP5)** by reading master. |
| **F-SIGN-3** | `merge_all`'s deploy wait could not fail — `'"SUCCESS"' in out` matches the deployment already serving. **FIXED (K CP5).** |
| **F-SIGN-4** | **A signed packet did not re-derive its own fingerprint** — 30 of 35 signed blocks in the tree do not. `sign()` hashes before writing `APPROVED BY`/`ON`. **FIXED as a READER** (`rederive_signed`); `fingerprint()` untouched, because changing what is hashed re-dates every approval. |
| **F-SIGN-5** | ⚠️ **`sign_gate.sign()` never reads its `scope` argument** (AST, with `by`/`on` as the positive control), so all 38 approvals will carry a **blank `SCOPE APPROVED:`** while the text sits in an untracked `.scopes/`. Three signed blocks already look like this. **FILED, NOT FIXED** — writing the scope changes the packet's bytes, which is what every manifest fingerprint pins. **Owner's call.** |
| **F-SIGN-6** | `core.autocrlf=true` + no `.gitattributes` rule for `docs/**/*.md` ⇒ a checked-out packet comes back CRLF, and `sign_gate` then refuses it (`APPROVED AT SHA:[ \t]*$` cannot consume the `\r`). All 38 manifest packets are LF today; **19 other gate packets are already CRLF**. Fix proposed, not applied. |
| **F-CI-29** | The parity lane ran **nothing** in CI — `subprocess(LIST, shell=True)`. **FIXED.** Retracts E CP23 §4. |
| **F-CI-31** | **EMPTY POPULATION.** Nothing is stale; the cited SHA is a live ancestor 292 commits back and the CI checkout is depth-1. |
| **F-CI-33** | `tools/desk_creative_watch.py:40` carries the same `shell=True` class. Local operator tool, never runs in CI. **FILED.** |
| **F-CI-34** | PyYAML absent in the publish job ⇒ 7 of 8 pairs UNREADABLE. **FIXED.** |
| **F-CI-35** | `tests-05` exceeded its 20-minute cap (Run step killed at 1,142 s). **STILL OPEN** — the split that would have fixed it was reverted (§6b); the real fix is a TIME-weighted partition. |
| **F-CI-36** | **`tests/test_voice_router.py` is ORDER-DEPENDENT** — 41 of its tests return `402 Payment Required` when the file is shuffled into a different shard. A real defect the partition made VISIBLE and did not create. **FILED.** |

---

## 8 · OPEN QUESTIONS

1. **F-SIGN-5 — do the 38 approvals carry a scope, or not?** Writing it invalidates all 38
   manifest fingerprints in one commit. A blank scope reads as a full approval to
   `read_approval`, which answers on the AT SHA line alone.
2. **The first limb of F-CI-30 has no evidence.** One `workflow_dispatch` re-run at an
   unchanged SHA would give it some, for free. Worth doing?
3. **How should `tests-05`'s cap be fixed now that a finer alphabetical split is ruled out?**
   A time-weighted partition uses the `collect_profile` timings the workflow already
   gathers, and does not re-shuffle neighbours alphabetically — but it is a real change to
   `pytest_shards.py`, not a constant.
4. **F-SIGN-6** — pin `docs/**/*.md` to `eol=lf`? It rewrites the working-tree bytes of 19
   already-signed packets on the next checkout.

---

## 9 · [KEYBOARD]

```
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt
```

Read `docs/terminal-research/SIGNING_SESSION.md` first — one screen, the four commands, the
resume, and the two decisions owed before you sign.

---

## 10 · Merge readiness

**38 units, 30 constraints, 0 already merged, both dry-runs exit 0.** Nothing signed, nothing
merged, nothing pushed to master. The two new units are **K CP5** (the resumability fix) and
**E CP25** (the derived flaky set); both are docs-worktree only and trigger no build.

---

## 11 · Three phone-readable sentences

1. **Neither signing script could be run twice, and the deploy wait could not fail** — so a
   three-hour session would have stopped at unit 2 with no way forward; both are fixed and
   the resume is proven by pasted controls.
2. **The flake policy is built and derived from the record** — no list anyone can edit — and
   building it proved that the rule read literally would have classified 129 real repairs as
   noise.
3. **Two published claims are retracted**: nothing is stale (the SHA is a live ancestor and
   CI's checkout is shallow), and the two lanes never disagreed (they were never compared).

---

## 12 · Status

⛔ **Blocked on nothing.** ⚠️ **Two decisions are owed before the signing session**
(F-SIGN-5's blank scope, and whether to bend the one-unit-at-a-time rule for wall time);
neither blocks starting it.

⚠️ **One thing I did and undid in the same session**: the shard split (§6b). It was the
standing rule's prescribed response to a job that missed its cap, it cost 41 NEW failures,
and it is reverted. **Run #25 verifies the revert**; if it does not come back to 0 NEW, the
cause is not the partition and this report is wrong about it.
