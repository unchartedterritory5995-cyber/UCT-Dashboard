# 07 — Execution plan: lanes, contracts, dependencies, wall clock

Owner brief, 2026-09-13 20:4x ET: *parallelize, pipeline and expedite without lowering the bar.*
Nothing here relaxes a quality rule. The full scoped gate still runs before every master merge, every
merge still waits for `web` SUCCESS and a confirmed running SHA, mutation controls still go red,
goldens still diff at zero drift on the pre-V2 path, one master merge at a time.

---

## 0. Two corrections to the brief, stated before planning against it

1. **Shadow mode is P2.10, not P2.9** (P2.9 is the concurrency / loop-stall work), and **it is
   already merged and live-dark** at master `5ca4d5db2`. The only thing left is the flip, which the
   previous brief pre-approved ("turn ON after merge, leave on through Monday RTH"). It is done in
   §6 below, not scheduled.
2. **"2.4b P2 fully merged and live-dark: end of today's session" is already met.** P2.1–P2.10
   merged at `5ca4d5db2`, deployed, running SHA read in-process, 1,112 passed, 69/69 mutations red.
   Lane A's forward scope is therefore *integration*, not the hot path — see §3.

---

## 1. ⛔⛔ THE MACHINE CONSTRAINT THAT SHAPES EVERY LANE

**Measured at plan time: 8.6 GB free of 31.8 GB, with 9 python and 5 node processes already running
from other sessions.** That is the same shape as the 2026-09-12 incident, where three concurrent
sessions drove free memory to 4.8 GB, an unscoped `pytest tests/` reached **11,854 MB RSS**, two
six-shard gates produced `INVALID` manifests, and a worktree's `node_modules` and `.git` were
destroyed mid-`npm ci`.

So the parallelism is in the **writing**, and the **gating stays serialised**:

| | Allowed in a lane | Never in a lane |
|---|---|---|
| pytest | scoped, **≤6 named files**, its own | `pytest tests/`, `-k` over the tree, any unscoped collection |
| vitest / npm | — | **nothing**: no `npm ci`, no `npx vitest`, no six-shard gate |
| full gate | — | runs **only** in Lane A, one at a time |
| heavy jobs | — | no renderer smoke, no Chromium, unless Lane A says the box is quiet |

⭐ **`-k` IS NOT SCOPING.** The filter selects what *executes*; every test in the tree is still
*collected*, and collection is where the memory goes (`--collect-only` alone reached 6.6 GB). Scoping
means **naming the files**.

⚠️ This is a resolution, not a refusal: the owner asked for concurrency, and concurrent *authorship*
with serialised *verification* delivers it without re-running the incident. If a lane needs a wide
gate it asks Lane A, which runs it when the box is quiet.

---

## 2. Dependency graph

```
                  ┌──────────────────────────────────────────────┐
                  │  CONTRACTS (frozen first, §4)                │
                  │  Result · adapter fetch() · CacheKey/Store    │
                  │  · Badge/footer API · artifact metadata       │
                  └───────┬───────────┬───────────┬──────────────┘
                          │           │           │
        ┌─────────────────┘           │           └───────────────┐
        ▼                             ▼                           ▼
   Lane B (2.5 cache)          Lane D (2.7 visual)          Lane A (integration)
   artifact_cache.py           badge.py + 04-spec           merge queue, shadow,
   coalescing                  golden harness               bench, master merges
        │                             │                           ▲
        └──────────┬──────────────────┘                           │
                   ▼                                              │
            Lane A integrates ────────────────────────────────────┘
                   ▲                              ▲
                   │                              │
   Lane C (2.6 delivery) ── independent ──────────┘
   delivery.py hardening      of the data layer entirely

   Lane E (2.8 + Step 3 harnesses) ── depends on NOTHING to START.
   Regression tests sit RED until their fix lands, which is the point.

   Lane F (docs, runbook, flip packet, RESUME) ── continuous, no code deps.
```

**Critical path:** contracts → Lane A integration → master merges, serialised by `web` SUCCESS.
Everything else is off it.

---

## 3. Lanes, scope, and the file-ownership map

⛔ **OVERLAP IS RESOLVED BY CONTRACT, NEVER BY TWO LANES EDITING ONE FILE.** A lane that needs a
change in another lane's file writes a **contract-change request** in its ledger row and proceeds on
its own side of the boundary; Lane A applies it at integration.

