# Chart-data invariant rails (P0)

These tests guard the bar data path while the BarStore consolidation is in progress.

| File | What it guards |
|---|---|
| `developingBar.property.test.js` | Seeded fuzz tests of the developing-bar merge (`lib/liveBarMerge`, `lib/realtimeCandle`, `lib/barsStreamManager`) |
| `bucketMath.property.test.js` | Seeded property tests of `chart/barTime` and `chart/liveBuckets` (DST changes, half-days, RTH and ETH) |
| `bucketGridParity.test.js` | Client buckets match `tests/fixtures/bar_bucket_grid_2026.json`. The server side is checked by `tests/test_bucket_grid_parity.py` |
| `writerCensus.census.test.js` | Ratchet on bar writers, caches and rollout `*_PCT` gates (`writerCensus.baseline.json`) |
| `oneKey.census.test.js` | Allowlist of inline cache keys, `/api/bars/` URLs and freshness classifiers (`oneKey.baseline.json`) |

A fuzz failure names its seed. Pass that seed to `forSeeds` to replay it.

## Ratchets go one way

- **A count goes UP, or a new site appears:** the test **fails**. Don't raise the baseline. Route the new writer, cache, key, URL or freshness check through its owning module (the BarStore, `utils/marketSession.js`, and so on). If the owner approves an exception, explain it in the commit.
- **A count goes DOWN:** the test **passes** and prints a `[rails] ... went DOWN` warning. Lower the baseline in the same PR or the next one. Until you do, the slack is room for a writer to come back unnoticed.

## Updating a baseline (after a reduction, or after re-basing onto master)

```sh
cd app
RAILS_WRITE_BASELINE=1 npx vitest run src/components/chart/rails/writerCensus.census.test.js src/components/chart/rails/oneKey.census.test.js
git diff src/components/chart/rails/*.baseline.json
```

Review the diff line by line. Every changed count must be explained by a change you can name: a PR, a file and a reason. A count that went up and can't be explained is the regression this rail exists to catch. In `oneKey.baseline.json`, `at` (file:line) is informational only. Matching is by file plus exact snippet.

## Bucket-grid fixture

Regenerate it only for a grid change the owner has ruled on:
`.venv/Scripts/python tests/fixtures/_gen_bucket_grid.py`. Re-recording the fixture to turn a red parity test green hides a real server/client divergence.

## Known gaps

A contract that current code does not yet meet is pinned with `it.fails` and a TODO. When the gap is fixed, that test turns red. Flip it to `it` in the same PR.
