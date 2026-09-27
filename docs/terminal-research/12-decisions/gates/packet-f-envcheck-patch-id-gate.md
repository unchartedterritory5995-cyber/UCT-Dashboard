---
id: PACKET-F
title: F-ENVCHECK-1 — check 1 tests ancestry, this programme publishes by cherry-pick — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET F — the env-check false STOP

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner), via Claude Chat middleman
APPROVED ON:      2026-09-23
APPROVED AT SHA:  e6b463cbf
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs
> `tools/terminal_next_env_check.py`. **Non-collision:** `PACKET-F` appears nowhere in
> either worktree (checked before writing this file, the same way `PACKET-E` and
> `PACKET-T` checked before them).

⛔ **ZERO PRODUCT CODE.** One tool file (~165 lines), plus its own `--self-check`. It
changes no member-facing behaviour, touches no `api/**` or `app/**` path, and blocks
nothing currently running.

---

## 1 · The finding, as registered (COMPLETION_AUDIT.md §3.1c, F-ENVCHECK-1)

`tools/terminal_next_env_check.py::check_tree` decides "is this tree published" with
`git merge-base --is-ancestor HEAD <publish-ref>` — pure **ancestry**: is every commit
on HEAD reachable from the ref by descent.

`feat/s7-price-level` does not publish that way. Per RESUME.md §0 and this repo's own
established practice this whole session, code lands on `origin/master` via
**cherry-pick** through the `_merge-master` worktree (branch `merge-run`) — so a commit
authored on `feat/s7-price-level` reaches master under a **different SHA** carrying the
same patch. Ancestry answers "no" to that shape by construction, every time, forever —
not intermittently.

**Measured 2026-09-21**, from `feat/s7-price-level`:

| measurement | result |
|---|---|
| `tools/terminal_next_env_check.py` exit code | **1 (FAIL)**, printing `10 unpublished commits` |
| `git cherry origin/master HEAD` | **77 `-`** (already on master under another SHA) **/ 2 `+`** |
| of the 10 commits the tool named | **9 are `-`** (false positives) · **1 (`87b5735f4`) is a genuine `+`** |

So the check is not merely noisy — it cannot currently distinguish "everything is
published" from "one real commit is missing," because it reports FAIL either way. §1 of
the weekly autonomous run's own prompt treats a FAIL as a full STOP, so this tool would
have refused to start the run on **every clean Saturday** this branch has cherry-picked
onto master, while simultaneously being unable to raise the alarm on the one case
(`87b5735f4`, F-S7-RC-3) that was genuinely unpublished at the same time.

⭐ **The mirror-image bug, already fixed once.** `terminal_next_env_check.py`'s own
docstring records the 2026-09-14 predecessor defect: comparing against
`origin/<branch>` OVER-counted published work as unpublished because that ref is stale
once a branch starts pushing straight to master. This finding is the same false-STOP
failure mode from the opposite direction — ancestry UNDER-recognizes cherry-picked work
as published. Both are the tool answering "is this commit's SHA where I expected it,"
when the actual question is "is this commit's PATCH somewhere already."

---

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | `check_tree()` tries `merge-base --is-ancestor` FIRST (cheap, the common case — most trees really are simple fast-forwards); if and only if that says NO, fall through to a `git cherry <ref> HEAD` read and PASS when every line is a `-`, FAIL (naming the `+` commits) when any line is a `+`. The existing PASS/FAIL/UNREADABLE three-state contract, and every existing UNREADABLE branch (unresolvable ref, undeclared branch, git not on PATH, a genuinely dirty tree), are UNCHANGED — this only touches the one branch that currently conflates "not-an-ancestor" with "not published." | none | **S** |

### ⛔ Ancestry stays the fast path — only the fall-through changes

Per COMPLETION_AUDIT.md's own "closes when" text for this finding, verbatim: *"check 1
compares by patch-id (`git cherry`), keeps the UNREADABLE-vs-FAIL split, and carries a
control proving a genuinely unmerged commit still FAILS."* This proposal builds exactly
that, no more:

- **Do not replace the ancestry check.** It is correct and cheap for the ordinary case
  (a tree fast-forwarded or merged normally) and running `git cherry` unconditionally
  would cost a patch-id computation over the ref's full history on every invocation for
  no benefit in that case.
- **`git cherry <ref> HEAD` output, line-by-line**: a leading `-` means a commit with
  equivalent patch content already exists in `<ref>` (published under another SHA); a
  leading `+` means no equivalent patch exists anywhere in `<ref>` (genuinely absent).
  All `-` (including zero lines) → PASS. Any `+` → FAIL, naming the `+` commits' short
  SHA and subject line (mirrors the existing ancestry-FAIL detail format).
- **UNREADABLE is preserved exactly where it already fires** — an unresolvable ref, an
  undeclared branch, a dirty tree, or `git cherry` itself erroring (non-zero exit with a
  reason `_git` can report) all stay UNREADABLE, never silently reinterpreted as FAIL or
  PASS. `git cherry` succeeding with a non-empty stderr but exit 0 is treated as success
  (git's own convention); a non-zero exit is UNREADABLE.
- **New self-check case**: a synthetic repo where a commit is cherry-picked onto the
  declared publish ref under a NEW SHA (same tree/message, different commit id) must
  read PASS under the fixed check — proving the false-STOP this finding names is
  actually gone — alongside the EXISTING self-check case (a genuinely unpushed commit,
  never cherry-picked anywhere) which must still read FAIL, so the fix cannot be
  verified by simply making everything pass.
- **No change to `PUBLISH_REF`, `TREES`, the CLI surface, or the exit-code contract**
  (`0/1/2` unchanged).

### Risk

**Low.** This tool has exactly one caller context (a manual/scheduled read at the top of
the weekly autonomous run's own checklist) and zero automated gate depends on its exit
code today — a FAIL here is read by a human, not enforced by CI. The change is additive
to one function's fall-through branch; every existing passing case (ancestry says YES)
is untouched, and every existing UNREADABLE case is untouched. The only behavior that
changes is: a tree that is NOT an ancestor of its publish ref, purely because its
commits were cherry-picked there under other SHAs, now reads PASS instead of a
false FAIL — and a tree with a genuinely unpublished commit still reads FAIL, now
correctly distinguished from the false-positive case instead of being lumped in with it.

### MUST-BUILD, exactly

1. `check_tree()`: on `merge-base --is-ancestor` returning "not an ancestor" (exit 1,
   not another code), run `git cherry <ref> HEAD` before concluding FAIL.
2. Classify every returned line: `-` = contained (already published under another SHA),
   `+` = genuinely absent. Zero `+` lines → PASS with a detail string naming the
   fast-forward-vs-cherry-pick distinction (e.g. "HEAD's N commit(s) are all already on
   `<ref>` under different SHAs"). One or more `+` lines → FAIL, naming each `+`
   commit's short SHA and subject (same shape as the existing "unpublished commits"
   detail string).
3. `git cherry` erroring (non-zero exit, or the underlying `_git` helper's own error
   paths) → UNREADABLE, with the same "could not be measured" framing the rest of the
   tool already uses — never silently treated as FAIL.
4. Extend `_self_check()` with the cherry-picked-onto-new-SHA case described above,
   run alongside (not instead of) the two existing cases (contained, genuinely
   unpushed) and the undeclared-branch case.
5. Update this file's own module docstring to record the fix the same way it already
   records the `origin/<branch>` predecessor defect — one paragraph, dated, citing this
   packet.

Nothing else. No change to any other tool, no change to any scheduler wiring, no change
to `api/**` or `app/**`.
