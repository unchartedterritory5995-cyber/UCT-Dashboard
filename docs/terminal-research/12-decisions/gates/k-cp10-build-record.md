---
id: k-cp10-build-record
unit: K CP10
packet: packet-k-two-command-signing-gate
merges-after: K CP9
status: UNSIGNED
---

# K CP10 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  65104478d
SCOPE APPROVED:   CP10 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP10 — signing is the last act before *that unit's* merge.** Scope is
> `tools/merge_all.py` and `tools/sign_all.py` **as enumerated by `git show --stat` of this
> unit's commit.**

⛔ **Collision proof, three sources:** K's packet table declares **CP1–CP2**; build records on
disk top out at **k-cp9**; manifest rows top out at **CP9**. **CP10 free.**

⚠️ **Recorded late.** The change shipped in docs commit `1e10fd0d7` with **no record and no
row** — the same "work with no signable checkpoint" shape as F-SIGN-1, in the session that
found F-SIGN-1. Written now rather than left implicit.

---

## 1 · Why

`merge_all` now signs each row **immediately before cherry-picking it**, inside the unit loop.

⛔ Signing every row up front invites a strand on an **already-signed** unit — and a signature
is pinned to the packet's content, so the fix would mean editing a signed row. Master moves
roughly hourly here; F-MERGE-2 was exactly that shape, at unit 41 of 47.

⭐ **Signing per unit makes a strand hit an UNSIGNED row by construction.** The fix is then
always a resolution beside the commit, never a re-signature.

## 2 · Two details that carry weight

⛔ **The delegation is re-checked PER UNIT**, not once per run. A four-hour run can outlive its
authority, and the authority is a file that can change under it.

⛔ **The scope is DERIVED from the manifest's checkpoint cell** — the same cell `sign_all`
reads — so the two tools cannot disagree about what a row authorises.

## 3 · ⚰️ ITS OWN CONTROL CAUGHT A BUG THAT HAD ALREADY SIGNED A REAL PACKET

`sign_one` ignored the packet it was handed and signed the path from the manifest row. The
fixture stayed `UNSIGNED` while the **real** `k-cp3-build-record.md` was signed — delegated
by-line, scope `CP3 ONLY`, outside any merge. **The run reported success either way.**

Restored from the committed blob by **writing bytes** (never `git checkout`), verified
`UNSIGNED`, `52 OK / 0 STALE`, `.scopes/` removed. **F-SIGN-19.**

⭐ The whole argument for controls in one incident: invisible to the tool's own output, and
review would have read the code as correct.

## 4 · Controls (8)

```
sign_one precedes the cherry-pick IN THE LOOP (AST, not grep)      ok
...in the same loop                                                ok   <- non-vacuity
the fixture starts UNSIGNED                                        ok   <- non-vacuity
sign_one signs THE PACKET IT WAS GIVEN                             ok
...the fixture now reads SIGNED                                    ok
...scope derived from the manifest cell                            ok
...by-line is the DELEGATED one                                    ok
⛔ THE REAL PACKET IS UNTOUCHED                                     ok   <- exists because of F-SIGN-19
```

## 5 · Files

```
tools/merge_all.py   sign_one · _manifest_row · _et_today · DELEGATED_BY ·
                     the per-unit sign step inside the merge loop
tools/sign_all.py    delegation_state + the exit-5 gate (recorded under K CP10's scope)
```

## 6 · Drafted ledger row — NOT written

| 118 | *(this unit's commit — named in the session report)* | 2026-09-17 | SIGNING | 1 | K CP10: `merge_all` signs each row immediately before cherry-picking it, so a strand always hits an UNSIGNED row and its fix never has to touch a signature. The delegation is re-checked per unit (a long run can outlive its authority) and the scope is derived from the manifest's checkpoint cell. Its own control caught F-SIGN-19: `sign_one` signed the manifest's path rather than the packet it was handed, signing a real packet during a fixture run — restored from the committed blob, and the control row "THE REAL PACKET IS UNTOUCHED" exists because of it. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **Sign as late as possible.** A signature is the one artifact a later fix cannot edit.
- ⛔ **A fixture must never be able to reach a real artifact**, and the control that proves it
  belongs in every signing rail.
- ⭐ **Re-check an authority per use, not per run**, when the run is long enough for the
  authority to change.
