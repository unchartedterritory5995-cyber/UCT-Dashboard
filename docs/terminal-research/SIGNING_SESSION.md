# SIGNING SESSION — the runbook

**51 units, 41 of them pushing. FOUR sittings.** Both tools are **resumable**: an
interruption costs a re-run, not a manifest edit.

⛔ **Read the table `sign_all` prints before it writes anything.** That table, not this
file, is the thing you are approving.

---

## 1 · Before every sitting — one command

```
cd C:\Users\Patrick\uct-worktrees\terminal-research
python tools/pre_sitting.py --code-repo C:\Users\Patrick\uct-worktrees\_merge-master
```

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

**235.1 min** total: 41 of 51 units push, each ~8 s of cherry-pick and push + a **186 s**
build + the guard's **150 s** settle = **5.73 min**.

| | rows | `--until` | minutes |
|---|---|---|---|
| **1** | 1–15 | `--until e-cp9-build-record` | **74.5** |
| **2** | 16–28 | `--until e-cp22-build-record` | **74.5** |
| **3** | 29–49 | `--until d3-cp2-build-record` | **74.5** |
| **4** | 50–51 | `--include-member-visible` | **11.5** |

```
cd C:\Users\Patrick\uct-worktrees\terminal-research
set MERGE=C:\Users\Patrick\uct-worktrees\_merge-master

# SITTING 1 — 74.5 min
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp9-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp9-build-record --code-repo %MERGE%

# SITTING 2 — 74.5 min
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until e-cp22-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until e-cp22-build-record --code-repo %MERGE%

# SITTING 3 — 74.5 min
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt --until d3-cp2-build-record
python tools/merge_all.py --manifest tools/sign_manifest.txt --until d3-cp2-build-record --code-repo %MERGE%

# SITTING 4 — 11.5 min, the member-visible unit and the tests-only row that depends on it
python tools/pre_sitting.py --code-repo %MERGE%
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt --include-member-visible --code-repo %MERGE%
```

**Why Sitting 4 holds two rows, and the arithmetic.** `t-cp2-build-record` modifies a test
file that F-S2-1 **creates**, so it can only follow it. It carries **zero member-visible
files** (derived), so it cannot change what a member sees. A fifth sitting would cost a whole
session for **5.7 min** of work on a file no member can reach. ⛔ If you want F-S2-1 strictly
alone anyway, split Sitting 4 — nothing else changes.

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
