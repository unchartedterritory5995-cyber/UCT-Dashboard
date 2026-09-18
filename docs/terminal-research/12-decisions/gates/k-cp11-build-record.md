---
id: k-cp11-build-record
unit: K CP11
packet: packet-k-two-command-signing-gate
merges-after: K CP10
status: UNSIGNED
---

# K CP11 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  6038494bd
SCOPE APPROVED:   CP11 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP11 — a strand is resolved from a recorded resolution, keyed by pre-images.** Scope is
> `tools/merge_all.py` and `tools/verify_manifest.py` **as enumerated by `git show --stat` of
> this unit's commit.**

⛔ **Collision proof, three sources:** K's packet table declares **CP1–CP2**; build records on
disk top out at **k-cp10**; manifest rows top out at **CP10**. **CP11 free.**

---

## 1 · Why, in one measurement (F-MERGE-3)

A commit is a **tree**; a cherry-pick applies a **patch**. Rewriting a unit's commit so its
tree matches a moved base makes its patch carry the base's own change:

```
feat's tests/conftest.py at #41^ : 302 lines
master's                         : 342 lines   (master has 40 feat lacks)
-> the rewritten patch = master's 40 lines + the unit's 45, and cherry-picking that
   onto master RE-APPLIES a change already there.
```

⭐ **So the fix cannot live in the commit. It lives beside it, as a recorded artifact applied
at merge time** — rerere with a proof attached.

## 2 · The mechanism

```
docs/terminal-research/resolutions/<row>--<path-slug>.md
  row · path · unit commit · master pre-image · unit pre-image · resolved blob · content
  + the additive proof, the mutation proof, and the replay result with base SHA
```

On a conflict `merge_all` computes **both** actual pre-image blob hashes
(`git rev-parse <base>:<path>` and `<unit-sha>:<path>`) and applies a resolution **only when
both match exactly**. Otherwise `STRAND-UNRESOLVED`, naming recorded-vs-actual.

⭐ **Keying on the BLOB, not the commit, is what makes a resolution survive master moving.**
Measured this session: master went `f86c3759e` → `e50c0552d` and `tests/conftest.py` **did
not change** — same blob `f4193ea6a` — so the record stayed valid across a base change
without being touched. That is the distinction the mechanism exists to draw: *master moved*
versus *master moved this file*.

⛔ **The unit's own commit is never rewritten.** `304ac481c` keeps its SHA and its patch-id.
No force-push.

## 3 · Controls (5 + 4, and the real-packet assertion)

```
1 matching resolution                    -> CLEAN, "1 resolution applied: <file>"     ok
2 master pre-image off by ONE BYTE       -> STRAND-UNRESOLVED                         ok
  ...and it NAMES the mismatch (recorded vs actual)                                   ok
3 no resolution at all                   -> plain STRAND naming the file              ok
4 recorded resolved-blob != content      -> REFUSED-CORRUPT-RESOLUTION                ok
5 no conflict, resolution present        -> not applied, count 0                      ok   <- non-vacuity

verify_manifest.check_resolutions:
  the real folder                        -> 0
  a resolution naming an UNKNOWN row     -> 1, named
  a CORRUPT resolved-blob hash           -> 1, named
  an EMPTY folder                        -> 0, and "0 parsed" printed

⛔ EVERY REAL PACKET'S HASH IS UNCHANGED  -> []  (74 packets hashed before and after)
```

⭐ **Row 5 is what stops this being a rubber stamp**: a mechanism that applied its resolution
whether or not there was a conflict would satisfy rows 1–4 and quietly overwrite a file on
every clean pick.

⚰️ **Two of these controls could not fire as first written, and both were caught by running
them, not by reading them:**

- `check_resolutions` loaded a **fresh** `merge_all` per call, so redirecting the caller's
  copy reached nothing and the unknown-row control returned 0. Made injectable.
- `REFUSED-CORRUPT-RESOLUTION` fired on its **first real run** because the record's `content`
  line carried trailing prose after the filename. ⛔ Fixed by tightening the **record**, not
  by loosening the parser — a parser that tolerates prose is how CODE-NEVER-PROSE gets lost.

## 4 · Files

```
tools/merge_all.py         read_resolutions · resolution_for · _blob_hash ·
                           the conflict branch that applies one · CORRUPT_RESOLUTION ·
                           the CLEAN line naming resolutions applied
tools/verify_manifest.py   check_resolutions (injectable), wired into main()
```

## 5 · Validators

```
ast.parse                        OK (both files)
merge_all --dry-run              replay CLEAN 47 of 47 onto origin/master (e50c0552d)
                                 (1 resolution applied: e-cp28-build-record--tests-conftest-py.md)
verify_manifest                  52 OK, 0 STALE · resolutions: 1 parsed, 0 corrupt
merge_all --self-check           PASS
```

## 6 · Drafted ledger row — NOT written

| 119 | *(this unit's commit — named in the session report)* | 2026-09-17 | SIGNING | 1 | K CP11: a strand is resolved at merge time from a recorded resolution keyed by BOTH pre-image blob hashes, never by rewriting the unit's commit (F-MERGE-3: a commit is a tree, a cherry-pick is a patch, so a commit rewritten to fit a moved base carries the base's own change). Keying on the blob rather than the commit is what let the conftest resolution survive master moving `f86c3759e` → `e50c0552d` untouched — the file's blob was unchanged. A pre-image mismatch is STRAND-UNRESOLVED; a resolved-blob hash that disagrees with its content is REFUSED-CORRUPT-RESOLUTION, never silently absent. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **Key a cached resolution on the CONTENT it was proven against, not the commit.** Bases
  move constantly; files move rarely, and only the second invalidates a proof.
- ⛔ **Corrupt must not read as absent.** The two states have opposite remedies and the same
  silence.
- ⭐ **Include the "no conflict → not applied" row.** Without it, a mechanism that always
  overwrites passes every other control.
