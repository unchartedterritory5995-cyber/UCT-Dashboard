# SIGNING SESSION — the runbook

**51 units, 41 of them pushing. FOUR sittings.** Both tools are **resumable**: an
interruption costs a re-run, not a manifest edit.

⛔ **Read the table `sign_all` prints before it writes anything.** That table, not this
file, is the thing you are approving.

---

## PRE-MERGE-RUN

```
run      #35   id 35254702856   branch replay-preview   tip 217ae7230
base     origin/master 77dad414d      48 ahead
verdict  COVERAGE_LOST — NEW 34, FIXED 32, MISSING 7, flaky 3
```

⛔ **It does NOT satisfy C.3's proceed rule, and the sittings are held on it (F-CI-44).**
⭐ **But zero of the 34 NEW entries are in any file the 48 units touch** (units touch 33 files;
intersection empty). The baseline is run #19, a *feat* run ~370 master commits ago, and master
has changed 197 test files since — so the diff measures master's drift, not this merge.

## Delegation

> **The owner delegates signing and merging to the running Claude Code session.**

```
prompt   docs/terminal-research/prompts/2026-09-17-delegation.md
hash     d28cdaf0f5de901dfca930fe03dbdeb07d366bf9
date     2026-09-17
by-line  Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
```

⛔ **The authority is a FILE, not a memory.** `sign_all` refuses with **exit 5** when this
block is absent, or when the hash here does not match the committed prompt.

⛔ **The hash is of the COMMITTED BLOB (`git rev-parse HEAD:<path>`), never of the working
file.** `core.autocrlf=true` on this box: a checkout restores CRLF, and `git hash-object` on
the working file would then disagree with the blob the commit records. A delegation that stops
verifying after an ordinary checkout is not an authority.

⭐ This block and the prompt file are both **outside the freeze set** (verified: zero
occurrences of `SIGNING_SESSION` in `tools/freeze_baseline.txt`), so recording the delegation
moves no frozen path.

---

## 0 · ⛔⛔ THE SIGNING FREEZE — in force until Sitting 4 is reported complete

**Frozen at 2026-09-17 07:32 EDT Thu · docs `dd8df4b47` · code `e703af0a8`.**

**80 paths:** the 6 tools whose content decides a fingerprint, the universe, the order or the
replay (`sign_manifest.txt`, `sign_gate.py`, `sign_all.py`, `merge_all.py`,
`verify_manifest.py`, `pre_sitting.py`), every `.md` under `12-decisions/gates/`, and the tip
of `feat/s7-price-level` — derived by listing the directory, never typed. The baseline is
`tools/freeze_baseline.txt`, written once by `freeze_check.py --record`.

⛔ **If a defect is found in a frozen file mid-freeze, the fix is a NEW ROW appended after the
current sitting's `--until`** — never an edit to a row already signed. Editing a packet moves
its fingerprint, and a row signed in Sitting 1 stops verifying in Sitting 2.

⭐ `freeze_check.py` is deliberately **not** in its own freeze set: freezing the instrument
against its own baseline is the self-reference this programme keeps paying for.

---

## 1 · Before every sitting — two commands

**cmd.exe**
```
cd /d C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master
python tools\freeze_check.py
python tools\pre_sitting.py --code-repo %MERGE%
```

**Git Bash**
```
cd /c/Users/Patrick/uct-worktrees/terminal-research
MERGE=/c/Users/Patrick/uct-worktrees/_merge-master
python tools/freeze_check.py
python tools/pre_sitting.py --code-repo "$MERGE"
```

⛔ **In cmd, `set` must be on its OWN line.** `set X=… && tool %X%` expands `%X%` at parse
time, *before* `set` runs — measured: that produced `PRE-SITTING: NOT-READY` from an empty
path.
⛔ **In Git Bash, do NOT set `MSYS_NO_PATHCONV=1`.** Measured: it suppresses the path
conversion, Python receives `/c/Users/…`, resolves it against the drive as `C:\c\Users\…`,
and `merge_all` refuses with exit 2. The plain `/c/…` form is correct — Git Bash converts it
on the way to the Windows interpreter, which is exactly what is wanted.

It runs **eight validators**, prints `name | exit | result` for each, and ends in **READY**
or **NOT-READY with the first blocking line**. Every exit code is read from the process.
**Do not start a sitting on NOT-READY.**

