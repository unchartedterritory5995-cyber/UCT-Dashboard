# The one reproducible defect, diagnosed from source — `GET /api/schwab/market-narrative`

**Measured tonight** (`results.md` §2.4): **20,768 ms cold and 7,531 ms warm of SERVER time for a
1 KB response**, client-side stall 2 ms both times, the slowest call on `/options-flow`'s load path
on both runs, and **not** explained by the 31 MB of cold packs because the warm control carried
none.

This note is the source-side diagnosis. ⛔ **Read-only. No further production request was made, and
§4 explains why that is a deliberate stop rather than an omission.**

---

## 1 · What the route does

`api/schwab_router.py:258` — `@router.get("/market-narrative")`, `def market_narrative(...)`, gated
by `Depends(require_flow_user)`.

It makes a **synchronous Anthropic call** (`client.messages.create`, `:289`) on
`model="claude-sonnet-4-6"`, `max_tokens=250`, **with the server-side web-search tool attached**
(`tools=[{"type": "web_search_20250305", ...}]`, `:299`). So a member's page load triggers a live
LLM call that itself performs web searches before answering.

⭐ **That is the whole latency.** 7.5 to 20.8 seconds is an unremarkable duration for a
Sonnet call that runs web searches first. **The endpoint is not slow because something is broken;
it is slow because of what it does, on a path where a member is waiting.**

## 2 · ⭐⭐ THE ACTUAL DEFECT: a 30-minute cache on a pod whose median life is 26 minutes

The route caches its answer (`:315`):

```python
if text:
    cache.set(cache_key, text, ttl=1800)     # 30 minutes, keyed by date
```

and its docstring claims this *"cuts cost ~15x without losing freshness"*.

⛔⛔ **`cache` is an in-process `TTLCache`** (`api/services/cache.py:26` for the class, `:148` for
the module-level singleton). It does not survive a redeploy.

**Tonight's Protocol F measured the median web-pod lifetime at 26 minutes**, with fourteen
deployments in six and a half hours. So:

| | |
|---|---|
| cache TTL | **30 minutes** |
| median pod life | **26 minutes** |

⭐⭐ **The cache is set to expire after the process that holds it is expected to die.** It is not a
cache with a low hit rate; it is a cache whose TTL is structurally longer than its own lifetime, so
under normal deploy churn **most of its entries never get the chance to be hit at all.** The
15× claim was true of the design and is not true of the deployment.

**Consequence, in the units that matter:** every fresh pod's *first* caller of `/options-flow` pays
the full LLM-plus-web-search call, and the web-search tool is **billed per search on top of
tokens** — which `api/services/narrative_cost_guard.py:3-10` says in its own words is why that
guard had to be written at all, having classed this route as *"uncapped anonymous LLM spend"*. At
fourteen deploys a day that is roughly fourteen unavoidable billed calls, each one on a member's
critical path.

## 3 · Two smaller findings in the same read

⛔ **A failure is never cached.** The write is guarded by `if text:` (`:314`) and the `except`
branch returns a 500 without caching (`:318`). So a run of empty or failing responses re-fires the
full call for **every** caller, with no backoff. The cost guard bounds the money; nothing bounds
the latency.

⚠️ **The route is a sync `def`, which is correct and not sufficient.** A `def` handler runs in the
anyio threadpool instead of blocking the single event loop, and the flow router makes the same
choice explicitly for its own gzip work. ⛔ **But it is not a fix for the ten-call cluster measured
tonight**, and I am not claiming it is — see §5.

## 4 · ⛔ WHY I STOPPED MEASURING, and this is not an omission

The obvious next step is to hit the endpoint again and watch whether the cache hits. **I did not,
and the reason is that each request is a billed LLM call with per-search billing on top**, drawn
against a daily budget that exists specifically because this route once had none.

⭐ **An instrument that spends the owner's money per sample is one where "take more samples" is the
wrong reflex.** Two samples are enough to establish the finding in §2, because §2 rests on two
constants in source and one measured median rather than on a hit-rate observation.

⚠️ **So one thing stays genuinely open:** the warm control still took 7,531 ms, meaning the cache
did **not** hit between two loads a couple of minutes apart. Candidates, undiscriminated: a
redeploy emptied it in between, or the first call's extracted `text` was empty so nothing was ever
written. ⛔ **Both are consistent with §2 and neither changes the remedy**, which is why the
remaining ambiguity is recorded rather than resolved at cost.

## 5 · ⚠️ What I am NOT concluding about the ten-call cluster

`results.md` §2.2 measured ten unrelated 0–1 KB calls all receiving a first byte at ~10.5 s with
client stall of 1–3 ms. **That is measured. The mechanism is not.** Two candidates fit:

1. **Threadpool occupancy** — several sync handlers holding anyio workers while doing multi-megabyte
   gzip and serialisation.
2. **GIL serialisation** — CPU-bound work inside threads does not run in parallel in one Python
   process, so a few megabytes of compression starve every other handler regardless of how many
   workers are free.

⭐ **Candidate 2 would mean the "use a sync `def` so it runs in the threadpool" idiom protects the
event loop without protecting throughput**, which is a much larger architectural claim than
anything this note measures. ⛔ **I am not making it.** What would discriminate them: the pod's own
thread-count line during a cold `/options-flow` load, plus whether server time scales with payload
size or with concurrent request count.

## 6 · The remedy, stated so it can be argued with

Ordered by ratio of benefit to risk. **None of these is applied — this is a research note.**

1. ⭐ **Take it off the load path.** A market narrative is not needed for the page to be usable.
   Render the page, fetch the narrative after, and show its absence rather than blocking on it. This
   alone removes 7.5–20.8 s from a member's perceived load and costs no correctness.
2. **Make the cache durable, or shorten the TTL below the pod's life.** A 30-minute TTL on a
   26-minute process is the defect in §2. Either outlives the process — the durable-ledger pattern
   the cost guard already uses for spend — or stop claiming 15×.
3. **Precompute it.** The content is per-date and identical for every member; it is a scheduled job's
   output, not a request's. ⭐ This repo already has that pattern several times over.
4. **Cache the failure too**, briefly, so an outage does not become a per-caller LLM call.

⛔ **What not to do: add a timeout and call it fixed.** A timeout converts a slow narrative into a
missing narrative while leaving the member waiting for the timeout. Item 1 is the one that helps.

## SOURCES

`api/schwab_router.py:258-318` (route, LLM call, tool attachment, cache write, error path) ·
`api/services/cache.py:26,148` (the in-process TTLCache and its singleton) ·
`api/services/narrative_cost_guard.py:1-30` (why the guard exists; per-search billing) ·
`docs/perf-baseline-2026-09-26.md` Protocol F (median pod life 26 minutes, fourteen deploys in
6.5 hours) · `results.md` §2.2 and §2.4 (the measured timings and the control).
