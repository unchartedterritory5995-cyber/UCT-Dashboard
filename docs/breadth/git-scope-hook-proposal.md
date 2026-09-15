# Proposal — wire `tools/git_scope.py` into the shared pre-commit hook

**Status: PROPOSAL. Nothing is installed.** Session 12, Workstream D.
⛔ **The shared `core.hooksPath` is another programme's**, so this describes the wiring and
stops there. Coordination is an OPEN QUESTION, not something this programme may decide.

---

## Why this exists

⚰️ On **2026-09-15** a breadth commit used `git add -A` and swept in two joystick docs —
`docs/plans/joystick/RESUME.md` and
`docs/plans/joystick/harness/2026-09-14-gate-harness-pr-body.md` — silently replacing
another programme's deliberate raw `\x01` bytes with normalised text. The diff was 16 and
4 lines of somebody else's file inside a commit about a SQLite cache.

⛔ **The rule already existed.** `lesson_uct_dashboard_shared_worktree`: *never
`git add -A` in this repo; stage by name.* It was written down, it was known, and it was
broken inside one commit. **A rule that lives only in prose survives until somebody is in a
hurry.**

## What already exists — do not build a second authority

| mechanism | what it is | owner |
|---|---|---|
| `app/src/hub/rule12Paths.test.js` | a **test** asserting a joystick change set does not edit Notebook files. Identifies the change set **from the diff**, not the branch name | joystick |
| `<repo>/.git/hooks/pre-commit` | the credential scan (`secret_scrub.py --pre-commit`) | rig-credential-hygiene |
| `<repo>/.git/hooks/pre-push` | the deploy guard (settle, window, stacked-push) | deploy-windows |

⭐ `rule12Paths.test.js` is the same idea as this checker, one programme narrower, and
`tools/git_scope.py` deliberately copies its shape: **scope is decided by the paths in the
change set, and an undeclared branch is not a violation.**

## The wiring, if approved

`<repo>/.git/hooks/pre-commit` currently runs the credential scan and exits. The scope
check is a second call in the same hook — it needs no new hook file:

```sh
# after the secret scan, before exit 0
if [ -f "$root/tools/git_scope.py" ]; then
  python "$root/tools/git_scope.py" || exit 1
fi
```

⛔ **Why it is safe to add to a hook every programme runs:**

1. **An undeclared branch is silent.** `tools/git_scope.py` enforces only scopes that were
   written down in `.git-scope/*.json`. Today that is **one** file, this programme's. Every
   other branch in the repo is unaffected — which is the property that keeps the check
   tolerable, and an intolerable check is one that gets bypassed within a day.
2. **It is absent-safe**, exactly like the credential scan beside it: the `-f` test means a
   worktree without the file is not blocked.
3. **The override is explicit and logged** — `UCT_SKIP_GIT_SCOPE=1`, written to
   `logs/git-scope-override.log`. ⛔ Unlike `--no-verify`, which leaves no trace anywhere;
   that is the property that made the 2026-09-14 stacked push unattributable.

**Proved it can fire:** `python tools/git_scope.py --self-check` →
refuses an out-of-scope path · passes an in-scope path · silent on an undeclared branch.
Rails in `tests/test_git_scope.py` (8), including the **actual paths from the incident**,
and mutation-proved: inverting the allow-list check and refusing undeclared branches each
turn the rails red by name.

## D.3 — the `\x01` normalisation itself: cause and fix, also a proposal

**Cause, measured:**

| | |
|---|---|
| `core.autocrlf` | **`true`** on this box |
| `.gitattributes` for those paths | **none** — `git check-attr -a` returns nothing |

So git decided text-vs-binary by **sniffing**, and a mostly-ASCII markdown file carrying a
few raw control bytes sniffs as text. On checkout it was normalised.

⭐ **This repo has already met this exact failure twice and fixed it the same way.**
`.gitattributes` says so in its own header — a `.woff2` that sniffed as text would have
every `0x0A` rewritten and fail silently; `tools/wave_p_cert_corpus/*.pdf` and
`manifest.json -text` are the second. The precedent is established; only the paths are new.

**Proposed line — NOT added, the files are another programme's:**