| Lane | Step | Owns (writes) | Reads only | Must never touch |
|---|---|---|---|---|
| **A** (me) | integration, bench, shadow, merges | `adapters/**`, `commands.py`, `runtime.py`, `05-progress.md`, `LEDGER.md`, `07`, `08` | everything | another lane's new files |
| **B** | 2.5 cache + coalescing | `api/services/discord_render/artifact_cache.py` (new) · `tests/test_discord_render_artifact_cache.py` (new) · `docs/discord-render/instruments/mutation_harness_cache.py` (new) | `adapters/result.py`, `contracts.py` | `adapters/**`, `commands.py`, `bindings.py` |
| **C** | 2.6 Discord delivery | `api/services/discord_render/delivery.py` · `tests/test_discord_render_delivery.py` (new) · `.../mutation_harness_delivery.py` (new) | `runtime.py`, `contract.py` | `runtime.py`, `commands.py`, `adapters/**` |
| **D** | 2.7 visual + goldens | `api/services/discord_render/badge.py` (new) · `docs/discord-render/04-visual-spec.md` · `tests/test_discord_render_badge.py` (new) · `tests/test_discord_render_goldens.py` (new) · `.../instruments/golden_capture.py` (new) | `adapters/result.py`, `freshness.py`, `bindings.py` | `bindings.py`, `adapters/**`, `commands.py` |
| **E** | 2.8 + Step 3 harnesses | `tests/test_discord_render_forensics.py` (new) · `.../instruments/{load_harness,chaos_scenarios,determinism_runner,soak_job}.py` (new) | all of `01-failure-forensics.md` | **all production code** — Lane E ships no `api/**` change |
| **F** | docs, runbook, flip packet | `docs/runbooks/discord-render-*.md` (new) · `docs/discord-render/06-flip-packet.md` (new) · `docs/RESUME.md` | everything | `LEDGER.md`, `05-progress.md`, `03`, `04`, `07`, `08` |

⚠️ **Manrav/Ravi-co-owned files** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`)
are out of scope for every lane. If one is unavoidable it is a minimal isolated diff, acked first.

---

## 4. Contracts frozen before any lane builds

One file, `api/services/discord_render/contracts.py`, with `tests/test_discord_render_contracts.py`
beside it. A contract change after lanes are running is a **ledgered event with a reason**.

| Contract | Frozen shape | Consumers |
|---|---|---|
| `Result` | `adapters/result.py` — `ok · data · provider · envelope · degraded_reasons · corr_id · elapsed_ms · meta`, with `as_of / session / stale / vintage / badge` **derived**, never stored | A, B, D |
| `fetch(request) -> Result` | every adapter, never raising, failure as a named class from `ALL_REASONS` | A, B |
| `ArtifactStore` | `get(key) -> CachedArtifact | None` · `put(key, artifact) -> None` · `coalesce(key, produce)` — see the Protocol | B, A |
| `CacheKey` | `(command, normalised args, data vintage)` — ⛔ **the DATA's vintage, never the wall clock**, or the same closed-market input caches under two keys and §3.10 determinism dies | B, A |
| `render_badge(result) -> str | None` / `render_footer(results, corr_id) -> str` | the ONE owner of member-facing degradation copy | D, A |

⛔ **`stale=None` IS NOT `stale=False` ANYWHERE ACROSS THE BOUNDARY.** Unknown vintage means the
badge is absent, not reassuring; a cache that stores a `None` verdict as `False` would launder an
unmeasured payload into a clean one.

---

## 5. Estimates, timeboxes and the two-strike rule

At **150 %** of estimate: stop, one paragraph in the ledger (what is slow, why, what changes), then
change approach or split. No item runs silently to 300 %.

| Item | Lane | Est. | Unblocks |
|---|---|---|---|
| Contracts frozen + merged | A | 0.5 h | B, D |
| Shadow flip + verification | A | 0.3 h | Monday truth |
| Bench three ways | A | 0.7 h | flip decision |
| 2.5 cache + coalescing | B | 3 h | artifact reuse, C-01 |
| 2.6 delivery hardening | C | 3 h | C-03, C-04, C-11 |
| 2.7 badge + spec + goldens | D | 3 h | A's stamp consumes badge.py |
| 2.8 forensics regressions | E | 2.5 h | Step 3 |
| Step 3 harnesses (load/chaos/determinism/soak) | E | 2.5 h | Step 3 start |
| Runbook + flip packet + RESUME | F | 2 h | the flip |

---

## 6. Targets, and their status at plan time

| Target | Status |
|---|---|
| Contracts frozen and merged — **first** | in flight (§4) |
| Shadow mode live and **ON** before Monday 09:30 ET | merged live-dark `5ca4d5db2`; flip in this session |
| 2.4b P2 fully merged and live-dark — end of session | ✅ **already met** — `5ca4d5db2`, verified in-process |
| 2.5 / 2.6 / 2.7 integrated and gated on the queue | lanes B, C, D spinning up |
| 2.8 live-dark + Step 3 harnesses by Monday close | lane E |
| RESUME re-checkpointed at every step boundary | lane F, continuous |

---

## 7. Wall clock

`05-progress.md` carries a wall-clock column per merge: **start · end · gate · deploy wait · active
work**. The point is to see where the time actually goes and fix it next pass — the first two merges
of this session spent more wall clock on gate + deploy wait than on authorship, which is the whole
reason for this plan.
