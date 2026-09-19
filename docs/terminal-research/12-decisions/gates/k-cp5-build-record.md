---
id: k-cp5-build-record
unit: K CP5
packet: packet-k-two-command-signing-gate
merges-after: K CP4
status: SIGNED (K CP5, fingerprint 137378730)
---

# K CP5 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  137378730
SCOPE APPROVED:   CP5 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP5 — the signing session survives an interruption, and the deploy wait can
> block.** Neither script could be run twice, and `merge_all`'s wait for a web deploy
> could not fail. Scope is `tools/sign_gate.py`, `tools/sign_all.py` and
> `tools/merge_all.py` **as enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof, three sources:** `packet-k-two-command-signing-gate.md` declares
**CP1–CP2** (lines 58–59); build records on disk are **k-cp3, k-cp4**; manifest rows are
**CP1,CP2 · CP3 · CP4**. **CP5 free.**

---

## 1 · Why this exists at all

The owner's readiness question was *"prove both scripts are idempotent."* They are not,
and the proof is the point of this unit. **Nothing here was inferred from reading the
code** — every claim below is a command and its output.

## 2 · ⛔ DEFECT 1 — `sign_all.py` could not be run a second time

Two fixture packets, signed by `sign_all` itself, then the **same command again**:

```
[sign-all] rows: 2   signature date: 2026-09-15 (from the ET authority)

⛔ no UNSIGNED `APPROVED AT SHA:` line (every block already carries a fingerprint).
Re-signing would destroy a historical value — add the new approval block first, then sign.
exit=1
```

That is `sign_gate.target_span` raising out of **PASS 1's** `fingerprint_of`, through
`main()`, **before a single row was classified**. ⭐ The refusal is right; the blast radius
was wrong. A run interrupted at unit 12 of 36 could not be resumed — the owner would have
had to hand-edit the manifest, at the point in a three-hour session when hand-editing a
manifest is least safe.

**Fixed** by asking what state the packet is in *before* asking for its fingerprint. A
verified already-signed row reads `SIGNED-ALREADY` and is skipped.

## 3 · ⛔ DEFECT 2 — a signed packet could not re-derive its own fingerprint

Found while building defect 1's verification, and it is the larger of the two:

```
the packet sign_all signed 3 minutes earlier, untouched since:
   stored c9904433a   fingerprint(text, span) c4152be4b   DOES NOT re-derive
every signed block in the gates tree:
   re-derives: 5    does not: 30
```

`sign()` computes the hash **before** it writes `APPROVED BY:` and `APPROVED ON:`, and
those bytes are inside the hash. `sign_gate.py`'s own docstring calls that round trip
*"the only way an approval can be checked after the fact."*

⭐ **The value being pinned is right and the READER was wrong.** A fingerprint pins the
bytes the owner read — the packet with an empty approval block — not the bytes after the
signature was stamped in. So `rederive_signed()` blanks all three written fields, and it
comes back:

```
probe-signed.md    manifest c9904433a   blank-all-three c9904433a   RE-DERIVES
probe-control.md   manifest e35593e5d   blank-all-three e35593e5d   RE-DERIVES
```

⛔ **`fingerprint()` IS UNCHANGED.** Changing what is hashed would re-date every approval
in the tree and invalidate all 36 manifest fingerprints in one commit. This adds a
reader, not a format.

## 4 · ⛔ DEFECT 3 — `merge_all.py` could not be run a second time either

There was no merged-state check of any kind. Measured in a throwaway repo:

```
git cherry-pick <already-applied>  ->  exit 1
  "The previous cherry-pick is now empty, possibly due to conflict resolution."
  ...and .git/CHERRY_PICK_HEAD is left behind, so the NEXT run dies before it starts.
```

**Fixed** by reading **master**, never the manifest:

```
git merge-base --is-ancestor <merged commit>   origin/master  ->  exit 0   skip it
git merge-base --is-ancestor <unmerged commit> origin/master  ->  exit 1   still to do
```

⛔ A unit **partially** on master is REFUSED, not papered over. ⛔ A fetch that fails
makes the merged state **UNREADABLE**, which is not "not merged" — guessing there
re-merges a unit.

## 5 · ⚠️⚠️ DEFECT 4 — THE DEPLOY WAIT COULD NOT FAIL

`wait_for_success` was `'"SUCCESS"' in out` over the raw JSON of
`railway deployment list`. **That list is history.** Measured live, with no deploy of
ours anywhere in it:

```
rows returned: 20   statuses: {'SUCCESS': 1, 'REMOVED': 19}
merge_all predicate  '"SUCCESS"' in out  ->  True
```

The single SUCCESS is the deployment **currently serving** — the previous one. So the
wait returned on its first poll, every time, and the whole guarantee collapsed to
`sleep(150)` against a build measured at **~186 s** the same afternoon.

⭐ **The consequence is not a member outage — the Layer-0 guard catches it — it is an
ABORTED SESSION.** The guard REFUSES while the latest deployment is not SUCCESS or is
younger than its 150 s settle, so unit 2's push is refused, `merge_all` stops, and
(before §4) could not be resumed. **Defect 4 is what would have made defect 3 fire, on
the owner's first attempt, at unit 2 of 36.**

