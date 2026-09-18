# Pod RSS during the run — the measurement stands, the CAUSAL CLAIM is WITHDRAWN

**Raw:** `pod-health-during-run.jsonl` (27 good samples, 1 non-200 — the 502 is data).
**Run:** `raw.txt`, 3301 s, 38 of 39 cells, **25 GREEN / 0 RED / 12 INCONCLUSIVE**.

## What was measured (this part is solid)

| wall (UTC) | pod uptime | RSS MB | threads |
|---|---|---|---|
| 19:45:42 | 676 | **1153** | 89 |
| 20:02:29 | 1664 | **8381** | 141 |
| 20:19:38 | 2693 | **8563** | 144 |
| 20:20:54 | — | **502 — swap to `a7c1a1926`** | — |
| 20:21:54 | 97 | 1022 | 91 |

Uptime climbs in step with wall time to 20:19, so rows 1-18 are ONE pod. It grew
**1,153 -> 8,597 MB between pod-age 11 min and 45 min.** That growth is real and
worth someone's attention. It is not this workstream's to fix.

## ⚰️ WITHDRAWN: "the hot pod is why 2.8b fails"

An earlier version of this file argued the RSS growth was the blocker, on the
strength of the PREVIOUS run's 22-of-24 `HTTP 500 / database is locked`.

**This run falsifies that.** It ran on a pod at 8.4-8.6 GB for most of its
duration and produced **ZERO HTTP 500s and ZERO lock errors** — grep `raw.txt`
for `HTTP 500` and `locked`, both are 0. A hot pod is therefore **not sufficient**
for the failure it was blamed for.

⭐ The likely actual cause of the earlier 500s is another workstream's fix, not a
condition that happened to clear: `6f7c7015` / `origin/production` carries
**"R72: instrument the three SQLite touches inside _sweep_locked, busy-wait..."**,
landed between the two runs. That is correlation with a named mechanism, and it
is still not proof — recorded as the best available reading, not as a finding.

⛔ **The shape of my error is the one this repo keeps paying for**: a correlation
observed once (hot pod + 500s), promoted to a cause, and written into a document
before a second run could test it. The second run tested it and disagreed.

## The real blocker, which is much smaller

| | |
|---|---|
| cells attempted | **38 of 39** in 3301 s |
| per cell | **~87 s** (not the ~80 s assumed) |
| budget needed | ~3400 s |
| budget given | **3300 s** |

**It ran out of clock by roughly one cell.** The `timeout_why` on the cell derived
3300 s from "39 cells x ~80 s = 3120 s"; the real rate is ~87 s, so the derivation
was ~10% optimistic and that 10% is the whole gap.

The other 12 INCONCLUSIVE are **rig and second-context drivability**, not product
facts, and none is a loss:

| n | cause |
|---|---|
| 4 | the rig never got the sentence into a queued outbox entry (setup) |
| 4 | the second context could not open the folder door / revision mismatch |
| 2 | SETUP budget of 120 s ran out at 'auth check' — both consistent with the 20:20:54 swap |
| 1 | the second context is NOT signed in |
| 1 | the append door was not opened |

## What this run DOES support

- **ZERO RED across 37 measured cells** on production, with fix 6 live and the
  guard still `full`.
- `ticker` **6/6** and `tags` **6/6** GREEN under a second writer; `folder` and
  `hero` 4/6 with the other two INCONCLUSIVE for rig reasons.
- The metadata families are the `settleLandedSave` / `persist` path fix 6
  rewired, so **20 of 24 GREEN and 0 RED there is the production evidence that
  the extraction did not break the designed rebase path.**

## What is NOT claimed

- 2.8b is **not** green: the standard is a GREEN artifact per cell, and "every
  cell that could be measured was GREEN" is explicitly not that.
- Nothing here says the pod's memory growth is harmless. It says it did not cause
  THIS run's INCONCLUSIVEs.
