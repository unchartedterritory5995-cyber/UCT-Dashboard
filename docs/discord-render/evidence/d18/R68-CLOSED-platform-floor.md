# R68 — CLOSED. The web-swap blip is a Railway platform floor, not a config bug.

## What R68 asked for, verbatim from the D-19 draft

> *"ZERO-DOWNTIME SWAP... point the health check at a READINESS endpoint that returns 200
> only when the app is fully booted... Acceptance... non-200 window ≤ 5 s (one sample) or
> zero. If Railway cannot overlap pods on this plan/config, say so with the doc/config read
> quoted, and record the blip as a platform floor in R64 — do not fake a fix."*

## What R68 would have been: the exact outage that already happened

`api/services/readiness.py`'s own docstring — read before writing a line of the proposed
change, not after — documents that this precise fix was **tried in production on
2026-07-26, deploy `650865d5`**, and produced a **~3 minute outage**:

> *"Railway does **not** keep the OLD pod serving while the new one healthchecks — the old
> pod is already gone. So a 503-until-warm probe does not hold traffic on the warm pod; it
> takes the site DOWN until the gate releases."*

Two standing regression tests guard against reintroducing it, one of which pins the
**prose**, not just the config, because the config guard alone did not stop an earlier
engineer from "fixing" the comment to match a wrong belief:

```
tests/api/test_ready_endpoint.py::test_railway_healthcheck_must_not_gate_on_readiness
tests/api/test_ready_endpoint.py::test_no_source_file_claims_the_healthcheck_gates_on_readiness
```

⛔ **R68 as drafted would have been the SIXTH copy of a claim five files were already
corrected out of** — this time not by editing a comment, but by shipping the config
change the comment used to falsely describe. I withdrew it before writing any code,
because reading the target before changing it (readiness.py) surfaced the contradiction
immediately.

## Why it is structurally impossible anyway — the part the 2026-07-26 incident didn't have

Railway's own docs (`docs.railway.com/deployments/healthchecks`, fetched 2026-09-17,
quoted verbatim):

> *"To prevent data corruption, we prevent multiple deployments from being active and
> mounted to the same service. This means that there will be a small amount of downtime
> when re-deploying a service that has a volume attached, **even if there is a healthcheck
> endpoint configured**."*

`web` has a Railway volume mounted at `/data` — auth.db, bars.db, wire_data.json, the
entire persistent layer (`CLAUDE.md`, Auth & User System). Railway will not run two active
deployments of a volume-mounted service concurrently, at any healthcheck configuration, by
design, to protect the data. **No readiness endpoint, no timeout tuning, no
`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` value closes this for `web`.**

⭐ **Two independent investigations, six weeks apart, reached the same wall from opposite
directions.** 2026-07-26 discovered it operationally (the outage). Tonight it was found
from the documentation, before touching anything. Both conclusions agree: the fix is not
in `web`'s config.

## What would actually remove the floor, and why it is out of scope here

- Remove the volume from `web` — not feasible; it is the entire data layer.
- Split `web` into a stateless request-serving tier + a separate data-owning service
  reached over the network — a real architecture change (new service, a data-access
  layer, a migration), not a config edit. Not proposed here; recorded as the honest
  answer to "can this ever go away."

## The lever that IS available: frequency, not mechanics

Since the per-deploy cost (82–119 s, measured once, `2026-09-17-web-swap-blip-measured.md`)
is fixed and cannot be reduced, the only remaining lever on **aggregate** member-facing
downtime is **how many times a day `web` redeploys**. This reframes "push whenever" (the
2026-08-24 ruling that removed the market-hours freeze) — that ruling is correct and
untouched (it was about *when* pushes were allowed, not *how many*), but it means the
daily cost line (R64) should count deploys × 82–119 s, and batching independent Tier-1
changes into fewer merges is a real, available reduction with no platform dependency.

## Disposition

**R68 CLOSED as a documented platform floor.** No code changed, no config changed,
`railway.json`'s `healthcheckPath` is untouched at `/api/health`. The two regression
tests above were re-run and remain green — they were never at risk, because nothing was
implemented against them.
