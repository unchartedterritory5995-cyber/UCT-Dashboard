# Trigger-4 capture — 2026-09-14T05:02:08Z

**Rig auth state:** `/api/auth/me` → 200 (signed in)

⭐ This matters before anything below is read: a 401 against a signed-OUT rig is an instrument fact; a 401 against a signed-IN rig is not.

## HTTP failures (2)

| method | status | type | url |
|---|---|---|---|
| GET | 401 | fetch | `https://uctintelligence.com/api/barspack/manifest` |

## Console errors (2)

- `Failed to load resource: the server responded with a status of 401 ()`  
  issued by `https://uctintelligence.com/api/barspack/manifest`:0
- `Failed to load resource: the server responded with a status of 401 ()`  
  issued by `https://uctintelligence.com/api/barspack/manifest`:0

## Classification

⛔ **Not decided by this tool.** It produces evidence; INSTRUMENT / PRODUCT / FOREIGN is a judgement made against the deploy history for the window in which the anomaly began, and a tool that guessed it would be a second authority over that call.

---

## Classification — made by the session, against deploy history

**FOREIGN. A real member-facing regression, and not Q1's.**

### (a) Is it a deploy from another session? **YES, with the diff as evidence.**

| | |
|---|---|
| SHA | **`2d121371f`** — *"fix(security): gate the chart-data origins — ported onto current master"* |
| deployed | `2026-09-13T21:54Z` = **16:54 CT** |
| touches | `api/routers/barspack_router.py`, and ADDS `api/bars_auth.py` (137 lines) |
| mentions `barspack` | 20 times in its own diff |

The anomaly window is bounded by the samplers: **16:00 CT clean, 18:00 CT
anomalous.** This commit adds an auth gate to the exact router that serves the
endpoint now returning 401, and it landed inside that window. That is a diff, not
a coincidence.

⚠️ **Two adjacent commits, named so they are not confused with the cause.**
`da0803baa` *"fix(bars-api): ungate the tier's DATA routes"* (17:59 CT) touches
`api/bars_api_main.py` and mentions `barspack` **once** — it reads as a partial
remediation that did not reach `/api/barspack/manifest`. `9fe247cb0`
*"feat(edge): chart entitlement token + SHADOW verification"* (18:57 CT) is a
plausible neighbour but postdates the first anomalous sample, so it cannot be the
cause of it.

### (b) Does a member hit it? **YES.**

The rig is a **signed-in** session (`/api/auth/me` → 200) and the request fires on
an ordinary load of `/journal/notebook`. Any signed-in member opening the Notebook
issues it.

⚠️ **Measured opted-OUT only.** The sampler runs with the offline layer off, so
that is the state measured. The request originates in the chart/bars stack rather
than the Notebook's offline layer, so an opted-IN member should behave
identically — but that is **reasoning, not measurement**, and is marked as such.

### (c) Does it touch the save path? **NO.**

`/api/barspack/manifest` is chart/bars data. Q1's save path is `/api/j2/notes/*`.
Nothing about this reaches the outbox, the durable record, or the drain.

### Consequence for trigger 4 — a PROPOSAL, deliberately not applied

Trigger 4 will keep failing the Sunday gate on a regression that belongs to
another workstream and cannot affect a single Q1 invariant. That is the case a
filter is for — but the filter must **not** be severity, and it must not be silent.

⛔ **Not severity — OWNERSHIP.** "The Notebook's page shows an error" and "the
Notebook is broken" are different facts, and a severity filter would collapse
them. A 401 from `/api/j2/*` or the offline layer is Q1's and must fail trigger 4.
A 401 from a foreign endpoint on the same page is real, member-visible, and
someone's — just not Q1's.

**Proposed:** trigger 4 partitions console errors by the ORIGIN of the failing
request. Errors from Q1-owned endpoints fail it as today. Errors from foreign
endpoints are recorded **by URL and by owning commit where known**, reported as
`FOREIGN` in the verdict, and do not block the Q1 KEEP/REVERT decision — while
still appearing in the row, because a hole that is invisible is worse than one
that is attributed. ⛔ Requires an owner ruling before it is applied; a filter that
narrows a gate is exactly the change that must never be made quietly.