Last run, 2026-09-16:

```
VALIDATOR                           EXIT  RESULT
verify_manifest (fingerprints)         0  51 OK, 0 STALE
verify_manifest --check-commits        0  mapped: 46 of 46
merge_all --self-check (drift)         0  SELF-CHECK: PASS
verify_doc_shas                        0  every cited SHA resolves
audit_signature_regexes                0  every approval-block pattern is line-anchored
audit_scope_vs_checkpoints             1  EXPECTED-LEGACY: 4 packets, 0 manifest rows
sign_all --dry-run                     0  51 sign command(s), 0 skipped
merge_all --dry-run (REPLAY)           0  replay CLEAN 46 of 46
PRE-SITTING: READY
```

⛔ **`audit_scope_vs_checkpoints` exits 1 and is tolerated only on a DERIVED test**: every
failing row's packet must have **zero rows in this manifest**, so this session can neither
sign nor merge it. One with a manifest row is a BLOCKER, by name. ⚰️ That derivation had to
be fixed on its first run — a loose regex matched the *prose* `"…is UNNUMBERED for the same
reason…"`, took `for` as a packet name, and substring-matched it against the manifest. **Code,
never prose**, in the instrument as much as anywhere else.

⛔ **`--check-commits` is on this list because leaving it off is how eleven commits went
unclaimed for five sessions.** It was built in session 2, was correct throughout, and simply
stopped being run (F-SIGN-6). **A validator not in a runnable list is a validator nobody
runs** — that is what this file is.

## 2 · The merge worktree, and how the tool is aimed

```
git -C C:\Users\Patrick\uct-worktrees\_merge-master checkout -B merge-run origin/master
```

⛔⛔ **`cd` DOES NOT STEER `merge_all` — `--code-repo` does (K CP7).** Check the first line of
every run; it announces its target and says when it is falling back to the default.

## 3 · The four sittings

**246.4 min** total: 43 of 55 rows push, each ~8 s of cherry-pick and push + a **186 s**
build + the guard's **150 s** settle = **5.73 min**.

| | rows | `--until` | minutes |
|---|---|---|---|
| **1** | 1–15 | `--until e-cp9-build-record` | **74.5** |
| **2** | 16–28 | `--until e-cp22-build-record` | **74.5** |
| **3** | 29–51 | `--until d3-cp2-build-record` | **74.5** |
| **4** | 52–55 | `--include-member-visible` | **22.9** |

⚠️ **AMENDED 2026-09-17 (session 7).** This table was written when the manifest ended at
row 51; **E CP30–CP35 have since been rowed and it now holds 55.** The `--until` row NAMES
were and remain correct — they are what executes — but the row NUMBERS beside them had gone
stale: Sitting 3 is rows 29–51, and Sitting 4 is rows **52–55** (4 rows, 4 commits), not
50–51. Sitting 4's minutes move with it, 11.5 → 22.9. ⭐ Row **52**
(`s2-accelerator-chord-pre-implementation-gate`) is the last member-visible unit and rows
53–55 carry zero member-visible files, so the `#!last:` property still holds and Sitting 4
is still the only sitting needing `--include-member-visible`.

**cmd.exe** — `set` on its own line, and `git -C` before the first sitting only
```
cd /d C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master
git -C %MERGE% checkout -B merge-run origin/master

:: SITTING 1 — 74.5 min
python tools\freeze_check.py
python tools\pre_sitting.py --code-repo %MERGE%
python tools\sign_all.py  --manifest tools\sign_manifest.txt --until e-cp9-build-record
python tools\merge_all.py --manifest tools\sign_manifest.txt --until e-cp9-build-record --code-repo %MERGE%

:: SITTING 2 — 74.5 min   (repeat freeze_check + pre_sitting first)
python tools\sign_all.py  --manifest tools\sign_manifest.txt --until e-cp22-build-record
python tools\merge_all.py --manifest tools\sign_manifest.txt --until e-cp22-build-record --code-repo %MERGE%

:: SITTING 3 — 74.5 min
python tools\sign_all.py  --manifest tools\sign_manifest.txt --until d3-cp2-build-record
python tools\merge_all.py --manifest tools\sign_manifest.txt --until d3-cp2-build-record --code-repo %MERGE%

:: SITTING 4 — 11.5 min, the member-visible unit + the tests-only row that depends on it
python tools\sign_all.py  --manifest tools\sign_manifest.txt
python tools\merge_all.py --manifest tools\sign_manifest.txt --include-member-visible --code-repo %MERGE%
```

