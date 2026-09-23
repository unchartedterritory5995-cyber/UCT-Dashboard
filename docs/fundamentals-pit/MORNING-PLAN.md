# Historical Fundamentals — morning deployment plan

Nothing below has been done. Each stage is gated on the previous stage's check, and each has its own rollback. Stages 2–5 touch production data or variables, so every one of them needs an explicit owner go.

Branch: `feat/historical-fundamentals` (local, unpushed). It merges cleanly with `origin/master` `ecdfef01e`: master moved one Screener-shell commit, with no shared files.

---

## Stage 0 — owner decisions (before anything ships)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Snapshot sources (forward P/E, PEG, EPS next Y/5Y, analyst target) are all licensing class R/U. | Keep them BLOCKED. The framework ships dormant (`RETENTION_ALLOWED = frozenset()`). |
| D2 | Where Beta is computed. Cold AAPL = 589 ms from 33 years of closes on the web pod. | Precompute it on the worker and publish it as an artifact next to the SEC series, rather than on web. Until then, the serving TTL cache (300 s) absorbs repeats. |
| D3 | Edge caching of the series route. It is entitlement-gated, so today it is `Cache-Control: private`. | Keep it private for V1. Payloads are 8–18 KB gzip without Beta. See `barspack-401` for why a URL-keyed CF cache of entitled data is unsafe. |
| D4 | Over-broad restatement invalidation (~2% of TTM transitions skip a quarter; TSLA Q1–Q3 2025). | Ship V1 with it documented, then do a knowledge-layer design pass. It never shows a wrong or early value: the gap is a gap. |
| D5 | Unentitled members see "not available right now", not an upgrade prompt. | Fine for V1; copy is an owner call. |

## Stage 1 — merge the code, dark

**Do:** open a PR from the branch; review; merge to master; let the gate promote master to `production`.

**What changes for members:** exactly one live, unflagged change.
- **`cb4fb9a67`, the pane-readout fix.** A pane readout now sits where its series actually drew, and a pane whose host drew nothing gets no readout. This is shared chart code, and it fixes a pre-existing mis-captioning.
- Everything else is dark. `FUNDAMENTALS_PIT_ENABLED` is unset, so `/api/fundamentals/pit/*` returns 404 and the Fundamentals tab shows the neutral notice with no rows.

**⚠ Before merging:** the push touches `api/**`, which redeploys the worker. That is the Breadth trigger in `breadth-pass-universe-resolution-502`.
- Merge outside a Breadth pass window.
- Confirm the Breadth V2 durable runner's service does not watch `api/**`.

**Check:**
- The web deploy is ACTIVE.
- `/api/fundamentals/pit/catalog` returns 404.
- In a ChartWidget EXTRA TAB (never Main Trading), the Fundamentals tab shows the notice.
- A chart with an RSI and a `sym:` pane still captions correctly.

**Rollback:** revert the merge commit. For the readout fix alone, revert `cb4fb9a67`.

## Stage 2 — worker-side store + backfill (production data: owner go)

**Do:** on the WORKER, never web (see `uct-railway-pod-memory-limits`):
- Set `FUNDAMENTALS_PIT_DB_PATH` to a path on the worker volume.
- Populate the split ledger from Massive (`--splits-massive FROM TO`, production allow-list `("massive",)`).
- Run the backfill from the SEC bulk archives, which are about 3 GB to download once:

```
python -m api.services.fundamentals_pit.backfill --db $FUNDAMENTALS_PIT_DB_PATH \
  --bulk-companyfacts companyfacts.zip --bulk-submissions submissions.zip \
  --fs-zip <FS quarter zips> --splits-massive 2003-01-01 <today> --all --workers 4 --report report.json
```

`SEC_MAX_RPS` defaults to 5 (cap 9) with the declared UA. Local measurement: 3,503 companies, 604 MB, 115 s on 8 processes. Expect it to be slower on the worker.

**Check:**
- `report.json` shows 0 failures.
- `split_unverified` is re-measured with the real Massive ledger. Locally it was 386 against a 17-ticker fixture, which is expected to drop sharply.
- `explain_cli --sample 300` gives 300/300.

**Rollback:** delete the store file. Nothing reads it yet.

## Stage 3 — publish artifacts to R2 (production R2 write: owner go)

**Do:** `FUNDAMENTALS_PIT_PUBLISH_R2=1` on the worker only; publish every company plus the index under `fundamentals_pit/v2/`.

**Check:** the index resolves AAPL/JPM/TSLA; artifact sizes are about p50 38 KB, p95 82 KB.

**Rollback:** delete the `fundamentals_pit/v2/` prefix. It is new and nothing else reads it.

## Stage 4 — turn serving on (production env: owner go)

**Do:** on web, set `FUNDAMENTALS_PIT_SOURCE=r2`, then `FUNDAMENTALS_PIT_ENABLED=1`.

**Check:** in a ChartWidget EXTRA TAB, add Revenue (Quarterly), P/E and Beta through Chart Settings → Indicators → Fundamentals.
- Step for quarterly, line for P/E and Beta.
- `$`, `x` and `%` on legend and axis.
- JPM: no Gross Margin pane, and Net Margin correctly captioned.
- Verify the served lazy chunk by grepping for the `fund:` string literal (`daily-first-paint-authority`).

**Rollback:** unset `FUNDAMENTALS_PIT_ENABLED`. The API returns 404, the tab shows the notice, and charts holding `fund:` instances draw nothing. Stored settings are untouched and come back when the flag is re-enabled.

## Stage 5 — incremental ingestion (after a day on Stage 4)

**Do:** schedule `incremental.poll` → `enqueue` → `drain` → publish on the worker, respecting SEC fair access. `reconcile` runs nightly.

**Check:**
- A filing accepted today appears after its `public_at`, never before.
- The next session for filings accepted after 17:30.

**Rollback:** remove the schedule. Served artifacts simply stop advancing.

---

## Follow-ups (not blocking)

- Knowledge-layer design pass for D4.
- Compact Beta encoding (`[t,v]`): 89 KB → 61 KB gzip for AAPL.
- An on-chart "no data for SYMBOL" state for an own-pane fundamental.
- Pane height budgets still count a phantom slot for an all-NaN host (`pane-height-budgets-not-reorder-aware` family). Readouts are now correct.
