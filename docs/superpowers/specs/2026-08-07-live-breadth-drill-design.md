# Live breadth row: make its cells drill like a recorded day (2026-08-07)

Owner ask: "I want the breadth spots to be clickable like the recorded previous
days."

Today every cell on the intraday row is inert. One line does it —
`Breadth.jsx:1273`:

```js
const isDrillable = !!col.drillKey && !row._live
```

The guard is correct as written: the live payload carries no `*_list` field
(74 fields, zero of them lists), and the recorded drill endpoint is keyed by
date, so a click would 404 against a day the collector has not written yet.

## Why this is cheap

`compute_metrics` already computes every count as a boolean mask over an
**aligned ticker array** (`levels["tickers"]`), then does `int(mask.sum())` and
discards `tickers[mask]`. The identities exist; only the tally is kept.

And recorded drill is **already on-demand** — `openDrill` fetches
`/api/breadth-monitor/{date}/drill/{key}` when a cell is clicked, rather than
reading a list off the row. So the live equivalent is a sibling endpoint and
**the 60s poll payload does not change size at all**. That matters: this
endpoint is polled by every user on the Dashboard, against a single-process pod.

## ⛔ The invariant that keeps this honest

**A drill list is emitted from the SAME boolean mask that produced the count —
never recomputed from a second pass.** Two passes drift the moment a definition
moves, and the failure is silent and awful: the cell says 47, the modal lists
45, and nothing reports a problem.

So `compute_metrics` gains an optional `members` out-dict it fills as it goes:

```python
m[key] = int(mask.sum())
if members is not None:
    members[key] = [t for t, keep in zip(tickers, mask) if keep]
```

Test 1 below is the gate: for every drillable metric, `len(members[k]) == m[k]`.
It fails the instant the two ever disagree.

## Which cells become clickable

The monitor declares 22 `drillKey`s. All 22 carry a live value, but **that is
not the same as being measured live**:

| group | metrics | live drill? |
|---|---|---|
| measured live | the other 21 | **yes** |
| carried from the prior day | `atr_ext_7` (needs intraday high/low, so it sits in `NOT_LIVE`; today's payload shows `10` from `carried_from: 2026-08-06`) | yes, but **routed to `carried_from`** |
| partial mid-session | `hvc_52w`, `up_vol_ratio` | yes — the row already marks them partial |

The rule: **drill live only what was measured live.** A carried metric's number
came from a past session, so its names come from that session too — clicking
`atr_ext_7` opens the drill for `carried_from`, which is a working click AND a
truthful list. Owner approved this over leaving it inert.

## Backend

1. `build_levels` gains `lv["vol_avg20"]` — the mean of the last 20 volume
   columns. Levels are built from COMPLETED sessions only, so those are exactly
   the prior 20 the collector averages (`volumes.iloc[-21:-1].mean()`). This is
   what makes the volume-ratio column real rather than another dash.
2. `compute_metrics(levels, prices, volumes, members=None)` fills `members` for
   the drillable keys, from the masks it already has.
3. `compute_live` stashes `members` + the `prices`/`vols` it already fetched into
   the existing module cache beside the payload, under the same `_live_lock` and
   the same `_LIVE_TTL_SECONDS`. **Not in the payload.**
4. `GET /api/breadth-monitor/live/drill/{metric_key}` enriches on request from
   that cache and returns `{items: [...]}` — the identical envelope the dated
   endpoint returns, so the modal needs no new parsing.

If the cache is cold or the metric is not live-measured, the endpoint returns
`{items: []}` with a reason rather than 500 — a dead click must not surface an
error page.

### Item shape

Recorded items are `{t, pct, c, vr, atr, a50, n}`. Live emits five of the seven:

| field | live source |
|---|---|
| `t` | `tickers[mask]` |
| `pct` | `(price − levels["prev_close"]) / prev_close × 100` |
| `c` | the live price |
| `vr` | `today_vol / lv["vol_avg20"]` |
| `n` | `ticker_search._name_from_cache`, omitted when unknown (`item.n ?? ''`) |
| `atr`, `a50` | **omitted** — need intraday high/low the snapshot does not carry |

The modal already renders `—` for a missing `vr`/`atr`/`a50`
(`Breadth.jsx:566/569/572`), so the two ATR columns degrade with no UI change.
That is the behaviour the owner chose, and it matches the philosophy stated in
`breadth_live.py` itself: *"a missing field reads as 'we didn't compute it',
which is exactly the truth."*

## Frontend

- `isDrillable` becomes `!!col.drillKey && (!row._live || liveDrillable(col.key))`.
- `openDrill` routes a live cell to the live endpoint; a **carried** metric routes
  to the dated endpoint for `carried_from`.
- The modal marks a live list as provisional using the same clock the row shows
  (`formatLiveClock`), so a mid-session list is never read as settled. A list
  routed to `carried_from` shows that date instead — it is not live.
- Group-by-industry is untouched: it takes tickers and does not care where they
  came from.

## Testing

1. **Count/membership parity** — for every drillable metric, `len(members[k])`
   equals `m[k]`, over a fixture with known masks. This is the gate on the
   invariant above; write it so it fails if a list is ever built by a second pass.
2. **`vol_avg20` matches the collector's window** — prior 20 completed sessions,
   today excluded.
3. **Carried metrics are not served as live** — `atr_ext_7` must not appear in
   `members`, and the frontend must route it to `carried_from`.
4. **Enrichment** — `pct` is computed against `prev_close`; a name that the cache
   does not know omits `n` rather than emitting null; `vr` is null (→ `—`) when
   `vol_avg20` is 0 or missing, never `Infinity`.
5. **Cold cache** — the endpoint returns `{items: []}` plus a reason, not a 500.
6. **Payload unchanged** — the live payload gains no `*_list` key and no new
   large field. Assert on the key set, so a future author cannot quietly inline
   the lists and re-bloat the Dashboard's 60s poll.
7. **Frontend** — a live cell is clickable and hits the live URL; a carried cell
   hits the dated URL for `carried_from`; a non-drillable cell stays inert; the
   modal shows the live clock for a live list.

### Live-surface pass

Both defects in the presets work survived thousands of green tests and only
showed in a browser. Click a live cell mid-session and confirm: the list is
non-empty, the count matches the cell, the ATR columns read `—`, and the header
says LIVE rather than a date.

⚠️ Only reproducible while the market is open and before the 4:15 collector
writes the day — after that the backend marks the read `superseded` and the live
row disappears by design.

## Out of scope

- Computing ATR intraday (owner decided; two columns are not worth carrying
  per-ticker high/low through the live path).
- Drilling metrics that recorded rows do not drill (percentages like
  `pct_above_50sma` have a member set but no precedent, and adding them here
  would make live richer than history).
- Persisting live lists. They are a 60s view; the collector remains the record.
