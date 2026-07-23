# Stock Catalysts — options-flow source (unusual options / smart money)

**Date:** 2026-07-23
**Status:** built; flag-gated `CATALYST_FLOW_ENABLED` (default on). Step 2 of the
source-completeness roadmap (reliability guardrail was step 1).

## Why

The catalyst engine pulled 8 sources but **no options flow** — the single biggest
gap. Unusual options activity (big sweeps / blocks) is the premier "smart money
positioning ahead of a catalyst" signal, and the ecosystem already computes it.

## The seam

The flow system's per-ticker **conviction board** (`flow_summary.get_top_conviction`
→ `GET /api/flow/top-conviction?limit=N`) already ranks tickers by net sweep/block
premium with bull/bear tilt + biggest contract + ER flag, and already filters to
sweep/block-only, drops RED-tier noise, and removes lottery/deep-ITM-arb prints.
That IS the "unusual options" signal — no new scoring machinery needed.

**Freshness:** the endpoint takes no auth (`top_conviction(request)`). Post
flow-worker cutover, web's `flow.db` is a **frozen** copy, so the catalyst engine
(web-side) fetches fresh over `WORKER_INTERNAL_URL` (internal, server-to-server).
Additive, web-side only — **touches no partner-owned flow-worker code or flow.db
writes.**

## How it feeds the list (surface + enrich)

New source #9 `sources._pull_options_flow()` → `{ticker: {dir, netPremium, bullPct,
topContract, er, sector, rank}}`, joined into the candidate universe. Then:

- **Surface:** `flow_notable` (on the board) is a hard signal in
  `filters.is_real_catalyst` → a name with unusual flow enters the pool *even if
  it isn't moving yet*. `tagging` tags it `Catalyst`; `scoring` adds
  `CATALYST_SCORE_W_FLOW` (12) so it clears the pre-sort into the curator pool.
- **Enrich:** the flow line (`synthesize._format_flow_block`) is attached to every
  candidate's **curator** signal block AND the **synthesis** prompt, so the curator
  ranks/keeps on it and the Opus thesis can cite it. Curator rubric + synth
  catalyst-type list both gained an options-flow entry (`Flow`).

The **curator judges** — heavy one-sided premium is kept; a small/mixed flow line
on an otherwise sleepy name is not enough on its own. (Exactly "take from the
leaderboard + curate.")

## Env

- `CATALYST_FLOW_ENABLED` (default `1`) · `CATALYST_FLOW_LIMIT` (20, board cap) ·
  `CATALYST_FLOW_TIMEOUT` (6s) · `CATALYST_SCORE_W_FLOW` (12). Requires
  `WORKER_INTERNAL_URL` (already set for the flow proxy); absent = no flow signal,
  fail-soft.

## Fail-soft / safety

`_pull_options_flow` never raises — disabled, no worker URL, timeout, or any error
→ `{}` (the engine just gets no flow signal that refresh, like its other sources).
Bounded 6s timeout; runs in the `collect_all` thread pool on the scheduler thread,
never the request path. BullFlow (`BULLFLOW_API_KEY`) is dead code and NOT used;
Unusual Whales (`uw_live_flow.py`) already feeds the same flow.db live.

## Tests

`tests/test_catalyst_flow.py` (11): pull disabled / no-URL / parse / fail-soft;
flow surfaces a flat name past the gate; flow rescues a flat-earnings name; tags
Catalyst; adds score; flow-block formatting + empty. Full catalyst suite green.

## Next (roadmap remainder)

FMP analyst → Brain setup-grading → Finviz/AV news.