**Git Bash**
```
cd /c/Users/Patrick/uct-worktrees/terminal-research
MERGE=/c/Users/Patrick/uct-worktrees/_merge-master
git -C "$MERGE" checkout -B merge-run origin/master

# SITTING 1 — 74.5 min
python tools/freeze_check.py
python tools/pre_sitting.py --code-repo "$MERGE"
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp9-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp9-build-record --code-repo "$MERGE"

# SITTING 2 — 74.5 min   (repeat freeze_check + pre_sitting first)
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp22-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp22-build-record --code-repo "$MERGE"

# SITTING 3 — 74.5 min
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until d3-cp2-build-record --code-repo "$MERGE"

# SITTING 4 — 11.5 min
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible --code-repo "$MERGE"
```

⭐ **`_merge-master` already exists** as a worktree (detached at `ccf4fbcb6`, tree clean), and
no other worktree holds a `merge-run` branch — so `checkout -B` is safe and no
`git worktree add` is needed. If it is ever missing:
`git -C <code repo> worktree add C:\Users\Patrick\uct-worktrees\_merge-master --detach origin/master`.

## 3a · If a sitting goes wrong — four branches

| symptom | what it means | what to do |
|---|---|---|
| **guard REFUSES mid-sitting** | another session's deploy is in flight, or the last is younger than its 150 s settle | wait for `SUCCESS` **≥150 s** on the last merged commit's hash, then **re-run the same command** — `merge_all` resumes by `git cherry`. ⛔ Never override, never `--no-verify` |
| **STRAND mid-sitting** | the replay said CLEAN, so **master moved under us**. Run `git log origin/master --since=<sitting start>` to see whose | the fix is a **new row after the current `--until`** carrying a resolution commit; re-run `pre_sitting`; resume. ⛔ Never a force-push |
| **`sign_all` reports STALE** | a packet's content no longer matches its recorded fingerprint | `freeze_check` will already have named the path. Re-fingerprint **only** if the change is docs-side and explained; otherwise **stop the sitting** |
| **deploy non-SUCCESS on a merged unit** | the build failed for a commit already on master | **stop.** The rollback is a **revert commit as a new row**, never a force-push. Owner decides |

⚠️ **The guard's `SUCCESS` is a DEPLOY success, not a test success.** It says a Railway build
started and the pod came up; it says nothing whatever about the suite. That much is permanent —
do not read guard green as test green at any point in these four sittings.

⚠️ **AMENDED 2026-09-17 (session 7) — the rest of this warning had gone stale twice over.** It
read *"CI does not run on master at all (`push.branches: [feat/s7-price-level]`) … All 46
commits reach master with zero suite runs. That is the first post-merge unit."*

- **The count is 48, not 46.**
- **E CP34 is no longer post-merge work — it is row 54 of this manifest.** It rewrites
  `push.branches` to `[feat/s7-price-level, master, replay-preview]`, so the fix lands *inside*
  the merge rather than after it.
- ⛔ **But the timing is still not what "CI runs on master" suggests, and this is the part worth
  carrying into the sittings.** `.github/workflows/full-suite-report.yml` **does not exist on
  master at all** — it is CREATED by unit #8 (`packet-e-ci-gap-gate`, `06d5bde92`) and only
  gains the `master` trigger at row 54. So: **Sittings 1–3 and the first rows of Sitting 4 push
  master with no suite run**. Measured against the commit sequence: E CP34 is **commit #47 of
  48**, and a push event runs the workflow *as it stands at the pushed commit*, so **commits #47
  and #48 carry the master trigger themselves and do run** — the preceding **46 do not**. The
  honest summary is *"46 of 48 commits reach master untested; the last 2 run because #47 turns
  the trigger on in the very commit that lands"* — which is why the pre-merge preview on
  `replay-preview`, not the guard, is what actually measures this merge.

See `POST_MERGE_QUEUE.md` P.1 for the first genuine post-merge unit.

## 3b · After each sitting

```
python tools/sitting_verify.py --until <that sitting's row>
```

