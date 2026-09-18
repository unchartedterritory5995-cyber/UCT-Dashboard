---
id: k-cp20-build-record
unit: K CP20
packet: packet-k-two-command-signing-gate
merges-after: K CP18
status: UNSIGNED
---

# K CP20 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-17)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  51c47081a
SCOPE APPROVED:   CP20 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **K CP20 — F-ATTEST-ISO-1.** Scope is `tools/merge_all.py`
> **as enumerated by `git show --stat` of this unit's commit.**

⛔ **Collision proof:** build records top out at k-cp19 before this session's K CP18 build;
K CP20 is the first free number after K CP18. **CP20 free.**

---

## 1 · F-ATTEST-ISO-1 — the first real attestation this session hit was REJECTED

The first genuine BURST refusal this session actually encountered (pushing
`d3-cp2-build-record`, 2026-09-18 ~01:33 ET) attested under R-ATTEST and the
attestation was **rejected outright** by `pre_push_guard.py`'s own `read_attestation()`:

```
UCT_BURST_ATTESTED_AT='ET 2026-09-18 01:33 EDT Fri' is not an ISO timestamp
```

`_push_with_attest()` in `tools/merge_all.py` set `UCT_BURST_ATTESTED_AT` to
`_et_now_line()`'s human-readable ET prose line — the SAME string it writes to
`attestation.log` for a person to read. `pre_push_guard.read_attestation()` parses that
env var with its own `_iso()`, which expects real ISO-8601, never ET prose. The retry
failed for a **different reason than the original refusal** (INVALID ATTESTATION, not
BURST) — the exact "right verdict, wrong reason" shape this session has already named
twice this session for stale regexes (F-SIGN-11, K CP18 §3).

## 2 · The fix

`_push_with_attest()` now computes two SEPARATE values where it previously computed one:

- `stamp = _et_now_line()` — unchanged, human-readable, written to `attestation.log`.
- `iso_now = datetime.now(timezone.utc).isoformat()` — NEW, real ISO-8601, written to
  `UCT_BURST_ATTESTED_AT` (the env var the guard actually parses).

`UCT_BURST_ATTESTED_BY` is unaffected (already a plain name string, no format the guard
parses). No other call site sets either env var.

## 3 · Control added to `_self_check()`

A new block proves (a) a value built the same way `_push_with_attest` builds `iso_now`
round-trips through `datetime.fromisoformat` (the same parse family the guard's `_iso()`
uses) and (b) that value is NOT the human-readable ET line — i.e. the two purposes stay
distinguishable, which is the property whose absence caused the bug.

```
F-ATTEST-ISO-1: the attestation timestamp is real ISO-8601, parses back      ok
...and is NOT the human-readable ET line (the bug that shipped)              ok
```

## 4 · Why this was found live and not in a self-check first

Every attestation control built earlier this session (R-ATTEST's BURST-only assertions,
the env-var clear-after-one-retry check) exercised `_is_burst_refusal()` and the
attest/retry CONTROL FLOW — never the actual STRING the env var was set to, because no
fixture asserted the guard's own parser could read it back. The self-check tested that
attestation happened; it never tested that attestation would be ACCEPTED. Same blind
spot shape as `lesson_an_instrument_can_reproduce_its_own_blind_spot`: the fixture and
the code shared an assumption (any non-empty string in the env var is fine) that only a
real `pre_push_guard.read_attestation()` call — or an equivalent parse-back check —
could have caught.

## 5 · Files

```
tools/merge_all.py     _push_with_attest(): iso_now computed + used for the env var,
                        stamp kept for attestation.log; F-ATTEST-ISO-1 self-check block
```

## 6 · Validators

```
ast.parse (merge_all.py)           OK
merge_all.py --self-check          PASS (unchanged plus F-ATTEST-ISO-1)
live retry, d3-cp2-build-record    ACCEPTED — pushed, origin/master = 9992f3d3b,
                                    Railway deploy SUCCESS on 9992f3d3b
```

## 7 · Drafted ledger row — NOT written

| — | *(docs-worktree only — see UNITS)* | 2026-09-18 | SIGNING | 1 | K CP20: the first real BURST attestation this session hit was rejected by the guard's own parser because the attestation env var carried a human-readable timestamp instead of ISO-8601. Fixed by computing the two formats separately — one for the audit log a person reads, one for the machine parser that gates the push — and added a self-check control that proves they stay distinguishable. Found live, not in advance, because no earlier fixture asserted the guard could actually read back what was set. |

## 8 · Drafted RESUME delta — NOT applied

- ⛔⛔ **A value written for a human and a value read by a machine are not
  interchangeable just because one function produces both.** `_et_now_line()`'s output
  is correct and necessary for `attestation.log` — the bug was reusing it a second time
  for a consumer with a different contract.
- ⭐ **A control that exercises the control-flow around a value is not the same as a
  control that exercises the value itself.** R-ATTEST's earlier self-checks proved
  attestation was ATTEMPTED under the right conditions; none of them proved the
  attempt would be ACCEPTED by the actual downstream parser, because none called it.
