---
id: k-cp4-build-record
unit: K CP4
packet: packet-k-two-command-signing-gate
merges-after: K CP3
status: UNSIGNED
---

# K CP4 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  35237823c
SCOPE APPROVED:   CP4 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP4 — a reader of a signature answers three states and never derives SIGNED from an
> absence.** `sign_gate.read_approval()` returns SIGNED / UNSIGNED / MALFORMED;
> `merge_all` consumes it and refuses an unsignable unit with a distinct exit code. Scope
> is `tools/sign_gate.py` and `tools/merge_all.py` **as enumerated by `git show --stat` of
> this unit's commit.**

⛔ **Collision proof.** `packet-k-two-command-signing-gate.md` declares `CP1` and `CP2`
only (lines 58–59); `CP3` is taken by `k-cp3-build-record.md`. **CP4 is free.** Checked
against the packet's own table before a line was written — the third time this session's
family of units has needed that check, and the first time it came back clean.

---

## 1 · The defect

`merge_all.is_signed()` asked `sign_gate.target_span()` for the unsigned block and treated
`SystemExit` as **signed**:

```python
try:
    sg.target_span(text)   # raises when there is NO unsigned block left
    return False
except SystemExit:
    return True            # <- "signed"
```

⛔ **`target_span` raises for TWO different reasons**, and its own message says so: *"no
UNSIGNED `APPROVED AT SHA:` line (every block already carries a fingerprint)"* is raised
both when every block is filled **and when there is no block at all.** The second case is
indistinguishable from the first at the call site, so **a document with no approval block
read as SIGNED.**

⭐ **This is the non-vacuity rule inside the one tool where a false positive is
unrecoverable.** An absence is not evidence. Everywhere else in this programme that rule
guards a measurement; here it guarded whether unapproved code reaches master.

**It was not hypothetical.** Measured 2026-09-15, two documents on disk are in exactly
that state:

| document | blocks | old `is_signed` | new reader |
|---|---|---|---|
| `packet-a-absent-bound-gate.md` | 0 | **True** | `UNSIGNED — no approval block at all` |
| `entity-master-pre-implementation-gate.md` | 0 | **True** | `UNSIGNED — no approval block at all` |

Packet A is the one that mattered: it ships three files in two commits, and the same
missing block also made `verify_manifest --check-commits` report them claimed by no unit
(**F-MERGE-1**). **One absent block produced both halves of the failure** — merge it
unapproved, or never merge it at all, depending on which tool you asked.

---

## 2 · ⛔ SIGNED IS A STATEMENT ABOUT FORM. THE COMMISSIONED DEFINITION WOULD HAVE BROKEN 30 APPROVALS.

The unit was commissioned as: *"SIGNED (block present, APPROVED AT SHA non-blank **and
equal to the recomputed fingerprint-with-blank**)."*

**Measured before implementing it — and it does not hold:**

| filled approval blocks on disk | 35 |
|---|---|
| re-derive from the CURRENT file | **5** |
| do **not** re-derive | **30** |

⛔ **The 30 are not corrupt; they are correct and expected.** `fingerprint()`'s own
docstring says a fingerprint pins the bytes the owner approved **at approval time**, so
*"a later edit elsewhere in the packet legitimately stops a fingerprint re-deriving from
the CURRENT file, and `git show <sha>:<file>` is how it is recovered."* Two blocks in
`intelligence-layer-pre-implementation-gate.md` also carry **40-character** hashes rather
than the 9-character form, so a strict equality test fails them on format alone.

**Implementing the definition as written would have declared 30 genuine owner approvals
invalid and made `merge_all` refuse every unit in the manifest.**

⭐ **So form and truth are two questions and they keep two tools.** `read_approval` asks
*"does a written approval exist, and is it well-formed?"* — answerable from the file alone.
`verify_manifest` asks *"is the fingerprint still true, and if not, at which commit was it
last true?"* — answerable only by walking history, which it already does. **Folding the
second into the first is what breaks the 30.**

---

## 3 · What the reader does

`read_approval(text) -> (state, reason)`:

- **UNSIGNED** — no block at all, **or** exactly one block awaiting a fingerprint.
- **MALFORMED** — a field count that disagrees with the block count (a block missing
  `APPROVED ON:`, or a duplicated `APPROVED BY:`), **or** more than one unsigned block
  (a signature could not say which checkpoint it covers).
- **SIGNED** — every block carries a fingerprint.

⚠️ **"Two blocks" is NOT malformed, and the commissioning text said it was.** Measured:
**13 of 35** gate documents carry 2–3 approval blocks, every one of them fully signed —
that is simply a packet whose checkpoints were approved on different days. Treating it as
MALFORMED would have condemned 13 correct documents. The malformed case is **two UNSIGNED
blocks**, which is the condition `target_span` already refuses with *"refusing to guess
which."*

