# LiveFlow `/recent` cold-latency optimization (hand-off for Ravi)

**Date:** 2026-07-20
**Hot path owner:** Ravi — `api/live_massive_router.py` + `api/flow_db.py` run on **flow-worker** and are in the pre-push `FLOW_WATCHED` set → **after-hours flow-worker deploy only** (`railway up -s flow-worker` from a fresh worktree, ≥ 4:20 PM ET).
**Status:** proposal, not started. Sibling to the client-side drift fix shipped 2026-07-20 (`af3b6011` — LiveFlowMassive return-to-tab reconcile). That fix closed the "15 min behind" tab-drift; **this is the separate "slow first paint on open" item.**

## Symptom
Opening `/live-massive` on **All Flow** is slow to first paint (several seconds), worst cold / mid-session at high row counts. Users read it as "the page takes forever to sync." Curated view is already fast — only **All Flow** is slow.

## Root cause (from the code)
The All-Flow capped read in `FlowDB.stream_csv` (`api/flow_db.py` ~L338–355):

```sql
SELECT <cols> FROM flow
 WHERE source = ? AND CreatedDate IN (<today…>)
 ORDER BY CAST(Premium AS REAL) DESC
 LIMIT ?
```

- `Premium` is stored as **TEXT**, so the premium ranking must `CAST(Premium AS REAL)` at query time.
- A `CAST()` sort key is **not served by any existing index** — `idx_flow_source_date_id (source, CreatedDate, id)` and `idx_flow_classified (source, CreatedDate, Color, id)` order by `id` (chronological), not by premium.
- So SQLite scans **every** `source + today` row (up to ~770K by mid/late session), computes the cast per row, and sorts them all to return the top-N. That is the measured **14.7s "All" build** (43s pre-index reverse scan). It runs on flow-worker, contending with the live writer.

The chronological + curated paths are already index-fast. Only the **premium-ranked All-Flow cap** is slow.

## Options (ranked)

### A. Expression index on the premium sort key — RECOMMENDED (near-term, low-risk, no writer change)
Add in `FlowDB._ensure_flow_indexes` (next to the existing boot indexes):
```sql
CREATE INDEX IF NOT EXISTS idx_flow_premium_num
  ON flow(source, CreatedDate, CAST(Premium AS REAL) DESC);
```
- SQLite supports **indexes on expressions**. For the live **single-day** path
  (`WHERE source=? AND CreatedDate=? ORDER BY CAST(Premium AS REAL) DESC LIMIT N`)
  this becomes an **index range scan + top-N with no sort** → the 14.7s collapses to ms.
- One-time boot build (~30–60s on the big DB, same pattern/cost as the existing boot indexes).
- **Additive only** — no schema or writer change; just the index. Ships as an after-hours flow-worker deploy.
- Caveat: multi-date DateRail ranges (`CreatedDate IN (a,b,c)`) still need a merge across dates so they won't be perfectly served — but those are historical, not the hot live path. Acceptable.
- Verify: `EXPLAIN QUERY PLAN` on the capped query shows `USING INDEX idx_flow_premium_num`, and a cold `/recent?...&limit=20000` for today returns sub-second.

### B. Real numeric `Premium` column — proper long-term fix (needs writer change = Ravi)
Add `PremiumNum REAL`, populated on insert in the `massive_ws_worker` write path; one-time backfill of existing rows; index `(source, CreatedDate, PremiumNum DESC)`. Removes the CAST entirely — cleanest data model. Costs a writer change + ~1.4M-row backfill. Best folded into the **writer-inversion** work when the write path is already open.

### C. Keyset pagination instead of the 20K cap (frontend + light backend)
Frontend defaults All-Flow to `limit=20000` (~34K-row response) to avoid truncating the morning. Replace with keyset pagination
(`… AND CAST(Premium AS REAL) < ? ORDER BY CAST(Premium AS REAL) DESC LIMIT page`) + "load more": first paint ships a small page fast, tail loads on demand. Pairs with **A** (uses the same index). Cuts payload + sort cost. Larger UX change.

### D. Default first paint to CURATED, lazy-load All-Flow (frontend UX, cheapest)
Curated (MAGENTA/YELLOW, ~80–150 rows/day) is already index-fast. Default the initial render to curated so first paint is instant; run the heavy All-Flow scan only when the user switches to it. Free lever — but changes default behavior (owner lives in All-Flow), so confirm before doing it.

## Recommendation
Ship **A** first — one additive index, after-hours, biggest win on the live path; alone it should turn the slow first paint sub-second. Then **C** (keyset pagination) for payload size, and **B** as the eventual clean-up when the writer is next in play. **D** is optional if the default-view change is acceptable.

## Related
- Client-side drift fix (done 2026-07-20): `app/src/pages/LiveFlowMassive.jsx` return-to-tab reconcile, `af3b6011`.
- Flow-worker writer / open-latency context: see the 7/17 open-latency incident notes.
