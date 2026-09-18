---
id: k-cp15-build-record
unit: K CP15
packet: packet-k-two-command-signing-gate
merges-after: K CP14
status: UNSIGNED
---

# K CP15 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> **K CP15 — member-visible is DERIVED, comment-stripped, and reads the same authority as
> `#!last:`.** Scope is `tools/merge_all.py` **as enumerated by `git show --stat` of this
> unit's commit** (built together with K CP13; see §4 for the shared-commit note).

⛔ **Collision proof:** K's packet table declares CP1–CP2; build records top out at k-cp14
(this session); manifest rows top out at CP14. **CP15 free.**

⚠️ **Built BEFORE K CP13, per the owner's explicit permission** ("if simpler, build CP15
before CP13"): CP13's `--batch` boundary decision needs exactly this derivation, so building
it first avoided writing the batch logic against a function that didn't exist yet.

---

## 1 · F-MV-1, closed

Two authorities on "is this unit member-visible" existed with nothing comparing them: the
merge gate read a **hand-typed boolean** in the `UNITS` tuple; `#!last:` **derived** it from
the file set. They disagreed on exactly one row:

```
row 51  d3-cp2-build-record   flag=False   derived (old rule)=True
        af9fe21a6 touches app/src/lib/barsStreamManager.js:
          -export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py pairs[:50]
          +export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py MAX_BARS_PAIRS
```

The value is unchanged; only a comment's own text cites a name instead of a literal. On this
row the FLAG was right and the OLD derived rule — pure path shape — was over-broad.

## 2 · The fix — two changes, not one

**(a) Comment-stripped diffs.** `_is_comment_only_change(sha, path, repo)` diffs the file
(`git show --unified=0`), strips a trailing `//...`/`#...` comment from every changed line
CONSERVATIVELY (`_strip_line_comment`: a marker counts only when preceded by whitespace or at
line-start — `http://`'s `//` is preceded by `:`, never whitespace, so a URL is never
mistaken for a comment start; no special case needed), and compares the two sides as a
MULTISET of stripped, non-blank lines. An extension this function does not know (anything
outside `.js/.jsx/.ts/.tsx/.py`) is NEVER comment-only — fail toward member-visible, never
away from it.

**(b) The surface list grew.** `is_member_visible_path` checked only `app/src/`. K CP15 adds
`api/routers/` — the layer that actually mounts an HTTP endpoint a member's browser reaches
(CLAUDE.md's own architecture section). Without it, `api/routers/stream.py` was never even a
CANDIDATE for the check, no matter what it changed.

⭐ **Consequence, surfaced rather than suppressed:** `d3-cp2-build-record`'s SAME commit
(`af9fe21a6`) touches `api/routers/stream.py` with a REAL change (an inline `pairs[:50]`
becomes a named `MAX_BARS_PAIRS` constant) — under the new rule this row IS member-visible,
which the old hand-flag never caught. It now pushes alone, like F-S2-1, with
`--include-member-visible`. This is a genuinely new finding this fix surfaced, not a defect
in the fix.

## 3 · Controls

```
row 51's REAL commit af9fe21a6, used as its own control (three cases, one commit):
  barsStreamManager.js comment-only hunk       -> NOT member-visible                  ok
  api/routers/stream.py's real change          -> member-visible (K CP15 expansion)   ok
  the new test file                            -> excluded by the test marker either way ok
F-S2-1's real commit — untouched by stripping   -> still all 3 files, byte-identical  ok
fixture: comment-only api/routers/ edit         -> comment-only=True                  ok
fixture: a real one-line code change            -> comment-only=False                 ok
member_visible_files on both fixture rows       -> empty set / the one real file      ok
```

## 4 · Files

```
tools/merge_all.py   _MEMBER_SURFACE_ROOTS, is_member_visible_path (expanded),
                     _strip_line_comment, _diff_lines, _is_comment_only_change (new),
                     member_visible_files (comment-aware)
```

⚠️ **Shared commit with K CP13.** Both checkpoints landed as edits to the same file in one
continuous session of work — K CP13's `--batch` logic calls this checkpoint's
`member_visible_files` directly, so the two were never in a state where one existed without
the other. Two build records, one commit; each documents its own concern. `commits: []` in
`UNITS` for both rows regardless (docs-worktree checkpoints carry no code-repo commit sha).

## 5 · Validators

```
ast.parse                     OK
merge_all.py --self-check     PASS (all controls above, plus every pre-existing one)
```

## 6 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-17 | SIGNING | 1 | K CP15: the member-visible merge gate read a hand-typed boolean while `#!last:` derived the same property from the file set, and they disagreed on row 51 (a comment-only rename). Fixed by deriving member-visibility everywhere from ONE comment-stripped function, and by adding `api/routers/` to the surface list alongside `app/src/` — which surfaces `d3-cp2-build-record`'s real API change as newly member-visible, a genuine finding rather than a defect. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **A path-shape rule and a behavior rule answer different questions.** "Is this file the
  kind of file that CAN be member-visible" and "did this commit actually change what a
  member sees" are two gates, and collapsing them into one lost the second question entirely.
- ⭐ **A derivation that surfaces an uncomfortable new finding is working, not broken.**
  d3-cp2 newly requiring `--include-member-visible` is the fix functioning as designed, not
  a regression to explain away.