**Fixed:** the deployment is found by **our commit hash**; SUCCESS settles, FAILED /
CRASHED / REMOVED stops and names the status, and a timeout says UNREADABLE is not
SUCCESS.

## 6 · Controls

```
sign_all, RESUME: both rows already signed          -> SIGNED-ALREADY x2, exit 0
sign_all, PARTIAL: row 1 signed, row 2 fresh        -> skip + SIGNED,     exit 0
sign_all, EDITED AFTER SIGNING                      -> SIGNED-DRIFTED,    exit 2
sign_all, manifest names a different value          -> SIGNED-ELSEWHERE,  exit 2
sign_gate CONTROL 7: a signed packet re-derives     -> ok
  ...and a one-byte body edit moves the value       -> ok  (not a tautology)
  ...and fingerprint() must STILL not re-derive     -> ok  (or delete rederive_signed)
merge_all: the OLD predicate fires on a stranger    -> True   (the control)
  ...and the row lookup does not find our commit    -> None
  ...and DOES find it when present                  -> SUCCESS (non-vacuity)
  ...a BUILDING row is found and is not SUCCESS     -> BUILDING
  ...unreadable JSON is NOT FOUND, never a pass     -> None
git merge-base --is-ancestor, both directions       -> 0 and 1
```

⛔ **Mutation, restored by EDIT:** blanking `APPROVED BY:` with `_H` (which matches only
an *empty* field) turns `rederive_signed` into a silent no-op — CONTROL 7 goes RED with
*"a signed packet does not re-derive"*, exit 1. Restored, PASS.

## 7 · Files

```
tools/sign_gate.py     (rederive_signed + _FILLED + CONTROL 7)
tools/sign_all.py      (state-before-fingerprint, SIGNED-ALREADY, skip, counts)
tools/merge_all.py     (merged_into_master, wait_for_deploy, _deployment_for_sha)
tools/sign_manifest.txt                      (this unit's row + its #!after constraint)
docs/terminal-research/SIGNING_SESSION.md    (the runbook these controls are pasted into)
```

⚠️ **FILED, NOT FIXED — `--scope-file` IS INERT.** `sign_gate.sign()` takes a `scope`
argument and never reads it; an AST over the function reports `scope NEVER READ` with
`by` and `on` as the positive control. So all 37 approvals will carry a **blank**
`SCOPE APPROVED:` line while the scope text sits in an untracked `.scopes/*.txt` — and
three signed blocks in the tree already look like that. ⛔ **Not fixed in this unit
deliberately:** writing the scope changes the packet's bytes, and those bytes are what
every manifest fingerprint pins, so the fix re-fingerprints all 37 rows in one commit.
That is a decision about the approval format, which belongs to the owner.

## 8 · Validators

```
sign_gate --self-check          -> PASS, exit 0
sign_gate --read-check          -> PASS, exit 0
merge_all --self-check          -> PASS, exit 0 (14 rows)
sign_all  --dry-run  (real)     -> 37 rows, 37 ok, 0 refusing, exit 0
merge_all --dry-run  (real)     -> 37 units, 29 constraints, 0 already merged, exit 0
```

⛔ Both dry-runs were re-run **after** this unit's own manifest row was added — 36→37
rows, 28→29 constraints — because a validator run that predates the row it must validate
is a validator run of a different manifest.

## 9 · ⚠️ PREDICTION for the owner's signing session

| field | prediction |
|---|---|
| `sign_all` signs | **37 of 37**, exit 0 |
| a re-run straight after | **37 SIGNED-ALREADY**, exit 0, nothing written |
| `merge_all` pushes | **31** units (6 are docs-only) |
| wall time | **2 h 30 m – 3 h 00 m** with an empty deploy queue |
| the guard REFUSES at least once | **yes** — 8+ web deployments landed from other sessions in one 2.5 h window today |
| a resume is needed | **more likely than not**, and it now costs one re-run |

## 10 · Drafted ledger row — NOT written

| 103 | *(the docs commit carrying this record — named in `SESSION_REPORT_2026-09-15_5.md`, because a record cannot contain the hash of the commit that contains it)* | 2026-09-15 | TOOLING | 1 | K CP5: neither signing script could be run twice — `sign_all` died in PASS 1 before classifying a row, `merge_all` re-cherry-picked unit 1 and left CHERRY_PICK_HEAD behind. Both are now resumable, `merge_all` reading master rather than the manifest. And the deploy wait could not fail: `'"SUCCESS"' in out` matched the deployment already serving, so a 36-unit session would have been refused by the Layer-0 guard at unit 2. The wait now follows our own commit hash. A signed packet also re-derives its fingerprint again — 30 of 35 did not. |

## 11 · Drafted RESUME delta — NOT applied

- ⛔ **"Can it be run twice?" is a question you answer by running it twice.** Both
  scripts read as idempotent and neither was.
- ⛔ **A wait that accepts "something succeeded" is a sleep.** Name the thing you are
  waiting for — here, our own commit hash — or the assertion cannot fail.
- ⛔ **Ask what state a document is in BEFORE asking for a value that presumes a state.**
  PASS 1 asked for a fingerprint and got an exception that ended the run.
- ⭐ **A round trip that is documented as the only way to check something is worth
  actually running once.** 30 of 35 approvals in this tree did not close it.