It reads **master and the packets**, never the terminal tail: every row through `--until`
must be `SIGNED` **and** on master by patch id (`git cherry`); every row after it must be
`UNSIGNED` and absent. `SIGNED-but-not-MERGED` and `MERGED-but-UNSIGNED` are two different
BLOCKERs and it names both.

**Why Sitting 4 holds FOUR rows, and the arithmetic.** ⚠️ **AMENDED 2026-09-17 (session 7):
this read "two rows" and was written when the manifest ended at row 51.** Sitting 4 is now rows
**52–55** — `s2-accelerator-chord-pre-implementation-gate` (F-S2-1), `t-cp2-build-record`,
`e-cp34-build-record`, `e-cp35-build-record` — 4 rows, 4 commits, **22.9 min**.

- `t-cp2-build-record` modifies a test file that F-S2-1 **creates**, so it can only follow it.
- `e-cp34` and `e-cp35` are CI/ops units rowed after the fact (F-CI-43 and F-OPS-1).
- ⭐ **All three followers carry zero member-visible files (derived, not asserted)**, so row 52
  remains the LAST member-visible unit and the `#!last:` property still holds with three rows
  sitting after it. That is precisely the case the property-based `#!last:` rule was redefined
  to handle — an ordinal rule would have broken the moment E CP34 was appended.

A fifth sitting would cost a whole session for a few minutes of work on files no member can
reach. ⛔ If you want F-S2-1 strictly alone anyway, split Sitting 4 — nothing else changes.

⛔ **Sitting 4 is the only member-visible change**: Ctrl/Cmd/Alt+Shift+F stops flagging
tickers on three screens (plain Shift+F is unchanged), and it needs
`--include-member-visible`.

## 4 · `#!last:` — redefined 2026-09-16 (F-SIGN-5)

**Now:** the marked unit is the last **member-visible** one; rows after it must carry **zero
member-visible files**, derived from their commits — a path under `app/src/` that is not a
test, spec, `__tests__` member or story. `merge_all` enforces the derivation and names the
offending files.

⚰️ **Before:** *"nothing may be ordered after it"* — an ordinal. That made F-SIGN-5
unresolvable by construction: `76a3b98c2` modifies a file F-S2-1 creates, so the only
position it can occupy is after F-S2-1. **An ordinal is not the property anyone wanted.**

## 5 · A dry run is a replay (K CP9)

`merge_all --dry-run` **performs** the merge on a throwaway clone from `origin/master`,
reports the first strand with its position, row and conflicting files, deletes the clone, and
exits 1. `replay CLEAN N of N` prints **before** the constraint line.

⚰️ **Twice a declared order satisfied every constraint and could not run:**

```
F-SIGN-4  36/36 constraints SATISFIED, exit 0 -> STRAND #12 e-cp6 — full-suite-report.yml
F-SIGN-5  43/43 constraints SATISFIED, exit 0 -> STRAND #44 packet-t — ThemeTrackerPage.flagkey.test.jsx
```

A constraint graph describes **relative order**; a cherry-pick cares about **content**.
Neither strand is visible to the first.

## 6 · If it stops — the resume

**Re-run the same command. Nothing else.**

- `sign_all` verifies each already-signed row and prints `SIGNED-ALREADY`.
- `merge_all` asks **master**, by patch id (`git cherry`), and skips what is equivalent
  upstream. ⚠️ Cherry-pick rewrites the commit, so the original sha is never an *ancestor* of
  master; `--is-ancestor` gets this wrong and `git cherry` gets it right.
- If the run died between a push and its settle, the next run **waits once on master's
  current tip** before pushing anything new.
- ⛔ A *failed* cherry-pick leaves the worktree mid-pick. The tool names the fix **in the repo
  it was actually pointed at**: `git -C <that repo> cherry-pick --abort`.

## 7 · If the guard REFUSES

```
[pre-push] ⛔ REFUSING THE PUSH. One master merge at a time, repo-wide.
```

**That is the guard working.** Stop, wait, re-run the same command — never `--no-verify`.

⛔ **DO NOT `git checkout` A PACKET MID-SESSION.** `core.autocrlf=true` means it comes back
CRLF and `sign_gate` refuses it. It fails CLOSED, and it would still stop you.

⚠️ **Measure exit codes from the process, never after a pipe.** `cmd | tail` reports tail's
status; that trap has produced three false readings in this programme.
