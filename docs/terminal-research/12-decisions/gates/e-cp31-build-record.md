---
id: e-cp31-build-record
unit: E CP31
packet: packet-e-ci-gap-gate
merges-after: E CP30
status: SIGNED (E CP31, fingerprint f4fd0651f)
---

# E CP31 — build record

## APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  f4fd0651f
SCOPE APPROVED:   CP31 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP31 — the FIRST shard-split attempt and its revert, together.** Scope is the commit(s) named below, **as enumerated by
> `git show --stat`**.

**Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk topped out at **e-cp29** before this unit; manifest rows topped out at **CP29**.
**CP31 free.**

---

## 1 · Why this checkpoint exists at all

Run #24's split (ROOT_BUCKETS 8 to 12) cost 41 NEW failures and was reverted inside the hour. Neither commit was ever a checkpoint, and neither can be dropped: the revert is only meaningful beside the attempt it undoes, and the comment block the pair leaves behind is the record of WHY 12 failed the first time — which is exactly what E CP27's second attempt was built against.

**A findings-fix with no packet cannot reach master**, because nothing signable names it.
This is that checkpoint: it claims the commit, nothing more.

## 2 · The commit(s)

```
16027f239   .github/workflows/full-suite-report.yml, tools/pytest_shards.py
4feaeb86f   tools/pytest_shards.py
```

## 3 · Ordering

**Both, in this order, in one unit.** Net effect measured: `ROOT_BUCKETS = 8` before the pair and `ROOT_BUCKETS = 8` after it — behaviourally net-zero. NOT textually net-zero: +24/-1 survives in `pytest_shards.py` (the comment block recording the failure) and +10 in the workflow (a pyyaml install step for the publisher, which was never reverted and is a rider on the first commit). Stated rather than smoothed over.

Placed BEFORE E CP26: `16027f239` is chronologically earlier than E CP26's `8a8ebe0ab` and both touch the workflow, so the reverse order conflicts.

## 4 · Validators

```
verify_manifest --check-commits   the commit is CLAIMED (it was one of the eleven)
merge_all --self-check            UNITS and the manifest agree, both directions
cherry-pick proof                 replayed onto a throwaway from origin/master
```

## 5 · Drafted ledger row — NOT written

| 113 | *(named in the session report)* | 2026-09-16 | CI | 1 | E CP31: claims the first shard-split attempt `16027f239` and its revert `4feaeb86f`. Behaviourally net-zero (ROOT_BUCKETS 8 before and after); textually not — the comment block recording the 41-failure outcome survives, deliberately, and a pyyaml publisher fix rides on the first commit and was never reverted. |

## 6 · Drafted RESUME delta — NOT applied

- **A revert does not erase an attempt, and should not.** Merge the pair, prove the behaviour is net-zero, and keep the text that says why.
