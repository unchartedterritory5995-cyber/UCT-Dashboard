---
id: k-cp9-build-record
unit: K CP9
packet: packet-k-two-command-signing-gate
merges-after: K CP8
status: UNSIGNED
---

# K CP9 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  439dfc4a7
SCOPE APPROVED:   CP9 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP9 — a dry run is a replay.** Scope is `tools/merge_all.py` **as enumerated by
> `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** K's packet table declares **CP1–CP2**; build records
on disk top out at **k-cp8**; manifest rows top out at **CP8**. **CP9 free.**

---

## 1 · ⚰️ TWICE, A DECLARED ORDER SATISFIED EVERY CONSTRAINT AND COULD NOT RUN

```
F-SIGN-4   36 of 36 constraints SATISFIED, units 44 of 44, exit 0
           -> STRAND at #12  e-cp6-build-record  0d7c55fb1
              conflicting: .github/workflows/full-suite-report.yml
F-SIGN-5   43 of 43 constraints SATISFIED, units 49 of 49, exit 0
           -> STRAND at #44  packet-t-stale-test-gate  76a3b98c2
              conflicting: app/src/pages/ThemeTrackerPage.flagkey.test.jsx
```

⛔ **Neither is visible to a constraint graph, and that is structural, not an oversight.** A
constraint graph describes **relative order**; a cherry-pick cares about **content**. "B
merges after A" can be satisfied by an order in which A's change to a file has not yet
established the context B's patch applies to — or in which the file B edits does not exist
yet at all.

⭐ **So `--dry-run` no longer describes the merge. It performs it.**

## 2 · What it does

```
clone CODE_REPO --shared --no-hardlinks into a temp dir
checkout -B merge-replay origin/master
cherry-pick every unit's commits, in manifest order
  on conflict -> print STRAND at #<n> <row> <sha> — conflicting: <files>
                 abort the pick, delete the throwaway, exit 1
  on success  -> print "replay CLEAN N of N"
delete the throwaway (in a `finally`, including on a strand)
```

⛔ **Order of output is load-bearing:** `replay CLEAN N of N` prints **first**, and the
constraint-pair check prints after it. The pair check is kept — it catches a *declared*
inconsistency the replay cannot distinguish from a content one — but it is now subordinate,
and "all constraints SATISFIED" can never again be the only thing a reader sees.

⛔ **A modify/delete conflict leaves no `UU` entry**, so the file list falls back to reading
`DU`/`UD`/`AU`/`UA` from `git status --porcelain`. Without that, F-SIGN-5's strand would have
been reported with `(unnamed)` — a strand you cannot act on.

## 3 · `#!last:` enforced by PROPERTY, not ordinal

Redefined this session (F-SIGN-5): the marked unit is the last **member-visible** one, alone
in its sitting, and rows after it must carry **zero member-visible files**.

```python
member-visible := a path under app/src/ that is not a test, spec, __tests__ member or story
```

`member_visible_files(stem)` derives it from each unit's commits and returns **None** when a
commit cannot be read — ⛔ **UNREADABLE is a third state**: a commit git cannot show is not a
commit with no member-visible files, and calling it clean is how a member-facing change
slips past the rule.

## 4 · ⚰️ A CONTROL THAT PASSED FOR THE WRONG REASON, CAUGHT BY PROBING IT

The old control moved F-S2-1 to position 0 and asserted `check_order` refused. Under the new
semantics it **still refuses** — but on the `#!after:` clauses its fixture drags along, not
on the `last` rule. Measured with `last` as the ONLY constraint over synthetic stems:

```
check_order(moved, [("last", S2, None)])  ->  []        the rule no longer fires
```

Synthetic stems have no file set, and the rule is about files now. **A control whose subject
has moved out from under it is not a control.** Replaced with four that exercise the new
meaning, one of which is the permission the redefinition exists to grant.

## 5 · Controls (5 replay + 4 `#!last:`)

```
1  the real tree                         replay CLEAN 46 of 46                     ok
2  F-SIGN-4's inversion restored          STRAND at #12 e-cp6, names the workflow   ok
3  F-SIGN-5's attribution restored        STRAND at #44 packet-t, names the file    ok
4  a member-visible row after #!last:     refused, NAMES all three files            ok
5  an EMPTY manifest                      "ZERO units … nothing to replay", exit 0  ok

a row after #!last: carrying member-visible files: refuses                          ok
...and NAMES them                                                                   ok
...but a TESTS-ONLY row after it is ALLOWED                                         ok   <- the point
an UNREADABLE follower is refused, not called clean                                 ok
the predicate can say YES (3 member-visible files in F-S2-1's own commit)           ok   <- non-vacuity
```

⭐ **Controls 2 and 3 are the two real incidents, restored as fixtures.** They are the only
rows that prove the replay can fail, and each names the exact position and file the live
strand named.

## 6 · Files

```
tools/merge_all.py   replay() · is_member_visible_path · member_visible_files ·
                     check_order(units=) · the `last` rule by property · the dry-run
                     ordering (replay, then constraints, then the timing table)
```

## 7 · Validators

```
ast.parse                     OK
merge_all --self-check        PASS, exit 0
merge_all --dry-run           replay CLEAN 46 of 46 · 44 constraints SATISFIED · 50 of 50
K9.2 five controls            PASS
exit codes captured from the process, never from a pipe
```

## 8 · Drafted ledger row — NOT written

| 117 | *(named in the session report)* | 2026-09-16 | SIGNING | 1 | K CP9: `merge_all --dry-run` now REPLAYS the merge onto a throwaway clone of the code repo and reports the first strand with its position, row and conflicting files, deleting the clone in a `finally`. Twice a declared order satisfied every constraint and could not run — F-SIGN-4 stranded at unit 11 on a workflow conflict, F-SIGN-5 at commit 44 on a modify/delete — and neither is visible to a constraint graph, which describes relative order while a cherry-pick cares about content. The pair check is kept but subordinate: "constraints SATISFIED" prints only after "replay CLEAN N of N". `#!last:` is enforced by a derived member-visible-file property rather than an ordinal. |

## 9 · Drafted RESUME delta — NOT applied

- ⛔ **A dry run that does not perform the thing is a description.** Twice this programme
  published "all constraints satisfied, exit 0" for an order that could not execute.
- ⛔ **A conflict report without file names is not actionable**, and modify/delete is exactly
  the case that produces none unless you go and look.
- ⭐ **When a rule's meaning changes, re-probe its controls rather than re-running them.**
  One here still went green while no longer testing the rule at all.
