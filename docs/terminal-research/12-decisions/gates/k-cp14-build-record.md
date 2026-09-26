---
id: k-cp14-build-record
unit: K CP14
packet: packet-k-two-command-signing-gate
merges-after: K CP11
status: SIGNED (K CP14, fingerprint 66b3a2be3)
---

# K CP14 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  66b3a2be3
SCOPE APPROVED:   CP14 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP14 — `verify_manifest` learns to read a SIGNED row, instead of crashing on one.**
> Scope is `tools/verify_manifest.py` **as enumerated by `git show --stat` of this unit's
> commit.**

⛔ **Collision proof, three sources:** K's packet table declares **CP1–CP2**; build records
on disk top out at **k-cp11** (K CP12 is skipped — never claimed by any packet, build record,
or manifest row); manifest rows top out at **CP11**. **CP14 free**, per the owner's explicit
numbering (K CP13–15, built CP14 → CP15 → CP13).

---

## 1 · The crash, in one measurement (F-VERIFY-1)

`verify_manifest.check()` called `sign_gate.fingerprint(text)` — no span — on EVERY row,
unconditionally:

```
target_span(text)  raises SystemExit  "no UNSIGNED APPROVED AT SHA: line"
                    whenever every block in the packet already carries a fingerprint.
```

That `SystemExit` propagated uncaught through `check()` and `main()`. Measured 2026-09-17,
minutes after unit 1's packet was signed for the first time in this programme's history:

```
verify_manifest (fingerprints)         exit 1   (no line printed at all)
verify_manifest --check-commits        exit 1   (never reached — main() died first)
```

⛔ **`check_commits` is K CP8's commit-coverage proof** — the one this whole tool exists to
protect (`pre_sitting.py`'s own docstring: *"was correct throughout, and stopped being run —
because it was in no list"*). The moment ANYTHING was signed, it went dark again, from a
completely different cause than the one that darkened it before.

## 2 · The fix

`sign_all.py` already solved exactly this problem (`already_signed_as`,
`sign_gate.rederive_signed`) for its OWN read of a packet. `verify_manifest._row_state` now
asks `sign_gate.read_approval()` FIRST:

- **UNSIGNED** (0 or 1 blank block) → the ORIGINAL path, byte-identical: `fingerprint_text`
  is safe here because `target_span` has exactly one candidate.
- **SIGNED** (every block filled) → find every filled `APPROVED AT SHA:` line
  (`sign_gate._AT_ANY`, reused rather than a second regex), `rederive_signed` each one,
  and compare against the manifest's expected value: `SIGNED-OK` / `SIGNED-STALE` /
  `SIGNED-ELSEWHERE`.
- **MALFORMED** → reported, never guessed as either.

`main()` now runs `check()`, `check_resolutions()`, and (if requested) `check_commits()`
**each in its own `try/except`**, so a crash in any one is named and counted as a failure —
never lets the others go unreached. The exit code is the OR of all three, exactly as before,
now guaranteed regardless of what any single check does.

## 3 · Controls

```
CLEAN / DIRTY / EMPTY / never-this-doc's fixtures       -> unchanged, byte-identical    ok
K CP14 — a SIGNED row matching                          -> SIGNED-OK, exit 0            ok
  ...and check_commits() STILL RUNS right after it       -> SIGNED-OK + exit 0 (composed) ok
K CP14 — SIGNED then edited (owner-facing text only)     -> SIGNED-STALE, exit 1         ok
K CP8 fixtures (commit coverage, duplicates, UNREADABLE) -> unchanged                    ok
```

⚰️ **Two bugs were caught by running these controls, not by reading them.** (1) The first
version of the SIGNED-row fixture pre-filled `SCOPE APPROVED: CP1` in BOTH the "unsigned"
and "signed" states — but `rederive_signed` blanks FOUR fields (AT SHA, BY, ON, **and
SCOPE**, per K CP6 in `sign_gate.py`), so a scope filled before hashing produced a fingerprint
that could never re-derive, and the control read SIGNED-STALE on a packet that was never
edited. Fixed by matching the real template: every field blank until signed. (2) `show()`'s
own failure-report line, `"WRONG (want %s)" % want`, raised when `want` was a 2-element
tuple (one `%s` slot, two values) — the format string ate its own failure message. Fixed with
`% (want,)`.

## 4 · Files

```
tools/verify_manifest.py   _row_state (new), check() (rewritten), main() (hardened),
                           _self_check() (new SIGNED-OK/SIGNED-STALE + composition controls)
```

## 5 · Validators

```
ast.parse                              OK
verify_manifest.py --self-check        PASS (14 controls)
verify_manifest.py (real manifest)     55 OK, 0 STALE  (2 of them SIGNED-OK)
verify_manifest.py --check-commits     mapped: 48 of 48    <- runs again, for the first
                                        time since the first signature landed
pre_sitting.py                          both verify_manifest rows green
```

## 6 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-17 | SIGNING | 1 | K CP14: `verify_manifest` crashed the instant any packet was fully signed, because it called `sign_gate.fingerprint()` with no span unconditionally — the form that raises on a fully-signed block, by design. `check_commits` (K CP8's commit-coverage proof) went dark as collateral: `main()` died before ever reaching it. Fixed by asking `read_approval()` first and taking `sign_all`'s own SIGNED-aware path (`rederive_signed`) when every block is filled; `main()` now isolates each of its three checks in its own try/except so one cannot block the others. |

## 7 · Drafted RESUME delta — NOT applied

- ⛔ **A tool proved only from a cold start has not been proved for the state one signature
  later.** `verify_manifest` was correct for five sessions because nothing had ever signed
  anything real; the first real signature found the bug in minutes.
- ⭐ **A second tool solving the same problem is a fix waiting to be copied, not duplicated.**
  `sign_all.py` had already solved "how do I read a signed block's fingerprint" — the fix was
  reuse, not invention.
- ⛔ **Isolate every check in a runnable list.** One check's crash must never be the reason
  the others are never attempted.