### `merge_all`: exit 3, and why a plain UNSIGNED must not stop a dry run

`OK, FAIL, REFUSED, UNSIGNABLE = 0, 1, 2, 3`. A **structural** fault — MALFORMED, or no
block at all — is refused in **both** modes, because no signature can ever land on such a
document and previewing its merge is a preview of nothing. A plain **UNSIGNED** (block
present, awaiting a fingerprint) stops a real run and lets a dry run continue.

⛔ **That distinction is load-bearing and was nearly lost.** Before signing day **every**
unit reads UNSIGNED. Refusing the whole dry run on that would have destroyed the preview
the owner reads before trusting the sequence — the exact thing `merge_all`'s own
*"a dry run that stops at row 1 is not a preview"* comment protects.

---

## 4 · Controls — `python tools/sign_gate.py --read-check`

```
SIGNED: one filled block                               -> SIGNED     ok
UNSIGNED: one blank block                              -> UNSIGNED   ok
NO BLOCK AT ALL -> UNSIGNED, never SIGNED              -> UNSIGNED   ok
two FILLED blocks (13 real docs look like this) -> SIGNED -> SIGNED   ok
two UNSIGNED blocks -> MALFORMED                       -> MALFORMED  ok
one filled + one blank -> UNSIGNED                     -> UNSIGNED   ok
block missing APPROVED ON -> MALFORMED                 -> MALFORMED  ok
duplicated APPROVED BY -> MALFORMED                    -> MALFORMED  ok
the reader returns all three states (non-vacuity)      -> 3          ok
READ-CHECK: PASS
```

⛔ **The non-vacuity control is the one that matters**: a reader that answered a single
state for everything would pass seven of the eight fixtures above by accident. It asserts
the reader actually produces **three distinct** states.

**End-to-end control, before Packet A was given a block:** `merge_all --dry-run` with
`packet-a` injected at the head of `UNITS` exited **3**, naming it:

```
── packet-a-absent-bound-gate
    ⛔ UNSIGNED — no approval block at all (0 `APPROVED AT SHA:` lines)
    ⛔ UNSIGNABLE AS IT STANDS: packet-a-absent-bound-gate
    ⛔ STOPPED — nothing after this was attempted.
EXIT CODE: 3
```

`sign_gate --self-check` (the signing controls) still exits 0 — the reader is additive and
changed no signing behaviour.

---

## 5 · Census over the real corpus

35 gate documents · **48 approval blocks** · 35 filled · 13 blank ·
**SIGNED 20 / UNSIGNED 15 / MALFORMED 0**.

⭐ **Blocks ≠ packets, and both numbers are printed because conflating them is how the
count goes stale.** The declared reconciliation *"35 on disk + 1 external = 36"* is a count
of **filled blocks**, and it matches exactly. It is **not** a count of signed documents,
which is **20** — thirteen documents hold more than one block.

---

## 6 · Files, and the one-unit-one-commit proof

```
tools/sign_gate.py    (read_approval, _read_approval_check, --read-check)
tools/merge_all.py    (approval_state, _cannot_be_signed, UNSIGNABLE=3, call site)
```

**Docs worktree only — no commit on `feat/s7-price-level`, no watch-coverage strand.**

⚠️ `tools/merge_all.py` is also touched by the Packet A registration commit, which adds one
`UNITS` row. **The overlap is a shared registry, not a bundle**: this unit changes the
file's LOGIC, that one adds a DATA row. Stated rather than claimed as disjoint.

---

## 7 · Drafted ledger row — NOT written

| 80 | *(docs-only)* | 2026-09-15 | Process | 1 | K CP4: `is_signed()` derived SIGNED from an absence, so a document with no approval block read as signed — two such documents exist on disk and one ships three files. Replaced with a three-state reader (SIGNED/UNSIGNED/MALFORMED); `merge_all` exits 3 on an unsignable unit. The commissioned definition of SIGNED ("re-derives now") was measured against the corpus first and rejected: only 5 of 35 filled blocks re-derive, so it would have invalidated 30 genuine approvals. |

## 8 · Drafted RESUME delta — NOT applied

- A reader of a signature answers **three** states. `--read-check` is the gate.
- **Form and truth are different questions.** `read_approval` = form; `verify_manifest` =
  truth, by walking history. Do not merge them.
- ⛔ `entity-master-pre-implementation-gate.md` still has **no approval block**. It ships no
  commits today, so nothing is blocked — but it cannot be signed as it stands. Filed as
  **F-SIGN-2**, not fixed here.
