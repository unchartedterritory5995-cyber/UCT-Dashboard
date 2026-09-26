---
id: e-cp33-build-record
unit: E CP33
packet: packet-e-ci-gap-gate
merges-after: E CP32
status: SIGNED (E CP33, fingerprint 0651de213)
---

# E CP33 — build record

## APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  0651de213
SCOPE APPROVED:   CP33 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> **E CP33 — the leaked dependency override, the file that was measured (F-CI-36).** Scope is the commit(s) named below, **as enumerated by
> `git show --stat`**.

**Collision proof, three sources:** E's packet table declares **CP1–CP3**; build records on
disk topped out at **e-cp29** before this unit; manifest rows topped out at **CP29**.
**CP33 free.**

---

## 1 · Why this checkpoint exists at all

One test file installed `app.dependency_overrides[get_current_user]` on the REAL shared app and never removed it, so a stub user with no plan answered for every later test in the process: 401 became 402, 200 became 402. Found by bisecting the 52 files that joined its process, with both non-vacuity ends proved first. E CP28 later fixed the CLASS; this is the instance that was measured, and it is what made the second split attempt safe.

**A findings-fix with no packet cannot reach master**, because nothing signable names it.
This is that checkpoint: it claims the commit, nothing more.

## 2 · The commit(s)

```
240bb3305   tests/test_thesis_reviews_router.py
```

## 3 · Ordering

Touches one test file no other unit touches. Placed before E CP27 because the second shard split depends on this fix being present — that dependency is the whole reason the second attempt was permitted.

## 4 · Validators

```
verify_manifest --check-commits   the commit is CLAIMED (it was one of the eleven)
merge_all --self-check            UNITS and the manifest agree, both directions
cherry-pick proof                 replayed onto a throwaway from origin/master
```

## 5 · Drafted ledger row — NOT written

| 115 | *(named in the session report)* | 2026-09-16 | CI | 1 | E CP33: claims `240bb3305`, the F-CI-36 per-file fix. E CP28 fixed the class; this is the instance, and E CP27's second split attempt depends on it. |

## 6 · Drafted RESUME delta — NOT applied

- **The instance and the class are two checkpoints.** Merging the class without the instance leaves the measured reproduction unexplained on master.