```gitattributes
# Joystick harness/resume docs carry deliberate raw control bytes (see the commit
# "the two raw control bytes"). Without this, core.autocrlf=true normalises them away
# on checkout and any `git add -A` from another worktree commits the damage.
docs/plans/joystick/RESUME.md                  -text
docs/plans/joystick/harness/*.md               -text
```

⚠️ **`-text`, not `binary`.** `binary` also suppresses diffs, which for a document that
people read and review is a worse cure than the disease. `-text` disables EOL conversion
and nothing else.

## What this programme did instead, and did not do

- ✅ Built the checker, the scope declaration, the rails, the mutation proof.
- ✅ Declared its own scope in `.git-scope/breadth-history-reader.json`.
- ⛔ **Did not install the hook.** Shared dir, another programme's.
- ⛔ **Did not add the `.gitattributes` line.** Another programme's files.

---

## SD-1 S2 — the wiring, measured (Session 13, 2026-09-15)

SD-1 authorises installing this in the shared `pre-commit` in **WARN mode** for 24 h,
then promoting to ENFORCE on zero false positives. Two things were measured before
touching anything, and both change the instruction.

### 1. ⛔ "A call at the END of the existing pre-commit" would never run

The shared hook is thirteen lines and its credential-scan loop **exits 0 from inside the
loop** the moment it finds `secret_scrub.py`:

```sh
for cand in "$root/tools/secret_scrub.py" …; do
  if [ -f "$cand" ]; then
    python "$cand" --pre-commit || exit 1
    exit 0            # ⛔ the whole hook ends here on the normal path
  fi
done
exit 0
```

`secret_scrub.py` is present in this repo, so that branch is the normal path and
**anything appended after line 13 is unreachable**.

**Measured, in a throwaway repo, same commit, same staged out-of-scope path:**

| install position | warn log after the commit |
|---|---|
| appended (the literal reading) | **empty — the call never ran** |
| prepended | `…WOULD-REFUSE docs/plans/joystick/THIRD.md` |

⭐ A vacuous install is the worst outcome available here: the hook is present, the trial
"runs" for 24 h, the log stays empty, and an empty log reads as **zero false positives**
— which is the promotion criterion. It would have promoted itself to ENFORCE on the
strength of never having executed.

**So the block is PREPENDED.** That still touches none of the credential scan's lines —
it adds lines above them.

### 2. ⛔ The 24 h trial cannot observe anyone else until the tool is on master

The proposed block is absent-safe by design, and `tools/git_scope.py` currently exists
only on `repo/git-scope`. Every other worktree is on some other branch, so the file is
absent and the hook correctly skips. The trial would therefore observe **this programme's
own commits and nobody else's**, while appearing to run repo-wide.

**Ordering, forced by that:** land the tool on master first; *then* start the 24 h WARN
trial; *then* promote. S2 is blocked on the first step, not on coordination.

### The block, exactly as tested

```sh
# --- UCT git-scope (breadth-history-reader) — WARN ONLY, never blocks. ---
# ⛔ PREPENDED, not appended: the credential-scan loop below exits 0 as soon as it
# finds secret_scrub.py, so anything after it is unreachable on the normal path.
# ⛔ `|| true` and the -f guard are load-bearing: this runs inside another
# programme's hook and must not be able to refuse anybody's commit.
_gs_root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$_gs_root" ] && [ -f "$_gs_root/tools/git_scope.py" ]; then
  python "$_gs_root/tools/git_scope.py" --warn 2>/dev/null || true
fi
# --- end git-scope ---
```

⚠️ `2>/dev/null` is a deliberate trade: a traceback from this tool must not appear in
another programme's commit output. The cost is that a broken checker fails silently, so
**the promotion criterion is not "the log is empty" — it is "the log contains entries
this programme's own commits produced, and none of them are false positives."** An empty
log is an unrun trial, not a clean one.

### WARN mode

`python tools/git_scope.py --warn` records `timestamp<TAB>branch<TAB>WOULD-REFUSE<TAB>paths`
to `logs/git-scope-warn.log` and **always exits 0**. Verified end-to-end in a throwaway
repo: a commit staging an out-of-scope path on a scoped branch succeeded and was recorded.
