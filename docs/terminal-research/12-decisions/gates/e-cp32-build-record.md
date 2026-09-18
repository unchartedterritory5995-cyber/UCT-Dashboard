---
id: e-cp32-build-record
unit: E CP32
packet: packet-e-ci-gap-gate
merges-after: E CP26
status: UNSIGNED
---

# E CP32 — build record

## APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  604b0dc69
SCOPE APPROVED:   CP32 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP32 — full history on every job (F-CI-32).** Scope is the commit(s) named below, **as enumerated by
> `git show --stat`**.

**Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk topped out at **e-cp29** before this unit; manifest rows topped out at **CP29**.
**CP32 free.**

---

## 1 · Why this checkpoint exists at all

27 of 121 failure entries were the shallow checkout, not the product. `fetch-depth: 0` on all five checkouts is what made the history walkers answerable at all. Found and fixed in session 6, never numbered.

**A findings-fix with no packet cannot reach master**, because nothing signable names it.
This is that checkpoint: it claims the commit, nothing more.

## 2 · The commit(s)

```
4274e26cc   .github/workflows/full-suite-report.yml
```

## 3 · Ordering

Touches the workflow, so its position is load-bearing: after E CP26's `8a8ebe0ab` and before E CP29's `e703af0a8`, which is chronological.

## 4 · Validators

```
verify_manifest --check-commits   the commit is CLAIMED (it was one of the eleven)
merge_all --self-check            UNITS and the manifest agree, both directions
cherry-pick proof                 replayed onto a throwaway from origin/master
```

## 5 · Drafted ledger row — NOT written

| 114 | *(named in the session report)* | 2026-09-16 | CI | 1 | E CP32: claims `4274e26cc`, `fetch-depth: 0` on every checkout. One of the eleven unclaimed commits; 27 of 121 failure entries were the shallow clone. |

## 6 · Drafted RESUME delta — NOT applied

- **A CI-shape fix is product code for the gate.** It needs a number like any other.
