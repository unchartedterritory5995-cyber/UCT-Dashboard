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
